/**
 * Optional: reads events out of Instagram posts with an AI model, for the
 * posts the rule-based reader can't handle well (chatty captions, unusual
 * date formats, roundups with no consistent layout, dates only on a flyer).
 *
 * Turned on with `npm run ingest:sf -- --ai` (or `--images`). The service is
 * chosen in server/.env; see aiProviders.ts. The default, Gemini's free tier,
 * costs nothing. Runs only on your computer, never in the app.
 *
 * Guardrails, because a model can be confidently wrong:
 *  - it must quote the text each date came from, and an event whose quote
 *    isn't really in the caption is dropped (image quotes are only accepted
 *    when an image was actually sent, and are marked as such);
 *  - dates, times and prices are validated like any imported record;
 *  - nothing it says can mark a record verified;
 *  - answers are cached per caption, so re-running costs nothing and a run
 *    stopped by a free daily limit picks up where it left off;
 *  - any failure falls back to the rule-based reader for that post.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { QuotaError, type AiImage, type AiProvider } from './aiProviders.ts';
import type { CaptionEvent } from './extractEvent.ts';

export interface AiExtractorOptions {
  provider: AiProvider;
  /** JSON file used to cache answers between runs. */
  cacheFile?: string;
  /** Used to download post images. */
  fetchImpl?: typeof fetch;
  timeZone?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface AiExtractOptions {
  /**
   * The post's image (Apify's displayUrl). Many event posts put the date and
   * venue on a flyer and write only "link in bio" in the caption, so the model
   * looks at the image too. Instagram image links expire after a few days, so
   * this works on fresh runs; an expired link falls back to the caption only.
   */
  imageUrl?: string;
}

export interface AiStats {
  calls: number;
  cached: number;
  failures: number;
  dropped: number;
  images: number;
  /** Set when the service's quota ran out; later posts used the rules. */
  quotaHit: boolean;
}

export interface AiExtractor {
  /** Events in the post, or null if the model couldn't be used (the caller falls back to rules). */
  extract(caption: string, postedAtIso: string, now: Date, extra?: AiExtractOptions): Promise<CaptionEvent[] | null>;
  /** Picks a model and checks the service is reachable, before the run starts. */
  prepare(): Promise<void>;
  save(): void;
  readonly label: string;
  stats: AiStats;
}

const PROMPT_VERSION = 4;

/** The answer every provider must return. */
export const EVENTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short event name, max 80 characters, in the caption’s words.' },
          venue: { type: ['string', 'null'], description: 'Venue or place name as written, or null.' },
          start_date: { type: 'string', description: 'YYYY-MM-DD' },
          end_date: { type: ['string', 'null'], description: 'YYYY-MM-DD for multi-day runs, else null.' },
          start_time: { type: ['string', 'null'], description: '24h HH:MM if a time is written, else null.' },
          end_time: { type: ['string', 'null'], description: '24h HH:MM if written, else null.' },
          is_free: { type: ['boolean', 'null'] },
          price_min: { type: ['number', 'null'], description: 'Lowest ticket price in USD if written.' },
          price_max: { type: ['number', 'null'] },
          recurring: { type: 'boolean', description: 'True for weekly regulars such as "every Tuesday".' },
          date_quote: {
            type: 'string',
            description: 'The exact text the date came from, copied character for character.',
          },
          seen_in: {
            type: 'string',
            enum: ['caption', 'image'],
            description: 'Where date_quote appears: the caption, or only the attached image.',
          },
        },
        required: ['title', 'start_date', 'date_quote'],
      },
    },
  },
  required: ['events'],
};

function systemPrompt(timeZone: string): string {
  return [
    'You extract events from Instagram captions for a San Francisco activity app.',
    `All dates and times are local to ${timeZone}.`,
    'Only include things a person could go to on a specific date: shows, markets, classes, meetups, openings, festivals, exhibitions with an end date, weekly regulars.',
    'Exclude: dates that are ticket sales, deadlines, giveaways, or anything that already happened (recaps, thank-yous).',
    'For weekly regulars ("every Tuesday", "Thursdays"), give the next date on or after the posted date and set recurring.',
    'For "this weekend", "tonight", "tomorrow", resolve against the posted date.',
    'Never invent a time, price or venue: use null when the caption does not say.',
    'date_quote must be copied exactly from where you read it.',
    'If an image is attached it is the post itself, often a flyer: read dates, times, venues and prices from it too, and set seen_in to "image" when the date appears only in the image.',
  ].join(' ');
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function realDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const dayNum = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;

/** Validates the model's answer. Exported for tests. */
export function validateAiEvents(
  input: unknown,
  caption: string,
  postedDate: string,
  todayDate: string,
  options: { imageSent?: boolean } = {},
): { events: CaptionEvent[]; dropped: number } {
  const list = (input as { events?: unknown })?.events;
  if (!Array.isArray(list)) return { events: [], dropped: 0 };
  const haystack = squash(caption);
  const events: CaptionEvent[] = [];
  let dropped = 0;
  for (const raw of list.slice(0, 12)) {
    const e = raw as Record<string, unknown>;
    const quote = typeof e.date_quote === 'string' ? squash(e.date_quote) : '';
    const title = typeof e.title === 'string' ? e.title.trim().slice(0, 100) : '';
    // A quote from the caption is checked word for word. One read off the image can't be
    // checked here, so it's only accepted when an image was actually sent.
    const fromImage = e.seen_in === 'image' && options.imageSent === true;
    const quoteOk = quote.length > 0 && (haystack.includes(quote) || fromImage);
    if (!quoteOk || !title || !realDate(e.start_date)) {
      dropped++;
      continue;
    }
    const start = e.start_date;
    const end = realDate(e.end_date) && dayNum(e.end_date) > dayNum(start) ? e.end_date : undefined;
    // Plausible window: from a week before the post to ~10 months after; and not already over.
    if (dayNum(start) < dayNum(postedDate) - 7 || dayNum(start) > dayNum(postedDate) + 300) {
      dropped++;
      continue;
    }
    if (dayNum(end ?? start) < dayNum(todayDate)) continue;
    const date = end && dayNum(start) < dayNum(todayDate) ? todayDate : start;
    const startTime = typeof e.start_time === 'string' && TIME.test(e.start_time) ? e.start_time : undefined;
    const endTime = typeof e.end_time === 'string' && TIME.test(e.end_time) ? e.end_time : undefined;
    const allDay = !startTime || end !== undefined;
    const price = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2000 ? v : undefined);
    const priceMin = price(e.price_min);
    const priceMax = price(e.price_max);
    const venue = typeof e.venue === 'string' && e.venue.trim() ? e.venue.trim().slice(0, 100) : undefined;
    const event: CaptionEvent = {
      title,
      date,
      allDay,
      text: caption,
      evidence: [
        fromImage && !haystack.includes(quote) ? `on the post image: ${String(e.date_quote)}` : String(e.date_quote),
      ],
      ...(venue ? { venue } : {}),
      ...(end ? { endDate: end } : {}),
      ...(e.recurring === true ? { recurring: true } : {}),
      ...(e.is_free === true && !priceMin ? { isFree: true } : {}),
      ...(priceMin !== undefined && e.is_free !== true ? { priceMin } : {}),
      ...(priceMax !== undefined && priceMin !== undefined && priceMax > priceMin ? { priceMax } : {}),
    };
    if (!allDay && startTime) {
      event.startWall = `${date} ${startTime}`;
      if (endTime && endTime > startTime) event.endWall = `${date} ${endTime}`;
    }
    events.push(event);
  }
  return { events, dropped };
}

function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createAiExtractor(options: AiExtractorOptions): AiExtractor {
  const { provider } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeZone = options.timeZone ?? 'America/Los_Angeles';
  const cache: Record<string, unknown> =
    options.cacheFile && existsSync(options.cacheFile)
      ? (JSON.parse(readFileSync(options.cacheFile, 'utf8')) as Record<string, unknown>)
      : {};
  const stats: AiStats = { calls: 0, cached: 0, failures: 0, dropped: 0, images: 0, quotaHit: false };
  let lastCall = 0;
  const persist = () => {
    if (options.cacheFile) writeFileSync(options.cacheFile, JSON.stringify(cache, null, 1));
  };

  /** Downloads an image as base64, or null if it can't be used. */
  async function loadImage(url: string): Promise<AiImage | null> {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) return null;
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 4_500_000) return null;
      return { media_type: type, data: bytes.toString('base64') };
    } catch {
      return null;
    }
  }

  async function ask(caption: string, postedDate: string, image: AiImage | null): Promise<unknown> {
    const wait = lastCall + provider.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const weekday = new Date(`${postedDate}T12:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return provider.ask({
      system: systemPrompt(timeZone),
      schema: EVENTS_SCHEMA,
      image,
      text:
        `Posted on ${weekday}, ${postedDate}.${image ? ' The image is the post.' : ''}\n\n` +
        `Caption:\n"""\n${caption.slice(0, 4000) || '(no caption)'}\n"""\n\n` +
        'Answer with JSON: {"events": [...]}, using an empty list when there are no events.',
    });
  }

  return {
    stats,
    get label() {
      return `${provider.name} (${provider.model || 'auto'})`;
    },
    prepare: () => provider.prepare(),
    async extract(caption, postedAtIso, now, extra = {}) {
      if (!caption.trim() && !extra.imageUrl) return [];
      const postedMs = Date.parse(postedAtIso);
      const postedDate = localDate(Number.isFinite(postedMs) ? postedMs : now.getTime(), timeZone);
      const todayDate = localDate(now.getTime(), timeZone);
      // Image links change on every scrape, so a key records only whether an image was sent.
      const keyFor = (kind: 'img' | 'text') =>
        createHash('sha256')
          .update(`${PROMPT_VERSION}|${provider.name}|${provider.model}|${postedDate}|${kind}|${caption}`)
          .digest('hex')
          .slice(0, 32);
      let imageSent = false;
      let answer: unknown;
      if (extra.imageUrl && cache[keyFor('img')] !== undefined) {
        answer = cache[keyFor('img')];
        imageSent = true;
        stats.cached++;
      } else if (!extra.imageUrl && cache[keyFor('text')] !== undefined) {
        answer = cache[keyFor('text')];
        stats.cached++;
      } else {
        // Once the quota is used up, the rest of the run uses the rules (answers so far stay cached).
        if (stats.quotaHit) return null;
        // An expired or unusable image link falls back to a caption-only answer.
        const image = extra.imageUrl ? await loadImage(extra.imageUrl) : null;
        const key = keyFor(image ? 'img' : 'text');
        if (!image && cache[key] !== undefined) {
          answer = cache[key];
          stats.cached++;
        } else {
          if (!image && !caption.trim()) return [];
          try {
            stats.calls++;
            if (image) stats.images++;
            answer = await ask(caption, postedDate, image);
            cache[key] = answer;
            // Save as we go, so a stopped run (or a used-up free quota) keeps what it paid for.
            if (stats.calls % 10 === 0) persist();
          } catch (error) {
            stats.failures++;
            if (error instanceof QuotaError) {
              stats.quotaHit = true;
              console.warn(`  ${provider.name} quota used up; the rest of this run uses the built-in rules.`);
            } else {
              console.warn(`  AI reading failed, using rules for this post: ${(error as Error).message}`);
            }
            return null;
          }
        }
        imageSent = image !== null;
      }
      const { events, dropped } = validateAiEvents(answer, caption, postedDate, todayDate, { imageSent });
      stats.dropped += dropped;
      return events;
    },
    save: persist,
  };
}
