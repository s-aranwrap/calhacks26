/**
 * Supabase catalog adapter (read-only).
 *
 * Talks to Supabase's PostgREST endpoint with plain `fetch` instead of the
 * supabase-js client: the app only needs one read query, so this avoids a
 * dependency and its React Native polyfills.
 *
 * Security: this runs on the device, so it must only ever receive the
 * project's *publishable* (anon) key. Row-level security in
 * supabase/migrations limits that key to published catalog rows. Secret /
 * service-role keys belong to server/ingest only.
 */
import { dedupeActivities } from '../../core/dedupe.ts';
import { normalizeActivity } from '../../core/normalize.ts';
import type { ActivityRepository } from '../../core/ports.ts';
import type { Activity } from '../../core/types.ts';

export class CatalogFetchError extends Error {
  readonly kind: 'network' | 'timeout' | 'http' | 'malformed';
  readonly status: number | undefined;
  constructor(kind: CatalogFetchError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'CatalogFetchError';
    this.kind = kind;
    this.status = status;
  }
}

export interface SupabaseRepositoryOptions {
  url: string;
  publishableKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  /** Upper bound on rows fetched; the MVP catalog is small and filtered on-device. */
  limit?: number;
  onWarning?: (message: string) => void;
}

export function createSupabaseRepository(options: SupabaseRepositoryOptions): ActivityRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const now = options.now ?? (() => new Date());
  const base = options.url.replace(/\/+$/, '');
  const limit = options.limit ?? 1000;

  return {
    name: 'supabase',
    async listActivities({ signal } = {}) {
      const params = new URLSearchParams({
        select: '*',
        published: 'eq.true',
        order: 'start_at.asc.nullslast',
        limit: String(limit),
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort);

      let response: Response;
      try {
        response = await fetchImpl(`${base}/rest/v1/activities?${params.toString()}`, {
          method: 'GET',
          // Only the `apikey` header: works for both new publishable keys and legacy anon JWTs.
          headers: { apikey: options.publishableKey, Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted && !signal?.aborted)
          throw new CatalogFetchError('timeout', `Catalog request timed out after ${timeoutMs} ms`);
        throw new CatalogFetchError('network', (error as Error)?.message ?? 'Network request failed');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }

      if (!response.ok) {
        throw new CatalogFetchError('http', `Catalog request failed with HTTP ${response.status}`, response.status);
      }

      let rows: unknown;
      try {
        rows = await response.json();
      } catch {
        throw new CatalogFetchError('malformed', 'Catalog response was not valid JSON');
      }
      if (!Array.isArray(rows)) throw new CatalogFetchError('malformed', 'Catalog response was not a list');

      const at = now();
      const activities: Activity[] = [];
      let skipped = 0;
      for (const row of rows) {
        const result = normalizeActivity(row, { platform: 'supabase', now: at });
        if (result.ok) activities.push(result.activity);
        else skipped++;
      }
      if (skipped) options.onWarning?.(`Skipped ${skipped} malformed catalog rows`);
      return dedupeActivities(activities).activities;
    },
  };
}
