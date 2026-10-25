/**
 * Discovery inputs as the user picks them: up to three penguin moods and an
 * optional "when". Both are translated here into what the recommender
 * understands, so screens never hard-code the mapping.
 */
import type { ActivityMood } from './types.ts';
import { DAY_MS } from './util.ts';

export const MOOD_PICKS = ['chill', 'creative', 'social', 'peaceful', 'adventurous', 'energetic'] as const;
export type MoodPick = (typeof MOOD_PICKS)[number];
export const MAX_MOOD_PICKS = 3;

/**
 * The catalog tags activities with four moods. Until it carries more, the six
 * penguins share them: Peaceful leans on chill, Adventurous and Energetic on
 * active.
 */
export const MOOD_PICK_MATCHES: Record<MoodPick, readonly ActivityMood[]> = {
  chill: ['chill'],
  peaceful: ['chill'],
  social: ['social'],
  creative: ['creative'],
  adventurous: ['active'],
  energetic: ['active'],
};

export function activityMoodsFor(picks: readonly MoodPick[]): ActivityMood[] {
  return [...new Set(picks.flatMap((p) => MOOD_PICK_MATCHES[p]))];
}

/** Tap behaviour: select, deselect, or refuse a fourth pick (limitReached). */
export function toggleMoodPick(
  picks: readonly MoodPick[],
  mood: MoodPick,
): { picks: MoodPick[]; limitReached: boolean } {
  if (picks.includes(mood)) return { picks: picks.filter((p) => p !== mood), limitReached: false };
  if (picks.length >= MAX_MOOD_PICKS) return { picks: [...picks], limitReached: true };
  return { picks: [...picks, mood], limitReached: false };
}

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

/** Dates are local calendar days, "YYYY-MM-DD", inclusive. */
export type WhenFilter =
  | { kind: 'anytime' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'weekend' }
  | { kind: 'dates'; start: string; end: string };

export const ANYTIME: WhenFilter = { kind: 'anytime' };

export function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dayKey(date) === key ? date : null;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The window (in the device's time zone) a "when" choice covers, or null for anytime. */
export function resolveWhen(when: WhenFilter, now: Date): { startMs: number; endMs: number } | null {
  const today = startOfDay(now);
  switch (when.kind) {
    case 'anytime':
      return null;
    case 'today':
      return { startMs: now.getTime(), endMs: addDays(today, 1).getTime() };
    case 'tomorrow':
      return { startMs: addDays(today, 1).getTime(), endMs: addDays(today, 2).getTime() };
    case 'weekend': {
      const dow = today.getDay(); // 0 Sunday … 6 Saturday
      const saturday = dow === 0 ? addDays(today, -1) : addDays(today, (6 - dow) % 7);
      const start = Math.max(saturday.getTime(), now.getTime());
      return { startMs: start, endMs: addDays(saturday, 2).getTime() };
    }
    case 'dates': {
      const start = parseDayKey(when.start);
      const end = parseDayKey(when.end);
      if (!start || !end) return null;
      const [a, b] = start <= end ? [start, end] : [end, start];
      return { startMs: Math.max(a.getTime(), now.getTime()), endMs: addDays(b, 1).getTime() };
    }
  }
}

const shortDay = (key: string) => {
  const date = parseDayKey(key);
  if (!date) return key;
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  } catch {
    return key;
  }
};

export function whenLabel(when: WhenFilter): string {
  switch (when.kind) {
    case 'anytime':
      return 'Anytime';
    case 'today':
      return 'Today';
    case 'tomorrow':
      return 'Tomorrow';
    case 'weekend':
      return 'This weekend';
    case 'dates':
      return when.start === when.end ? shortDay(when.start) : `${shortDay(when.start)}–${shortDay(when.end)}`;
  }
}

/** Whole days from today a date picker may offer (matches the recommender's event horizon). */
export const WHEN_HORIZON_DAYS = 45;
export const isWithinHorizon = (date: Date, now: Date) =>
  date.getTime() >= startOfDay(now).getTime() && date.getTime() < startOfDay(now).getTime() + WHEN_HORIZON_DAYS * DAY_MS;

// ---------------------------------------------------------------------------
// Distance (entered in miles, stored in km)
// ---------------------------------------------------------------------------

export const KM_PER_MILE = 1.609344;

export function parseMiles(text: string): { ok: true; km: number | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, km: null };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, error: 'Enter a number of miles, like 5.' };
  const miles = Number(trimmed);
  if (!(miles > 0)) return { ok: false, error: 'Distance needs to be more than 0 miles.' };
  if (miles > 500) return { ok: false, error: 'That’s a road trip. Try 500 miles or less.' };
  return { ok: true, km: miles * KM_PER_MILE };
}

export function kmToMilesText(km: number | null): string {
  if (km === null) return '';
  const miles = km / KM_PER_MILE;
  return String(Math.round(miles * 10) / 10);
}
