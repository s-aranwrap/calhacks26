/**
 * Writes catalog rows to Supabase with a *secret* key. Server-side only: this
 * key bypasses row-level security and must never be shipped in the app.
 *
 * Activity rows use the same snake_case columns as the import format, so a row
 * written here reads back through the app's normalizeActivity unchanged.
 */
import { canonicalizeUrl } from '../../src/core/urls.ts';
import type { Activity } from '../../src/core/types.ts';

/** One row as sent to PostgREST. jsonb columns take plain objects. */
export type CatalogRow = Record<string, unknown>;

export function activityToRow(activity: Activity, options: { published: boolean }): CatalogRow {
  const { venue, price, duration, source, challenge } = activity;
  return {
    id: activity.id,
    kind: activity.kind,
    title: activity.title,
    description: activity.description,
    category: activity.category,
    moods: activity.moods,
    tags: activity.tags,
    venue_name: venue?.name ?? null,
    address: venue?.address ?? null,
    area: venue?.area ?? null,
    latitude: venue?.latitude ?? null,
    longitude: venue?.longitude ?? null,
    start_at: activity.startAt ?? null,
    end_at: activity.endAt ?? null,
    time_zone: activity.timeZone ?? null,
    opening_hours: activity.openingHours ?? null,
    duration_min_minutes: duration?.minMinutes ?? null,
    duration_max_minutes: duration?.maxMinutes ?? null,
    duration_certainty: duration?.certainty ?? null,
    is_free: price ? price.minAmount === 0 : null,
    price_min: price?.minAmount ?? null,
    price_max: price?.maxAmount ?? null,
    currency: price?.currency ?? null,
    price_certainty: price?.certainty ?? null,
    price_note: price?.note ?? null,
    source_platform: source.platform,
    source_id: source.sourceId ?? null,
    source_url: source.url ?? null,
    canonical_url: canonicalizeUrl(source.url) ?? null,
    source_label: source.label ?? null,
    source_published_at: source.publishedAt ?? null,
    verification_status: activity.verification.status,
    last_checked_at: activity.verification.lastCheckedAt ?? null,
    availability: activity.availability,
    image_url: activity.imageUrl ?? null,
    what_to_expect: activity.whatToExpect ?? null,
    why_try: activity.whyTry ?? null,
    restrictions: activity.restrictions ?? null,
    challenge_novelty: challenge?.novelty ?? null,
    challenge_social: challenge?.social ?? null,
    challenge_physical: challenge?.physical ?? null,
    challenge_commitment: challenge?.commitment ?? null,
    // Candidates can never be published; the database enforces this too.
    published: options.published && activity.verification.status !== 'candidate',
  };
}

export interface SupabaseWriterOptions {
  url: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
  batchSize?: number;
}

export class SupabaseWriteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SupabaseWriteError';
    this.status = status;
  }
}

export function createSupabaseWriter(options: SupabaseWriterOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const batchSize = options.batchSize ?? 200;
  const headers: Record<string, string> = {
    apikey: options.secretKey,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys don't.
  if (options.secretKey.startsWith('eyJ')) headers.Authorization = `Bearer ${options.secretKey}`;

  async function upsert(table: string, rows: CatalogRow[]): Promise<number> {
    let written = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const response = await fetchImpl(`${options.url}/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers,
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new SupabaseWriteError(
          `Upsert into ${table} failed (HTTP ${response.status}): ${detail}`,
          response.status,
        );
      }
      written += batch.length;
    }
    return written;
  }

  return {
    upsertActivities(activities: Activity[], published: boolean) {
      return upsert(
        'activities',
        activities.map((a) => activityToRow(a, { published })),
      );
    },
    /** Discovered candidates go to a separate, non-public table for human review. */
    upsertCandidates(candidates: { activity: Activity; raw: unknown; reviewHints: string[] }[]) {
      const rows: CatalogRow[] = candidates.map(({ activity, raw, reviewHints }) => ({
        id: activity.id,
        source_platform: activity.source.platform,
        source_id: activity.source.sourceId ?? null,
        source_url: activity.source.url ?? null,
        candidate: activity,
        raw,
        review_hints: reviewHints,
        discovered_at: activity.source.retrievedAt ?? new Date().toISOString(),
      }));
      return upsert('activity_candidates', rows);
    },
  };
}
