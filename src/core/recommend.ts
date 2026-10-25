/**
 * The recommendation engine. Pure function: catalog + request + on-device
 * history in, at most three explained recommendations out.
 *
 * Pipeline
 *  1. Eligibility (hard rules). Each excluded activity records the first rule
 *     it failed, so empty states can suggest which filter to loosen.
 *  2. Scoring (soft signals). Every point added or removed carries a reason,
 *     and the strongest positive reasons become the card's "why" line.
 *  3. Selection. Greedy pick with a diversity penalty (no three pottery
 *     classes), at most N "stretch" activities depending on the nudge
 *     setting, one slot reserved for something new when available, and at
 *     least one easy option when available.
 *
 * Missing data is never treated as a failed filter: unknown price, distance or
 * duration only costs a little score and is labeled honestly in the UI.
 */
import { assessAvailability, eventEndMs, type AvailabilityState } from './availability.ts';
import { assessChallenge, type ChallengeAssessment } from './challenge.ts';
import { buildProfile, isInDismissCooldown, type LearnedProfile } from './learning.ts';
import { dayPart, hourInZone } from './time.ts';
import type {
  Activity,
  ActivityMood,
  BudgetLevel,
  Category,
  GeoPoint,
  Mood,
  UserHistory,
  UserPreferences,
} from './types.ts';
import { HOUR_MS, distanceKm, parseTime, seededRandom, stableHash } from './util.ts';

export const BUDGET_CAP: Record<BudgetLevel, number> = { free: 0, low: 15, medium: 40, any: Infinity };

export const BUDGET_LABEL: Record<BudgetLevel, string> = {
  free: 'Free only',
  low: 'Up to 15',
  medium: 'Up to 40',
  any: 'Any budget',
};

export interface DiscoveryRequest {
  /** Single-mood requests (older callers and tests). Ignored when `moods` is non-empty. */
  mood?: Mood;
  /** Any-of match: an activity fits when it carries at least one of these. Empty = surprise me. */
  moods?: readonly ActivityMood[];
  /**
   * Optional "when" window (epoch ms). Events must overlap it; places are
   * checked for being open at its start rather than right now.
   */
  window?: { startMs: number; endMs: number };
  budget: BudgetLevel;
  /** null = any distance */
  maxDistanceKm: number | null;
  /** null = no time limit */
  availableMinutes: number | null;
  origin?: GeoPoint;
  now: Date;
  /** IDs already shown in this discovery session ("Show me three more"). */
  excludeIds?: readonly string[];
  /** Varies "Surprise me" and breaks ties. Fixed in tests. */
  seed?: number;
  count?: number;
  /**
   * Dated events are what makes Huddle worth opening (a place will still be
   * there next week). When at least this many events are eligible, at least
   * this many of the picks are events, and places only fill what's left.
   * Default 3 (all three, when there are enough); 0 turns it off.
   */
  minEvents?: number;
}

export type RecommendationPreferences = Pick<UserPreferences, 'interests' | 'nudge' | 'includeUnverified' | 'currency'>;

export type ExclusionReason =
  | 'candidate'
  | 'unavailable'
  | 'expired'
  | 'date_unknown'
  | 'too_far_ahead'
  | 'closed'
  | 'unverified'
  | 'already_planned'
  | 'completed'
  | 'recently_dismissed'
  | 'shown_this_session'
  | 'mood'
  | 'when'
  | 'budget'
  | 'distance'
  | 'time'
  | 'too_challenging';

export type FilterSuggestion =
  | 'raise_budget'
  | 'widen_distance'
  | 'more_time'
  | 'change_mood'
  | 'any_time'
  | 'include_unverified'
  | 'bolder_nudge'
  | 'start_fresh';

export interface Recommendation {
  activity: Activity;
  score: number;
  /** Up to three short, human reasons, strongest first. */
  reasons: string[];
  challenge: ChallengeAssessment;
  distanceKm?: number;
  /** "novel" marks the slot reserved for stepping outside the routine. */
  slot: 'match' | 'novel';
}

export interface DiscoveryResult {
  status: 'ok' | 'limited' | 'empty';
  recommendations: Recommendation[];
  eligibleCount: number;
  exclusions: Partial<Record<ExclusionReason, number>>;
  suggestions: FilterSuggestion[];
}

interface Reason {
  text: string;
  /** Display priority; can differ from the score contribution (e.g. "Free" is already on the card). */
  priority: number;
}

interface Candidate {
  activity: Activity;
  score: number;
  reasons: Reason[];
  challenge: ChallengeAssessment;
  distanceKm?: number;
  novel: boolean;
}

const CATEGORY_ADJECTIVE: Record<Category, string> = {
  outdoors: 'outdoor',
  arts: 'creative',
  music: 'music',
  food: 'food',
  learning: 'learning',
  community: 'community',
  wellness: 'wellness',
  fitness: 'active',
  games: 'games',
  culture: 'cultural',
  other: '',
};

const MOOD_TEXT: Record<ActivityMood, string> = {
  chill: 'Easygoing, matches your chill mood',
  social: 'A good one for being around people',
  active: 'Gets you moving',
  creative: 'Something to make or imagine',
};

const MAX_STRETCH = { gentle: 0, balanced: 1, bold: 2 } as const;
const NOVELTY_BONUS = { gentle: 0, balanced: 0.6, bold: 1.2 } as const;

const AVAILABILITY_EXCLUSION: Partial<Record<AvailabilityState, ExclusionReason>> = {
  cancelled: 'unavailable',
  sold_out: 'unavailable',
  ended: 'expired',
  date_unknown: 'date_unknown',
  too_far_ahead: 'too_far_ahead',
  closed_now: 'closed',
};

// ---------------------------------------------------------------------------
// 1. Eligibility
// ---------------------------------------------------------------------------

/** The activity moods a request asks for; empty means "surprise me". */
export function requestedMoods(request: Pick<DiscoveryRequest, 'mood' | 'moods'>): readonly ActivityMood[] {
  if (request.moods?.length) return request.moods;
  return request.mood && request.mood !== 'surprise' ? [request.mood] : [];
}

function outsideWindow(activity: Activity, window: NonNullable<DiscoveryRequest['window']>): boolean {
  if (activity.kind !== 'event') return false;
  const start = parseTime(activity.startAt);
  if (start === undefined) return true;
  const end = eventEndMs(activity) ?? start;
  return start >= window.endMs || end <= window.startMs;
}

function knownPriceInCurrency(activity: Activity, currency: string): number | undefined {
  if (!activity.price) return undefined;
  // Without exchange rates we can't compare across currencies, so treat as unknown.
  if (activity.price.minAmount > 0 && activity.price.currency !== currency) return undefined;
  return activity.price.minAmount;
}

function activityDistance(activity: Activity, origin: GeoPoint | undefined): number | undefined {
  const v = activity.venue;
  if (!origin || !v || v.latitude === undefined || v.longitude === undefined) return undefined;
  return distanceKm(origin, { latitude: v.latitude, longitude: v.longitude });
}

/** Returns the first hard rule this activity fails, or null if it's eligible. */
export function exclusionReason(
  activity: Activity,
  request: DiscoveryRequest,
  prefs: RecommendationPreferences,
  history: UserHistory,
  challenge: ChallengeAssessment,
  distance: number | undefined,
): ExclusionReason | null {
  if (activity.verification.status === 'candidate') return 'candidate';

  // A place that's shut tonight can still be tomorrow's plan, so places are checked at the window's start.
  const checkAt =
    activity.kind === 'evergreen' && request.window && request.window.startMs > request.now.getTime()
      ? new Date(request.window.startMs)
      : request.now;
  const availability = assessAvailability(activity, checkAt);
  if (!availability.viable) return AVAILABILITY_EXCLUSION[availability.state] ?? 'unavailable';

  if (activity.verification.status === 'unverified' && !prefs.includeUnverified) return 'unverified';

  const entry = history.adventures.find((a) => a.activityId === activity.id);
  if (entry?.status === 'planned') return 'already_planned';
  if (entry?.status === 'completed') return 'completed';
  if (isInDismissCooldown(activity.id, history.feedback, request.now)) return 'recently_dismissed';
  if (request.excludeIds?.includes(activity.id)) return 'shown_this_session';

  const moods = requestedMoods(request);
  if (moods.length && !activity.moods.some((m) => moods.includes(m))) return 'mood';
  if (request.window && outsideWindow(activity, request.window)) return 'when';

  const price = knownPriceInCurrency(activity, prefs.currency);
  if (price !== undefined && price > BUDGET_CAP[request.budget]) return 'budget';

  if (request.maxDistanceKm !== null && distance !== undefined && distance > request.maxDistanceKm) return 'distance';

  if (
    request.availableMinutes !== null &&
    activity.duration &&
    activity.duration.basis !== 'event_window' &&
    activity.duration.minMinutes > request.availableMinutes
  ) {
    return 'time';
  }

  if (MAX_STRETCH[prefs.nudge] === 0 && challenge.level === 'stretch') return 'too_challenging';
  return null;
}

// ---------------------------------------------------------------------------
// 2. Scoring
// ---------------------------------------------------------------------------

function scoreCandidate(
  activity: Activity,
  request: DiscoveryRequest,
  prefs: RecommendationPreferences,
  history: UserHistory,
  profile: LearnedProfile,
  challenge: ChallengeAssessment,
  distance: number | undefined,
  rng: () => number,
): Candidate {
  const reasons: Reason[] = [];
  let score = 0;
  const add = (points: number, text?: string, priority = points) => {
    score += points;
    if (text && points > 0) reasons.push({ text, priority });
  };

  // Mood is already a hard filter; this reason is a low-priority fallback line.
  const moods = requestedMoods(request);
  const matched = moods.find((m) => activity.moods.includes(m));
  if (matched) add(0.5, MOOD_TEXT[matched], 0.2);

  if (prefs.interests.includes(activity.category)) add(2, 'One of your interests');

  const categoryAffinity = profile.categoryAffinity[activity.category] ?? 0;
  const tagAffinity = Math.max(
    -2,
    Math.min(
      2,
      activity.tags.reduce((sum, t) => sum + (profile.tagAffinity[t] ?? 0), 0),
    ),
  );
  const affinity = categoryAffinity * 1.2 + tagAffinity * 0.5;
  add(affinity, affinity >= 1 ? "Similar to things you've enjoyed" : undefined);

  // Price
  const cap = BUDGET_CAP[request.budget];
  const price = knownPriceInCurrency(activity, prefs.currency);
  if (price === 0) add(1.2, 'Free', 0.5);
  else if (price !== undefined) {
    if (Number.isFinite(cap)) add(0.4, 'Fits your budget', 0.3);
    if (profile.priceCeiling !== undefined && price >= profile.priceCeiling) add(-1.5);
  } else {
    add(request.budget === 'free' ? -1 : -0.4);
  }

  // Distance
  if (distance !== undefined) {
    if (distance <= 1.5) add(1.2, `About a ${Math.max(5, Math.round(((distance / 4.8) * 60) / 5) * 5)} minute walk`);
    else if (distance <= 5) add(0.6, `Only ${distance.toFixed(1)} km away`);
    if (profile.distanceCeilingKm !== undefined && distance >= profile.distanceCeilingKm) add(-1.2);
  } else if (request.origin) {
    add(-0.3);
  }

  // Time. An event's start and end already say how long it is, so a missing duration isn't held against it.
  if (request.availableMinutes !== null) {
    if (activity.duration) {
      const hours = request.availableMinutes / 60;
      add(
        0.4,
        `Fits in your ${hours >= 1 ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'}` : `${request.availableMinutes} minutes`}`,
      );
    } else if (activity.kind !== 'event') add(-0.3);
  }

  // Timing for events: a one-off happening soon beats a place that's always there.
  const start = parseTime(activity.startAt);
  if (activity.kind === 'event' && start !== undefined) {
    const hoursUntil = (start - request.now.getTime()) / HOUR_MS;
    const end = parseTime(activity.endAt);
    const longRun = activity.allDay && end !== undefined && end - start > 36 * HOUR_MS;
    if (longRun) add(1.2, 'On for a limited time', 1.2);
    else if (hoursUntil <= 0) add(2.5, 'Happening right now', 2);
    else if (hoursUntil <= 24) add(2.2, 'Happening soon', 2);
    else if (hoursUntil <= 72) add(1.6, 'Coming up in the next few days', 1.5);
    else if (hoursUntil <= 7 * 24) add(1.1, 'This week only', 1.2);
    else add(0.6, 'On a set date, so it won’t wait for you', 0.8);
    // Freshly found one-offs beat the pack's weekly regulars, which come round every week anyway.
    if (activity.source.platform === 'instagram' || activity.source.platform === 'supabase') add(1);
    const part = dayPart(hourInZone(start, undefined));
    if ((profile.avoidDayParts[part] ?? 0) >= 0.5) add(-1);
  }

  // Trust
  const status = activity.verification.status;
  const checked = parseTime(activity.verification.lastCheckedAt);
  if (status === 'verified') {
    const fresh = checked !== undefined && request.now.getTime() - checked <= 14 * 24 * HOUR_MS;
    add(fresh ? 0.8 : -0.2, fresh ? 'Details recently verified' : undefined);
  } else if (status === 'unverified') add(-0.6);

  if (history.adventures.some((a) => a.activityId === activity.id && a.status === 'saved'))
    add(0.8, 'You saved this earlier');

  // Novelty. With some history or interests we can tell what's new *for this
  // person*; for a brand-new user only intrinsically unusual activities count.
  const knowsUser = profile.triedCategories.size > 0 || prefs.interests.length > 0;
  const newCategory =
    knowsUser && !profile.triedCategories.has(activity.category) && !prefs.interests.includes(activity.category);
  const unusual = challenge.factors.novelty === 2;
  const novel = newCategory || unusual;
  if (novel && NOVELTY_BONUS[prefs.nudge] > 0) {
    const adjective = CATEGORY_ADJECTIVE[activity.category];
    const text = newCategory
      ? adjective
        ? `A new ${adjective} experience for you`
        : 'Something new for you'
      : 'Something a bit out of the ordinary';
    add(NOVELTY_BONUS[prefs.nudge], text, 1.6);
  }

  if (challenge.level === 'stretch') add(prefs.nudge === 'bold' ? 0.5 : -0.5);
  else if (challenge.level === 'moderate' && prefs.nudge === 'bold') add(0.3);

  // "Surprise me" leans on randomness; other moods only use it to break ties.
  add(rng() * (moods.length === 0 ? 2 : 0.25));

  return { activity, score, reasons, challenge, ...(distance !== undefined ? { distanceKm: distance } : {}), novel };
}

// ---------------------------------------------------------------------------
// 3. Selection
// ---------------------------------------------------------------------------

function diversityPenalty(candidate: Candidate, picks: readonly Candidate[]): number {
  let penalty = 0;
  for (const pick of picks) {
    if (pick.activity.category === candidate.activity.category) penalty += 1.8;
    const a = pick.activity.venue?.name;
    const b = candidate.activity.venue?.name;
    if (a && b && a === b) penalty += 3;
  }
  return penalty;
}

function selectDiverse(
  pool: Candidate[],
  count: number,
  nudge: RecommendationPreferences['nudge'],
  minEvents: number,
): Candidate[] {
  const picks: Candidate[] = [];
  const remaining = [...pool];
  const maxStretch = MAX_STRETCH[nudge];
  const stretchCount = () => picks.filter((p) => p.challenge.level === 'stretch').length;

  while (picks.length < count && remaining.length) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    remaining.forEach((c, i) => {
      if (c.challenge.level === 'stretch' && stretchCount() >= maxStretch) return;
      const value = c.score - diversityPenalty(c, picks);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    });
    if (bestIndex === -1) break;
    picks.push(remaining.splice(bestIndex, 1)[0]!);
  }

  // The stretch cap shapes the mix but must not leave a slot empty when other
  // eligible activities exist (gentle users never see stretch: it's a hard rule there).
  while (picks.length < count && remaining.length) {
    remaining.sort((a, b) => b.score - diversityPenalty(b, picks) - (a.score - diversityPenalty(a, picks)));
    picks.push(remaining.shift()!);
  }

  const slack = 2.5;
  const lowest = () => Math.min(...picks.map((p) => p.score));

  // Reserve one slot for stepping outside the routine.
  if (nudge !== 'gentle' && count >= 3 && picks.length === count && !picks.some((p) => p.novel)) {
    const canAddStretch = stretchCount() < maxStretch;
    const novel = remaining
      .filter((c) => c.novel && (c.challenge.level !== 'stretch' || canAddStretch))
      .sort((a, b) => b.score - a.score)[0];
    if (novel && novel.score >= lowest() - slack) {
      picks[picks.length - 1] = novel;
      remaining.splice(remaining.indexOf(novel), 1);
    }
  }

  // Keep at least one comfortable, accessible option in the mix.
  if (count >= 3 && picks.length === count && !picks.some((p) => p.challenge.level === 'easy')) {
    const easy = remaining.filter((c) => c.challenge.level === 'easy').sort((a, b) => b.score - a.score)[0];
    if (easy && easy.score >= lowest() - slack) {
      // Replace the weakest non-novel pick so the novelty slot survives.
      let replaceAt = -1;
      picks.forEach((p, i) => {
        if (p.novel && picks.filter((q) => q.novel).length === 1) return;
        if (replaceAt === -1 || p.score < picks[replaceAt]!.score) replaceAt = i;
      });
      if (replaceAt !== -1) picks[replaceAt] = easy;
    }
  }

  // Make room for events: swap the weakest places for the best eligible events, one venue each.
  const isEvent = (c: Candidate) => c.activity.kind === 'event';
  const wanted = Math.min(minEvents, count);
  while (picks.filter(isEvent).length < wanted) {
    const venues = new Set(picks.map((p) => p.activity.venue?.name).filter(Boolean));
    const event = pool
      .filter((c) => isEvent(c) && !picks.includes(c) && !(c.activity.venue?.name && venues.has(c.activity.venue.name)))
      .sort((a, b) => b.score - diversityPenalty(b, picks) - (a.score - diversityPenalty(a, picks)))[0];
    const places = picks.filter((p) => !isEvent(p));
    if (!event || places.length === 0) break;
    const weakest = places.sort((a, b) => a.score - b.score)[0]!;
    picks[picks.indexOf(weakest)] = event;
  }
  return picks;
}

function topReasons(reasons: Reason[]): string[] {
  const seen = new Set<string>();
  const sorted = [...reasons].sort((a, b) => b.priority - a.priority);
  const out: string[] = [];
  for (const r of sorted) {
    if (seen.has(r.text)) continue;
    seen.add(r.text);
    out.push(r.text);
    if (out.length === 3) break;
  }
  return out.length ? out : ['Matches what you asked for'];
}

function suggestionsFor(
  exclusions: Partial<Record<ExclusionReason, number>>,
  request: DiscoveryRequest,
): FilterSuggestion[] {
  const ranked: [FilterSuggestion, number][] = [
    ['raise_budget', exclusions.budget ?? 0],
    ['widen_distance', exclusions.distance ?? 0],
    ['more_time', exclusions.time ?? 0],
    ['include_unverified', exclusions.unverified ?? 0],
    ['bolder_nudge', exclusions.too_challenging ?? 0],
    ['any_time', exclusions.when ?? 0],
    ['start_fresh', exclusions.shown_this_session ?? 0],
  ];
  const out: FilterSuggestion[] = ranked
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);
  if (requestedMoods(request).length && (exclusions.mood ?? 0) > 0) out.push('change_mood');
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------

export function recommend(
  catalog: readonly Activity[],
  request: DiscoveryRequest,
  prefs: RecommendationPreferences,
  history: UserHistory,
): DiscoveryResult {
  const count = request.count ?? 3;
  const profile = buildProfile(history, request.now);
  const rng = seededRandom(request.seed ?? Number.parseInt(stableHash(request.now.toISOString().slice(0, 13)), 16));

  const exclusions: Partial<Record<ExclusionReason, number>> = {};
  const pool: Candidate[] = [];
  const seenIds = new Set<string>();

  for (const activity of catalog) {
    if (seenIds.has(activity.id)) continue; // defensive: catalogs should already be deduped
    seenIds.add(activity.id);
    const challenge = assessChallenge(activity);
    const distance = activityDistance(activity, request.origin);
    const excluded = exclusionReason(activity, request, prefs, history, challenge, distance);
    if (excluded) {
      exclusions[excluded] = (exclusions[excluded] ?? 0) + 1;
      continue;
    }
    pool.push(scoreCandidate(activity, request, prefs, history, profile, challenge, distance, rng));
  }

  pool.sort((a, b) => b.score - a.score || a.activity.id.localeCompare(b.activity.id));
  const picks = selectDiverse(pool, count, prefs.nudge, request.minEvents ?? 3);

  // Present comfortable matches first and the "something different" slot last.
  // Only label a "something different" slot when there's contrast with the others.
  const novelPicks = picks.filter((p) => p.novel);
  const novelSlotId =
    prefs.nudge !== 'gentle' && picks.length === count && novelPicks.length >= 1 && novelPicks.length < picks.length
      ? novelPicks.sort((a, b) => b.score - a.score)[0]!.activity.id
      : undefined;
  // Freshly found events lead, then other events (weekly regulars), then places; the novelty slot, if any, goes last.
  const rank = (c: Candidate) =>
    c.activity.kind !== 'event'
      ? 0
      : c.activity.source.platform === 'instagram' || c.activity.source.platform === 'supabase'
        ? 2
        : 1;
  const ordered = [...picks].sort((a, b) => {
    if (a.activity.id === novelSlotId) return 1;
    if (b.activity.id === novelSlotId) return -1;
    return rank(b) - rank(a) || b.score - a.score;
  });

  const recommendations: Recommendation[] = ordered.map((c) => ({
    activity: c.activity,
    score: Math.round(c.score * 100) / 100,
    reasons: topReasons(c.reasons),
    challenge: c.challenge,
    ...(c.distanceKm !== undefined ? { distanceKm: c.distanceKm } : {}),
    slot: c.activity.id === novelSlotId ? 'novel' : 'match',
  }));

  const status: DiscoveryResult['status'] =
    recommendations.length === 0 ? 'empty' : recommendations.length < count ? 'limited' : 'ok';
  return {
    status,
    recommendations,
    eligibleCount: pool.length,
    exclusions,
    suggestions: status === 'ok' ? [] : suggestionsFor(exclusions, request),
  };
}
