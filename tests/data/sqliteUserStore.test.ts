/**
 * Exercises the real SQL against SQLite through Node's built-in `node:sqlite`
 * (same engine family the app uses through expo-sqlite).
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, test } from 'node:test';

import type { UserStore } from '../../src/core/ports.ts';
import { DEFAULT_PREFERENCES } from '../../src/data/local/preferences.ts';
import {
  createSqliteUserStore,
  migrate,
  type SqlDatabase,
  type SqlParam,
} from '../../src/data/local/sqliteUserStore.ts';
import { NOW, dismissal, makeActivity } from '../helpers.ts';

/** Adapts node:sqlite's synchronous API to the async interface expo-sqlite exposes. */
function nodeSqlite(): SqlDatabase & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, ...params: SqlParam[]) {
      return raw.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, ...params: SqlParam[]) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: SqlParam[]) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
}

const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: ReturnType<typeof nodeSqlite>;
let store: UserStore;

beforeEach(async () => {
  db = nodeSqlite();
  await migrate(db);
  store = createSqliteUserStore(db);
});

describe('migrations', () => {
  test('are idempotent and tracked with user_version', async () => {
    await migrate(db);
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
    assert.equal(row?.user_version, 1);
  });
});

describe('preferences', () => {
  test('round-trip and are re-validated on read', async () => {
    assert.equal(await store.getPreferences(), null);
    await store.savePreferences({
      ...DEFAULT_PREFERENCES,
      location: { label: 'Leeds', source: 'manual' },
      interests: ['arts'],
    });
    const prefs = await store.getPreferences();
    assert.equal(prefs?.location?.label, 'Leeds');
    assert.deepEqual(prefs?.interests, ['arts']);

    db.raw.exec(`UPDATE preferences SET value = '{"budget":"lavish","interests":["arts","bogus"],"maxDistanceKm":-4}'`);
    const repaired = await store.getPreferences();
    assert.equal(repaired?.budget, DEFAULT_PREFERENCES.budget);
    assert.deepEqual(repaired?.interests, ['arts']);
    assert.equal(repaired?.maxDistanceKm, DEFAULT_PREFERENCES.maxDistanceKm);
  });
});

describe('saved, planned and completed', () => {
  test('save → plan → cancel returns the activity to Saved', async () => {
    const a = makeActivity({ id: 'a' });
    await store.saveActivity(a, NOW);
    await store.planActivity(a, later(1));
    assert.equal((await store.getAdventure('a'))?.status, 'planned');
    const afterCancel = await store.cancelPlan('a', later(2));
    assert.equal(afterCancel?.status, 'saved');
    assert.equal(afterCancel?.plannedAt, undefined);
    assert.equal(afterCancel?.savedAt, NOW.toISOString());
  });

  test('cancelling a plan that was never saved removes it entirely', async () => {
    const a = makeActivity({ id: 'a' });
    await store.planActivity(a, NOW);
    assert.equal(await store.cancelPlan('a', later(1)), null);
    assert.deepEqual(await store.listAdventures(), []);
  });

  test('saving never downgrades a planned or completed activity', async () => {
    const a = makeActivity({ id: 'a' });
    await store.planActivity(a, NOW);
    const saved = await store.saveActivity(a, later(1));
    assert.equal(saved.status, 'planned');
    assert.equal(saved.savedAt, later(1).toISOString());
  });

  test('completion with an emoji reaction and a private reflection', async () => {
    const a = makeActivity({ id: 'a', title: 'Pottery' });
    await store.planActivity(a, NOW);
    const done = await store.completeActivity(a, later(60));
    assert.equal(done.status, 'completed');
    assert.equal(done.plannedAt, NOW.toISOString(), 'keeps the plan timestamp');
    await store.saveReflection('a', 'loved', '  Wonky bowl, very proud.  ', later(61));
    const entry = await store.getAdventure('a');
    assert.equal(entry?.reaction, 'loved');
    assert.equal(entry?.reflection, 'Wonky bowl, very proud.');
    assert.equal(entry?.activity.title, 'Pottery', 'stores a snapshot of the activity');
  });

  test('reflections are optional, bounded, and invalid reactions are dropped', async () => {
    const a = makeActivity({ id: 'a' });
    await store.completeActivity(a, NOW);
    await store.saveReflection('a', 'ecstatic' as never, 'x'.repeat(5000), NOW);
    const entry = await store.getAdventure('a');
    assert.equal(entry?.reaction, undefined);
    assert.equal(entry?.reflection?.length, 1000);
    await store.saveReflection('a', undefined, '   ', NOW);
    assert.equal((await store.getAdventure('a'))?.reflection, undefined);
  });

  test('unsave only removes saved entries', async () => {
    const saved = makeActivity({ id: 's' });
    const planned = makeActivity({ id: 'p' });
    await store.saveActivity(saved, NOW);
    await store.planActivity(planned, NOW);
    await store.unsaveActivity('s');
    await store.unsaveActivity('p');
    assert.deepEqual(
      (await store.listAdventures()).map((e) => e.activityId),
      ['p'],
    );
  });

  test('corrupted rows are skipped instead of crashing', async () => {
    await store.saveActivity(makeActivity({ id: 'good' }), NOW);
    db.raw.exec(
      `INSERT INTO adventures (activity_id, status, updated_at, activity) VALUES ('bad', 'saved', '${NOW.toISOString()}', '{not json')`,
    );
    db.raw.exec(
      `INSERT INTO feedback (id, activity_id, kind, created_at, context) VALUES ('f', 'x', 'dismissed', '${NOW.toISOString()}', 'null')`,
    );
    assert.deepEqual(
      (await store.listAdventures()).map((e) => e.activityId),
      ['good'],
    );
    assert.deepEqual(await store.listFeedback(), []);
  });
});

describe('feedback', () => {
  test('stores dismissals with optional reasons', async () => {
    const a = makeActivity({ id: 'a' });
    await store.addFeedback(dismissal(a, 'too_far'));
    await store.addFeedback({ ...dismissal(a, undefined, 1), id: 'no-reason' });
    const feedback = await store.listFeedback();
    assert.equal(feedback.length, 2);
    assert.equal(feedback[0]?.reason, 'too_far');
    assert.equal(feedback[1]?.reason, undefined);
  });
});

describe('catalog caches', () => {
  test('imported activities and the remote snapshot round-trip', async () => {
    await store.replaceImportedActivities([makeActivity({ id: 'imp' })]);
    assert.deepEqual(
      (await store.listImportedActivities()).map((a) => a.id),
      ['imp'],
    );
    await store.replaceImportedActivities([]);
    assert.deepEqual(await store.listImportedActivities(), []);

    await store.setCachedCatalog({
      activities: [makeActivity({ id: 'r' })],
      origin: 'remote',
      fetchedAt: NOW.toISOString(),
    });
    const cached = await store.getCachedCatalog();
    assert.equal(cached?.origin, 'cache');
    assert.equal(cached?.fetchedAt, NOW.toISOString());
    assert.deepEqual(
      cached?.activities.map((a) => a.id),
      ['r'],
    );
  });
});

describe('export and delete', () => {
  test('export contains preferences, history and reflections; delete clears history only', async () => {
    await store.savePreferences({ ...DEFAULT_PREFERENCES, location: { label: 'Bath', source: 'manual' } });
    const a = makeActivity({ id: 'a' });
    const b = makeActivity({ id: 'b' });
    const c = makeActivity({ id: 'c' });
    await store.saveActivity(a, NOW);
    await store.planActivity(b, NOW);
    await store.completeActivity(c, NOW);
    await store.saveReflection('c', 'calm', 'Nice.', NOW);
    await store.addFeedback(dismissal(makeActivity({ id: 'd' }), 'not_my_thing'));
    await store.replaceImportedActivities([makeActivity({ id: 'imp' })]);

    const exported = await store.exportHistory(NOW);
    assert.equal(exported.app, 'huddle');
    assert.equal(exported.formatVersion, 1);
    assert.deepEqual(
      exported.saved.map((e) => e.activityId),
      ['a'],
    );
    assert.deepEqual(
      exported.planned.map((e) => e.activityId),
      ['b'],
    );
    assert.deepEqual(
      exported.completed.map((e) => [e.activityId, e.reaction, e.reflection]),
      [['c', 'calm', 'Nice.']],
    );
    assert.equal(exported.feedback.length, 1);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(exported)));

    await store.clearHistory();
    assert.deepEqual(await store.listAdventures(), []);
    assert.deepEqual(await store.listFeedback(), []);
    assert.equal((await store.getPreferences())?.location?.label, 'Bath', 'preferences survive');
    assert.equal((await store.listImportedActivities()).length, 1, 'imported catalog survives');
  });
});
