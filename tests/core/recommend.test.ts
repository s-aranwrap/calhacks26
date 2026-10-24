import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { recommend } from '../../src/core/recommend.ts';
import type { Activity } from '../../src/core/types.ts';
import { DEMO_CENTER } from '../../src/data/fixtures/demoActivities.ts';
import { DEFAULT_PREFERENCES } from '../../src/data/local/preferences.ts';
import { buildDemoCatalog } from '../../src/data/repositories/demoRepository.ts';
import {
  EMPTY_HISTORY,
  NOW,
  PREFS,
  adventure,
  dismissal,
  makeActivity,
  makeEvent,
  north,
  request,
} from '../helpers.ts';

const ids = (result: ReturnType<typeof recommend>) => result.recommendations.map((r) => r.activity.id);

describe('result size', () => {
  test('returns exactly three distinct recommendations when at least three are eligible', () => {
    const catalog = Array.from({ length: 8 }, (_, i) => makeActivity({ category: i % 2 ? 'arts' : 'outdoors' }));
    const result = recommend(catalog, request(), PREFS, EMPTY_HISTORY);
    assert.equal(result.status, 'ok');
    assert.equal(result.recommendations.length, 3);
    assert.equal(new Set(ids(result)).size, 3);
    assert.deepEqual(result.suggestions, []);
  });

  test('returns exactly three when exactly three are eligible', () => {
    const catalog = [makeActivity(), makeActivity(), makeActivity(), makeActivity({ moods: ['social'] })];
    const result = recommend(catalog, request(), PREFS, EMPTY_HISTORY);
    assert.equal(result.recommendations.length, 3);
    assert.equal(result.eligibleCount, 3);
  });

  test('returns what exists, flagged as limited, when fewer than three are eligible', () => {
    const catalog = [makeActivity(), makeActivity(), makeActivity({ moods: ['active'] })];
    const result = recommend(catalog, request(), PREFS, EMPTY_HISTORY);
    assert.equal(result.status, 'limited');
    assert.equal(result.recommendations.length, 2);
  });

  test('returns an empty result with filter suggestions instead of padding', () => {
    const catalog = [
      makeActivity({ price: { minAmount: 50, currency: 'USD', certainty: 'verified' } }),
      makeActivity({ price: { minAmount: 60, currency: 'USD', certainty: 'verified' } }),
    ];
    const result = recommend(catalog, request({ budget: 'low' }), PREFS, EMPTY_HISTORY);
    assert.equal(result.status, 'empty');
    assert.equal(result.recommendations.length, 0);
    assert.equal(result.exclusions.budget, 2);
    assert.deepEqual(result.suggestions, ['raise_budget']);
  });

  test('handles an empty catalog', () => {
    const result = recommend([], request(), PREFS, EMPTY_HISTORY);
    assert.equal(result.status, 'empty');
    assert.deepEqual(result.recommendations, []);
  });

  test('ignores duplicate IDs in the catalog', () => {
    const a = makeActivity({ id: 'same' });
    const result = recommend([a, { ...a }, makeActivity(), makeActivity()], request(), PREFS, EMPTY_HISTORY);
    assert.equal(new Set(ids(result)).size, result.recommendations.length);
    assert.equal(result.eligibleCount, 3);
  });

  test('only ever returns activities from the catalog', () => {
    const catalog = [makeActivity(), makeActivity()];
    const catalogIds = new Set(catalog.map((a) => a.id));
    for (const id of ids(recommend(catalog, request(), PREFS, EMPTY_HISTORY))) assert.ok(catalogIds.has(id));
  });
});

describe('budget filter', () => {
  const free = makeActivity({ id: 'free', price: { minAmount: 0, currency: 'USD', certainty: 'verified' } });
  const cheap = makeActivity({ id: 'cheap', price: { minAmount: 12, currency: 'USD', certainty: 'verified' } });
  const pricey = makeActivity({ id: 'pricey', price: { minAmount: 35, currency: 'USD', certainty: 'verified' } });
  const unknown = makeActivity({ id: 'unknown' });
  delete (unknown as Partial<Activity>).price;

  test('free budget keeps free and unknown-price activities only', () => {
    const result = recommend([free, cheap, pricey, unknown], request({ budget: 'free' }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(new Set(ids(result)), new Set(['free', 'unknown']));
    assert.equal(result.exclusions.budget, 2);
  });

  test('low budget allows up to 15', () => {
    const result = recommend([free, cheap, pricey], request({ budget: 'low' }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(new Set(ids(result)), new Set(['free', 'cheap']));
  });

  test('unknown price is kept but ranked below a known free option', () => {
    const result = recommend([unknown, free], request({ budget: 'free' }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(ids(result), ['free', 'unknown']);
  });

  test('prices in another currency are treated as unknown, not excluded', () => {
    const euro = makeActivity({ id: 'euro', price: { minAmount: 90, currency: 'EUR', certainty: 'verified' } });
    const result = recommend([euro], request({ budget: 'low' }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(ids(result), ['euro']);
  });
});

describe('distance filter', () => {
  const near = makeActivity({ id: 'near', venue: { name: 'Near', ...north(1) } });
  const mid = makeActivity({ id: 'mid', venue: { name: 'Mid', ...north(4) } });
  const far = makeActivity({ id: 'far', venue: { name: 'Far', ...north(20) } });
  const noCoords = makeActivity({ id: 'nocoords', venue: { name: 'Somewhere' } });

  test('excludes activities beyond the max distance', () => {
    const result = recommend([near, mid, far], request({ maxDistanceKm: 5 }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(new Set(ids(result)), new Set(['near', 'mid']));
    assert.equal(result.exclusions.distance, 1);
  });

  test('keeps activities whose distance is unknown', () => {
    const result = recommend([noCoords], request({ maxDistanceKm: 2 }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(ids(result), ['nocoords']);
  });

  test('does not filter by distance without an origin', () => {
    const { origin: _origin, ...withoutOrigin } = request({ maxDistanceKm: 2 });
    void _origin;
    const result = recommend([far], withoutOrigin, PREFS, EMPTY_HISTORY);
    assert.deepEqual(ids(result), ['far']);
    assert.equal(result.recommendations[0]?.distanceKm, undefined);
  });

  test('null max distance means any distance', () => {
    const result = recommend([far], request({ maxDistanceKm: null }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(ids(result), ['far']);
    assert.ok(Math.abs((result.recommendations[0]?.distanceKm ?? 0) - 20) < 0.5);
  });
});

describe('time filter', () => {
  test('excludes activities longer than the available time, keeps unknown durations', () => {
    const short = makeActivity({ id: 'short', duration: { minMinutes: 45, certainty: 'estimated' } });
    const long = makeActivity({ id: 'long', duration: { minMinutes: 180, certainty: 'estimated' } });
    const unknown = makeActivity({ id: 'unknown' });
    delete (unknown as Partial<Activity>).duration;
    const result = recommend([short, long, unknown], request({ availableMinutes: 120 }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(new Set(ids(result)), new Set(['short', 'unknown']));
    assert.equal(result.exclusions.time, 1);
  });

  test('uses the minimum of a duration range', () => {
    const range = makeActivity({ id: 'range', duration: { minMinutes: 60, maxMinutes: 180, certainty: 'estimated' } });
    assert.deepEqual(ids(recommend([range], request({ availableMinutes: 90 }), PREFS, EMPTY_HISTORY)), ['range']);
  });
});

describe('mood', () => {
  const chill = makeActivity({ id: 'chill', moods: ['chill'] });
  const active = makeActivity({ id: 'active', moods: ['active'] });

  test('a specific mood only returns matching activities', () => {
    assert.deepEqual(ids(recommend([chill, active], request({ mood: 'active' }), PREFS, EMPTY_HISTORY)), ['active']);
  });

  test('"Surprise me" considers every mood', () => {
    const result = recommend([chill, active], request({ mood: 'surprise' }), PREFS, EMPTY_HISTORY);
    assert.equal(result.recommendations.length, 2);
  });

  test('suggests changing mood when the mood filtered things out', () => {
    const result = recommend([active], request({ mood: 'chill' }), PREFS, EMPTY_HISTORY);
    assert.ok(result.suggestions.includes('change_mood'));
  });
});

describe('availability and trust', () => {
  test('never recommends expired, sold out, cancelled, undated or candidate records', () => {
    const catalog = [
      makeEvent(-5, { id: 'expired' }),
      makeEvent(24, { id: 'soldout', availability: 'sold_out' }),
      makeEvent(24, { id: 'cancelled', availability: 'cancelled' }),
      makeActivity({ id: 'undated', kind: 'event' }),
      makeActivity({ id: 'candidate', verification: { status: 'candidate' } }),
      makeEvent(24, { id: 'ok' }),
    ];
    const result = recommend(catalog, request(), PREFS, EMPTY_HISTORY);
    assert.deepEqual(ids(result), ['ok']);
    assert.deepEqual(result.exclusions, { expired: 1, unavailable: 2, date_unknown: 1, candidate: 1 });
  });

  test('an event that is still running is eligible', () => {
    const ongoing = makeEvent(-1, { id: 'ongoing', duration: { minMinutes: 180, certainty: 'estimated' } });
    assert.deepEqual(ids(recommend([ongoing], request(), PREFS, EMPTY_HISTORY)), ['ongoing']);
  });

  test('respects includeUnverified = false', () => {
    const verified = makeActivity({ id: 'v', verification: { status: 'verified', lastCheckedAt: NOW.toISOString() } });
    const unverified = makeActivity({ id: 'u' });
    const result = recommend([verified, unverified], request(), { ...PREFS, includeUnverified: false }, EMPTY_HISTORY);
    assert.deepEqual(ids(result), ['v']);
    assert.ok(result.recommendations[0]?.reasons.includes('Details recently verified'));
  });

  test('ranks a freshly verified record above an otherwise identical unverified one', () => {
    const base = { category: 'arts' as const, tags: [], venue: { name: 'X', ...north(1) } };
    const verified = makeActivity({
      id: 'v',
      ...base,
      verification: { status: 'verified', lastCheckedAt: NOW.toISOString() },
    });
    const unverified = makeActivity({ id: 'u', ...base, venue: { name: 'Y', ...north(1) } });
    assert.deepEqual(ids(recommend([unverified, verified], request(), PREFS, EMPTY_HISTORY)), ['v', 'u']);
  });
});

describe('history', () => {
  test('excludes planned and completed activities', () => {
    const planned = makeActivity({ id: 'planned' });
    const done = makeActivity({ id: 'done' });
    const other = makeActivity({ id: 'other' });
    const history = { feedback: [], adventures: [adventure(planned, 'planned'), adventure(done, 'completed')] };
    const result = recommend([planned, done, other], request(), PREFS, history);
    assert.deepEqual(ids(result), ['other']);
    assert.equal(result.exclusions.already_planned, 1);
    assert.equal(result.exclusions.completed, 1);
  });

  test('a saved activity is still recommended, with a reason', () => {
    const saved = makeActivity({ id: 'saved' });
    const result = recommend([saved], request(), PREFS, { feedback: [], adventures: [adventure(saved, 'saved')] });
    assert.ok(result.recommendations[0]?.reasons.includes('You saved this earlier'));
  });

  test('a dismissed activity is not shown again during its cooldown', () => {
    const dismissed = makeActivity({ id: 'dismissed' });
    const history = { feedback: [dismissal(dismissed, 'too_far', 3)], adventures: [] };
    const result = recommend([dismissed, makeActivity()], request(), PREFS, history);
    assert.ok(!ids(result).includes('dismissed'));
    assert.equal(result.exclusions.recently_dismissed, 1);
  });

  test('a "too far" dismissal expires after its cooldown', () => {
    const dismissed = makeActivity({ id: 'dismissed' });
    const history = { feedback: [dismissal(dismissed, 'too_far', 30)], adventures: [] };
    assert.ok(ids(recommend([dismissed], request(), PREFS, history)).includes('dismissed'));
  });

  test('"not my thing" stays out much longer', () => {
    const dismissed = makeActivity({ id: 'dismissed' });
    const history = { feedback: [dismissal(dismissed, 'not_my_thing', 60)], adventures: [] };
    assert.ok(!ids(recommend([dismissed], request(), PREFS, history)).includes('dismissed'));
  });

  test('"not my thing" lowers similar activities, loved completions raise them', () => {
    const music1 = makeActivity({ id: 'music-old', category: 'music', tags: ['jazz'] });
    const music2 = makeActivity({ id: 'music-new', category: 'music', tags: ['jazz'] });
    const food1 = makeActivity({ id: 'food-old', category: 'food', tags: ['street-food'] });
    const food2 = makeActivity({ id: 'food-new', category: 'food', tags: ['street-food'] });
    const req = request({ count: 1 });

    const dislikedMusic = {
      feedback: [dismissal(music1, 'not_my_thing', 1)],
      adventures: [adventure(food1, 'completed', { reaction: 'loved' })],
    };
    assert.deepEqual(ids(recommend([music2, food2], req, PREFS, dislikedMusic)), ['food-new']);

    const lovedMusic = {
      feedback: [dismissal(food1, 'not_my_thing', 1)],
      adventures: [adventure(music1, 'completed', { reaction: 'loved' })],
    };
    const result = recommend([music2, food2], req, PREFS, lovedMusic);
    assert.deepEqual(ids(result), ['music-new']);
    assert.ok(result.recommendations[0]?.reasons.includes("Similar to things you've enjoyed"));
  });

  test('"too expensive" feedback lowers similarly priced activities', () => {
    const pricey = makeActivity({
      id: 'pricey-old',
      category: 'arts',
      price: { minAmount: 30, currency: 'USD', certainty: 'verified' },
    });
    const pricey2 = makeActivity({
      id: 'pricey-new',
      category: 'arts',
      price: { minAmount: 32, currency: 'USD', certainty: 'verified' },
    });
    const cheap = makeActivity({
      id: 'cheap',
      category: 'arts',
      price: { minAmount: 5, currency: 'USD', certainty: 'verified' },
    });
    const history = { feedback: [dismissal(pricey, 'too_expensive', 2)], adventures: [] };
    assert.deepEqual(ids(recommend([pricey2, cheap], request(), PREFS, history)), ['cheap', 'pricey-new']);
  });

  test('"Show me three more" excludes everything already shown', () => {
    const catalog = Array.from({ length: 7 }, () => makeActivity());
    const first = recommend(catalog, request(), PREFS, EMPTY_HISTORY);
    const second = recommend(catalog, request({ excludeIds: ids(first) }), PREFS, EMPTY_HISTORY);
    assert.equal(second.recommendations.length, 3);
    for (const id of ids(second)) assert.ok(!ids(first).includes(id));
    const third = recommend(catalog, request({ excludeIds: [...ids(first), ...ids(second)] }), PREFS, EMPTY_HISTORY);
    assert.equal(third.status, 'limited');
    assert.ok(third.suggestions.includes('start_fresh'));
  });
});

describe('ranking mix', () => {
  test('spreads picks across categories when scores are similar', () => {
    const catalog = [
      ...Array.from({ length: 5 }, () => makeActivity({ category: 'arts', moods: ['chill'] })),
      makeActivity({ id: 'food', category: 'food' }),
      makeActivity({ id: 'music', category: 'music' }),
    ];
    const categories = recommend(catalog, request(), PREFS, EMPTY_HISTORY).recommendations.map(
      (r) => r.activity.category,
    );
    assert.ok(new Set(categories).size >= 2, `expected variety, got ${categories.join(', ')}`);
  });

  test('balanced nudge shows at most one stretch activity when alternatives exist', () => {
    const stretch = (id: string) =>
      makeActivity({ id, category: 'arts', challenge: { novelty: 2, social: 2, physical: 1, commitment: 1 } });
    const catalog = [
      stretch('s1'),
      stretch('s2'),
      stretch('s3'),
      makeActivity({ id: 'e1' }),
      makeActivity({ id: 'e2' }),
    ];
    const result = recommend(catalog, request(), PREFS, EMPTY_HISTORY);
    assert.equal(result.recommendations.filter((r) => r.challenge.level === 'stretch').length, 1);
    assert.ok(result.recommendations.some((r) => r.challenge.level === 'easy'));
  });

  test('balanced nudge still fills three slots with stretch activities if that is all there is', () => {
    const catalog = ['s1', 's2', 's3'].map((id) =>
      makeActivity({ id, challenge: { novelty: 2, social: 2, physical: 1, commitment: 1 } }),
    );
    assert.equal(recommend(catalog, request(), PREFS, EMPTY_HISTORY).recommendations.length, 3);
  });

  test('gentle nudge never shows stretch activities', () => {
    const catalog = [
      makeActivity({ id: 's', challenge: { novelty: 2, social: 2, physical: 2, commitment: 2 } }),
      makeActivity({ id: 'e' }),
    ];
    const result = recommend(catalog, request(), { ...PREFS, nudge: 'gentle' }, EMPTY_HISTORY);
    assert.deepEqual(ids(result), ['e']);
    assert.equal(result.exclusions.too_challenging, 1);
  });

  test('reserves the last slot for something new, labeled as such', () => {
    const catalog = [
      makeActivity({ id: 'o1', category: 'outdoors' }),
      makeActivity({ id: 'o2', category: 'outdoors' }),
      makeActivity({ id: 'o3', category: 'outdoors' }),
      makeActivity({ id: 'o4', category: 'outdoors' }),
      makeActivity({ id: 'new', category: 'learning', venue: { name: 'Far', ...north(8) } }),
    ];
    const prefs = { ...PREFS, interests: ['outdoors' as const] };
    const result = recommend(catalog, request(), prefs, EMPTY_HISTORY);
    const last = result.recommendations.at(-1);
    assert.equal(last?.activity.id, 'new');
    assert.equal(last?.slot, 'novel');
    assert.ok(last?.reasons.includes('A new learning experience for you'));
  });

  test('every recommendation explains itself with one to three reasons', () => {
    const result = recommend(
      buildDemoCatalog(NOW),
      request({ origin: DEMO_CENTER }),
      DEFAULT_PREFERENCES,
      EMPTY_HISTORY,
    );
    for (const r of result.recommendations) {
      assert.ok(r.reasons.length >= 1 && r.reasons.length <= 3);
      for (const reason of r.reasons) assert.ok(reason.length > 0 && reason.length < 60);
    }
  });

  test('is deterministic for a given seed', () => {
    const catalog = Array.from({ length: 10 }, (_, i) => makeActivity({ category: i % 3 ? 'arts' : 'food' }));
    const a = recommend(catalog, request({ mood: 'surprise', seed: 9 }), PREFS, EMPTY_HISTORY);
    const b = recommend(catalog, request({ mood: 'surprise', seed: 9 }), PREFS, EMPTY_HISTORY);
    assert.deepEqual(ids(a), ids(b));
  });
});

describe('demo catalog', () => {
  test('every mood yields three recommendations with default preferences', () => {
    const catalog = buildDemoCatalog(NOW);
    for (const mood of ['surprise', 'chill', 'social', 'active', 'creative'] as const) {
      const result = recommend(
        catalog,
        {
          mood,
          budget: DEFAULT_PREFERENCES.budget,
          maxDistanceKm: DEFAULT_PREFERENCES.maxDistanceKm,
          availableMinutes: DEFAULT_PREFERENCES.availableMinutes,
          origin: DEMO_CENTER,
          now: NOW,
        },
        DEFAULT_PREFERENCES,
        EMPTY_HISTORY,
      );
      assert.equal(result.recommendations.length, 3, `mood ${mood} returned ${result.recommendations.length}`);
    }
  });

  test('includes deliberately unavailable records that are never recommended', () => {
    const catalog = buildDemoCatalog(NOW);
    const blocked = [
      'demo-jazz-expired',
      'demo-sunset-sail-soldout',
      'demo-kite-festival-cancelled',
      'demo-poetry-swap-undated',
    ];
    for (const id of blocked)
      assert.ok(
        catalog.some((a) => a.id === id),
        `${id} missing from fixtures`,
      );
    const seen = new Set<string>();
    for (const mood of ['surprise', 'chill', 'social', 'active', 'creative'] as const) {
      let shown: string[] = [];
      for (let round = 0; round < 10; round++) {
        const r = recommend(
          catalog,
          request({ mood, origin: DEMO_CENTER, excludeIds: shown }),
          DEFAULT_PREFERENCES,
          EMPTY_HISTORY,
        );
        if (!r.recommendations.length) break;
        shown = [...shown, ...ids(r)];
      }
      shown.forEach((id) => seen.add(id));
    }
    for (const id of blocked) assert.ok(!seen.has(id), `${id} was recommended`);
  });

  test('all demo records are labeled as demo content', () => {
    for (const a of buildDemoCatalog(NOW)) {
      assert.equal(a.verification.status, 'demo');
      assert.equal(a.source.platform, 'demo');
    }
  });
});
