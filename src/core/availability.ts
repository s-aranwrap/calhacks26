/**
 * Decides whether an activity is a viable *current* option and how to talk
 * about its availability honestly. Being in the catalog is not evidence that
 * something is still on: only a verified, recently checked record counts as
 * confirmed.
 */
import { formatClock, openStatus, parsedHours } from './hours.ts';
import type { Activity } from './types.ts';
import { DAY_MS, MINUTE_MS, parseTime } from './util.ts';

export type AvailabilityState =
  | 'evergreen'
  | 'upcoming'
  | 'happening_now'
  | 'ended'
  | 'sold_out'
  | 'cancelled'
  | 'date_unknown'
  | 'too_far_ahead'
  /** Evergreen place whose known weekly hours say it's closed for the rest of today. */
  | 'closed_now';

export interface AvailabilityAssessment {
  /** Can this be recommended as something to do now / soon? */
  viable: boolean;
  state: AvailabilityState;
  /** True only when a verified source reported availability recently. */
  confirmed: boolean;
  /** Short, honest, user-facing line. */
  label: string;
}

export interface AvailabilityOptions {
  /** Events further out than this aren't recommended yet. */
  horizonDays?: number;
  /** Assumed event length when neither end time nor duration is known. */
  defaultEventMinutes?: number;
  /** A verified check older than this no longer counts as confirmation. */
  staleAfterDays?: number;
  /** An ongoing event with less time left than this is treated as over. */
  minRemainingMinutes?: number;
  /** A place closing sooner than this is treated as closed for today. */
  minOpenMinutes?: number;
}

const DEMO_LABEL = 'Sample listing for the demo, not a real booking';

const DEFAULTS: Required<AvailabilityOptions> = {
  horizonDays: 45,
  defaultEventMinutes: 180,
  staleAfterDays: 14,
  minRemainingMinutes: 30,
  minOpenMinutes: 45,
};

/** Best-known end instant of an event, or undefined if it has no start. */
export function eventEndMs(activity: Activity, defaultEventMinutes = DEFAULTS.defaultEventMinutes): number | undefined {
  const start = parseTime(activity.startAt);
  if (start === undefined) return undefined;
  const end = parseTime(activity.endAt);
  if (end !== undefined && end > start) return end;
  const minutes = activity.duration?.maxMinutes ?? activity.duration?.minMinutes ?? defaultEventMinutes;
  return start + minutes * MINUTE_MS;
}

export function isExpired(activity: Activity, now: Date, options: AvailabilityOptions = {}): boolean {
  if (activity.kind !== 'event') return false;
  const end = eventEndMs(activity, options.defaultEventMinutes);
  if (end === undefined) return false;
  const minRemaining = (options.minRemainingMinutes ?? DEFAULTS.minRemainingMinutes) * MINUTE_MS;
  return end - now.getTime() < minRemaining;
}

export function assessAvailability(
  activity: Activity,
  now: Date,
  options: AvailabilityOptions = {},
): AvailabilityAssessment {
  const opts = { ...DEFAULTS, ...options };
  const nowMs = now.getTime();

  if (activity.availability === 'cancelled') {
    return { viable: false, state: 'cancelled', confirmed: true, label: 'Cancelled' };
  }
  if (activity.availability === 'sold_out') {
    return { viable: false, state: 'sold_out', confirmed: true, label: 'Fully booked' };
  }

  const checked = parseTime(activity.verification.lastCheckedAt);
  const freshlyVerified =
    activity.verification.status === 'verified' &&
    checked !== undefined &&
    nowMs - checked <= opts.staleAfterDays * DAY_MS;
  const confirmed = freshlyVerified && (activity.availability === 'available' || activity.availability === 'limited');

  if (activity.verification.status === 'demo') {
    // Sample content still respects dates, so the demo behaves like real data.
    if (activity.kind === 'evergreen') return { viable: true, state: 'evergreen', confirmed: false, label: DEMO_LABEL };
    const state = eventState(activity, nowMs, opts);
    return { ...state, confirmed: false, label: state.viable ? DEMO_LABEL : state.label };
  }

  if (activity.kind === 'evergreen') {
    const hours = parsedHours(activity.openingHours);
    if (hours) {
      const status = openStatus(hours, now, activity.timeZone);
      if (status.state === 'closed_today' || status.state === 'always_closed') {
        return { viable: false, state: 'closed_now', confirmed: false, label: status.label };
      }
      if (status.state === 'open' && (status.minutesLeft ?? 0) < opts.minOpenMinutes) {
        const closesAt = formatClock(wallMinutes(now, activity.timeZone) + (status.minutesLeft ?? 0));
        return {
          viable: false,
          state: 'closed_now',
          confirmed: false,
          label: `Closes at ${closesAt}, too soon to go today`,
        };
      }
      return {
        viable: true,
        state: 'evergreen',
        confirmed,
        label: freshlyVerified
          ? `${status.label}. Hours verified recently`
          : `${status.label}. Hours not verified, so check before you go`,
      };
    }
    return {
      viable: true,
      state: 'evergreen',
      confirmed,
      label: freshlyVerified
        ? activity.openingHours
          ? 'Opening info verified recently'
          : 'Details verified recently'
        : activity.openingHours
          ? 'Opening hours not verified, so check before you go'
          : 'Opening hours unknown, so check before you go',
    };
  }

  const state = eventState(activity, nowMs, opts);
  if (!state.viable) return { ...state, confirmed: false };

  let label: string;
  if (confirmed && activity.availability === 'limited') label = 'Limited spots, checked recently';
  else if (confirmed) label = 'Spots available, checked recently';
  else if (activity.availability === 'limited') label = 'Reported as limited spots, not verified';
  else label = 'Availability not verified, so check before you go';
  return { ...state, confirmed, label };
}

function eventState(
  activity: Activity,
  nowMs: number,
  opts: Required<AvailabilityOptions>,
): Pick<AvailabilityAssessment, 'viable' | 'state' | 'label'> {
  const start = parseTime(activity.startAt);
  if (start === undefined) return { viable: false, state: 'date_unknown', label: 'Date unknown' };
  const end = eventEndMs(activity, opts.defaultEventMinutes)!;
  if (end - nowMs < opts.minRemainingMinutes * MINUTE_MS)
    return { viable: false, state: 'ended', label: 'This event has ended' };
  if (start - nowMs > opts.horizonDays * DAY_MS)
    return { viable: false, state: 'too_far_ahead', label: 'Too far ahead to plan yet' };
  if (start <= nowMs) return { viable: true, state: 'happening_now', label: 'Happening now' };
  return { viable: true, state: 'upcoming', label: 'Upcoming' };
}

function wallMinutes(now: Date, timeZone: string | undefined): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      ...(timeZone ? { timeZone } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return (get('hour') % 24) * 60 + get('minute');
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}
