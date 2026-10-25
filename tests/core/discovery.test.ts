import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  activityMoodsFor,
  dayKey,
  kmToMilesText,
  MAX_MOOD_PICKS,
  parseMiles,
  resolveWhen,
  toggleMoodPick,
} from '../../src/core/discovery.ts';
import { recommend } from '../../src/core/recommend.ts';
import { EMPTY_HISTORY, NOW, PREFS, makeActivity, makeEvent, request } from '../helpers.ts';

describe('mood picks', () => {
  test('select, deselect, and refuse a fourth mood without dropping the others', () => {
    let state = toggleMoodPick([], 'chill');
    assert.deepEqual(state.picks, ['chill']);
    state = toggleMoodPick(state.picks, 'social');
    state = toggleMoodPick(state.picks, 'creative');
    assert.equal(state.picks.length, MAX_MOOD_PICKS);
    const fourth = toggleMoodPick(state.picks, 'energetic');
    assert.equal(fourth.limitReached, true);
    assert.deepEqual(fourth.picks, ['chill', 'social', 'creative']);
    assert.deepEqual(toggleMoodPick(state.picks, 'social').picks, ['chill', 'creative']);
  });

  test('penguin moods map onto catalog moods without duplicates', () => {
    assert.deepEqual(activityMoodsFor(['chill', 'peaceful']), ['chill']);
    assert.deepEqual(activityMoodsFor(['adventurous', 'social']), ['active', 'social']);
    assert.deepEqual(activityMoodsFor([]), []);
  });

  test('several moods match activities carrying any of them', () => {
    const chill = makeActivity({ moods: ['chill'] });
    const social = makeActivity({ moods: ['social'], category: 'community' });
    const active = makeActivity({ moods: ['active'], category: 'fitness' });
    const result = recommend([chill, social, active], request({ moods: ['chill', 'social'] }), PREFS, EMPTY_HISTORY);
    const ids = result.recommendations.map((r) => r.activity.id).sort();
    assert.deepEqual(ids, [chill.id, social.id].sort());
    assert.equal(result.exclusions.mood, 1);
  });

  test('no moods behaves like "surprise me"', () => {
    const catalog = [makeActivity({ moods: ['chill'] }), makeActivity({ moods: ['active'], category: 'fitness' })];
    const result = recommend(catalog, request({ mood: 'surprise', moods: [] }), PREFS, EMPTY_HISTORY);
    assert.equal(result.recommendations.length, 2);
  });
});

describe('when filter', () => {
  // NOW is a Wednesday afternoon (UTC); tests compute windows in the runner's zone.
  test('today ends at local midnight and tomorrow covers the next calendar day', () => {
    const today = resolveWhen({ kind: 'today' }, NOW)!;
    assert.equal(today.startMs, NOW.getTime());
    const tomorrow = resolveWhen({ kind: 'tomorrow' }, NOW)!;
    assert.equal(tomorrow.startMs, today.endMs);
    assert.equal(dayKey(new Date(tomorrow.startMs)), dayKey(new Date(NOW.getTime() + 86_400_000)));
  });

  test('this weekend starts on Saturday, or now when it is already the weekend', () => {
    const weekend = resolveWhen({ kind: 'weekend' }, NOW)!;
    assert.equal(new Date(weekend.startMs).getDay(), 6);
    const saturdayNoon = new Date(2026, 10, 7, 12);
    assert.equal(resolveWhen({ kind: 'weekend' }, saturdayNoon)!.startMs, saturdayNoon.getTime());
  });

  test('chosen dates are inclusive and never start in the past', () => {
    const start = dayKey(NOW);
    const later = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2);
    const window = resolveWhen({ kind: 'dates', start, end: dayKey(later) }, NOW)!;
    assert.equal(window.startMs, NOW.getTime());
    assert.equal(window.endMs, new Date(later.getFullYear(), later.getMonth(), later.getDate() + 1).getTime());
    assert.equal(resolveWhen({ kind: 'dates', start: 'nope', end: start }, NOW), null);
  });

  test('events outside the window are excluded and counted; places stay eligible', () => {
    const soon = makeEvent(2);
    const nextWeek = makeEvent(24 * 7);
    const place = makeActivity();
    const window = { startMs: NOW.getTime(), endMs: NOW.getTime() + 6 * 3_600_000 };
    const result = recommend([soon, nextWeek, place], request({ window }), PREFS, EMPTY_HISTORY);
    const ids = result.recommendations.map((r) => r.activity.id).sort();
    assert.deepEqual(ids, [soon.id, place.id].sort());
    assert.equal(result.exclusions.when, 1);
  });

  test('suggests widening the time window when it rules things out', () => {
    const result = recommend(
      [makeEvent(24 * 7)],
      request({ window: { startMs: NOW.getTime(), endMs: NOW.getTime() + 3_600_000 } }),
      PREFS,
      EMPTY_HISTORY,
    );
    assert.equal(result.status, 'empty');
    assert.ok(result.suggestions.includes('any_time'));
  });
});

describe('distance input', () => {
  test('accepts positive miles, blank means any, and rejects the rest', () => {
    const five = parseMiles('5');
    assert.ok(five.ok && five.km !== null && Math.abs(five.km - 8.047) < 0.01);
    assert.deepEqual(parseMiles('  '), { ok: true, km: null });
    assert.equal(parseMiles('0').ok, false);
    assert.equal(parseMiles('-3').ok, false);
    assert.equal(parseMiles('five').ok, false);
    assert.equal(kmToMilesText(8.04672), '5');
    assert.equal(kmToMilesText(null), '');
  });
});
