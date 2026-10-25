/**
 * Optional: reads events out of Instagram captions with Claude, for the posts
 * the rule-based reader can't handle well (chatty captions, unusual date
 * formats, roundups with no consistent layout).
 *
 * Turned on with `npm run ingest:sf -- --ai` and ANTHROPIC_API_KEY in
 * server/.env. Runs only on your computer, never in the app.
 *
 * Guardrails, because a model can be confidently wrong:
 *  - it must quote the caption text each date came from, and an event whose
 *    quote isn't really in the caption is dropped;
 *  - dates, times and prices are validated like any imported record;
 *  - nothing it says can mark a record verified;
 *  - answers are cached per caption, so re-running costs nothing;
 *  - any failure falls back to the rule-based reader for that post.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { CaptionEvent } from './extractEvent.ts';

export interface AiExtractorOptions {
  apiKey: string;
  model?: string;
  /** JSON file used to cache answers between runs. */
  cacheFile?: string;
  fetchImpl?: typeof fetch;
  timeZone?: string;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface AiExtractor {
  /** Events in the caption, or null if the model couldn't be used (the caller falls back to rules). */
  extract(caption: string, postedAtIso: string, now: Date): Promise<CaptionEvent[] | null>;
  save(): void;
  stats: { calls: number; cached: number; failures: number; dropped: number };
}

export const DEFAULT_AI_MODEL = 'claude-haiku-5-5';
const PROMPT_VERSION = 2;

const TOOL = {
  name: 'record_events',
  description: 'Record every attendable event the caption announces. Use an empty list when there are none.',
  input_schema: {
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
              description: 'The exact caption text the date came from, copied character for character.',
            },
          },
          required: ['title', 'start_date', 'date_quote'],
        },
      },
    },
    required: ['events'],
  },
} as const;

function systemPrompt(timeZone: string): string {
  return [
    'You extract events from Instagram captions for a San Francisco activity app.',
    `All dates and times are local to ${timeZone}.`,
    'Only include things a person could go to on a specific date: shows, markets, classes, meetups, openings, festivals, exhibitions with an end date, weekly regulars.',
    'Exclude: dates that are ticket sales, deadlines, giveaways, or anything that already happened (recaps, thank-yous).',
    'For weekly regulars ("every Tuesday", "Thursdays"), give the next date on or after the posted date and set recurring.',
    'For "this weekend", "tonight", "tomorrow", resolve against the posted date.',
    'Never invent a time, price or venue: use null when the caption does not say.',
    'date_quote must be copied exactly from the caption.',
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
    if (!quote || !haystack.includes(quote) || !title || !realDate(e.start_date)) {
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
      evidence: [String(e.date_quote)],
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
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const model = options.model ?? DEFAULT_AI_MODEL;
  const timeZone = options.timeZone ?? 'America/Los_Angeles';
  const maxRetries = options.maxRetries ?? 3;
  const cache: Record<string, unknown> =
    options.cacheFile && existsSync(options.cacheFile)
      ? (JSON.parse(readFileSync(options.cacheFile, 'utf8')) as Record<string, unknown>)
      : {};
  const stats = { calls: 0, cached: 0, failures: 0, dropped: 0 };

  async function ask(caption: string, postedDate: string): Promise<unknown> {
    const weekday = new Date(`${postedDate}T12:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    });
    const body = {
      model,
      max_tokens: 1500,
      system: systemPrompt(timeZone),
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Posted on ${weekday}, ${postedDate}.\n\nCaption:\n"""\n${caption.slice(0, 4000)}\n"""`,
        },
      ],
    };
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        const text = (await response.text().catch(() => '')).slice(0, 200).split(options.apiKey).join('[redacted]');
        throw new Error(`Claude API error ${response.status}: ${text}`);
      }
      const json = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
      const tool = json.content?.find((c) => c.type === 'tool_use' && c.name === TOOL.name);
      if (!tool) throw new Error('Claude API answer had no tool call');
      return tool.input;
    }
  }

  return {
    stats,
    async extract(caption, postedAtIso, now) {
      if (!caption.trim()) return [];
      const postedMs = Date.parse(postedAtIso);
      const postedDate = localDate(Number.isFinite(postedMs) ? postedMs : now.getTime(), timeZone);
      const todayDate = localDate(now.getTime(), timeZone);
      const key = createHash('sha256')
        .update(`${PROMPT_VERSION}|${model}|${postedDate}|${caption}`)
        .digest('hex')
        .slice(0, 32);
      let answer = cache[key];
      if (answer === undefined) {
        try {
          stats.calls++;
          answer = await ask(caption, postedDate);
          cache[key] = answer;
        } catch (error) {
          stats.failures++;
          console.warn(`  AI extraction failed, using rules for this post: ${(error as Error).message}`);
          return null;
        }
      } else {
        stats.cached++;
      }
      const { events, dropped } = validateAiEvents(answer, caption, postedDate, todayDate);
      stats.dropped += dropped;
      return events;
    },
    save() {
      if (options.cacheFile) writeFileSync(options.cacheFile, JSON.stringify(cache, null, 1));
    },
  };
}
