import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { recommend } from '../../src/core/recommend.ts';
import { loadCatalog } from '../../src/data/catalogService.ts';
import { DEFAULT_PREFERENCES } from '../../src/data/local/preferences.ts';
import { buildPackCatalog, createPackRepository, SF_PACK } from '../../src/data/packs/index.ts';
import { SF_EVERGREEN_RECORDS } from '../../src/data/packs/sfEvergreen.ts';
import { createDemoRepository } from '../../src/data/repositories/demoRepository.ts';
import { extractEventFromCaption, guessCategory } from '../../server/ingest/extractEvent.ts';
import { createGeocoder, SF_BOUNDS } from '../../server/ingest/geocode.ts';
import { maxResults, postsToRecords, renderPackModule, type SfSourcesConfig } from '../../server/ingest/sfPipeline.ts';
import { normalizeActivity } from '../../src/core/normalize.ts';

// Thursday 30 Oct 2026, 10:00 in San Francisco.
const NOW = new Date('2026-10-30T17:00:00Z');
const POSTED = '2026-10-29T18:00:00Z';
const extract = (caption: string, posted = POSTED) => extractEventFromCaption(caption, posted, NOW);

describe('caption → event extraction', () => {
  test('month name + time range, with free entry', () => {
    const r = extract('Night market returns! Sat, Nov 8 · 6-10pm at the Mission. Free entry 🎉');
    assert.ok(r.ok);
    assert.equal(r.event.startWall, '2026-11-08 18:00');
    assert.equal(r.event.endWall, '2026-11-08 22:00');
    assert.equal(r.event.isFree, true);
  });

  test('numeric date, single time, price', () => {
    const r = extract('Jazz quartet live 11/14 at 7:30pm. Tickets $15-25 at the door');
    assert.ok(r.ok);
    assert.equal(r.event.startWall, '2026-11-14 19:30');
    assert.equal(r.event.priceMin, 15);
    assert.equal(r.event.priceMax, 25);
  });

  test('day-first dates, noon, and am/pm inheritance in ranges', () => {
    const a = extract('Swap meet 8th November, 11-2pm');
    assert.ok(a.ok && a.event.startWall === '2026-11-08 11:00' && a.event.endWall === '2026-11-08 14:00');
    const b = extract('Picnic on November 9 at noon');
    assert.ok(b.ok && b.event.startWall === '2026-11-09 12:00');
  });

  test('relative words and lone weekdays resolve from the post date', () => {
    const tonight = extract('Trivia tonight 8pm!', '2026-10-30T16:00:00Z');
    assert.ok(tonight.ok && tonight.event.startWall === '2026-10-30 20:00');
    const sat = extract('Run club this Saturday 9am, meet at the Ferry Building', '2026-10-29T16:00:00Z');
    assert.ok(sat.ok && sat.event.startWall === '2026-10-31 09:00');
  });

  test('year rolls over for early-year dates posted in December', () => {
    const r = extractEventFromCaption(
      'New year hike Jan 3, 9am',
      '2026-12-20T18:00:00Z',
      new Date('2026-12-21T00:00:00Z'),
    );
    assert.ok(r.ok && r.event.startWall === '2027-01-03 09:00');
  });

  test('skips what it can’t be sure about', () => {
    assert.deepEqual(extract('Our new menu is here! Come by anytime'), { ok: false, reason: 'no_date' });
    assert.deepEqual(extract('Workshops Nov 8 and Nov 15, 2pm'), { ok: false, reason: 'ambiguous_date' });
    assert.deepEqual(extract('Big show on Nov 8'), { ok: false, reason: 'no_time' });
    assert.deepEqual(extract('Thanks to everyone who came Oct 12 at 7pm!'), { ok: false, reason: 'too_old' });
  });

  test('ignores misleading "free" and conflicting prices', () => {
    const glutenFree = extract('Gluten-free baking class Nov 10 at 6pm, $40');
    assert.ok(glutenFree.ok && glutenFree.event.isFree === undefined && glutenFree.event.priceMin === 40);
    const conflict = extract('FREE show Nov 10 at 6pm, $10 drinks');
    assert.ok(conflict.ok && conflict.event.isFree === undefined && conflict.event.priceMin === undefined);
  });

  test('overnight ranges drop the end rather than guess', () => {
    const r = extract('Dance party Nov 8 10pm-2am');
    assert.ok(r.ok);
    assert.equal(r.event.startWall, '2026-11-08 22:00');
    assert.equal(r.event.endWall, undefined);
  });

  test('category keywords', () => {
    assert.equal(guessCategory('Live music and DJs all night', 'other'), 'music');
    assert.equal(guessCategory('Trivia night with prizes', 'other'), 'games');
    assert.equal(guessCategory('Come hang out', 'community'), 'community');
  });
});

const CONFIG: SfSourcesConfig = {
  city: 'San Francisco',
  timeZone: 'America/Los_Angeles',
  newerThan: '21 days',
  maxResultsPerRun: 150,
  sources: [
    { url: 'https://www.instagram.com/funcheap/', limit: 30, category: 'community' },
    { url: 'https://www.instagram.com/exploratorium/', limit: 12, category: 'learning' },
  ],
};

const post = (shortCode: string, caption: string, extra: Record<string, unknown> = {}) => ({
  shortCode,
  url: `https://www.instagram.com/p/${shortCode}/`,
  caption,
  timestamp: POSTED,
  ownerUsername: 'funcheap',
  inputUrl: 'https://www.instagram.com/funcheap/',
  ...extra,
});

describe('SF pipeline', () => {
  test('keeps dated posts, skips the rest, and every record passes the app normalizer', async () => {
    const items = [
      post('A1', 'Free outdoor movie night!\nNov 7 at 7pm in Dolores Park. Bring a blanket.', {
        locationName: 'Mission Dolores Park',
      }),
      post('A1', 'duplicate of the same post'),
      post('B2', 'This week in SF: 25 things to do Nov 3, Nov 4, Nov 5…'),
      post('C3', 'Late nights are back Nov 13 at 6pm. Tickets $25', {
        ownerUsername: 'exploratorium',
        inputUrl: 'https://www.instagram.com/exploratorium',
      }),
      { error: 'not_found', url: 'https://www.instagram.com/nope/' },
    ];
    const lookups: string[] = [];
    const { records, report } = await postsToRecords(items, CONFIG, {
      now: NOW,
      geocode: async (venue) => {
        lookups.push(venue);
        return { latitude: 37.7596, longitude: -122.4269, displayName: venue };
      },
    });
    assert.equal(report.kept, 2);
    assert.deepEqual(report.skipped, { duplicate: 1, ambiguous_date: 1, actor_error: 1 });
    assert.deepEqual(lookups, ['Mission Dolores Park']);

    const [movie, lateNight] = records.map((r) => {
      const n = normalizeActivity(r, { platform: 'json', now: NOW });
      assert.ok(n.ok);
      return n.activity;
    });
    assert.equal(movie?.startAt, '2026-11-08T03:00:00.000Z', '7pm PST');
    assert.equal(movie?.verification.status, 'unverified');
    assert.equal(movie?.source.platform, 'instagram');
    assert.equal(movie?.source.url, 'https://www.instagram.com/p/A1/');
    assert.equal(movie?.price?.minAmount, 0);
    assert.equal(movie?.venue?.latitude, 37.7596);
    assert.equal(movie?.category, 'arts', 'movie night → film keyword → arts');
    assert.equal(lateNight?.category, 'learning');
    assert.equal(lateNight?.price?.certainty, 'estimated');
  });

  test('the generated module round-trips', async () => {
    const { records } = await postsToRecords([post('Z9', 'Trivia Nov 12 at 8pm')], CONFIG, { now: NOW });
    const source = renderPackModule(records, NOW.toISOString());
    assert.match(source, /SF_INSTAGRAM_RECORDS: RawActivityRecord\[\] = \[/);
    assert.match(source, /"source_id": "Z9"/);
  });

  test('budget guard counts the configured limits', () => {
    assert.equal(maxResults(CONFIG), 42);
  });
});

describe('geocoder', () => {
  test('stays inside the bounding box, caches hits, and doesn’t cache network failures', async () => {
    let calls = 0;
    const responses = [
      [{ lat: '37.76', lon: '-122.43', display_name: 'In SF' }],
      [{ lat: '40.7', lon: '-74.0', display_name: 'New York' }],
    ];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls++;
      assert.match(url, /bounded=1/);
      assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /HuddleTest/);
      return new Response(JSON.stringify(responses.shift() ?? []), { status: 200 });
    }) as typeof fetch;
    const geo = createGeocoder({
      bounds: SF_BOUNDS,
      userAgent: 'HuddleTest/1.0',
      fetchImpl,
      sleep: async () => {},
      minIntervalMs: 0,
    });
    assert.equal((await geo.lookup('The Chapel'))?.displayName, 'In SF');
    assert.equal(await geo.lookup('the chapel '), await geo.lookup('The Chapel'));
    assert.equal(calls, 1, 'cached');
    assert.equal(await geo.lookup('Somewhere far'), null, 'outside the box');

    const offline = createGeocoder({
      bounds: SF_BOUNDS,
      userAgent: 'HuddleTest/1.0',
      fetchImpl: (async () => {
        throw new TypeError('offline');
      }) as typeof fetch,
      minIntervalMs: 0,
    });
    assert.equal(await offline.lookup('X'), null);
  });
});

describe('bundled SF pack in the app', () => {
  test('every evergreen record is valid, unverified and inside San Francisco', () => {
    for (const record of SF_EVERGREEN_RECORDS) {
      const r = normalizeActivity(record, { platform: 'json', now: NOW });
      assert.ok(r.ok, String(record.id));
      assert.deepEqual(r.warnings, [], String(record.id));
      assert.equal(r.activity.verification.status, 'unverified');
      const v = r.activity.venue!;
      assert.ok(
        v.latitude! > SF_BOUNDS.south &&
          v.latitude! < SF_BOUNDS.north &&
          v.longitude! > SF_BOUNDS.west &&
          v.longitude! < SF_BOUNDS.east,
        String(record.id),
      );
    }
  });

  test('every mood gets three suggestions from Union Square with default filters', () => {
    // Sunday 10 AM and Monday 7 AM.
    for (const now of [NOW, new Date('2026-10-26T14:00:00Z')]) {
      const catalog = buildPackCatalog(SF_PACK, now);
      for (const mood of ['surprise', 'chill', 'social', 'active', 'creative'] as const) {
        const result = recommend(
          catalog,
          {
            mood,
            budget: DEFAULT_PREFERENCES.budget,
            maxDistanceKm: DEFAULT_PREFERENCES.maxDistanceKm,
            availableMinutes: DEFAULT_PREFERENCES.availableMinutes,
            origin: SF_PACK.center,
            now,
          },
          DEFAULT_PREFERENCES,
          { feedback: [], adventures: [] },
        );
        assert.equal(result.recommendations.length, 3, `${mood} at ${now.toISOString()}`);
      }
    }
  });

  test('late at night, closed places are left out instead of padding the three', () => {
    const now = new Date('2026-10-28T06:30:00Z'); // Tuesday 11:30 PM
    const catalog = buildPackCatalog(SF_PACK, now);
    const result = recommend(
      catalog,
      { mood: 'surprise', budget: 'any', maxDistanceKm: null, availableMinutes: null, origin: SF_PACK.center, now },
      DEFAULT_PREFERENCES,
      { feedback: [], adventures: [] },
    );
    const ids = result.recommendations.map((r) => r.activity.id);
    for (const closed of ['sf-sfmoma', 'sf-exploratorium', 'sf-cal-academy', 'sf-main-library', 'sf-musee-mecanique']) {
      assert.ok(!ids.includes(closed), closed);
    }
    assert.ok((result.exclusions.closed ?? 0) >= 5);
  });

  test('replaces the fictional town and reports the city', async () => {
    const store = {
      getCachedCatalog: async () => null,
      setCachedCatalog: async () => {},
      listImportedActivities: async () => [],
    };
    const state = await loadCatalog({
      demo: createDemoRepository({ now: () => NOW }),
      remote: null,
      cityPack: { pack: SF_PACK, repository: createPackRepository(SF_PACK, () => NOW) },
      store,
      now: () => NOW,
    });
    assert.equal(state.usesDemo, false);
    assert.equal(state.cityPack?.city, 'San Francisco');
    assert.ok(state.activities.some((a) => a.id === 'sf-lands-end'));
  });
});
