/**
 * On-device persistence for preferences, feedback, saved/planned/completed
 * adventures, private reflections and catalog caches.
 *
 * Written against a tiny `SqlDatabase` interface rather than expo-sqlite
 * directly: the app passes expo-sqlite's database (see src/state/database.ts)
 * and the tests pass Node's built-in `node:sqlite`, so the real SQL is tested.
 *
 * Privacy: nothing in here is ever sent to a server. Export is user-initiated.
 */
import type { CatalogSnapshot, HistoryExport, UserStore } from '../../core/ports.ts';
import type {
  Activity,
  ActivityFeedback,
  AdventureEntry,
  AdventureStatus,
  CompletedQuest,
  Reaction,
} from '../../core/types.ts';
import { REACTIONS } from '../../core/types.ts';
import { sanitizePreferences } from './preferences.ts';

export type SqlParam = string | number | null;

export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlParam[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null>;
}

/** Ordered schema migrations, tracked with PRAGMA user_version. Append only. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY NOT NULL,
    activity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    context TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS feedback_activity_idx ON feedback (activity_id);
  CREATE TABLE IF NOT EXISTS adventures (
    activity_id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('saved', 'planned', 'completed')),
    saved_at TEXT,
    planned_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    reaction TEXT,
    reflection TEXT,
    activity TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS catalog_cache (
    key TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
];

export async function migrate(db: SqlDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.execAsync(`BEGIN; ${MIGRATIONS[version]} PRAGMA user_version = ${version + 1}; COMMIT;`);
    version++;
  }
}

interface AdventureRow {
  activity_id: string;
  status: string;
  saved_at: string | null;
  planned_at: string | null;
  completed_at: string | null;
  updated_at: string;
  reaction: string | null;
  reflection: string | null;
  activity: string;
}

interface FeedbackRow {
  id: string;
  activity_id: string;
  kind: string;
  reason: string | null;
  created_at: string;
  context: string;
}

const MAX_REFLECTION_LENGTH = 1000;

function safeJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Minimal shape check so a corrupted row can't crash a screen. */
function isActivityLike(value: unknown): value is Activity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Activity>;
  return (
    typeof v.id === 'string' && typeof v.title === 'string' && !!v.source && !!v.verification && Array.isArray(v.moods)
  );
}

function toEntry(row: AdventureRow): AdventureEntry | null {
  const activity = safeJson<unknown>(row.activity);
  if (!isActivityLike(activity)) return null;
  const status = (['saved', 'planned', 'completed'] as AdventureStatus[]).includes(row.status as AdventureStatus)
    ? (row.status as AdventureStatus)
    : null;
  if (!status) return null;
  const reaction = (REACTIONS as readonly string[]).includes(row.reaction ?? '')
    ? (row.reaction as Reaction)
    : undefined;
  return {
    activityId: row.activity_id,
    status,
    updatedAt: row.updated_at,
    activity,
    ...(row.saved_at ? { savedAt: row.saved_at } : {}),
    ...(row.planned_at ? { plannedAt: row.planned_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(reaction ? { reaction } : {}),
    ...(row.reflection ? { reflection: row.reflection } : {}),
  };
}

function toFeedback(row: FeedbackRow): ActivityFeedback | null {
  const context = safeJson<ActivityFeedback['context']>(row.context);
  if (!context || typeof context.category !== 'string' || !Array.isArray(context.tags)) return null;
  const reasons = ['too_expensive', 'too_far', 'wrong_timing', 'unavailable', 'not_my_thing'];
  return {
    id: row.id,
    activityId: row.activity_id,
    kind: 'dismissed',
    createdAt: row.created_at,
    context,
    ...(row.reason && reasons.includes(row.reason)
      ? { reason: row.reason as NonNullable<ActivityFeedback['reason']> }
      : {}),
  };
}

export function createSqliteUserStore(db: SqlDatabase): UserStore {
  async function getRow(activityId: string): Promise<AdventureRow | null> {
    return db.getFirstAsync<AdventureRow>('SELECT * FROM adventures WHERE activity_id = ?', activityId);
  }

  async function writeEntry(entry: AdventureEntry): Promise<void> {
    await db.runAsync(
      `INSERT INTO adventures (activity_id, status, saved_at, planned_at, completed_at, updated_at, reaction, reflection, activity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET
         status = excluded.status, saved_at = excluded.saved_at, planned_at = excluded.planned_at,
         completed_at = excluded.completed_at, updated_at = excluded.updated_at, reaction = excluded.reaction,
         reflection = excluded.reflection, activity = excluded.activity`,
      entry.activityId,
      entry.status,
      entry.savedAt ?? null,
      entry.plannedAt ?? null,
      entry.completedAt ?? null,
      entry.updatedAt,
      entry.reaction ?? null,
      entry.reflection ?? null,
      JSON.stringify(entry.activity),
    );
  }

  async function current(activityId: string): Promise<AdventureEntry | null> {
    const row = await getRow(activityId);
    return row ? toEntry(row) : null;
  }

  async function readCache<T>(key: string): Promise<T | null> {
    const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM catalog_cache WHERE key = ?', key);
    return safeJson<T>(row?.payload);
  }

  async function writeCache(key: string, payload: unknown, now: Date): Promise<void> {
    await db.runAsync(
      'INSERT INTO catalog_cache (key, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
      key,
      JSON.stringify(payload),
      now.toISOString(),
    );
  }

  const store: UserStore = {
    async getPreferences() {
      const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM preferences WHERE key = 'user'");
      const parsed = safeJson<unknown>(row?.value);
      return parsed ? sanitizePreferences(parsed) : null;
    },

    async savePreferences(preferences) {
      await db.runAsync(
        "INSERT INTO preferences (key, value) VALUES ('user', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        JSON.stringify(sanitizePreferences(preferences)),
      );
    },

    async listFeedback() {
      const rows = await db.getAllAsync<FeedbackRow>('SELECT * FROM feedback ORDER BY created_at DESC');
      return rows.map(toFeedback).filter((f): f is ActivityFeedback => f !== null);
    },

    async addFeedback(feedback) {
      await db.runAsync(
        'INSERT OR REPLACE INTO feedback (id, activity_id, kind, reason, created_at, context) VALUES (?, ?, ?, ?, ?, ?)',
        feedback.id,
        feedback.activityId,
        feedback.kind,
        feedback.reason ?? null,
        feedback.createdAt,
        JSON.stringify(feedback.context),
      );
    },

    async listAdventures() {
      const rows = await db.getAllAsync<AdventureRow>('SELECT * FROM adventures ORDER BY updated_at DESC');
      return rows.map(toEntry).filter((e): e is AdventureEntry => e !== null);
    },

    getAdventure: current,

    async saveActivity(activity, now) {
      const existing = await current(activity.id);
      const iso = now.toISOString();
      if (existing && existing.status !== 'saved') {
        // Saving something already planned or completed must not downgrade it.
        const updated: AdventureEntry = { ...existing, savedAt: existing.savedAt ?? iso, updatedAt: iso };
        await writeEntry(updated);
        return updated;
      }
      const entry: AdventureEntry = {
        activityId: activity.id,
        status: 'saved',
        savedAt: existing?.savedAt ?? iso,
        updatedAt: iso,
        activity,
      };
      await writeEntry(entry);
      return entry;
    },

    async planActivity(activity, now) {
      const existing = await current(activity.id);
      const iso = now.toISOString();
      const entry: AdventureEntry = {
        activityId: activity.id,
        status: 'planned',
        plannedAt: iso,
        updatedAt: iso,
        activity,
        ...(existing?.savedAt ? { savedAt: existing.savedAt } : {}),
      };
      await writeEntry(entry);
      return entry;
    },

    async cancelPlan(activityId, now) {
      const existing = await current(activityId);
      if (!existing || existing.status !== 'planned') return existing;
      if (existing.savedAt) {
        const { plannedAt: _dropped, ...rest } = existing;
        void _dropped;
        const entry: AdventureEntry = { ...rest, status: 'saved', updatedAt: now.toISOString() };
        await writeEntry(entry);
        return entry;
      }
      await db.runAsync('DELETE FROM adventures WHERE activity_id = ?', activityId);
      return null;
    },

    async unsaveActivity(activityId) {
      await db.runAsync("DELETE FROM adventures WHERE activity_id = ? AND status = 'saved'", activityId);
    },

    async completeActivity(activity, now) {
      const existing = await current(activity.id);
      const iso = now.toISOString();
      const entry: AdventureEntry = {
        ...(existing ?? {}),
        activityId: activity.id,
        status: 'completed',
        completedAt: existing?.completedAt ?? iso,
        updatedAt: iso,
        activity: existing?.activity ?? activity,
      };
      await writeEntry(entry);
      return entry;
    },

    async saveReflection(activityId, reaction, reflection, now) {
      const trimmed = reflection?.trim().slice(0, MAX_REFLECTION_LENGTH);
      await db.runAsync(
        'UPDATE adventures SET reaction = ?, reflection = ?, updated_at = ? WHERE activity_id = ?',
        reaction && (REACTIONS as readonly string[]).includes(reaction) ? reaction : null,
        trimmed ? trimmed : null,
        now.toISOString(),
        activityId,
      );
    },

    async listImportedActivities() {
      const list = await readCache<unknown[]>('imported');
      return Array.isArray(list) ? list.filter(isActivityLike) : [];
    },

    async replaceImportedActivities(activities) {
      if (!activities.length) {
        await db.runAsync("DELETE FROM catalog_cache WHERE key = 'imported'");
        return;
      }
      await writeCache('imported', activities, new Date());
    },

    async getCachedCatalog() {
      const snapshot = await readCache<CatalogSnapshot>('remote');
      if (!snapshot || !Array.isArray(snapshot.activities) || typeof snapshot.fetchedAt !== 'string') return null;
      return { ...snapshot, origin: 'cache', activities: snapshot.activities.filter(isActivityLike) };
    },

    async setCachedCatalog(snapshot) {
      await writeCache('remote', snapshot, new Date(snapshot.fetchedAt));
    },

    async exportHistory(now) {
      const [preferences, adventures, feedback] = await Promise.all([
        store.getPreferences(),
        store.listAdventures(),
        store.listFeedback(),
      ]);
      const completed: CompletedQuest[] = adventures
        .filter((a) => a.status === 'completed')
        .map((a) => ({
          activityId: a.activityId,
          completedAt: a.completedAt ?? a.updatedAt,
          activity: a.activity,
          ...(a.reaction ? { reaction: a.reaction } : {}),
          ...(a.reflection ? { reflection: a.reflection } : {}),
        }));
      const exported: HistoryExport = {
        app: 'huddle',
        formatVersion: 1,
        exportedAt: now.toISOString(),
        preferences,
        saved: adventures.filter((a) => a.status === 'saved'),
        planned: adventures.filter((a) => a.status === 'planned'),
        completed,
        feedback,
      };
      return exported;
    },

    async clearHistory() {
      await db.execAsync('DELETE FROM feedback; DELETE FROM adventures;');
    },
  };
  return store;
}
