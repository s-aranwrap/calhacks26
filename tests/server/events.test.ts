import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeActivity } from '../../src/core/normalize.ts';
import { buildPackCatalog, SF_PACK } from '../../src/data/packs/index.ts';
import { nextOccurrence, SF_RECURRING_EVENTS } from '../../src/data/packs/sfRecurring.ts';
import { createAiExtractor, validateAiEvents } from '../../server/ingest/aiExtract.ts';
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
        ['Our new show is on view through Jan 4', 'X1', true],
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
      ['From Claude', 'Pottery class Nov 4 at 6pm'],
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
      apiKey: 'sk-ant-test-key-123',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'record_events', input: answer }] }), {
          status: 200,
        });
      }) as typeof fetch,
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
      apiKey: 'sk-ant-test-key-123',
      maxRetries: 0,
      fetchImpl: (async () => new Response('bad key sk-ant-test-key-123', { status: 401 })) as unknown as typeof fetch,
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
