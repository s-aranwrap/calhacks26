/**
 * App-wide state and actions. Screens call these actions; the business logic
 * itself lives in src/core (recommendations, import) and src/data (storage,
 * catalog sources), so this file is mostly wiring.
 */
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { dedupeActivities } from '@/core/dedupe';
import { importActivities, type ImportFormat, type ImportReport } from '@/core/importer';
import { recommend, type DiscoveryResult, type Recommendation } from '@/core/recommend';
import type {
  Activity,
  ActivityFeedback,
  AdventureEntry,
  BudgetLevel,
  DismissReason,
  GeoPoint,
  Mood,
  Reaction,
  UserHistory,
  UserLocation,
  UserPreferences,
} from '@/core/types';
import { distanceKm, localId } from '@/core/util';
import { loadCatalog, type CatalogState } from '@/data/catalogService';
import { resolveConfig } from '@/data/config';
import { DEMO_CENTER } from '@/data/fixtures/demoActivities';
import { createPackRepository, SF_PACK } from '@/data/packs';
import { DEFAULT_PREFERENCES } from '@/data/local/preferences';
import { createSqliteUserStore } from '@/data/local/sqliteUserStore';
import { createDemoRepository } from '@/data/repositories/demoRepository';
import { createSupabaseRepository } from '@/data/repositories/supabaseRepository';

import { fromExpoSqlite } from './database';

export interface DiscoveryFilters {
  mood: Mood;
  budget: BudgetLevel;
  maxDistanceKm: number | null;
  availableMinutes: number | null;
}

export interface DiscoverySession {
  filters: DiscoveryFilters;
  result: DiscoveryResult;
  /** Every activity shown in this session, so "three more" never repeats. */
  shownIds: string[];
  dismissedIds: string[];
  round: number;
}

interface AppContextValue {
  ready: boolean;
  preferences: UserPreferences;
  catalog: CatalogState | null;
  catalogLoading: boolean;
  history: UserHistory;
  discovery: DiscoverySession | null;
  /** Where distances are measured from (demo town centre when showing sample data). */
  origin: GeoPoint | undefined;

  updatePreferences(patch: Partial<UserPreferences>): Promise<void>;
  completeOnboarding(location: UserLocation | null): Promise<void>;
  reloadCatalog(): Promise<void>;

  startDiscovery(filters: DiscoveryFilters): void;
  showMore(): void;
  endDiscovery(): void;
  dismiss(recommendation: Recommendation, reason: DismissReason | undefined): Promise<void>;

  findActivity(id: string): Activity | null;
  entryFor(id: string): AdventureEntry | undefined;
  save(activity: Activity): Promise<void>;
  unsave(activityId: string): Promise<void>;
  plan(activity: Activity): Promise<void>;
  cancelPlan(activityId: string): Promise<void>;
  complete(activity: Activity): Promise<void>;
  reflect(activityId: string, reaction: Reaction | undefined, reflection: string | undefined): Promise<void>;

  exportHistoryJson(): Promise<string>;
  clearHistory(): Promise<void>;
  importFromText(text: string, format: ImportFormat): Promise<ImportReport>;
  clearImported(): Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const config = resolveConfig();

export function AppProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const store = useMemo(() => createSqliteUserStore(fromExpoSqlite(db)), [db]);

  const [ready, setReady] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [history, setHistory] = useState<UserHistory>({ feedback: [], adventures: [] });
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoverySession | null>(null);

  // Latest preferences for callbacks that run later (event handlers, async work).
  const prefsRef = useRef(preferences);
  useEffect(() => {
    prefsRef.current = preferences;
  }, [preferences]);

  const remote = useMemo(
    () =>
      config.supabase
        ? createSupabaseRepository({ url: config.supabase.url, publishableKey: config.supabase.publishableKey })
        : null,
    [],
  );

  const refreshHistory = useCallback(async () => {
    const [feedback, adventures] = await Promise.all([store.listFeedback(), store.listAdventures()]);
    setHistory({ feedback, adventures });
  }, [store]);

  const cityPack = useMemo(
    () => (config.cityPack === 'sf' ? { pack: SF_PACK, repository: createPackRepository(SF_PACK) } : null),
    [],
  );

  const reloadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      // Sample prices follow the user's currency, read at load time.
      const demo = createDemoRepository({ currency: () => prefsRef.current.currency });
      setCatalog(await loadCatalog({ demo, remote, cityPack, store }));
    } finally {
      setCatalogLoading(false);
    }
  }, [cityPack, remote, store]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await store.getPreferences();
        if (!cancelled && saved) setPreferences(saved);
        await refreshHistory();
      } finally {
        if (!cancelled) setReady(true);
      }
      // The catalog loads after the UI is ready; screens show their own loading state.
      if (!cancelled) await reloadCatalog().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshHistory, reloadCatalog, store]);

  const origin = useMemo<GeoPoint | undefined>(() => {
    if (catalog?.usesDemo) return DEMO_CENTER;
    const loc = preferences.location;
    const user =
      loc && loc.latitude !== undefined && loc.longitude !== undefined
        ? { latitude: loc.latitude, longitude: loc.longitude }
        : undefined;
    const pack = catalog?.cityPack;
    // With a city pack, use the user's position only if they're actually in or near that city;
    // otherwise measure from the city center so a demo outside SF still works.
    if (pack) return user && distanceKm(user, pack.center) <= 50 ? user : pack.center;
    return user;
  }, [catalog?.usesDemo, catalog?.cityPack, preferences.location]);

  const updatePreferences = useCallback(
    async (patch: Partial<UserPreferences>) => {
      const next = { ...prefsRef.current, ...patch };
      setPreferences(next);
      await store.savePreferences(next);
      if (patch.currency && patch.currency !== prefsRef.current.currency && catalog?.usesDemo) await reloadCatalog();
    },
    [catalog?.usesDemo, reloadCatalog, store],
  );

  const completeOnboarding = useCallback(
    (location: UserLocation | null) => updatePreferences({ location, onboardedAt: new Date().toISOString() }),
    [updatePreferences],
  );

  // --- Discovery ------------------------------------------------------------

  const runRecommend = useCallback(
    (filters: DiscoveryFilters, excludeIds: string[]): DiscoveryResult =>
      recommend(
        catalog?.activities ?? [],
        { ...filters, now: new Date(), excludeIds, seed: Date.now() % 2_147_483_647, ...(origin ? { origin } : {}) },
        prefsRef.current,
        history,
      ),
    [catalog?.activities, history, origin],
  );

  const startDiscovery = useCallback(
    (filters: DiscoveryFilters) => {
      const result = runRecommend(filters, []);
      setDiscovery({
        filters,
        result,
        shownIds: result.recommendations.map((r) => r.activity.id),
        dismissedIds: [],
        round: 1,
      });
    },
    [runRecommend],
  );

  const showMore = useCallback(() => {
    setDiscovery((current) => {
      if (!current) return current;
      const result = runRecommend(current.filters, current.shownIds);
      return {
        ...current,
        result,
        shownIds: [...current.shownIds, ...result.recommendations.map((r) => r.activity.id)],
        dismissedIds: [],
        round: current.round + 1,
      };
    });
  }, [runRecommend]);

  const endDiscovery = useCallback(() => setDiscovery(null), []);

  const dismiss = useCallback(
    async (recommendation: Recommendation, reason: DismissReason | undefined) => {
      const { activity, distanceKm } = recommendation;
      const feedback: ActivityFeedback = {
        id: localId('fb'),
        activityId: activity.id,
        kind: 'dismissed',
        createdAt: new Date().toISOString(),
        context: {
          category: activity.category,
          tags: activity.tags,
          ...(activity.price ? { priceMin: activity.price.minAmount } : {}),
          ...(distanceKm !== undefined ? { distanceKm } : {}),
          ...(activity.startAt ? { startAt: activity.startAt } : {}),
        },
        ...(reason ? { reason } : {}),
      };
      setDiscovery((current) =>
        current ? { ...current, dismissedIds: [...current.dismissedIds, activity.id] } : current,
      );
      await store.addFeedback(feedback);
      await refreshHistory();
    },
    [refreshHistory, store],
  );

  // --- Adventures -----------------------------------------------------------

  const findActivity = useCallback(
    (id: string) =>
      catalog?.activities.find((a) => a.id === id) ??
      history.adventures.find((e) => e.activityId === id)?.activity ??
      null,
    [catalog?.activities, history.adventures],
  );
  const entryFor = useCallback(
    (id: string) => history.adventures.find((e) => e.activityId === id),
    [history.adventures],
  );

  const withRefresh = useCallback(
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
      async (...args: A) => {
        await fn(...args);
        await refreshHistory();
      },
    [refreshHistory],
  );

  const actions = useMemo(
    () => ({
      save: withRefresh((activity: Activity) => store.saveActivity(activity, new Date())),
      unsave: withRefresh((id: string) => store.unsaveActivity(id)),
      plan: withRefresh(async (activity: Activity) => {
        await store.planActivity(activity, new Date());
        // Committing ends the browsing session: the planned adventure takes focus.
        setDiscovery(null);
      }),
      cancelPlan: withRefresh((id: string) => store.cancelPlan(id, new Date())),
      complete: withRefresh((activity: Activity) => store.completeActivity(activity, new Date())),
      reflect: withRefresh((id: string, reaction: Reaction | undefined, text: string | undefined) =>
        store.saveReflection(id, reaction, text, new Date()),
      ),
    }),
    [store, withRefresh],
  );

  // --- Data management ------------------------------------------------------

  const exportHistoryJson = useCallback(
    async () => JSON.stringify(await store.exportHistory(new Date()), null, 2),
    [store],
  );

  const clearHistory = useCallback(async () => {
    await store.clearHistory();
    setDiscovery(null);
    await refreshHistory();
  }, [refreshHistory, store]);

  const importFromText = useCallback(
    async (text: string, format: ImportFormat) => {
      const report = importActivities(text, format, { now: new Date(), defaultCurrency: prefsRef.current.currency });
      if (report.activities.length) {
        const existing = await store.listImportedActivities();
        // New rows come first so a re-import refreshes older copies of the same listing.
        await store.replaceImportedActivities(dedupeActivities([...report.activities, ...existing]).activities);
        await reloadCatalog();
      }
      return report;
    },
    [reloadCatalog, store],
  );

  const clearImported = useCallback(async () => {
    await store.replaceImportedActivities([]);
    await reloadCatalog();
  }, [reloadCatalog, store]);

  const value: AppContextValue = {
    ready,
    preferences,
    catalog,
    catalogLoading,
    history,
    discovery,
    origin,
    updatePreferences,
    completeOnboarding,
    reloadCatalog,
    startDiscovery,
    showMore,
    endDiscovery,
    dismiss,
    findActivity,
    entryFor,
    ...actions,
    exportHistoryJson,
    clearHistory,
    importFromText,
    clearImported,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

/** The most relevant planned adventure (soonest event first, then most recently planned). */
export function focusAdventure(adventures: AdventureEntry[]): AdventureEntry | undefined {
  const planned = adventures.filter((a) => a.status === 'planned');
  return planned.sort((a, b) => {
    const sa = a.activity.startAt ? Date.parse(a.activity.startAt) : Infinity;
    const sb = b.activity.startAt ? Date.parse(b.activity.startAt) : Infinity;
    if (sa !== sb) return sa - sb;
    return (b.plannedAt ?? '').localeCompare(a.plannedAt ?? '');
  })[0];
}
