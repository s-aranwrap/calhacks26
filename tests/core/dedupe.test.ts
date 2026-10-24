import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { dedupeActivities } from '../../src/core/dedupe.ts';
import { canonicalizeUrl, instagramShortcodeFromUrl, sanitizeHttpUrl } from '../../src/core/urls.ts';
import { makeActivity } from '../helpers.ts';

describe('canonical URLs', () => {
  test('ignore www, trailing slashes, fragments, tracking params and param order', () => {
    const variants = [
      'https://www.Example.com/events/42/?utm_source=ig&b=2&a=1#tickets',
      'http://example.com/events/42?a=1&b=2&fbclid=xyz',
      'https://example.com/events/42?b=2&a=1',
    ];
    const canonical = new Set(variants.map((v) => canonicalizeUrl(v)));
    assert.equal(canonical.size, 1);
    assert.equal([...canonical][0], 'example.com/events/42?a=1&b=2');
  });

  test('collapse Instagram post, reel and profile-prefixed URLs to one shortcode', () => {
    assert.equal(canonicalizeUrl('https://www.instagram.com/p/Cx1_ab-9/?igsh=abc'), 'instagram.com/p/Cx1_ab-9');
    assert.equal(canonicalizeUrl('https://instagram.com/reel/Cx1_ab-9'), 'instagram.com/p/Cx1_ab-9');
    assert.equal(instagramShortcodeFromUrl('https://www.instagram.com/someclub/p/Cx1_ab-9/'), 'Cx1_ab-9');
    assert.equal(instagramShortcodeFromUrl('https://example.com/p/abc'), undefined);
  });

  test('reject non-web and credential-bearing URLs', () => {
    for (const bad of [
      'javascript:alert(1)',
      'intent://x',
      'ftp://x.com/f',
      'https://user:pw@x.com',
      'not a url',
      '',
    ]) {
      assert.equal(sanitizeHttpUrl(bad), undefined, bad);
    }
  });
});

describe('dedupeActivities', () => {
  test('merges records with the same platform source id', () => {
    const a = makeActivity({ id: 'one', source: { platform: 'instagram', sourceId: 'ABC' } });
    const b = makeActivity({ id: 'two', source: { platform: 'instagram', sourceId: 'ABC' } });
    const result = dedupeActivities([a, b]);
    assert.equal(result.activities.length, 1);
    assert.equal(result.duplicates[0]?.matchedOn, 'source_id');
  });

  test('the same source id on different platforms is not a duplicate', () => {
    const a = makeActivity({ source: { platform: 'instagram', sourceId: 'ABC' } });
    const b = makeActivity({ source: { platform: 'csv', sourceId: 'ABC' } });
    assert.equal(dedupeActivities([a, b]).activities.length, 2);
  });

  test('merges records whose source URLs canonicalize to the same page', () => {
    const a = makeActivity({ source: { platform: 'csv', url: 'https://www.venue.com/quiz/?utm_campaign=x' } });
    const b = makeActivity({ source: { platform: 'json', url: 'https://venue.com/quiz' } });
    const result = dedupeActivities([a, b]);
    assert.equal(result.activities.length, 1);
    assert.equal(result.duplicates[0]?.matchedOn, 'url');
  });

  test('merges by title + start + venue fingerprint, ignoring case and punctuation', () => {
    const start = '2026-11-07T18:00:00.000Z';
    const a = makeActivity({ kind: 'event', title: 'Quiz Night!', startAt: start, venue: { name: 'The Pint' } });
    const b = makeActivity({ kind: 'event', title: 'quiz night', startAt: start, venue: { name: 'the pint' } });
    assert.equal(dedupeActivities([a, b]).activities.length, 1);
  });

  test('keeps recurring events on different dates separate', () => {
    const a = makeActivity({
      kind: 'event',
      title: 'Quiz',
      startAt: '2026-11-07T18:00:00.000Z',
      venue: { name: 'Pint' },
    });
    const b = makeActivity({
      kind: 'event',
      title: 'Quiz',
      startAt: '2026-11-14T18:00:00.000Z',
      venue: { name: 'Pint' },
    });
    assert.equal(dedupeActivities([a, b]).activities.length, 2);
  });

  test('keeps the most trustworthy record and only fills its missing fields', () => {
    const unverified = makeActivity({
      id: 'unverified',
      source: { platform: 'csv', sourceId: 'x', url: 'https://organizer.example/e' },
      imageUrl: 'https://img.example/a.jpg',
      price: { minAmount: 99, currency: 'USD', certainty: 'estimated' },
    });
    const verified = makeActivity({
      id: 'verified',
      source: { platform: 'csv', sourceId: 'x' },
      verification: { status: 'verified', lastCheckedAt: '2026-11-01T00:00:00Z' },
      price: { minAmount: 10, currency: 'USD', certainty: 'verified' },
    });
    delete (verified as { imageUrl?: string }).imageUrl;
    const [merged] = dedupeActivities([unverified, verified]).activities;
    assert.equal(merged?.id, 'verified');
    assert.equal(merged?.price?.minAmount, 10, 'existing values are never overwritten');
    assert.equal(merged?.imageUrl, 'https://img.example/a.jpg', 'missing values are filled');
    assert.equal(merged?.source.url, 'https://organizer.example/e');
  });

  test('preserves order and handles transitive matches', () => {
    const a = makeActivity({ id: 'a', source: { platform: 'csv', sourceId: '1' } });
    const b = makeActivity({ id: 'b', source: { platform: 'csv', sourceId: '1', url: 'https://x.com/e' } });
    const c = makeActivity({ id: 'c', source: { platform: 'json', url: 'https://x.com/e/' } });
    const d = makeActivity({ id: 'd' });
    const result = dedupeActivities([a, b, c, d]);
    // a, b and c are one listing (a~b by source id, b~c by URL). b wins on
    // completeness but keeps a's position in the list.
    assert.deepEqual(
      result.activities.map((x) => x.id),
      ['b', 'd'],
    );
    assert.equal(result.duplicates.length, 2);
  });
});
