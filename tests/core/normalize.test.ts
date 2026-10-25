import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeActivity, type NormalizeContext } from '../../src/core/normalize.ts';
import { parseImportedDateTime } from '../../src/core/time.ts';
import type { Activity } from '../../src/core/types.ts';
import { NOW } from '../helpers.ts';

const ctx: NormalizeContext = { platform: 'csv', now: NOW, defaultCurrency: 'USD' };

function ok(raw: unknown, context: NormalizeContext = ctx): { activity: Activity; warnings: string[] } {
  const result = normalizeActivity(raw, context);
  assert.ok(result.ok, `expected ok, got errors: ${!result.ok ? result.errors.join('; ') : ''}`);
  return result;
}

describe('required fields and defaults', () => {
  test('a title alone is enough; everything else degrades gracefully', () => {
    const { activity, warnings } = ok({ title: '  Sunset   walk ' });
    assert.equal(activity.title, 'Sunset walk');
    assert.equal(activity.kind, 'evergreen');
    assert.equal(activity.category, 'other');
    assert.deepEqual(activity.moods, ['chill']);
    assert.equal(activity.availability, 'unknown');
    assert.equal(activity.verification.status, 'unverified');
    assert.equal(activity.price, undefined);
    assert.equal(activity.duration, undefined);
    assert.equal(activity.venue, undefined);
    assert.ok(warnings.some((w) => w.includes('moods inferred')));
  });

  test('rejects records without a title', () => {
    const result = normalizeActivity({ description: 'No title' }, ctx);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.includes('title is required'));
  });

  test('rejects non-objects', () => {
    for (const raw of [null, 42, 'text', ['title']]) assert.equal(normalizeActivity(raw, ctx).ok, false);
  });

  test('unknown category becomes "other" with a warning; unknown moods are dropped', () => {
    const { activity, warnings } = ok({ title: 'x', category: 'Spelunking', moods: 'chill|sleepy' });
    assert.equal(activity.category, 'other');
    assert.deepEqual(activity.moods, ['chill']);
    assert.ok(warnings.some((w) => w.includes('sleepy')));
  });

  test('accepts JSON arrays and pipe/comma separated lists', () => {
    assert.deepEqual(ok({ title: 'x', moods: ['social', 'active'] }).activity.moods, ['social', 'active']);
    assert.deepEqual(ok({ title: 'x', tags: '#Walk, views ;  Walk' }).activity.tags, ['walk', 'views']);
  });
});

describe('trust rules', () => {
  test('"verified" without last_checked_at is downgraded', () => {
    const { activity, warnings } = ok({ title: 'x', verification_status: 'verified' });
    assert.equal(activity.verification.status, 'unverified');
    assert.ok(warnings.some((w) => w.includes('downgraded')));
  });

  test('"verified" with a valid last_checked_at is kept, and field certainty follows it', () => {
    const { activity } = ok({
      title: 'x',
      verification_status: 'verified',
      last_checked_at: '2026-11-01T10:00:00Z',
      price_min: 10,
      duration_min_minutes: 60,
    });
    assert.equal(activity.verification.status, 'verified');
    assert.equal(activity.price?.certainty, 'verified');
    assert.equal(activity.duration?.certainty, 'verified');
  });

  test('field certainty cannot be "verified" on an unverified record', () => {
    const { activity } = ok({ title: 'x', price_min: 10, price_certainty: 'verified' });
    assert.equal(activity.price?.certainty, 'estimated');
  });

  test('Instagram imports default to candidate status', () => {
    const { activity } = ok({ title: 'x' }, { ...ctx, platform: 'instagram' });
    assert.equal(activity.verification.status, 'candidate');
  });

  test('demo fixtures are always demo, whatever they claim', () => {
    const { activity } = ok(
      {
        title: 'x',
        verification_status: 'verified',
        last_checked_at: '2026-11-01T10:00:00Z',
        source_platform: 'organizer',
      },
      { ...ctx, platform: 'demo' },
    );
    assert.equal(activity.verification.status, 'demo');
    assert.equal(activity.source.platform, 'demo');
  });

  test('imported records cannot claim to be demo content', () => {
    const { activity } = ok({ title: 'x', source_platform: 'demo' });
    assert.equal(activity.source.platform, 'csv');
  });
});

describe('malformed optional data', () => {
  test('drops invalid, incomplete or (0,0) coordinates but keeps the venue', () => {
    for (const coords of [
      { latitude: 'abc', longitude: 2 },
      { latitude: 95, longitude: 2 },
      { latitude: 10 },
      { latitude: 0, longitude: 0 },
    ]) {
      const { activity, warnings } = ok({ title: 'x', venue_name: 'Hall', ...coords });
      assert.equal(activity.venue?.name, 'Hall');
      assert.equal(activity.venue?.latitude, undefined);
      assert.ok(warnings.some((w) => w.includes('coordinates dropped')));
    }
  });

  test('parses numeric strings', () => {
    const { activity } = ok({
      title: 'x',
      latitude: '51.5',
      longitude: '-0.12',
      price_min: '$1,200',
      duration_min_minutes: '90',
    });
    assert.equal(activity.venue?.latitude, 51.5);
    assert.equal(activity.price?.minAmount, 1200);
    assert.equal(activity.duration?.minMinutes, 90);
  });

  test('only keeps http(s) source URLs and https images', () => {
    const { activity, warnings } = ok({
      title: 'x',
      source_url: 'javascript:alert(1)',
      image_url: 'http://example.com/a.jpg',
    });
    assert.equal(activity.source.url, undefined);
    assert.equal(activity.imageUrl, undefined);
    assert.equal(warnings.filter((w) => w.includes('dropped')).length, 2);
    assert.equal(
      ok({ title: 'x', source_url: ' https://example.com/e ' }).activity.source.url,
      'https://example.com/e',
    );
  });

  test('negative prices are dropped, not clamped', () => {
    const { activity } = ok({ title: 'x', price_min: -5 });
    assert.equal(activity.price, undefined);
  });

  test('price_max below price_min is ignored', () => {
    const { activity } = ok({ title: 'x', price_min: 20, price_max: 10 });
    assert.deepEqual([activity.price?.minAmount, activity.price?.maxAmount], [20, undefined]);
  });

  test('is_free and price 0 both mean free; price_max alone is unknown', () => {
    assert.equal(ok({ title: 'x', is_free: 'yes' }).activity.price?.minAmount, 0);
    assert.equal(ok({ title: 'x', price_min: 0 }).activity.price?.minAmount, 0);
    assert.equal(ok({ title: 'x', price_max: 30 }).activity.price, undefined);
  });

  test('invalid currency falls back to the default', () => {
    assert.equal(ok({ title: 'x', price_min: 5, currency: 'dollars' }).activity.price?.currency, 'USD');
    assert.equal(ok({ title: 'x', price_min: 5, currency: 'eur' }).activity.price?.currency, 'EUR');
  });

  test('non-positive or absurd durations are dropped', () => {
    assert.equal(ok({ title: 'x', duration_min_minutes: 0 }).activity.duration, undefined);
    assert.equal(ok({ title: 'x', duration_min_minutes: 99999 }).activity.duration, undefined);
  });

  test('unknown availability and unsafe ids are handled', () => {
    const { activity, warnings } = ok({ title: 'x', availability: 'maybe', id: 'bad id!' });
    assert.equal(activity.availability, 'unknown');
    assert.match(activity.id, /^act_[0-9a-f]{8}$/);
    assert.ok(warnings.length >= 2);
  });

  test('truncates very long text', () => {
    const { activity } = ok({ title: 'T'.repeat(500), description: 'D'.repeat(5000) });
    assert.ok(activity.title.length <= 140);
    assert.ok(activity.description.length <= 2000);
  });
});

describe('dates and times', () => {
  test('events: ISO with offset is accepted, kind inferred from start_at', () => {
    const { activity } = ok({ title: 'x', start_at: '2026-11-07T18:30:00+01:00' });
    assert.equal(activity.kind, 'event');
    assert.equal(activity.startAt, '2026-11-07T17:30:00.000Z');
  });

  test('wall-clock times are converted using the time zone, across DST', () => {
    // US daylight saving ends on 1 Nov 2026: EDT (UTC-4) before, EST (UTC-5) after.
    assert.deepEqual(parseImportedDateTime('2026-07-04 12:00', 'America/New_York'), {
      ok: true,
      iso: '2026-07-04T16:00:00.000Z',
    });
    assert.deepEqual(parseImportedDateTime('2026-11-07T18:30', 'America/New_York'), {
      ok: true,
      iso: '2026-11-07T23:30:00.000Z',
    });
    assert.deepEqual(parseImportedDateTime('2026-03-29 09:15', 'Europe/London'), {
      ok: true,
      iso: '2026-03-29T08:15:00.000Z',
    });
  });

  test('wall-clock times without a time zone are rejected rather than guessed', () => {
    const { activity, warnings } = ok({ title: 'x', kind: 'event', start_at: '2026-11-07 18:30' });
    assert.equal(activity.startAt, undefined);
    assert.ok(warnings.some((w) => w.includes('time_zone')));
    assert.ok(warnings.some((w) => w.includes('will not be recommended')));
  });

  test('invalid time zones and date-only values are reported', () => {
    const { warnings } = ok({ title: 'x', start_at: '2026-11-07', time_zone: 'Mars/Olympus' });
    assert.ok(warnings.some((w) => w.includes('Mars/Olympus')));
    assert.ok(warnings.some((w) => w.includes('date without a time')));
  });

  test('end before start is dropped; end after start gives a duration', () => {
    const bad = ok({ title: 'x', start_at: '2026-11-07T18:00:00Z', end_at: '2026-11-07T17:00:00Z' }).activity;
    assert.equal(bad.endAt, undefined);
    const good = ok({ title: 'x', start_at: '2026-11-07T18:00:00Z', end_at: '2026-11-07T20:30:00Z' }).activity;
    assert.deepEqual(good.duration, { minMinutes: 150, certainty: 'estimated', basis: 'event_window' });
  });

  test('evergreen activities ignore event times but keep opening hours', () => {
    const { activity } = ok({
      title: 'x',
      kind: 'evergreen',
      start_at: '2026-11-07T18:00:00Z',
      opening_hours: 'Daily 9–5',
    });
    assert.equal(activity.startAt, undefined);
    assert.equal(activity.openingHours, 'Daily 9–5');
  });

  test('source publication time is kept separately from the event start', () => {
    const { activity } = ok({
      title: 'x',
      start_at: '2026-11-20T18:00:00Z',
      source_published_at: '2026-10-01T09:00:00Z',
    });
    assert.equal(activity.source.publishedAt, '2026-10-01T09:00:00.000Z');
    assert.equal(activity.startAt, '2026-11-20T18:00:00.000Z');
  });
});

describe('ids', () => {
  test('derives the same id for the same source listing across imports', () => {
    const a = ok({ title: 'Quiz', source_id: 'abc', start_at: '2026-11-07T18:00:00Z' }).activity;
    const b = ok({ title: 'Quiz night (updated)', source_id: 'abc' }).activity;
    assert.equal(a.id, b.id);
  });

  test('falls back to the canonical URL, then to a content fingerprint', () => {
    const viaUrl1 = ok({ title: 'A', source_url: 'https://www.example.com/e/1/?utm_source=x' }).activity;
    const viaUrl2 = ok({ title: 'B', source_url: 'https://example.com/e/1' }).activity;
    assert.equal(viaUrl1.id, viaUrl2.id);
    const fp1 = ok({ title: 'Pottery Night!', venue_name: 'Kiln' }).activity;
    const fp2 = ok({ title: 'pottery night', venue_name: 'KILN' }).activity;
    assert.equal(fp1.id, fp2.id);
  });

  test('explicit safe ids are kept', () => {
    assert.equal(ok({ id: 'my-event_1', title: 'x' }).activity.id, 'my-event_1');
  });
});
