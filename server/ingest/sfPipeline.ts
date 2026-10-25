/**
 * Turns raw Apify Instagram items into Huddle activity records for the San
 * Francisco demo pack. Pure apart from the optional geocoder, so it's tested
 * without the network and can re-process saved raw runs without spending
 * Apify credits again.
 *
 * Demo-mode publishing: records are marked "unverified" (not "candidate") so
 * they show in the app, always labeled Unverified with a link to the post.
 * Before a public launch, put the review step back in front of this.
 */
import { normalizeActivity, type RawActivityRecord } from '../../src/core/normalize.ts';
import { extractEventsFromCaption, guessCategory, type CaptionEvent } from './extractEvent.ts';
import type { GeoHit } from './geocode.ts';
import { instagramPostToCandidate } from './instagram.ts';

export interface SfSource {
  url: string;
  limit: number;
  category: string;
  confirmed?: boolean;
  note?: string;
}

export interface SfSourcesConfig {
  city: string;
  timeZone: string;
  newerThan: string;
  maxResultsPerRun: number;
  sources: SfSource[];
}

export interface PipelineReport {
  items: number;
  /** Events written (a roundup post can give several). */
  kept: number;
  /** Posts that gave at least one event. */
  postsWithEvents: number;
  /** Events read by Claude rather than the rules (with --ai). */
  fromAi: number;
  skipped: Record<string, number>;
  perSource: Record<string, number>;
}

/** Most results the run could return; used to keep Apify usage predictable. */
export function maxResults(config: SfSourcesConfig): number {
  return config.sources.reduce((sum, s) => sum + s.limit, 0);
}

export function sourceFor(item: Record<string, unknown>, sources: SfSource[]): SfSource | undefined {
  const input = typeof item.inputUrl === 'string' ? item.inputUrl.replace(/\/+$/, '').toLowerCase() : '';
  const owner = typeof item.ownerUsername === 'string' ? item.ownerUsername.toLowerCase() : '';
  return sources.find((s) => {
    const url = s.url.replace(/\/+$/, '').toLowerCase();
    return (input && url === input) || (owner && url.endsWith(`/${owner}`));
  });
}

export interface PipelineOptions {
  now: Date;
  geocode?: (venue: string) => Promise<GeoHit>;
  /** Optional Claude reader; returns null to fall back to the rules for a post. */
  aiExtract?: (
    caption: string,
    postedAtIso: string,
    now: Date,
    extra?: { imageUrl?: string },
  ) => Promise<CaptionEvent[] | null>;
  /** Also send each post's image to the AI reader (flyers often carry the date). */
  readImages?: boolean;
}

/** The post's main image URL, if Apify returned one. */
export function postImageUrl(raw: Record<string, unknown>): string | undefined {
  const first = Array.isArray(raw.images) ? raw.images.find((i) => typeof i === 'string') : undefined;
  const url = typeof raw.displayUrl === 'string' ? raw.displayUrl : (first as string | undefined);
  return url && /^https:\/\//.test(url) ? url : undefined;
}

export async function postsToRecords(
  items: unknown[],
  config: SfSourcesConfig,
  options: PipelineOptions,
): Promise<{ records: RawActivityRecord[]; report: PipelineReport }> {
  const report: PipelineReport = {
    items: items.length,
    kept: 0,
    postsWithEvents: 0,
    fromAi: 0,
    skipped: {},
    perSource: {},
  };
  const skip = (reason: string) => {
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
  };
  const records: RawActivityRecord[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const converted = instagramPostToCandidate(item);
    if (!converted.ok) {
      skip(converted.reason);
      continue;
    }
    const raw = item as Record<string, unknown>;
    const { record } = converted.candidate;
    const shortcode = String(record.source_id);
    if (seen.has(shortcode)) {
      skip('duplicate');
      continue;
    }
    seen.add(shortcode);

    const caption = typeof raw.caption === 'string' ? raw.caption : '';
    const postedAt = typeof raw.timestamp === 'string' ? raw.timestamp : options.now.toISOString();
    let events: CaptionEvent[] | null = options.aiExtract
      ? await options.aiExtract(caption, postedAt, options.now, {
          ...(options.readImages && postImageUrl(raw) ? { imageUrl: postImageUrl(raw)! } : {}),
        })
      : null;
    const usedAi = events !== null;
    let mode: 'single' | 'multi' = 'single';
    if (events === null) {
      const extracted = extractEventsFromCaption(caption, postedAt, options.now, config.timeZone);
      events = extracted.events;
      mode = extracted.mode;
      if (events.length === 0) {
        skip(extracted.skipped ?? 'no_date');
        continue;
      }
    } else if (events.length === 0) {
      skip('ai_no_event');
      continue;
    }
    const source = sourceFor(raw, config.sources);
    const several = events.length > 1 || mode === 'multi';
    let keptFromPost = 0;

    for (const [index, event] of events.entries()) {
      // The post's tagged location only describes the post as a whole.
      const venueName = event.venue ?? (several ? undefined : (record.venue_name as string | undefined));
      let coords: GeoHit = null;
      if (options.geocode && venueName) coords = await options.geocode(venueName);

      const title = event.title ?? (record.title as string);
      const full: RawActivityRecord = {
        ...record,
        title: event.recurring && !/\b(every|weekly)\b/i.test(title) ? `${title} (weekly)` : title,
        ...(several ? { source_id: `${shortcode}:${index + 1}` } : {}),
        kind: 'event',
        category: guessCategory(event.text, source?.category ?? 'other'),
        start_at: event.allDay ? event.date : (event.startWall ?? event.date),
        ...(event.allDay
          ? { all_day: true, ...(event.endDate ? { end_at: event.endDate } : {}) }
          : event.endWall
            ? { end_at: event.endWall }
            : {}),
        time_zone: config.timeZone,
        ...(event.isFree ? { is_free: true } : {}),
        ...(event.priceMin !== undefined ? { price_min: event.priceMin } : {}),
        ...(event.priceMax !== undefined ? { price_max: event.priceMax } : {}),
        currency: 'USD',
        price_certainty: 'estimated',
        // Demo mode: visible but clearly labeled. See the file header.
        verification_status: 'unverified',
        ...(event.recurring ? { tags: [...((record.tags as string[]) ?? []), 'weekly'] } : {}),
        ...(venueName ? { venue_name: venueName } : { venue_name: undefined, area: config.city }),
        ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
      };
      if (full.venue_name === undefined) delete full.venue_name;

      // Run the app's own normalizer now, so the pack never contains a record the app would reject.
      const check = normalizeActivity(full, { platform: 'json', now: options.now });
      if (!check.ok || !check.activity.startAt) {
        skip('invalid');
        continue;
      }
      records.push(full);
      keptFromPost++;
      report.kept++;
      if (usedAi) report.fromAi++;
      const key = source?.url ?? 'unknown source';
      report.perSource[key] = (report.perSource[key] ?? 0) + 1;
    }
    if (keptFromPost > 0) report.postsWithEvents++;
  }
  return { records, report };
}

/** Source text of the generated module bundled into the app. */
export function renderPackModule(records: RawActivityRecord[], generatedAt: string): string {
  return `// Generated by server/ingest/sf-instagram.ts on ${generatedAt}. Do not edit by hand:
// re-run \`npm run ingest:sf\` (or \`-- --from-raw latest\` to reprocess without Apify).
import type { RawActivityRecord } from '../../core/normalize.ts';

export const SF_INSTAGRAM_GENERATED_AT: string | null = ${JSON.stringify(generatedAt)};

export const SF_INSTAGRAM_RECORDS: RawActivityRecord[] = ${JSON.stringify(records, null, 2)};
`;
}
