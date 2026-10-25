/**
 * Date/time parsing and formatting that respects an activity's own time zone.
 *
 * Imported data often contains wall-clock times ("2026-11-07 18:30") without an
 * offset. Guessing the offset would silently shift events by hours, so a
 * wall-clock time is only accepted together with a valid IANA time zone.
 */
import { DAY_MS } from './util.ts';

export function isValidTimeZone(timeZone: string | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInZone(utcMs: number, timeZone: string): WallParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = partsInZone(utcMs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

/** Converts a wall-clock time in `timeZone` to a UTC instant (handles DST transitions). */
export function wallTimeToUtcMs(parts: WallParts, timeZone: string): number {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const firstOffset = zoneOffsetMs(guess, timeZone);
  const candidate = guess - firstOffset;
  const secondOffset = zoneOffsetMs(candidate, timeZone);
  return secondOffset === firstOffset ? candidate : guess - secondOffset;
}

const HAS_OFFSET = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

export type DateTimeParse = { ok: true; iso: string } | { ok: false; error: string };

/**
 * Parses an imported date-time.
 * - ISO 8601 with offset or Z: accepted as-is.
 * - "YYYY-MM-DD HH:MM" without offset: accepted only when `timeZone` is valid.
 * - Anything else (including date-only values): rejected with an explanation.
 */
export function parseImportedDateTime(value: unknown, timeZone?: string): DateTimeParse {
  if (value === undefined || value === null || value === '') return { ok: false, error: 'missing' };
  if (typeof value !== 'string') return { ok: false, error: 'not a string' };
  const trimmed = value.trim();

  if (HAS_OFFSET.test(trimmed) && /^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? { ok: true, iso: new Date(ms).toISOString() } : { ok: false, error: 'invalid date' };
  }

  const wall = trimmed.match(WALL_TIME);
  if (wall) {
    if (!isValidTimeZone(timeZone)) {
      return { ok: false, error: 'local time without offset needs a valid time_zone' };
    }
    const [, y, mo, d, h, mi, s] = wall;
    const parts: WallParts = {
      year: Number(y),
      month: Number(mo),
      day: Number(d),
      hour: Number(h),
      minute: Number(mi),
      second: Number(s ?? '0'),
    };
    if (
      parts.month < 1 ||
      parts.month > 12 ||
      parts.day < 1 ||
      parts.day > 31 ||
      parts.hour > 23 ||
      parts.minute > 59
    ) {
      return { ok: false, error: 'invalid date' };
    }
    try {
      return { ok: true, iso: new Date(wallTimeToUtcMs(parts, timeZone)).toISOString() };
    } catch {
      // Some JS engines have partial Intl support; refuse rather than guess an offset.
      return { ok: false, error: 'could not convert local time on this device; use an ISO time with offset' };
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false, error: 'date without a time' };
  return { ok: false, error: 'unrecognised date format (use ISO 8601)' };
}

function dayKey(utcMs: number, timeZone: string | undefined): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : undefined;
  try {
    if (tz) {
      const p = partsInZone(utcMs, tz);
      return `${p.year}-${p.month}-${p.day}`;
    }
  } catch {
    // Fall through to device-local calendar.
  }
  const d = new Date(utcMs);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Human label for an event time in the event's own zone:
 * "Today · 6:30 PM", "Tomorrow · 10:00 AM", "Sat, Nov 8 · 6:30 PM".
 */
export function formatEventWhen(startIso: string, timeZone: string | undefined, now: Date, locale?: string): string {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return 'Date unknown';
  const tz = isValidTimeZone(timeZone) ? timeZone : undefined;
  let time: string;
  let date: string;
  try {
    time = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(start);
    date = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(
      start,
    );
  } catch {
    const d = new Date(start);
    time = d.toLocaleTimeString();
    date = d.toLocaleDateString();
  }
  const startKey = dayKey(start, tz);
  if (startKey === dayKey(now.getTime(), tz)) return `Today · ${time}`;
  if (startKey === dayKey(now.getTime() + DAY_MS, tz)) return `Tomorrow · ${time}`;
  return `${date} · ${time}`;
}

/**
 * When-label for any event, including all-day ones whose source gave no time:
 * "Today · time not listed", "Sat, Nov 8 · time not listed", "On now · through Sun, Nov 2".
 */
export function formatActivityWhen(
  activity: { startAt?: string; endAt?: string; allDay?: boolean; timeZone?: string },
  now: Date,
  locale?: string,
): string {
  if (!activity.startAt) return 'Date unknown';
  if (!activity.allDay) return formatEventWhen(activity.startAt, activity.timeZone, now, locale);
  const start = Date.parse(activity.startAt);
  const end = Date.parse(activity.endAt ?? '');
  if (!Number.isFinite(start)) return 'Date unknown';
  const tz = isValidTimeZone(activity.timeZone) ? activity.timeZone : undefined;
  const dateLabel = (ms: number) => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(
        ms,
      );
    } catch {
      return new Date(ms).toLocaleDateString();
    }
  };
  const relative = (ms: number) => {
    const key = dayKey(ms, tz);
    if (key === dayKey(now.getTime(), tz)) return 'Today';
    if (key === dayKey(now.getTime() + DAY_MS, tz)) return 'Tomorrow';
    return dateLabel(ms);
  };
  const multiDay = Number.isFinite(end) && dayKey(end, tz) !== dayKey(start, tz);
  if (!multiDay) return `${relative(start)} · time not listed`;
  if (start <= now.getTime()) return `On now · through ${dateLabel(end)}`;
  return `${relative(start)} – ${dateLabel(end)}`;
}

/** "Checked 3 days ago", "Checked today". */
export function formatCheckedAgo(iso: string | undefined, now: Date): string | undefined {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return undefined;
  const days = Math.floor((now.getTime() - ms) / DAY_MS);
  if (days <= 0) return 'Checked today';
  if (days === 1) return 'Checked yesterday';
  if (days < 60) return `Checked ${days} days ago`;
  return `Checked ${Math.round(days / 30)} months ago`;
}

/** Local hour (0–23) of an instant in the given zone; used for time-of-day learning. */
export function hourInZone(utcMs: number, timeZone: string | undefined): number {
  try {
    if (isValidTimeZone(timeZone)) return partsInZone(utcMs, timeZone).hour;
  } catch {
    // ignore and use device-local time
  }
  return new Date(utcMs).getHours();
}

export type DayPart = 'morning' | 'afternoon' | 'evening';
export function dayPart(hour: number): DayPart {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
