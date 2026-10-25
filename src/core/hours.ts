/**
 * Weekly opening hours: parsing, "open now?" checks and display.
 *
 * Hours are stored in a small subset of OpenStreetMap's `opening_hours`
 * syntax, because it is compact, well documented and what OSM and many other
 * sources already use:
 *
 *   "Mo-Fr 10:00-17:00; Th 12:00-20:00; We off"
 *   "Mo-Su 05:00-24:00"
 *   "24/7"
 *
 * Supported: day names Mo..Su, day ranges and comma lists, one or more
 * HH:MM-HH:MM ranges per rule (closing after midnight is allowed), "off" or
 * "closed", and "24/7". Later rules override earlier ones for the days they
 * name, as in OSM. Anything else (sunrise, months, holidays, comments) makes
 * the text unparseable, and the app falls back to showing it as plain text
 * without claiming to know whether the place is open.
 */
import { isValidTimeZone } from './time.ts';

/** Minutes after local midnight; `close` may exceed 1440 when a range runs past midnight. */
export interface OpenInterval {
  open: number;
  close: number;
}

/** Index 0 = Sunday … 6 = Saturday, matching Date#getDay. */
export type WeeklyHours = OpenInterval[][];

const DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const DAY_INDEX: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseClock(text: string): number | null {
  const m = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 24 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

function parseDays(spec: string): number[] | null {
  const days = new Set<number>();
  for (const part of spec.split(',')) {
    const range = part
      .trim()
      .toLowerCase()
      .match(/^([a-z]{2})(?:\s*-\s*([a-z]{2}))?$/);
    if (!range) return null;
    const from = DAY_INDEX[range[1]!];
    const to = range[2] ? DAY_INDEX[range[2]] : from;
    if (from === undefined || to === undefined) return null;
    // OSM weeks run Monday to Sunday, so "Fr-Mo" wraps over the weekend.
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  return [...days];
}

function parseRanges(spec: string): OpenInterval[] | null {
  const intervals: OpenInterval[] = [];
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!m) return null;
    const open = parseClock(m[1]!);
    let close = parseClock(m[2]!);
    if (open === null || close === null || open >= 1440) return null;
    if (close <= open) close += 1440; // runs past midnight
    intervals.push({ open, close });
  }
  return intervals.sort((a, b) => a.open - b.open);
}

/** Parses the supported subset; returns null for anything it can't read with confidence. */
export function parseOpeningHours(text: string | undefined): WeeklyHours | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const week: WeeklyHours = [[], [], [], [], [], [], []];
  if (/^24\/7$/.test(trimmed)) return week.map(() => [{ open: 0, close: 1440 }]);

  let sawRule = false;
  for (const rawRule of trimmed.split(';')) {
    const rule = rawRule.trim();
    if (!rule) continue;
    const m = rule.match(
      /^((?:[A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?\s*,\s*)*[A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?)?\s*(.*)$/,
    );
    if (!m) return null;
    const days = m[1] ? parseDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    const rest = (m[2] ?? '').trim().toLowerCase();
    if (!days || !rest) return null;
    let intervals: OpenInterval[] | null;
    if (rest === 'off' || rest === 'closed') intervals = [];
    else intervals = parseRanges(rest);
    if (!intervals) return null;
    for (const d of days) week[d] = intervals;
    sawRule = true;
  }
  return sawRule ? week : null;
}

function wallClock(nowMs: number, timeZone: string | undefined): { weekday: number; minutes: number } {
  try {
    if (isValidTimeZone(timeZone)) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(nowMs);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const weekday = DAY_SHORT.indexOf(get('weekday'));
      if (weekday >= 0) return { weekday, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
    }
  } catch {
    // fall back to device-local time
  }
  const d = new Date(nowMs);
  return { weekday: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
}

/** "10 AM", "5:30 PM", "noon", "midnight". */
export function formatClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m === 0) return 'midnight';
  if (m === 720) return 'noon';
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

const isAllDay = (intervals: OpenInterval[]) =>
  intervals.length === 1 && intervals[0]!.open === 0 && intervals[0]!.close >= 1440;

export type OpenState = 'open' | 'opens_later' | 'closed_today' | 'always_closed';

export interface OpenStatus {
  state: OpenState;
  /** Minutes until closing, when open. */
  minutesLeft?: number;
  /** "Open now · until 5 PM", "Opens at 10 AM", "Closed now · opens Tue 10 AM". */
  label: string;
}

export function openStatus(hours: WeeklyHours, now: Date, timeZone: string | undefined): OpenStatus {
  const { weekday, minutes } = wallClock(now.getTime(), timeZone);
  const today = hours[weekday] ?? [];
  const yesterday = hours[(weekday + 6) % 7] ?? [];

  // A range from yesterday that runs past midnight.
  for (const iv of yesterday) {
    if (iv.close > 1440 && minutes < iv.close - 1440) {
      return {
        state: 'open',
        minutesLeft: iv.close - 1440 - minutes,
        label: `Open now · until ${formatClock(iv.close)}`,
      };
    }
  }
  for (const iv of today) {
    if (minutes >= iv.open && minutes < iv.close) {
      const allDay = isAllDay(today) && isAllDay(hours[(weekday + 1) % 7] ?? []);
      return {
        state: 'open',
        minutesLeft: allDay ? 24 * 60 : iv.close - minutes,
        label: allDay ? 'Open any time' : `Open now · until ${formatClock(iv.close)}`,
      };
    }
  }
  const later = today.find((iv) => iv.open > minutes);
  if (later) return { state: 'opens_later', label: `Opens at ${formatClock(later.open)}` };

  for (let offset = 1; offset <= 7; offset++) {
    const day = (weekday + offset) % 7;
    const first = hours[day]?.[0];
    if (first) {
      const when = offset === 1 ? 'tomorrow' : DAY_SHORT[day];
      return { state: 'closed_today', label: `Closed now · opens ${when} ${formatClock(first.open)}` };
    }
  }
  return { state: 'always_closed', label: 'Closed' };
}

function describeDay(intervals: OpenInterval[]): string {
  if (intervals.length === 0) return 'closed';
  if (isAllDay(intervals)) return 'open 24 hours';
  return intervals.map((iv) => `${formatClock(iv.open)}–${formatClock(iv.close)}`).join(', ');
}

/** "Mon–Tue 10 AM–5 PM · Wed closed · Thu noon–8 PM · Fri–Sun 10 AM–5 PM". */
export function formatWeeklyHours(hours: WeeklyHours): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const descriptions = order.map((d) => describeDay(hours[d] ?? []));
  if (descriptions.every((t) => t === descriptions[0])) {
    return descriptions[0] === 'open 24 hours' ? 'Open 24 hours, every day' : `Daily ${descriptions[0]}`;
  }
  const groups: { from: number; to: number; text: string }[] = [];
  order.forEach((day, i) => {
    const text = descriptions[i]!;
    const last = groups.at(-1);
    if (last && last.text === text) last.to = day;
    else groups.push({ from: day, to: day, text });
  });
  return groups.map((g) => `${DAY_SHORT[g.from]}${g.from === g.to ? '' : `–${DAY_SHORT[g.to]}`} ${g.text}`).join(' · ');
}

/** Renders a WeeklyHours back into the OSM subset (used by the ingestion scripts). */
export function toOpeningHoursText(hours: WeeklyHours): string {
  if (hours.every((d) => isAllDay(d))) return '24/7';
  const order = [1, 2, 3, 4, 5, 6, 0];
  const spec = (d: number) => {
    const ivs = hours[d] ?? [];
    if (ivs.length === 0) return 'off';
    const clock = (m: number) =>
      `${String(Math.floor(m / 60) % 25).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return ivs.map((iv) => `${clock(iv.open)}-${clock(iv.close > 1440 ? iv.close - 1440 : iv.close)}`).join(',');
  };
  const groups: { from: number; to: number; text: string }[] = [];
  for (const day of order) {
    const text = spec(day);
    const last = groups.at(-1);
    if (last && last.text === text) last.to = day;
    else groups.push({ from: day, to: day, text });
  }
  return groups.map((g) => `${DAY_CODES[g.from]}${g.from === g.to ? '' : `-${DAY_CODES[g.to]}`} ${g.text}`).join('; ');
}

const cache = new Map<string, WeeklyHours | null>();
/** Memoized parse, since the same few strings are checked on every recommendation. */
export function parsedHours(text: string | undefined): WeeklyHours | null {
  if (!text) return null;
  if (!cache.has(text)) {
    if (cache.size > 500) cache.clear();
    cache.set(text, parseOpeningHours(text));
  }
  return cache.get(text) ?? null;
}

/** What a card should say about an evergreen place's hours right now. */
export function describeOpening(
  openingHours: string | undefined,
  now: Date,
  timeZone: string | undefined,
): { text: string; structured: boolean } | undefined {
  if (!openingHours) return undefined;
  const hours = parsedHours(openingHours);
  if (!hours) return { text: openingHours, structured: false };
  return { text: openStatus(hours, now, timeZone).label, structured: true };
}
