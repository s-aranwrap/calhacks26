/**
 * Assembles the catalog the recommender sees, with an offline-first fallback chain:
 *
 *   remote (Supabase, if configured) ──fails──▶ last cached remote copy
 *        +  activities imported on this device
 *        └─ if both are empty ──▶ bundled demo data
 *
 * Network problems never block discovery. They only change the banner the
 * user sees ("Showing saved copy from Tuesday").
 */
import { dedupeActivities } from '../core/dedupe.ts';
import type { ActivityRepository, UserStore } from '../core/ports.ts';
import type { Activity } from '../core/types.ts';

export type RemoteStatus = 'not_configured' | 'live' | 'cached' | 'unavailable';

export interface CatalogState {
  activities: Activity[];
  /** True when the bundled sample data is being shown. */
  usesDemo: boolean;
  remoteStatus: RemoteStatus;
  remoteError?: string;
  /** When the cached remote copy was fetched (remoteStatus = cached). */
  cachedAt?: string;
  importedCount: number;
  loadedAt: string;
}

export interface CatalogDeps {
  demo: ActivityRepository;
  remote: ActivityRepository | null;
  store: Pick<UserStore, 'getCachedCatalog' | 'setCachedCatalog' | 'listImportedActivities'>;
  now?: () => Date;
}

export async function loadCatalog(deps: CatalogDeps): Promise<CatalogState> {
  const now = deps.now ?? (() => new Date());
  const imported = await deps.store.listImportedActivities().catch(() => [] as Activity[]);

  let remoteActivities: Activity[] = [];
  let remoteStatus: RemoteStatus = 'not_configured';
  let remoteError: string | undefined;
  let cachedAt: string | undefined;

  if (deps.remote) {
    try {
      remoteActivities = await deps.remote.listActivities();
      remoteStatus = 'live';
      // Caching is best-effort; a failed write must not hide fresh data.
      await deps.store
        .setCachedCatalog({ activities: remoteActivities, origin: 'remote', fetchedAt: now().toISOString() })
        .catch(() => undefined);
    } catch (error) {
      remoteError = (error as Error)?.message ?? 'Unknown error';
      const cached = await deps.store.getCachedCatalog().catch(() => null);
      if (cached && cached.activities.length) {
        remoteActivities = cached.activities;
        remoteStatus = 'cached';
        cachedAt = cached.fetchedAt;
      } else {
        remoteStatus = 'unavailable';
      }
    }
  }

  const combined = dedupeActivities([...remoteActivities, ...imported]).activities;
  const base = {
    remoteStatus,
    importedCount: imported.length,
    loadedAt: now().toISOString(),
    ...(remoteError ? { remoteError } : {}),
    ...(cachedAt ? { cachedAt } : {}),
  };
  if (combined.length) return { activities: combined, usesDemo: false, ...base };

  const demo = await deps.demo.listActivities();
  return { activities: demo, usesDemo: true, ...base };
}
