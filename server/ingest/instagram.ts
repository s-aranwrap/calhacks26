/**
 * Optional Instagram discovery through Apify's `apify/instagram-scraper` actor.
 *
 * What this does, deliberately and no more:
 *  - runs the actor once for a handful of configured profile/post URLs,
 *  - turns each post into a *candidate* activity using only what the post
 *    itself contains (caption, hashtags, tagged location name, timestamps, URL),
 *  - stores candidates in a non-public review table.
 *
 * What it does not do:
 *  - it never marks anything verified or published,
 *  - it never guesses dates, prices or addresses from caption text. Date-like
 *    phrases are surfaced as `reviewHints` for a human to check,
 *  - it doesn't store Instagram image URLs (they expire, and re-hosting
 *    images raises rights questions),
 *  - it is not a scheduler or crawler. Run it by hand when you want fresh candidates.
 *
 * Field names follow the actor's documented input/output at the time of
 * writing; check the actor's input schema in Apify Console if a run fails.
 */
import type { RawActivityRecord } from '../../src/core/normalize.ts';
import type { Category } from '../../src/core/types.ts';
import { instagramShortcodeFromUrl } from '../../src/core/urls.ts';
import { redact } from './env.ts';

export interface InstagramScraperInput {
  directUrls: string[];
  resultsType: 'posts';
  resultsLimit: number;
  /** e.g. "14 days" or "2026-10-01". */
  onlyPostsNewerThan?: string;
  addParentData?: boolean;
}

export interface ApifyRunOptions {
  token: string;
  actorId: string;
  /** Actor input; the Instagram shape by default, any JSON object for other actors. */
  input: InstagramScraperInput | Record<string, unknown>;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Seconds the actor may run; the synchronous endpoint waits at most 300 s. */
  timeoutSecs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class ApifyError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApifyError';
    this.status = status;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs the actor and returns its dataset items. Retries rate limits (429) and
 * transient server errors with exponential backoff, honouring Retry-After.
 * The token goes in the Authorization header (never the URL) and is redacted
 * from any error text.
 */
export async function runInstagramScraper(options: ApifyRunOptions): Promise<unknown[]> {
  return runApifyActor(options);
}

/** Runs any Apify actor synchronously and returns its dataset items. */
export async function runApifyActor(options: ApifyRunOptions): Promise<unknown[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 3;
  const timeoutSecs = Math.min(options.timeoutSecs ?? 240, 290);
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(options.actorId)}/run-sync-get-dataset-items?format=json&clean=true&timeout=${timeoutSecs}`;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(options.input),
      });
    } catch (error) {
      if (attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new ApifyError(redact(`Could not reach Apify: ${(error as Error).message}`, options.token));
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new ApifyError(
        `Apify kept failing (HTTP ${response.status}) after ${maxRetries + 1} attempts`,
        response.status,
      );
    }
    if (response.status === 408) {
      throw new ApifyError(
        'The actor run took longer than the synchronous limit. Try fewer URLs or a lower --limit.',
        408,
      );
    }
    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 300);
      const hint = response.status === 401 ? ' Check APIFY_API_TOKEN.' : '';
      throw new ApifyError(
        redact(`Apify request failed (HTTP ${response.status}).${hint} ${body}`, options.token),
        response.status,
      );
    }

    let items: unknown;
    try {
      items = await response.json();
    } catch {
      throw new ApifyError('Apify returned a response that is not JSON');
    }
    if (!Array.isArray(items)) throw new ApifyError('Apify returned something other than a list of items');
    return items;
  }
}

// ---------------------------------------------------------------------------
// Normalization: Instagram post → candidate record
// ---------------------------------------------------------------------------

interface InstagramPost {
  id?: unknown;
  shortCode?: unknown;
  url?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  timestamp?: unknown;
  locationName?: unknown;
  ownerUsername?: unknown;
  ownerFullName?: unknown;
  error?: unknown;
  errorDescription?: unknown;
}

export interface CandidateRecord {
  record: RawActivityRecord;
  reviewHints: string[];
  raw: unknown;
}

export type PostSkipReason = 'actor_error' | 'not_a_post' | 'missing_shortcode';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Date/time-looking phrases, offered to reviewers. Never parsed into fields. */
const DATE_HINT_PATTERNS: RegExp[] = [
  /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b[^.\n]{0,30}/gi,
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
  /\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/g,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b/gi,
  /(?:[$€£]\s?\d+(?:[.,]\d{2})?|\bfree\b|\btickets?\b|\bsold out\b)/gi,
];

export function reviewHintsFromCaption(caption: string): string[] {
  const hints = new Set<string>();
  for (const pattern of DATE_HINT_PATTERNS) {
    for (const match of caption.matchAll(pattern)) hints.add(match[0].trim());
  }
  return [...hints].slice(0, 10);
}

function titleFromCaption(caption: string | undefined, owner: string | undefined): string {
  const firstLine = caption
    ?.split('\n')
    .map((l) => l.replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim())
    .find((l) => l.length > 0);
  if (firstLine) return firstLine.length > 100 ? `${firstLine.slice(0, 99).trimEnd()}…` : firstLine;
  return owner ? `Instagram post from @${owner}` : 'Instagram post';
}

export function instagramPostToCandidate(
  item: unknown,
  options: { category?: Category } = {},
): { ok: true; candidate: CandidateRecord } | { ok: false; reason: PostSkipReason } {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'not_a_post' };
  const post = item as InstagramPost;
  if (post.error || post.errorDescription) return { ok: false, reason: 'actor_error' };

  const url = str(post.url);
  const shortCode = str(post.shortCode) ?? (url ? instagramShortcodeFromUrl(url) : undefined);
  if (!shortCode || !/^[A-Za-z0-9_-]+$/.test(shortCode)) return { ok: false, reason: 'missing_shortcode' };

  const caption = str(post.caption);
  const owner = str(post.ownerUsername);
  const hashtags = Array.isArray(post.hashtags) ? post.hashtags.filter((h): h is string => typeof h === 'string') : [];

  const record: RawActivityRecord = {
    title: titleFromCaption(caption, owner),
    description: caption ?? '',
    tags: hashtags.map((h) => h.replace(/^#/, '').toLowerCase()),
    source_platform: 'instagram',
    source_id: shortCode,
    source_url: `https://www.instagram.com/p/${shortCode}/`,
    source_label: owner ? `@${owner} on Instagram` : 'Instagram',
    verification_status: 'candidate',
    availability: 'unknown',
    ...(typeof post.timestamp === 'string' ? { source_published_at: post.timestamp } : {}),
    ...(str(post.locationName) ? { venue_name: str(post.locationName) } : {}),
    ...(options.category ? { category: options.category } : {}),
  };

  const reviewHints = caption ? reviewHintsFromCaption(caption) : [];
  return { ok: true, candidate: { record, reviewHints, raw: item } };
}
