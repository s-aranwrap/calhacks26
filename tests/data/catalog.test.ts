import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ActivityRepository, CatalogSnapshot } from '../../src/core/ports.ts';
import type { Activity } from '../../src/core/types.ts';
import { loadCatalog } from '../../src/data/catalogService.ts';
import { resolveConfig } from '../../src/data/config.ts';
import { createDemoRepository } from '../../src/data/repositories/demoRepository.ts';
import { CatalogFetchError, createSupabaseRepository } from '../../src/data/repositories/supabaseRepository.ts';
import { NOW, makeActivity } from '../helpers.ts';

function memoryStore(initial: { cached?: CatalogSnapshot; imported?: Activity[] } = {}) {
  let cached = initial.cached ?? null;
  return {
    writes: 0,
    async getCachedCatalog() {
      return cached;
    },
    async setCachedCatalog(snapshot: CatalogSnapshot) {
      this.writes++;
      cached = snapshot;
    },
    async listImportedActivities() {
      return initial.imported ?? [];
    },
  };
}

const failing: ActivityRepository = {
  name: 'supabase',
  async listActivities() {
    throw new CatalogFetchError('network', 'offline');
  },
};
const working = (activities: Activity[]): ActivityRepository => ({
  name: 'supabase',
  listActivities: async () => activities,
});
const demo = createDemoRepository({ now: () => NOW });

describe('loadCatalog fallback chain', () => {
  test('no remote configured and nothing imported → demo data', async () => {
    const state = await loadCatalog({ demo, remote: null, store: memoryStore(), now: () => NOW });
    assert.equal(state.usesDemo, true);
    assert.equal(state.remoteStatus, 'not_configured');
    assert.ok(state.activities.length > 20);
  });

  test('live remote data is used and cached', async () => {
    const store = memoryStore();
    const state = await loadCatalog({ demo, remote: working([makeActivity({ id: 'r1' })]), store, now: () => NOW });
    assert.equal(state.usesDemo, false);
    assert.equal(state.remoteStatus, 'live');
    assert.deepEqual(
      state.activities.map((a) => a.id),
      ['r1'],
    );
    assert.equal(store.writes, 1);
  });

  test('remote failure falls back to the cached copy', async () => {
    const cached = {
      activities: [makeActivity({ id: 'c1' })],
      origin: 'cache' as const,
      fetchedAt: '2026-11-01T10:00:00.000Z',
    };
    const state = await loadCatalog({ demo, remote: failing, store: memoryStore({ cached }), now: () => NOW });
    assert.equal(state.remoteStatus, 'cached');
    assert.equal(state.cachedAt, '2026-11-01T10:00:00.000Z');
    assert.equal(state.remoteError, 'offline');
    assert.deepEqual(
      state.activities.map((a) => a.id),
      ['c1'],
    );
  });

  test('remote failure with no cache still works, using demo data', async () => {
    const state = await loadCatalog({ demo, remote: failing, store: memoryStore(), now: () => NOW });
    assert.equal(state.remoteStatus, 'unavailable');
    assert.equal(state.usesDemo, true);
  });

  test('imported activities replace the demo and merge with remote data', async () => {
    const imported = [makeActivity({ id: 'i1', source: { platform: 'csv', url: 'https://x.example/e' } })];
    const onlyImported = await loadCatalog({ demo, remote: null, store: memoryStore({ imported }), now: () => NOW });
    assert.equal(onlyImported.usesDemo, false);
    assert.equal(onlyImported.importedCount, 1);

    const remoteDuplicate = makeActivity({ id: 'r1', source: { platform: 'supabase', url: 'https://x.example/e/' } });
    const merged = await loadCatalog({
      demo,
      remote: working([remoteDuplicate]),
      store: memoryStore({ imported }),
      now: () => NOW,
    });
    assert.equal(merged.activities.length, 1, 'the same listing from two sources is shown once');
  });
});

describe('Supabase adapter', () => {
  const row = {
    id: 'row-1',
    kind: 'event',
    title: 'Repair café',
    category: 'community',
    moods: ['social'],
    tags: ['repair'],
    start_at: '2026-11-08T13:00:00+00:00',
    end_at: '2026-11-08T16:00:00+00:00',
    is_free: true,
    source_platform: 'organizer',
    source_url: 'https://example.org/repair',
    verification_status: 'verified',
    last_checked_at: '2026-11-02T09:00:00+00:00',
    availability: 'available',
    published: true,
  };

  test('reads published rows with only the publishable key and normalizes them', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify([row, { title: '' }]), { status: 200 });
    }) as typeof fetch;
    const warnings: string[] = [];
    const repo = createSupabaseRepository({
      url: 'https://abc.supabase.co/',
      publishableKey: 'sb_publishable_x',
      fetchImpl,
      now: () => NOW,
      onWarning: (w) => warnings.push(w),
    });
    const activities = await repo.listActivities();

    assert.equal(activities.length, 1);
    assert.equal(activities[0]?.verification.status, 'verified');
    assert.equal(activities[0]?.source.platform, 'organizer');
    assert.deepEqual(warnings, ['Skipped 1 malformed catalog rows']);
    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, '/rest/v1/activities');
    assert.equal(url.searchParams.get('published'), 'eq.true');
    assert.deepEqual(Object.keys((calls[0]!.init?.headers ?? {}) as Record<string, string>).sort(), [
      'Accept',
      'apikey',
    ]);
  });

  test('maps failures to typed errors', async () => {
    const respond = (body: string, status = 200) =>
      (async () => new Response(body, { status })) as unknown as typeof fetch;
    const make = (fetchImpl: typeof fetch) =>
      createSupabaseRepository({ url: 'https://abc.supabase.co', publishableKey: 'k', fetchImpl });

    await assert.rejects(
      make(respond('[]', 401)).listActivities(),
      (e: CatalogFetchError) => e.kind === 'http' && e.status === 401,
    );
    await assert.rejects(make(respond('<html>')).listActivities(), (e: CatalogFetchError) => e.kind === 'malformed');
    await assert.rejects(
      make(respond('{"rows":[]}')).listActivities(),
      (e: CatalogFetchError) => e.kind === 'malformed',
    );
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    await assert.rejects(make(offline).listActivities(), (e: CatalogFetchError) => e.kind === 'network');
  });

  test('times out instead of hanging', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const repo = createSupabaseRepository({
      url: 'https://abc.supabase.co',
      publishableKey: 'k',
      fetchImpl: hang,
      timeoutMs: 20,
    });
    await assert.rejects(repo.listActivities(), (e: CatalogFetchError) => e.kind === 'timeout');
  });
});

describe('public config', () => {
  test('is only enabled with a real https URL and a publishable key', () => {
    assert.equal(resolveConfig({}).supabase, null);
    assert.equal(
      resolveConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'https://your-project.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'your-publishable-key',
      }).supabase,
      null,
    );
    assert.equal(
      resolveConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1',
      }).supabase,
      null,
    );
    assert.deepEqual(
      resolveConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1',
      }).supabase,
      {
        url: 'https://abc.supabase.co',
        publishableKey: 'sb_publishable_1',
      },
    );
  });

  test('refuses secret keys even if misconfigured', () => {
    assert.equal(
      resolveConfig({
        EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc',
      }).supabase,
      null,
    );
  });
});
