/**
 * Interfaces between the app and its data sources. The UI and the
 * recommender depend only on these, so a data source can be swapped (demo
 * fixtures, Supabase, an imported file) without touching screens.
 */
import type { Activity, ActivityFeedback, AdventureEntry, CompletedQuest, Reaction, UserPreferences } from './types.ts';

export type CatalogOrigin = 'demo' | 'remote' | 'cache';

export interface CatalogSnapshot {
  activities: Activity[];
  origin: CatalogOrigin;
  fetchedAt: string;
}

/** Read-only access to the shared activity catalog. */
export interface ActivityRepository {
  /** Short identifier for logs and the Settings screen ("demo", "supabase"). */
  readonly name: string;
  listActivities(options?: { signal?: AbortSignal }): Promise<Activity[]>;
}

/** On-device store for everything personal. Implemented with SQLite in the app. */
export interface UserStore {
  getPreferences(): Promise<UserPreferences | null>;
  savePreferences(preferences: UserPreferences): Promise<void>;

  listFeedback(): Promise<ActivityFeedback[]>;
  addFeedback(feedback: ActivityFeedback): Promise<void>;

  listAdventures(): Promise<AdventureEntry[]>;
  getAdventure(activityId: string): Promise<AdventureEntry | null>;
  saveActivity(activity: Activity, now: Date): Promise<AdventureEntry>;
  planActivity(activity: Activity, now: Date): Promise<AdventureEntry>;
  /** Cancels a plan. Keeps the activity in Saved if it was saved before, otherwise removes it. */
  cancelPlan(activityId: string, now: Date): Promise<AdventureEntry | null>;
  unsaveActivity(activityId: string): Promise<void>;
  completeActivity(activity: Activity, now: Date): Promise<AdventureEntry>;
  saveReflection(
    activityId: string,
    reaction: Reaction | undefined,
    reflection: string | undefined,
    now: Date,
  ): Promise<void>;

  /** Activities the user imported from a CSV/JSON file on this device. */
  listImportedActivities(): Promise<Activity[]>;
  replaceImportedActivities(activities: Activity[]): Promise<void>;

  /** Last successful remote catalog, used when offline. */
  getCachedCatalog(): Promise<CatalogSnapshot | null>;
  setCachedCatalog(snapshot: CatalogSnapshot): Promise<void>;

  exportHistory(now: Date): Promise<HistoryExport>;
  /** Deletes feedback, adventures and reflections. Keeps preferences and imported catalog data. */
  clearHistory(): Promise<void>;
}

export interface HistoryExport {
  app: 'huddle';
  formatVersion: 1;
  exportedAt: string;
  preferences: UserPreferences | null;
  saved: AdventureEntry[];
  planned: AdventureEntry[];
  completed: CompletedQuest[];
  feedback: ActivityFeedback[];
}
