import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeActivity } from '../../src/core/normalize.ts';
import { buildPackCatalog, SF_PACK } from '../../src/data/packs/index.ts';
import { nextOccurrence, SF_RECURRING_EVENTS } from '../../src/data/packs/sfRecurring.ts';
import { createAiExtractor, EVENTS_SCHEMA, validateAiEvents } from '../../server/ingest/aiExtract.ts';
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOllamaProvider,
  pickGeminiModel,
  providerFromEnv,
  toGeminiSchema,
} from '../../server/ingest/aiProviders.ts';
import { extractEventsFromCaption } from '../../server/ingest/extractEvent.ts';
import { googleOpeningHours, parseGoogleDayHours, placesToHours } from '../../server/ingest/placeHours.ts';
import { postsToRecords, type SfSourcesConfig } from '../../server/ingest/sfPipeline.ts';

const NOW = new Date('2026-10-25T17:00:00Z'); // Sunday 10 AM in SF
const POSTED = '2026-10-24T18:00:00Z';
const read = (caption: string) => extractEventsFromCaption(caption, POSTED, NOW);

describe('reading events from captions', () => {
  test('splits a roundup into one event per line, with title, venue, time and price', () => {
    const { mode, events } = read(
      [
        'THIS WEEKEND IN SF 🎉',
        'Sat 11/1 · Día de los Muertos Night Market @ Dolores Park · 5–10pm · FREE',
        'Sun 11/2 · Vintage swap at the Mission Rec Center, 11am-3pm, $5',
        'Mon 11/3 – Comedy night 📍 The Chapel 8pm $15',
        '#sfevents',
      ].join('\n'),
    );
    assert.equal(mode, 'multi');
    assert.deepEqual(
      events.map((e) => [e.title, e.venue, e.startWall, e.endWall ?? null, e.isFree ?? e.priceMin]),
      [
        ['Día de los Muertos Night Market', 'Dolores Park', '2026-11-01 17:00', '2026-11-01 22:00', true],
        ['Vintage swap', 'the Mission Rec Center', '2026-11-02 11:00', '2026-11-02 15:00', 5],
        ['Comedy night', 'The Chapel', '2026-11-03 20:00', null, 15],
      ],
    );
  });

  test('a date heading hands its date to each line under it', () => {
    const { events } = read(
      [
        'SATURDAY 11/1',
        '🎃 Pumpkin carving in the park 2-4pm',
        '🍜 Ramen pop-up at Ferry Plaza',
        'SUNDAY 11/2',
        'Free yoga 9am',
      ].join('\n'),
    );
    assert.deepEqual(
      events.map((e) => [e.title, e.date, e.allDay]),
      [
        ['Pumpkin carving in the park', '2026-11-01', false],
        ['Ramen pop-up', '2026-11-01', true],
        ['Free yoga', '2026-11-02', false],
      ],
    );
  });

  test('keeps date-only events, runs, regulars and two-day events', () => {
    const exhibit = read('Our new exhibition is on view through Jan 4.').events;
    assert.deepEqual(
      exhibit.map((e) => [e.date, e.endDate, e.allDay]),
      [['2026-10-25', '2027-01-04', true]],
    );

    const trivia = read('Trivia every Tuesday, 7pm at Zeitgeist').events[0]!;
    assert.equal(trivia.recurring, true);
    assert.equal(trivia.startWall, '2026-10-27 19:00');
    assert.equal(trivia.venue, 'Zeitgeist');

    assert.deepEqual(
      read('Open studios Nov 8 & Nov 9. Tickets on sale Oct 30!').events.map((e) => e.date),
      ['2026-11-08', '2026-11-09'],
      'the ticket-sale date is ignored',
    );
    assert.deepEqual(
      read('Art walk Nov 7–9 in the Mission').events.map((e) => [e.date, e.endDate]),
      [['2026-11-07', '2026-11-09']],
    );
  });

  test('still refuses what isn’t an event', () => {
    assert.equal(read('Open Wednesday to Sunday, 10am–5pm').skipped, 'no_date', 'opening days are not an event');
    assert.equal(read('Thanks to everyone who came out Oct 12 🙏').skipped, 'too_old');
    assert.equal(read('25 things to do this week: Nov 3, Nov 4, Nov 5…').skipped, 'ambiguous_date');
    assert.equal(read('See you Saturday!').skipped, 'no_time', 'a bare weekday needs a time');
    assert.equal(read('Sunny days in the sun').skipped, 'no_date');
  });
});

const CONFIG: SfSourcesConfig = {
  city: 'San Francisco',
  timeZone: 'America/Los_Angeles',
  newerThan: '21 days',
  maxResultsPerRun: 150,
  sources: [{ url: 'https://www.instagram.com/funcheap', limit: 30, category: 'community', confirmed: true }],
};
const post = (shortCode: string, caption: string, extra: Record<string, unknown> = {}) => ({
  shortCode,
  url: `https://www.instagram.com/p/${shortCode}/`,
  caption,
  timestamp: POSTED,
  ownerUsername: 'funcheap',
  inputUrl: 'https://www.instagram.com/funcheap',
  ...extra,
});

describe('pipeline with several events per post', () => {
  test('one record per event, each valid in the app and geocoded by its own venue', async () => {
    const lookups: string[] = [];
    const { records, report } = await postsToRecords(
      [
        post(
          'R1',
          'Sat 11/1 · Night Market @ Dolores Park · 5–10pm\nSun 11/2 · Swap meet at the Mission Rec Center 11am',
          {
            locationName: 'San Francisco, California',
          },
        ),
        post('X1', 'Our new show is on view through Jan 4'),
      ],
      CONFIG,
      {
        now: NOW,
        geocode: async (venue) => {
          lookups.push(venue);
          return null;
        },
      },
    );
    assert.equal(report.kept, 3);
    assert.equal(report.postsWithEvents, 2);
    assert.deepEqual(lookups, ['Dolores Park', 'the Mission Rec Center'], 'the post’s own location tag is not reused');
    const activities = records.map((r) => {
      const n = normalizeActivity(r, { platform: 'json', now: NOW });
      assert.ok(n.ok);
      return n.activity;
    });
    assert.deepEqual(
      activities.map((a) => [a.title, a.source.sourceId, a.allDay ?? false]),
      [
        ['Night Market', 'R1:1', false],
        ['Swap meet', 'R1:2', false],
        ['Our new show is on view', 'X1', true],
      ],
    );
    assert.equal(new Set(activities.map((a) => a.id)).size, 3);
  });

  test('Claude’s answer is used when available, and the rules take over when it fails', async () => {
    const { records, report } = await postsToRecords(
      [post('A1', 'caption one'), post('A2', 'Pottery class Nov 4 at 6pm')],
      CONFIG,
      {
        now: NOW,
        aiExtract: async (caption) =>
          caption === 'caption one'
            ? [{ title: 'From Claude', date: '2026-11-05', allDay: true, text: caption, evidence: [] }]
            : null,
      },
    );
    assert.equal(report.fromAi, 1);
    assert.deepEqual(
      records.map((r) => r.title),
      ['From Claude', 'Pottery class'],
    );
  });
});

describe('Claude caption reader', () => {
  const caption = 'Night market this Saturday Nov 1, 5-10pm at Dolores Park. Free!';

  test('drops events whose quote is not in the caption, and invalid or past dates', () => {
    const { events, dropped } = validateAiEvents(
      {
        events: [
          {
            title: 'Night market',
            start_date: '2026-11-01',
            start_time: '17:00',
            end_time: '22:00',
            venue: 'Dolores Park',
            is_free: true,
            date_quote: 'Saturday Nov 1',
          },
          { title: 'Made up', start_date: '2026-11-02', date_quote: 'Sunday Nov 2' },
          { title: 'Bad date', start_date: '2026-02-30', date_quote: 'Nov 1' },
          { title: 'Past', start_date: '2026-10-01', date_quote: 'Nov 1' },
        ],
      },
      caption,
      '2026-10-24',
      '2026-10-25',
    );
    assert.equal(dropped, 3);
    assert.deepEqual(
      events.map((e) => [e.title, e.startWall, e.endWall, e.isFree]),
      [['Night market', '2026-11-01 17:00', '2026-11-01 22:00', true]],
    );
  });

  test('calls the API once per caption, caches the answer and keeps the key out of errors', async () => {
    const calls: { headers: Record<string, string>; body: { tool_choice: unknown } }[] = [];
    const answer = { events: [{ title: 'Night market', start_date: '2026-11-01', date_quote: 'Nov 1' }] };
    const ai = createAiExtractor({
      provider: createAnthropicProvider({
        apiKey: 'sk-ant-test-key-123',
        fetchImpl: (async (_url: string, init: RequestInit) => {
          calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
          return new Response(
            JSON.stringify({ content: [{ type: 'tool_use', name: 'record_events', input: answer }] }),
            { status: 200 },
          );
        }) as typeof fetch,
      }),
    });
    const first = await ai.extract(caption, POSTED, NOW);
    const second = await ai.extract(caption, POSTED, NOW);
    assert.equal(calls.length, 1);
    assert.equal(ai.stats.cached, 1);
    assert.equal(calls[0]!.headers['x-api-key'], 'sk-ant-test-key-123');
    assert.deepEqual(calls[0]!.body.tool_choice, { type: 'tool', name: 'record_events' });
    assert.equal(first?.[0]?.allDay, true);
    assert.deepEqual(first, second);

    const failing = createAiExtractor({
      provider: createAnthropicProvider({
        apiKey: 'sk-ant-test-key-123',
        maxRetries: 0,
        fetchImpl: (async () =>
          new Response('bad key sk-ant-test-key-123', { status: 401 })) as unknown as typeof fetch,
      }),
    });
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      assert.equal(await failing.extract(caption, POSTED, NOW), null, 'null means: use the rules');
    } finally {
      console.warn = original;
    }
    assert.ok(!warnings.join('').includes('sk-ant-test-key-123'));
  });
});

describe('opening hours from Google Maps', () => {
  test('reads Google’s day strings', () => {
    assert.deepEqual(parseGoogleDayHours('10 AM to 5 PM'), [{ open: 600, close: 1020 }]);
    assert.deepEqual(parseGoogleDayHours('9:30 AM–5 PM'), [{ open: 570, close: 1020 }]);
    assert.deepEqual(parseGoogleDayHours('11 to 2 PM, 5 to 10 PM'), [
      { open: 660, close: 840 },
      { open: 1020, close: 1320 },
    ]);
    assert.deepEqual(parseGoogleDayHours('6 PM to 2 AM'), [{ open: 1080, close: 1560 }]);
    assert.deepEqual(parseGoogleDayHours('Open 24 hours'), [{ open: 0, close: 1440 }]);
    assert.deepEqual(parseGoogleDayHours('Closed'), []);
    assert.equal(parseGoogleDayHours('Hours might differ'), null);
  });

  test('uses a result only when it is the same place', () => {
    const week = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => ({
      day,
      hours: day === 'Wednesday' ? 'Closed' : '10 AM to 5 PM',
    }));
    assert.ok(googleOpeningHours(week));
    const queries = [
      { id: 'near', query: 'Museum A, San Francisco, CA', latitude: 37.78, longitude: -122.4 },
      { id: 'far', query: 'Museum B, San Francisco, CA', latitude: 37.78, longitude: -122.4 },
      { id: 'shut', query: 'Museum C, San Francisco, CA', latitude: 37.78, longitude: -122.4 },
    ];
    const { hours, report } = placesToHours(
      [
        { searchString: queries[0]!.query, location: { lat: 37.7801, lng: -122.4001 }, openingHours: week },
        { searchString: queries[1]!.query, location: { lat: 37.9, lng: -122.3 }, openingHours: week },
        { searchString: queries[2]!.query, location: { lat: 37.78, lng: -122.4 }, temporarilyClosed: true },
      ],
      queries,
      'Oct 25, 2026',
    );
    assert.equal(hours.near?.hours, 'Mo-Tu 10:00-17:00; We off; Th-Su 10:00-17:00');
    assert.equal(hours.shut?.hours, 'Mo-Su off');
    assert.deepEqual(report.tooFar, ['far']);
  });
});

describe('SF pack hours and weekly events', () => {
  test('weekly events roll forward to their next date', () => {
    const market = SF_RECURRING_EVENTS.find((e) => e.id === 'sf-ferry-plaza-farmers-market')!;
    assert.equal(nextOccurrence(market, NOW).start_at, '2026-10-27 10:00', 'Sunday → next Tuesday');
    assert.equal(
      nextOccurrence(market, new Date('2026-10-27T18:00:00Z')).start_at,
      '2026-10-27 10:00',
      'still on at 11 AM',
    );
    assert.equal(nextOccurrence(market, new Date('2026-10-27T21:00:00Z')).start_at, '2026-10-29 10:00', 'over by 2 PM');
  });

  test('the bundled catalog has hours for the museums and weekly events', () => {
    const catalog = buildPackCatalog(SF_PACK, NOW);
    const sfmoma = catalog.find((a) => a.id === 'sf-sfmoma');
    assert.match(sfmoma?.openingHours ?? '', /^Mo-Tu 10:00-17:00/);
    assert.match(sfmoma?.openingHoursSource ?? '', /checked Oct 25, 2026/);
    assert.ok(catalog.some((a) => a.id.startsWith('sf-ferry-plaza-farmers-market-2026-10-27')));
  });
});

describe('Apify long-running actor', async () => {
  const { runApifyActorAsync } = await import('../../server/ingest/instagram.ts');
  test('starts a run, waits for it and reads the dataset', async () => {
    const urls: string[] = [];
    const replies = [
      { data: { id: 'run1', status: 'RUNNING', defaultDatasetId: 'ds1' } },
      { data: { id: 'run1', status: 'RUNNING', defaultDatasetId: 'ds1' } },
      { data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } },
      [{ title: 'SFMOMA' }],
    ];
    const items = await runApifyActorAsync({
      token: 'apify_api_secret123',
      actorId: 'compass~crawler-google-places',
      input: { searchStringsArray: ['SFMOMA'] },
      fetchImpl: (async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(replies.shift()), { status: 200 });
      }) as typeof fetch,
    });
    assert.deepEqual(items, [{ title: 'SFMOMA' }]);
    assert.match(urls[0]!, /\/acts\/compass~crawler-google-places\/runs$/);
    assert.match(urls[1]!, /\/actor-runs\/run1\?waitForFinish=60$/);
    assert.match(urls.at(-1)!, /\/datasets\/ds1\/items/);
  });

  test('reports failed runs and bad tokens without leaking the token', async () => {
    await assert.rejects(
      runApifyActorAsync({
        token: 'apify_api_secret123',
        actorId: 'x',
        input: {},
        fetchImpl: (async () =>
          new Response('token apify_api_secret123 invalid', { status: 401 })) as unknown as typeof fetch,
      }),
      (e: Error) => /Check APIFY_API_TOKEN/.test(e.message) && !e.message.includes('apify_api_secret123'),
    );
    const replies = [{ data: { id: 'r', status: 'RUNNING' } }, { data: { id: 'r', status: 'FAILED' } }];
    await assert.rejects(
      runApifyActorAsync({
        token: 't0ken123',
        actorId: 'x',
        input: {},
        fetchImpl: (async () =>
          new Response(JSON.stringify(replies.shift()), { status: 200 })) as unknown as typeof fetch,
      }),
      /status FAILED/,
    );
  });
});

describe('finding better accounts', async () => {
  const { scoreCandidates, adoptSources, verdictFor } = await import('../../server/ingest/probe.ts');
  const probeConfig: SfSourcesConfig = { ...CONFIG, sources: [] };
  const from = (owner: string, shortCode: string, caption: string) => ({
    ...post(shortCode, caption),
    ownerUsername: owner,
    inputUrl: `https://www.instagram.com/${owner}`,
  });

  test('ranks accounts by the events their posts contain', async () => {
    const results = await scoreCandidates(
      [
        from('venue', 'V1', 'Sat 11/7 · Band night @ The Venue · 8pm $20'),
        from('venue', 'V2', 'Fri 11/6 · DJ night @ The Venue · 9pm'),
        from('brand', 'B1', 'New merch drop! Link in bio'),
        { error: 'not_found', url: 'https://www.instagram.com/typo/' },
      ],
      [
        { url: 'https://www.instagram.com/brand/', category: 'other' },
        { url: 'https://www.instagram.com/typo/', category: 'other' },
        { url: 'https://www.instagram.com/venue/', category: 'music' },
      ],
      probeConfig,
      { now: NOW },
    );
    assert.deepEqual(
      results.map((r) => [r.url.split('/')[3], r.verdict, r.events, r.posts]),
      [
        ['venue', 'good', 2, 2],
        ['brand', 'no_events', 0, 1],
        ['typo', 'no_posts', 0, 0],
      ],
    );
    assert.deepEqual(results[0]!.examples, ['Band night', 'DJ night']);
    assert.equal(verdictFor(10, 1), 'some');

    const { config, added } = adoptSources(CONFIG, results);
    assert.deepEqual(added, ['https://www.instagram.com/venue/']);
    assert.equal(config.sources.at(-1)?.limit, 15);
    assert.equal(adoptSources(config, results).added.length, 0, 'never added twice');
  });

  test('flyer images go to the model, and an image-only date is accepted only when an image was sent', async () => {
    const answer = {
      events: [
        { title: 'Flyer show', start_date: '2026-11-07', start_time: '20:00', date_quote: 'NOV 7', seen_in: 'image' },
      ],
    };
    const bodies: { contents: { parts: Record<string, unknown>[] }[] }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://cdn.example/ok.jpg')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      if (url.startsWith('https://cdn.example/')) return new Response('gone', { status: 403 });
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;
    const ai = createAiExtractor({
      provider: createGeminiProvider({ apiKey: 'AIza-test', model: 'gemini-test-flash-lite', fetchImpl }),
      fetchImpl,
      sleep: async () => {},
    });
    const withImage = await ai.extract('Link in bio!', POSTED, NOW, { imageUrl: 'https://cdn.example/ok.jpg' });
    assert.equal(withImage?.[0]?.title, 'Flyer show');
    assert.equal(withImage?.[0]?.startWall, '2026-11-07 20:00');
    assert.match(withImage?.[0]?.evidence[0] ?? '', /^on the post image/);
    assert.deepEqual(bodies[0]!.contents[0]!.parts[0], { inline_data: { mime_type: 'image/jpeg', data: 'AQID' } });
    assert.equal(ai.stats.images, 1);

    // Expired link: caption only, so the unverifiable image quote is dropped.
    const expired = await ai.extract('Another caption', POSTED, NOW, { imageUrl: 'https://cdn.example/old.jpg' });
    assert.deepEqual(expired, []);
    assert.ok('text' in bodies[1]!.contents[0]!.parts[0]!);
  });

  test('the pipeline passes the post image only with readImages', async () => {
    const seen: (string | undefined)[] = [];
    const aiExtract = async (_c: string, _p: string, _n: Date, extra?: { imageUrl?: string }) => {
      seen.push(extra?.imageUrl);
      return [];
    };
    const item = { ...post('I1', 'flyer'), displayUrl: 'https://cdn.example/a.jpg' };
    await postsToRecords([item], CONFIG, { now: NOW, aiExtract });
    await postsToRecords([item], CONFIG, { now: NOW, aiExtract, readImages: true });
    assert.deepEqual(seen, [undefined, 'https://cdn.example/a.jpg']);
  });
});

describe('free AI services', () => {
  const geminiAnswer = (events: unknown[]) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ events }) }] } }] }), {
      status: 200,
    });

  test('Gemini gets a schema it understands, and picks a free Flash-Lite model by itself', async () => {
    const schema = toGeminiSchema(EVENTS_SCHEMA) as {
      type: string;
      properties: { events: { items: { properties: Record<string, { type: string; nullable?: boolean }> } } };
    };
    assert.equal(schema.type, 'OBJECT');
    assert.deepEqual(schema.properties.events.items.properties.venue, {
      type: 'STRING',
      nullable: true,
      description: 'Venue or place name as written, or null.',
    });
    assert.equal(
      pickGeminiModel([
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.6-flash-lite-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding', supportedGenerationMethods: ['embedContent'] },
      ]),
      'gemini-3.5-flash-lite',
    );
    const provider = createGeminiProvider({
      apiKey: 'AIza-test',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            models: [{ name: 'models/gemini-9.0-flash', supportedGenerationMethods: ['generateContent'] }],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    await provider.prepare();
    assert.equal(provider.model, 'gemini-9.0-flash');
  });

  test('when the free daily quota runs out, the run carries on with the rules and keeps what it has', async () => {
    let calls = 0;
    const ai = createAiExtractor({
      sleep: async () => {},
      provider: createGeminiProvider({
        apiKey: 'AIza-test',
        model: 'gemini-test',
        sleep: async () => {},
        fetchImpl: (async () => {
          calls++;
          if (calls === 1) return geminiAnswer([{ title: 'Show', start_date: '2026-11-07', date_quote: 'Nov 7' }]);
          return new Response(
            '{"error":{"status":"RESOURCE_EXHAUSTED","message":"GenerateRequestsPerDayPerProject"}}',
            {
              status: 429,
            },
          );
        }) as unknown as typeof fetch,
      }),
    });
    const original = console.warn;
    console.warn = () => {};
    try {
      assert.equal((await ai.extract('Show Nov 7', POSTED, NOW))?.length, 1);
      assert.equal(await ai.extract('Other Nov 8', POSTED, NOW), null);
      assert.equal(await ai.extract('Third Nov 9', POSTED, NOW), null);
    } finally {
      console.warn = original;
    }
    assert.equal(ai.stats.quotaHit, true);
    assert.equal(calls, 2, 'no more requests once the daily quota is gone');
    assert.equal((await ai.extract('Show Nov 7', POSTED, NOW))?.length, 1, 'cached answers still work');
  });

  test('a per-minute limit waits as told and retries', async () => {
    const waits: number[] = [];
    let calls = 0;
    const provider = createGeminiProvider({
      apiKey: 'AIza-test',
      model: 'gemini-test',
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetchImpl: (async () =>
        ++calls === 1
          ? new Response('{"error":{"details":[{"retryDelay": "7s"}]}}', { status: 429 })
          : geminiAnswer([])) as unknown as typeof fetch,
    });
    assert.deepEqual(await provider.ask({ system: 's', text: 't', image: null, schema: EVENTS_SCHEMA }), {
      events: [],
    });
    assert.deepEqual(waits, [7500]);
  });

  test('Ollama runs locally with the JSON schema and the image', async () => {
    const bodies: Record<string, unknown>[] = [];
    const provider = createOllamaProvider({
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'gemma3:4b' }] }));
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ message: { content: '{"events": []}' } }));
      }) as typeof fetch,
    });
    await provider.prepare();
    await provider.ask({
      system: 's',
      text: 't',
      image: { media_type: 'image/png', data: 'AAA' },
      schema: EVENTS_SCHEMA,
    });
    assert.equal(bodies[0]!.model, 'gemma3:4b');
    assert.deepEqual(bodies[0]!.format, EVENTS_SCHEMA);
    assert.deepEqual((bodies[0]!.messages as { images?: string[] }[])[1]!.images, ['AAA']);

    const missing = createOllamaProvider({
      model: 'qwen2.5vl:7b',
      fetchImpl: (async () => new Response(JSON.stringify({ models: [] }))) as unknown as typeof fetch,
    });
    await assert.rejects(missing.prepare(), /ollama pull qwen2\.5vl:7b/);
  });

  test('picks the free option by default and explains what to set', () => {
    assert.equal(providerFromEnv({ geminiApiKey: 'k', anthropicApiKey: 'a' }).name, 'gemini');
    assert.equal(providerFromEnv({ ollamaModel: 'gemma3:4b' }).name, 'ollama');
    assert.equal(providerFromEnv({ anthropicApiKey: 'a' }).name, 'anthropic');
    assert.equal(
      providerFromEnv({ aiProvider: 'anthropic', anthropicApiKey: 'a', geminiApiKey: 'k' }).name,
      'anthropic',
    );
    assert.throws(() => providerFromEnv({}), /GEMINI_API_KEY/);
  });
});
