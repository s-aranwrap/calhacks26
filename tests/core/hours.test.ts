import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { assessAvailability } from '../../src/core/availability.ts';
import {
  describeOpening,
  formatWeeklyHours,
  openStatus,
  parseOpeningHours,
  toOpeningHoursText,
} from '../../src/core/hours.ts';
import { normalizeActivity } from '../../src/core/normalize.ts';
import { formatActivityWhen } from '../../src/core/time.ts';

const SF = 'America/Los_Angeles';
// Wednesday Oct 28, 2026, at the given Pacific time (PDT, UTC-7).
const wed = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00-07:00`);

describe('opening hours', () => {
  const sfmoma = parseOpeningHours('Mo-Tu 10:00-17:00; We off; Th 12:00-20:00; Fr-Su 10:00-17:00')!;

  test('parses the OSM subset, with later rules overriding earlier ones', () => {
    assert.ok(sfmoma);
    assert.deepEqual(sfmoma[3], [], 'Wednesday off');
    assert.deepEqual(sfmoma[4], [{ open: 720, close: 1200 }]);
    const override = parseOpeningHours('Mo-Su 09:00-17:00; Su off')!;
    assert.deepEqual(override[0], []);
    assert.deepEqual(override[6], [{ open: 540, close: 1020 }]);
    assert.equal(parseOpeningHours('24/7')![2]![0]!.close, 1440);
    assert.equal(parseOpeningHours('Fr-Mo 10:00-12:00')![0]!.length, 1, 'ranges wrap over the weekend');
  });

  test('refuses anything it cannot read rather than guessing', () => {
    for (const text of ['sunrise-sunset', 'Daily, sunrise to sunset', 'Mo-Fr 10-5', 'Xx 10:00-12:00', '']) {
      assert.equal(parseOpeningHours(text), null, text);
    }
  });

  test('says whether a place is open, opens later, or is closed today', () => {
    const library = parseOpeningHours(
      'Mo 09:00-18:00; Tu-Th 09:00-20:00; Fr 12:00-18:00; Sa 10:00-18:00; Su 12:00-18:00',
    )!;
    assert.deepEqual(openStatus(library, wed('10:00'), SF), {
      state: 'open',
      minutesLeft: 600,
      label: 'Open now · until 8 PM',
    });
    assert.equal(openStatus(library, wed('07:30'), SF).label, 'Opens at 9 AM');
    assert.equal(openStatus(library, wed('21:00'), SF).label, 'Closed now · opens tomorrow 9 AM');
    assert.equal(openStatus(sfmoma, wed('11:00'), SF).label, 'Closed now · opens tomorrow noon');
    assert.equal(openStatus(parseOpeningHours('Mo-Su off')!, wed('11:00'), SF).state, 'always_closed');
  });

  test('handles ranges past midnight', () => {
    const bar = parseOpeningHours('Tu-Sa 18:00-02:00')!;
    assert.equal(openStatus(bar, new Date('2026-10-29T01:00:00-07:00'), SF).label, 'Open now · until 2 AM');
    assert.equal(
      openStatus(parseOpeningHours('Mo-Su 05:00-24:00')!, wed('23:00'), SF).label,
      'Open now · until midnight',
    );
  });

  test('formats and round-trips', () => {
    assert.equal(formatWeeklyHours(sfmoma), 'Mon–Tue 10 AM–5 PM · Wed closed · Thu noon–8 PM · Fri–Sun 10 AM–5 PM');
    assert.equal(formatWeeklyHours(parseOpeningHours('24/7')!), 'Open 24 hours, every day');
    assert.equal(toOpeningHoursText(sfmoma), 'Mo-Tu 10:00-17:00; We off; Th 12:00-20:00; Fr-Su 10:00-17:00');
    assert.deepEqual(parseOpeningHours(toOpeningHoursText(sfmoma)), sfmoma);
  });

  test('plain-text hours are shown but never used to decide open or closed', () => {
    assert.deepEqual(describeOpening('Daily, sunrise to sunset', wed('23:00'), SF), {
      text: 'Daily, sunrise to sunset',
      structured: false,
    });
  });

  test('a place closed for the rest of today is not offered; one opening later is', () => {
    const place = (hours: string) => {
      const r = normalizeActivity(
        { title: 'Museum', kind: 'evergreen', opening_hours: hours, time_zone: SF, verification_status: 'unverified' },
        { platform: 'json', now: wed('12:00') },
      );
      assert.ok(r.ok);
      return r.activity;
    };
    const closed = assessAvailability(place('Mo-Tu 10:00-17:00; We off; Th-Su 10:00-17:00'), wed('12:00'));
    assert.equal(closed.viable, false);
    assert.equal(closed.state, 'closed_now');
    const later = assessAvailability(place('Mo-Su 14:00-17:00'), wed('12:00'));
    assert.equal(later.viable, true);
    assert.match(later.label, /^Opens at 2 PM\. Hours not verified/);
    const closingSoon = assessAvailability(place('Mo-Su 09:00-12:30'), wed('12:00'));
    assert.equal(closingSoon.viable, false);
    assert.equal(closingSoon.label, 'Closes at 12:30 PM, too soon to go today');
  });
});

describe('all-day events', () => {
  const now = wed('09:00');
  const event = (raw: Record<string, unknown>) => {
    const r = normalizeActivity(
      { title: 'Open studios', time_zone: SF, all_day: true, verification_status: 'unverified', ...raw },
      { platform: 'json', now },
    );
    assert.ok(r.ok);
    return r.activity;
  };

  test('accept bare dates and cover the whole local day', () => {
    const a = event({ start_at: '2026-11-07' });
    assert.equal(a.kind, 'event');
    assert.equal(a.allDay, true);
    assert.equal(a.startAt, '2026-11-07T08:00:00.000Z', 'midnight PST');
    assert.equal(a.endAt, '2026-11-08T07:59:00.000Z');
    assert.equal(formatActivityWhen(a, now, 'en-US'), 'Sat, Nov 7 · time not listed');
  });

  test('multi-day runs say how long they are on', () => {
    const a = event({ start_at: '2026-10-25', end_at: '2027-01-04' });
    assert.equal(formatActivityWhen(a, now, 'en-US'), 'On now · through Mon, Jan 4');
    assert.equal(assessAvailability(a, now).state, 'happening_now');
    const later = event({ start_at: '2026-11-07', end_at: '2026-11-09' });
    assert.equal(formatActivityWhen(later, now, 'en-US'), 'Sat, Nov 7 – Mon, Nov 9');
  });

  test('a bare date without all_day is still rejected', () => {
    const r = normalizeActivity(
      { title: 'x', kind: 'event', start_at: '2026-11-07', time_zone: SF },
      { platform: 'json', now },
    );
    assert.ok(r.ok);
    assert.equal(r.activity.startAt, undefined);
  });
});
