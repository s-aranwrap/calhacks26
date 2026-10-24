import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeActivity } from '../../src/core/normalize.ts';
import { parseArgs, redact } from '../../server/ingest/env.ts';
import {
  ApifyError,
  instagramPostToCandidate,
  reviewHintsFromCaption,
  runInstagramScraper,
} from '../../server/ingest/instagram.ts';
import { activityToRow, createSupabaseWriter } from '../../server/ingest/supabaseWriter.ts';
import { NOW, makeActivity, makeEvent } from '../helpers.ts';

const post = {
  id: '3141',
  shortCode: 'Cx1abc',
  url: 'https://www.instagram.com/p/Cx1abc/',
  caption: 'Open studio day! 🎨 #pottery #openstudio\nSat 14 Nov, 11am–4pm. Free entry.\n#sampletown',
  hashtags: ['pottery', 'openstudio', 'sampletown'],
  timestamp: '2026-10-30T09:12:00.000Z',
  locationName: 'Clayworks Studio',
  ownerUsername: 'clayworks.sample',
  displayUrl: 'https://scontent.cdninstagram.com/whatever.jpg',
  likesCount: 120,
};

describe('Instagram post → candidate', () => {
  test('uses only what the post contains and marks it as a candidate', () => {
    const result = instagramPostToCandidate(post, { category: 'arts' });
    assert.ok(result.ok);
    const { record, reviewHints } = result.candidate;
    assert.equal(record.title, 'Open studio day! 🎨');
    assert.equal(record.source_id, 'Cx1abc');
    assert.equal(record.source_published_at, '2026-10-30T09:12:00.000Z');
    assert.equal(record.venue_name, 'Clayworks Studio');
    assert.equal(record.start_at, undefined, 'never parses dates from captions');
    assert.equal(record.price_min, undefined, 'never parses prices from captions');
    assert.equal(record.image_url, undefined, 'does not store Instagram CDN images');
    assert.ok(reviewHints.some((h) => h.includes('14 Nov')));
    assert.ok(reviewHints.some((h) => /11am/i.test(h)));
    assert.ok(reviewHints.some((h) => /free/i.test(h)));

    const normalized = normalizeActivity(record, { platform: 'instagram', now: NOW });
    assert.ok(normalized.ok);
    assert.equal(normalized.activity.verification.status, 'candidate');
    assert.equal(normalized.activity.kind, 'evergreen');
    assert.deepEqual(normalized.activity.tags, ['pottery', 'openstudio', 'sampletown']);
  });

  test('handles missing captions, actor error items and malformed items', () => {
    const bare = instagramPostToCandidate({ url: 'https://www.instagram.com/reel/Zz9/', ownerUsername: 'club' });
    assert.ok(bare.ok && bare.candidate.record.title === 'Instagram post from @club');
    assert.deepEqual(instagramPostToCandidate({ error: 'no_items', url: 'https://instagram.com/x' }), {
      ok: false,
      reason: 'actor_error',
    });
    assert.deepEqual(instagramPostToCandidate({ caption: 'no url' }), { ok: false, reason: 'missing_shortcode' });
    assert.deepEqual(instagramPostToCandidate(null), { ok: false, reason: 'not_a_post' });
    assert.deepEqual(instagramPostToCandidate({ shortCode: '../../etc' }), { ok: false, reason: 'missing_shortcode' });
  });

  test('the same post from two runs gets the same id', () => {
    const a = instagramPostToCandidate(post);
    const b = instagramPostToCandidate({ ...post, caption: 'edited caption' });
    assert.ok(a.ok && b.ok);
    const idA = normalizeActivity(a.candidate.record, { platform: 'instagram', now: NOW });
    const idB = normalizeActivity(b.candidate.record, { platform: 'instagram', now: NOW });
    assert.ok(idA.ok && idB.ok && idA.activity.id === idB.activity.id);
  });

  test('review hints are bounded', () => {
    assert.ok(reviewHintsFromCaption('1/2 3/4 5/6 7/8 9/10 11/12 1:00 2:00 3:00 4:00 5:00 6:00').length <= 10);
  });
});

describe('Apify client', () => {
  const input = { directUrls: ['https://www.instagram.com/x/'], resultsType: 'posts' as const, resultsLimit: 5 };
  const noSleep = async () => {};

  test('sends the token as a bearer header, never in the URL', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, ...(init ? { init } : {}) };
      return new Response('[]', { status: 201 });
    }) as typeof fetch;
    await runInstagramScraper({ token: 'apify_api_SECRET123', actorId: 'apify~instagram-scraper', input, fetchImpl });
    assert.ok(seen && !seen.url.includes('SECRET'));
    assert.match(seen.url, /\/v2\/acts\/apify~instagram-scraper\/run-sync-get-dataset-items/);
    assert.equal((seen.init?.headers as Record<string, string>).Authorization, 'Bearer apify_api_SECRET123');
    assert.deepEqual(JSON.parse(String(seen.init?.body)), input);
  });

  test('retries rate limits and transient errors, then succeeds', async () => {
    const statuses = [429, 503, 200];
    const waits: number[] = [];
    const fetchImpl = (async () => {
      const status = statuses.shift()!;
      return new Response(status === 200 ? JSON.stringify([post]) : 'busy', {
        status,
        headers: status === 429 ? { 'retry-after': '2' } : {},
      });
    }) as unknown as typeof fetch;
    const items = await runInstagramScraper({
      token: 't0ken-value',
      actorId: 'a',
      input,
      fetchImpl,
      sleep: async (ms) => void waits.push(ms),
    });
    assert.equal(items.length, 1);
    assert.deepEqual(waits, [2000, 2000]);
  });

  test('gives up after max retries and never leaks the token', async () => {
    const fetchImpl = (async () =>
      new Response('token apify_api_SECRET123 invalid', { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(
      runInstagramScraper({ token: 'apify_api_SECRET123', actorId: 'a', input, fetchImpl, sleep: noSleep }),
      (e: ApifyError) => e.status === 401 && !e.message.includes('SECRET123') && e.message.includes('APIFY_API_TOKEN'),
    );
    const always429 = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    await assert.rejects(
      runInstagramScraper({ token: 'x', actorId: 'a', input, fetchImpl: always429, sleep: noSleep, maxRetries: 2 }),
      /after 3 attempts/,
    );
  });

  test('rejects malformed responses', async () => {
    const notList = (async () => new Response('{"items":[]}', { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(
      runInstagramScraper({ token: 'x', actorId: 'a', input, fetchImpl: notList }),
      /not a list|other than a list/,
    );
    const notJson = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(runInstagramScraper({ token: 'x', actorId: 'a', input, fetchImpl: notJson }), /not JSON/);
  });
});

describe('Supabase writer', () => {
  test('rows round-trip through the app normalizer', () => {
    const original = makeEvent(48, {
      id: 'evt-1',
      category: 'music',
      moods: ['social'],
      tags: ['choir'],
      timeZone: 'Europe/London',
      price: { minAmount: 5, maxAmount: 8, currency: 'GBP', certainty: 'verified', note: 'Donation' },
      duration: { minMinutes: 90, certainty: 'verified' },
      source: { platform: 'organizer', url: 'https://example.org/choir', sourceId: 'c1', label: 'Org' },
      verification: { status: 'verified', lastCheckedAt: '2026-11-03T10:00:00.000Z' },
      availability: 'limited',
      challenge: { social: 1 },
      whatToExpect: 'Singing',
    });
    const row = activityToRow(original, { published: true });
    assert.equal(row.published, true);
    assert.equal(row.canonical_url, 'example.org/choir');
    const back = normalizeActivity(row, { platform: 'supabase', now: NOW });
    assert.ok(back.ok);
    assert.deepEqual(back.warnings, [], 'null columns are treated as missing, not malformed');
    const { source: s1, ...rest1 } = back.activity;
    const { source: s2, ...rest2 } = original;
    assert.deepEqual(rest1, rest2);
    assert.equal(s1.url, s2.url);
    assert.equal(s1.platform, 'organizer');
  });

  test('candidates can never be published', () => {
    const candidate = makeActivity({ verification: { status: 'candidate' } });
    assert.equal(activityToRow(candidate, { published: true }).published, false);
  });

  test('batches upserts and uses merge-duplicates', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const writer = createSupabaseWriter({
      url: 'https://abc.supabase.co',
      secretKey: 'sb_secret_x',
      fetchImpl,
      batchSize: 2,
    });
    const written = await writer.upsertActivities([makeActivity(), makeActivity(), makeActivity()], false);
    assert.equal(written, 3);
    assert.equal(calls.length, 2);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    assert.equal(headers.Prefer, 'resolution=merge-duplicates,return=minimal');
    assert.equal(headers.Authorization, undefined, 'new-style secret keys are not sent as bearer tokens');
    assert.match(calls[0]!.url, /\/rest\/v1\/activities\?on_conflict=id$/);
  });
});

describe('CLI helpers', () => {
  test('parseArgs collects repeated flags and positionals', () => {
    assert.deepEqual(parseArgs(['file.csv', '--url', 'a', '--url=b', '--push', '--limit', '5']), {
      positional: ['file.csv'],
      flags: { url: ['a', 'b'], push: ['true'], limit: ['5'] },
    });
  });

  test('redact removes secrets', () => {
    assert.equal(redact('key sb_secret_abcdef here', 'sb_secret_abcdef'), 'key [redacted] here');
  });
});
