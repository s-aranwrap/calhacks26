/**
 * Weekly San Francisco events that the starter pack can always offer, even
 * before any Instagram run. Each one is expanded into its next upcoming date
 * whenever the catalog loads, so it never goes stale.
 *
 * Researched on Oct 25, 2026. Times come from the sources named; prices are
 * left unknown because they change. Records are "unverified" like the rest of
 * the pack.
 */
import type { RawActivityRecord } from '../../core/normalize.ts';

export interface RecurringEvent {
  id: string;
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[];
  /** Local "HH:MM". */
  start: string;
  end: string;
  record: RawActivityRecord;
}

const base = {
  kind: 'event',
  currency: 'USD',
  source_platform: 'manual',
  verification_status: 'unverified',
  price_certainty: 'estimated',
  time_zone: 'America/Los_Angeles',
} as const;

export const SF_RECURRING_EVENTS: RecurringEvent[] = [
  {
    id: 'sf-ferry-plaza-farmers-market',
    weekdays: [2, 4, 6],
    start: '10:00',
    end: '14:00',
    record: {
      ...base,
      title: 'Ferry Plaza Farmers Market',
      description:
        'Farmers, bakers and food stalls set up around the Ferry Building. Saturdays are the biggest, and start at 8 AM.',
      category: 'food',
      moods: 'social|chill|active',
      tags: 'market|food|outdoors',
      venue_name: 'Ferry Building',
      area: 'Embarcadero',
      latitude: 37.7955,
      longitude: -122.3937,
      is_free: true,
      price_note: 'Free to browse; food is extra',
      source_url: 'https://www.ferrybuildingmarketplace.com/farmers-market/',
      source_label: 'ferrybuildingmarketplace.com',
      why_try: 'Go hungry, try a few samples, and eat on the waterfront.',
    },
  },
  {
    id: 'sf-exploratorium-after-dark',
    weekdays: [4],
    start: '18:00',
    end: '22:00',
    record: {
      ...base,
      title: 'Exploratorium After Dark (18+)',
      description: 'The Exploratorium’s adults-only Thursday night, with the exhibits open and drinks available.',
      category: 'learning',
      moods: 'social|creative',
      tags: 'nightlife|science|18+',
      venue_name: 'Exploratorium, Pier 15',
      area: 'Embarcadero',
      latitude: 37.8017,
      longitude: -122.3973,
      restrictions: 'Ages 18 and up',
      source_url: 'https://www.exploratorium.edu/',
      source_label: 'Hours via thebettervacation.com (Jun 2026)',
    },
  },
  {
    id: 'sf-cal-academy-nightlife',
    weekdays: [4],
    start: '18:00',
    end: '22:00',
    record: {
      ...base,
      title: 'NightLife at the California Academy of Sciences (18+)',
      description: 'An adults-only Thursday night at the museum, with music, drinks and the exhibits open late.',
      category: 'learning',
      moods: 'social|creative',
      tags: 'nightlife|science|18+|music',
      venue_name: 'California Academy of Sciences',
      area: 'Golden Gate Park',
      latitude: 37.7699,
      longitude: -122.4661,
      restrictions: 'Adults only (18+ per the source); check the ticket page for ID rules',
      source_url: 'https://www.calacademy.org/',
      source_label: 'Hours via thebettervacation.com (Jun 2026)',
    },
  },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date and weekday in a zone. */
function localDate(
  ms: number,
  timeZone: string,
): { y: number; m: number; d: number; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

/** The next occurrence that hasn't ended yet, as a record with wall-clock start/end. */
export function nextOccurrence(event: RecurringEvent, now: Date, timeZone = 'America/Los_Angeles'): RawActivityRecord {
  const today = localDate(now.getTime(), timeZone);
  const [eh, em] = event.end.split(':').map(Number);
  const endMinutes = (eh ?? 0) * 60 + (em ?? 0);
  let offset = 0;
  for (; offset < 8; offset++) {
    const weekday = (today.weekday + offset) % 7;
    if (!event.weekdays.includes(weekday)) continue;
    if (offset === 0 && today.minutes >= endMinutes - 30) continue;
    break;
  }
  const date = new Date(Date.UTC(today.y, today.m - 1, today.d + offset));
  const ymd = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return {
    ...event.record,
    id: `${event.id}-${ymd}`,
    start_at: `${ymd} ${event.start}`,
    end_at: `${ymd} ${event.end}`,
  };
}
