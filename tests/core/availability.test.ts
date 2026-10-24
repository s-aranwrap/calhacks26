import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { assessAvailability, isExpired } from '../../src/core/availability.ts';
import { assessChallenge } from '../../src/core/challenge.ts';
import { buildProfile } from '../../src/core/learning.ts';
import { formatCheckedAgo, formatEventWhen } from '../../src/core/time.ts';
import { NOW, adventure, dismissal, makeActivity, makeEvent } from '../helpers.ts';

describe('expired-event handling', () => {
  test('an event is expired once its end has passed', () => {
    const ended = makeEvent(-4, { endAt: new Date(NOW.getTime() - 3_600_000).toISOString() });
    assert.equal(isExpired(ended, NOW), true);
    assert.equal(assessAvailability(ended, NOW).state, 'ended');
    assert.equal(assessAvailability(ended, NOW).viable, false);
  });

  test('without an end time, the duration (or a 3 hour default) decides', () => {
    const shortPast = makeEvent(-2, { duration: { minMinutes: 60, certainty: 'estimated' } });
    assert.equal(isExpired(shortPast, NOW), true);
    const noDuration = makeEvent(-2);
    delete (noDuration as { duration?: unknown }).duration;
    assert.equal(isExpired(noDuration, NOW), false, 'still within the 3h default');
  });

  test('an event with less than 30 minutes left is treated as over', () => {
    const almostDone = makeEvent(-1, { duration: { minMinutes: 80, certainty: 'estimated' } });
    assert.equal(isExpired(almostDone, NOW), true);
  });

  test('evergreen activities never expire', () => {
    assert.equal(isExpired(makeActivity(), NOW), false);
    assert.equal(assessAvailability(makeActivity(), NOW).viable, true);
  });

  test('events too far ahead are not offered yet', () => {
    assert.equal(assessAvailability(makeEvent(24 * 60), NOW).state, 'too_far_ahead');
  });
});

describe('availability labels are honest', () => {
  test('unverified events say availability is not verified', () => {
    const a = assessAvailability(makeEvent(24), NOW);
    assert.equal(a.confirmed, false);
    assert.match(a.label, /not verified/);
  });

  test('only a fresh verified check counts as confirmed', () => {
    const fresh = makeEvent(24, {
      availability: 'available',
      verification: { status: 'verified', lastCheckedAt: '2026-11-03T12:00:00Z' },
    });
    const stale = makeEvent(24, {
      availability: 'available',
      verification: { status: 'verified', lastCheckedAt: '2026-09-01T12:00:00Z' },
    });
    assert.equal(assessAvailability(fresh, NOW).confirmed, true);
    assert.equal(assessAvailability(stale, NOW).confirmed, false);
  });

  test('demo records are labeled as samples', () => {
    const demo = makeEvent(24, { verification: { status: 'demo' } });
    assert.match(assessAvailability(demo, NOW).label, /Sample listing/);
  });

  test('sold out and cancelled are never viable', () => {
    assert.equal(assessAvailability(makeEvent(24, { availability: 'sold_out' }), NOW).viable, false);
    assert.equal(assessAvailability(makeActivity({ availability: 'cancelled' }), NOW).viable, false);
  });
});

describe('challenge level', () => {
  test('explicit factors win over inference', () => {
    const a = makeActivity({
      category: 'fitness',
      tags: ['strenuous'],
      challenge: { novelty: 0, social: 0, physical: 0, commitment: 0 },
    });
    assert.equal(assessChallenge(a).level, 'easy');
    assert.deepEqual(assessChallenge(a).notes, []);
  });

  test('performing in front of strangers for the first time is a stretch', () => {
    const openMic = makeActivity({
      category: 'music',
      tags: ['open-mic', 'performance', 'first-time'],
      duration: { minMinutes: 180, certainty: 'estimated' },
    });
    const result = assessChallenge(openMic);
    assert.equal(result.level, 'stretch');
    assert.equal(result.notes[0], 'Something genuinely new for most people');
  });

  test('a short free walk is easy; a pricey long class is moderate or more', () => {
    assert.equal(assessChallenge(makeActivity({ category: 'outdoors', tags: ['walk'] })).level, 'easy');
    const pricey = makeActivity({
      category: 'arts',
      price: { minAmount: 60, currency: 'USD', certainty: 'verified' },
      duration: { minMinutes: 240, certainty: 'estimated' },
    });
    assert.notEqual(assessChallenge(pricey).level, 'easy');
  });
});

describe('learned profile', () => {
  test('reactions scale category affinity and old signals decay', () => {
    const music = makeActivity({ category: 'music' });
    const recent = buildProfile(
      { feedback: [], adventures: [adventure(music, 'completed', { reaction: 'loved' })] },
      NOW,
    );
    const old = buildProfile(
      {
        feedback: [],
        adventures: [adventure(music, 'completed', { reaction: 'loved', completedAt: '2026-01-01T00:00:00Z' })],
      },
      NOW,
    );
    assert.ok((recent.categoryAffinity.music ?? 0) > (old.categoryAffinity.music ?? 0));
    assert.ok(recent.triedCategories.has('music'));
    const meh = buildProfile({ feedback: [], adventures: [adventure(music, 'completed', { reaction: 'meh' })] }, NOW);
    assert.ok((meh.categoryAffinity.music ?? 0) < 0);
  });

  test('"too expensive" and "too far" become soft ceilings', () => {
    const a = makeActivity({ price: { minAmount: 25, currency: 'USD', certainty: 'verified' } });
    const b = makeActivity({ price: { minAmount: 18, currency: 'USD', certainty: 'verified' } });
    const far = dismissal(makeActivity(), 'too_far');
    far.context.distanceKm = 7;
    const profile = buildProfile(
      { feedback: [dismissal(a, 'too_expensive'), dismissal(b, 'too_expensive'), far], adventures: [] },
      NOW,
    );
    assert.equal(profile.priceCeiling, 18);
    assert.equal(profile.distanceCeilingKm, 7);
  });

  test('feedback older than the window no longer sets ceilings', () => {
    const a = makeActivity({ price: { minAmount: 25, currency: 'USD', certainty: 'verified' } });
    assert.equal(
      buildProfile({ feedback: [dismissal(a, 'too_expensive', 90)], adventures: [] }, NOW).priceCeiling,
      undefined,
    );
  });
});

describe('formatting', () => {
  test('event times are shown in the event time zone with Today/Tomorrow', () => {
    assert.equal(formatEventWhen('2026-11-04T23:30:00Z', 'Europe/London', NOW, 'en-US'), 'Today · 11:30 PM');
    assert.equal(formatEventWhen('2026-11-05T09:00:00Z', 'Europe/London', NOW, 'en-US'), 'Tomorrow · 9:00 AM');
    assert.equal(formatEventWhen('2026-11-07T18:00:00Z', 'Europe/London', NOW, 'en-US'), 'Sat, Nov 7 · 6:00 PM');
    assert.equal(formatEventWhen('nonsense', 'Europe/London', NOW), 'Date unknown');
  });

  test('last-checked labels', () => {
    assert.equal(formatCheckedAgo('2026-11-04T08:00:00Z', NOW), 'Checked today');
    assert.equal(formatCheckedAgo('2026-11-01T08:00:00Z', NOW), 'Checked 3 days ago');
    assert.equal(formatCheckedAgo(undefined, NOW), undefined);
  });
});

describe('fact formatting', async () => {
  const { formatDuration, formatPrice, budgetLabel, timeOptionLabel } = await import('../../src/core/format.ts');

  test('prices keep their certainty and never invent a value', () => {
    assert.deepEqual(formatPrice(undefined), { text: 'Price not listed', certainty: 'unknown' });
    assert.deepEqual(formatPrice({ minAmount: 0, currency: 'USD', certainty: 'verified' }, 'en-US'), {
      text: 'Free',
      certainty: 'verified',
    });
    assert.equal(
      formatPrice({ minAmount: 8, maxAmount: 15, currency: 'USD', certainty: 'estimated' }, 'en-US').text,
      '$8–$15',
    );
    assert.equal(formatPrice({ minAmount: 12.5, currency: 'GBP', certainty: 'estimated' }, 'en-GB').text, '£12.50');
    assert.equal(
      formatPrice({ minAmount: 0, maxAmount: 10, currency: 'EUR', certainty: 'estimated' }, 'en-US').text,
      'Free–€10',
    );
  });

  test('durations read naturally', () => {
    assert.equal(formatDuration({ minMinutes: 45, certainty: 'estimated' }).text, '45 min');
    assert.equal(formatDuration({ minMinutes: 45, maxMinutes: 90, certainty: 'estimated' }).text, '45–90 min');
    assert.equal(formatDuration({ minMinutes: 60, maxMinutes: 120, certainty: 'estimated' }).text, '1–2 hr');
    assert.equal(formatDuration({ minMinutes: 150, maxMinutes: 240, certainty: 'estimated' }).text, '2.5–4 hr');
    assert.equal(formatDuration({ minMinutes: 30, maxMinutes: 120, certainty: 'estimated' }).text, '30 min–2 hr');
    assert.equal(formatDuration(undefined).certainty, 'unknown');
  });

  test('filter labels', () => {
    assert.equal(budgetLabel('low', 'USD', 'en-US'), 'Up to $15');
    assert.equal(budgetLabel('any', 'USD'), 'Any');
    assert.equal(timeOptionLabel(120), '2 hr');
    assert.equal(timeOptionLabel(240), 'Half day');
    assert.equal(timeOptionLabel(null), 'No limit');
  });
});
