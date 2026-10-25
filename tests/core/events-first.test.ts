import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeActivity } from '../../src/core/normalize.ts';
import { recommend } from '../../src/core/recommend.ts';
import { buildPackCatalog, SF_PACK } from '../../src/data/packs/index.ts';
import { DEFAULT_PREFERENCES } from '../../src/data/local/preferences.ts';

const NOW = new Date('2026-10-25T19:00:00Z'); // Sunday noon in SF
const CATEGORIES = ['music', 'arts', 'food', 'community', 'games', 'fitness', 'learning'];

function instagramEvents(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(NOW.getTime() + (i % 14) * 86_400_000 + 3 * 3_600_000);
    const ymd = day.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const r = normalizeActivity(
      {
        title: `IG event ${i}`,
        kind: 'event',
        category: CATEGORIES[i % CATEGORIES.length],
        start_at: `${ymd} 19:00`,
        end_at: `${ymd} 22:00`,
        time_zone: 'America/Los_Angeles',
        source_platform: 'instagram',
        source_id: `P${i}`,
        verification_status: 'unverified',
        venue_name: `Venue ${i}`,
      },
      { platform: 'json', now: NOW },
    );
    assert.ok(r.ok);
    return r.activity;
  });
}

const ask = (
  catalog: Parameters<typeof recommend>[0],
  mood: 'surprise' | 'chill' | 'social' | 'active' | 'creative',
  minEvents?: number,
) =>
  recommend(
    catalog,
    {
      mood,
      budget: DEFAULT_PREFERENCES.budget,
      maxDistanceKm: DEFAULT_PREFERENCES.maxDistanceKm,
      availableMinutes: DEFAULT_PREFERENCES.availableMinutes,
      origin: SF_PACK.center,
      now: NOW,
      ...(minEvents !== undefined ? { minEvents } : {}),
    },
    DEFAULT_PREFERENCES,
    { feedback: [], adventures: [] },
  );

describe('events come first', () => {
  const catalog = [...buildPackCatalog(SF_PACK, NOW), ...instagramEvents(40)];

  test('a 3-hour event window doesn’t rule an event out for "I have 2 hours"', () => {
    const result = ask(catalog, 'surprise');
    assert.equal(result.exclusions.time ?? 0, 0);
  });

  test('with plenty of events, all three picks are events, Instagram finds first', () => {
    for (const mood of ['surprise', 'chill', 'social', 'active', 'creative'] as const) {
      const picks = ask(catalog, mood).recommendations;
      assert.equal(picks.length, 3, mood);
      assert.ok(
        picks.every((p) => p.activity.kind === 'event'),
        mood,
      );
      assert.equal(picks[0]!.activity.source.platform, 'instagram', mood);
    }
  });

  test('places fill in when there aren’t enough events, and minEvents 0 turns it off', () => {
    const places = buildPackCatalog(SF_PACK, NOW).filter((a) => a.kind === 'evergreen');
    const few = [...places, ...instagramEvents(1)];
    const picks = ask(few, 'surprise').recommendations;
    assert.equal(picks.length, 3);
    assert.equal(picks[0]!.activity.title, 'IG event 0');
    assert.ok(picks.some((p) => p.activity.kind === 'evergreen'));
    assert.equal(ask(catalog, 'surprise', 0).recommendations.length, 3);
  });
});
