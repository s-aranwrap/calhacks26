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
import type { Activity, GeoPoint } from '../core/types.ts';
import type { CityPack } from './packs/index.ts';

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
  /** Set when a bundled city pack (e.g. San Francisco) is part of the catalog. */
  cityPack?: { city: string; center: GeoPoint; centerLabel: string; eventsUpdatedAt: string | null };
  loadedAt: string;
}

export interface CatalogDeps {
  demo: ActivityRepository;
  remote: ActivityRepository | null;
  /** Bundled real-world pack, merged with remote and imported data. */
  cityPack?: { pack: CityPack; repository: ActivityRepository } | null;
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

  const packActivities = deps.cityPack ? await deps.cityPack.repository.listActivities().catch(() => []) : [];
  // Remote and imported entries come first, so they win over a bundled copy of the same listing.
  const combined = dedupeActivities([...remoteActivities, ...imported, ...packActivities]).activities;
  const base = {
    remoteStatus,
    importedCount: imported.length,
    loadedAt: now().toISOString(),
    ...(remoteError ? { remoteError } : {}),
    ...(cachedAt ? { cachedAt } : {}),
    ...(deps.cityPack && packActivities.length
      ? {
          cityPack: {
            city: deps.cityPack.pack.city,
            center: deps.cityPack.pack.center,
            centerLabel: deps.cityPack.pack.centerLabel,
            eventsUpdatedAt: deps.cityPack.pack.eventsUpdatedAt,
          },
        }
      : {}),
  };
  if (combined.length) return { activities: combined, usesDemo: false, ...base };

  const demo = await deps.demo.listActivities();
  return { activities: demo, usesDemo: true, ...base };
}
