/**
 * Turns the user's on-device history into a small, explainable profile that
 * nudges ranking. No model, just decayed counters:
 *
 * - Completions push their category/tags up, scaled by the emoji reaction.
 * - Saving or planning is a mild positive signal.
 * - "Not my thing" pushes the category/tags down.
 * - "Too expensive" / "Too far" / "Wrong timing" become soft ceilings on price,
 *   distance and time of day rather than hard rules.
 *
 * Signals halve in weight every HALF_LIFE_DAYS so old feedback fades.
 */
import { dayPart, hourInZone, type DayPart } from './time.ts';
import type { ActivityFeedback, AdventureEntry, Category, Reaction, UserHistory } from './types.ts';
import { DAY_MS, clamp, parseTime } from './util.ts';

const HALF_LIFE_DAYS = 45;
const CONSTRAINT_WINDOW_DAYS = 60;

export const REACTION_SENTIMENT: Record<Reaction, number> = {
  loved: 2,
  fun: 1.5,
  calm: 1,
  okay: 0.25,
  meh: -1,
};

export interface LearnedProfile {
  categoryAffinity: Partial<Record<Category, number>>;
  tagAffinity: Record<string, number>;
  /** Categories the user has completed at least once. */
  triedCategories: Set<Category>;
  /** Cheapest price the user called "too expensive" recently. */
  priceCeiling?: number;
  /** Nearest distance the user called "too far" recently. */
  distanceCeilingKm?: number;
  /** Decayed count of "wrong timing" dismissals per time of day. */
  avoidDayParts: Partial<Record<DayPart, number>>;
}

function decay(iso: string | undefined, now: Date): number {
  const t = parseTime(iso);
  if (t === undefined) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - t) / DAY_MS);
  return 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

function withinWindow(iso: string | undefined, now: Date): boolean {
  const t = parseTime(iso);
  return t !== undefined && now.getTime() - t <= CONSTRAINT_WINDOW_DAYS * DAY_MS;
}

export function buildProfile(history: UserHistory, now: Date): LearnedProfile {
  const categoryAffinity: Partial<Record<Category, number>> = {};
  const tagAffinity: Record<string, number> = {};
  const triedCategories = new Set<Category>();
  const avoidDayParts: Partial<Record<DayPart, number>> = {};
  let priceCeiling: number | undefined;
  let distanceCeilingKm: number | undefined;

  const bump = (category: Category, tags: readonly string[], amount: number) => {
    categoryAffinity[category] = (categoryAffinity[category] ?? 0) + amount;
    for (const tag of tags) tagAffinity[tag] = (tagAffinity[tag] ?? 0) + amount * 0.5;
  };

  for (const entry of history.adventures) applyAdventure(entry, now, bump, triedCategories);
  for (const fb of history.feedback) {
    const w = decay(fb.createdAt, now);
    switch (fb.reason) {
      case 'not_my_thing':
        bump(fb.context.category, fb.context.tags, -1 * w);
        break;
      case 'too_expensive':
        if (withinWindow(fb.createdAt, now) && fb.context.priceMin !== undefined && fb.context.priceMin > 0) {
          priceCeiling = Math.min(priceCeiling ?? Infinity, fb.context.priceMin);
        }
        break;
      case 'too_far':
        if (withinWindow(fb.createdAt, now) && fb.context.distanceKm !== undefined) {
          distanceCeilingKm = Math.min(distanceCeilingKm ?? Infinity, fb.context.distanceKm);
        }
        break;
      case 'wrong_timing': {
        const start = parseTime(fb.context.startAt);
        if (start !== undefined) {
          const part = dayPart(hourInZone(start, undefined));
          avoidDayParts[part] = (avoidDayParts[part] ?? 0) + w;
        }
        break;
      }
      default:
        break;
    }
  }

  for (const key of Object.keys(categoryAffinity) as Category[]) {
    categoryAffinity[key] = clamp(categoryAffinity[key]!, -3, 3);
  }
  for (const key of Object.keys(tagAffinity)) tagAffinity[key] = clamp(tagAffinity[key]!, -2, 2);

  return {
    categoryAffinity,
    tagAffinity,
    triedCategories,
    avoidDayParts,
    ...(priceCeiling !== undefined ? { priceCeiling } : {}),
    ...(distanceCeilingKm !== undefined ? { distanceCeilingKm } : {}),
  };
}

function applyAdventure(
  entry: AdventureEntry,
  now: Date,
  bump: (category: Category, tags: readonly string[], amount: number) => void,
  tried: Set<Category>,
) {
  const { category, tags } = entry.activity;
  if (entry.status === 'completed') {
    tried.add(category);
    // Completing something is a positive signal on its own; the reaction refines it.
    const sentiment = entry.reaction ? REACTION_SENTIMENT[entry.reaction] : 0.75;
    bump(category, tags, sentiment * decay(entry.completedAt ?? entry.updatedAt, now));
  } else if (entry.status === 'planned') {
    bump(category, tags, 0.75 * decay(entry.plannedAt ?? entry.updatedAt, now));
  } else {
    bump(category, tags, 0.5 * decay(entry.savedAt ?? entry.updatedAt, now));
  }
}

/** How long a dismissed activity stays out of recommendations, by reason. */
export const DISMISS_COOLDOWN_DAYS: Record<NonNullable<ActivityFeedback['reason']> | 'none', number> = {
  not_my_thing: 120,
  unavailable: 30,
  too_expensive: 21,
  too_far: 21,
  wrong_timing: 21,
  none: 30,
};

export function isInDismissCooldown(activityId: string, feedback: readonly ActivityFeedback[], now: Date): boolean {
  return feedback.some((fb) => {
    if (fb.activityId !== activityId) return false;
    const t = parseTime(fb.createdAt);
    if (t === undefined) return true;
    const days = DISMISS_COOLDOWN_DAYS[fb.reason ?? 'none'];
    return now.getTime() - t < days * DAY_MS;
  });
}
