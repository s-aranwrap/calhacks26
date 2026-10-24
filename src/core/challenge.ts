/**
 * Challenge level: a lightweight, explainable 3-step scale (Easy / Moderate /
 * Stretch) built from four factors scored 0–2 each:
 *
 *   novelty     – how unfamiliar the experience is for most people
 *   social      – how much it involves strangers, groups or performing
 *   physical    – how much physical effort it takes
 *   commitment  – time, money or booking required up front
 *
 * Catalog records can set any factor explicitly; missing factors are inferred
 * from category, tags, duration and price. Sum 0–2 = Easy, 3–4 = Moderate, 5+ = Stretch.
 */
import type { Activity, Category, ChallengeFactors, ChallengeLevel, ChallengeScore } from './types.ts';

const DEFAULT_NOVELTY: Record<Category, ChallengeScore> = {
  outdoors: 0,
  arts: 1,
  music: 0,
  food: 0,
  learning: 1,
  community: 1,
  wellness: 1,
  fitness: 1,
  games: 0,
  culture: 0,
  other: 1,
};

const DEFAULT_SOCIAL: Record<Category, ChallengeScore> = {
  outdoors: 0,
  arts: 0,
  music: 0,
  food: 0,
  learning: 1,
  community: 1,
  wellness: 0,
  fitness: 1,
  games: 1,
  culture: 0,
  other: 0,
};

const DEFAULT_PHYSICAL: Record<Category, ChallengeScore> = {
  outdoors: 1,
  arts: 0,
  music: 0,
  food: 0,
  learning: 0,
  community: 0,
  wellness: 0,
  fitness: 2,
  games: 0,
  culture: 0,
  other: 0,
};

const hasTag = (activity: Activity, ...tags: string[]) => tags.some((t) => activity.tags.includes(t));

function inferNovelty(a: Activity): ChallengeScore {
  if (hasTag(a, 'unusual', 'first-time', 'new-skill', 'try-something-new')) return 2;
  if (hasTag(a, 'familiar', 'classic')) return 0;
  return DEFAULT_NOVELTY[a.category];
}

function inferSocial(a: Activity): ChallengeScore {
  if (hasTag(a, 'open-mic', 'performance', 'public-speaking', 'improv')) return 2;
  if (hasTag(a, 'solo', 'self-guided', 'quiet')) return 0;
  if (hasTag(a, 'meet-people', 'group', 'team', 'meetup', 'conversation', 'volunteering')) return 1;
  return DEFAULT_SOCIAL[a.category];
}

function inferPhysical(a: Activity): ChallengeScore {
  if (hasTag(a, 'strenuous', 'hike', 'climbing', 'swimming', 'run')) return 2;
  if (hasTag(a, 'walk', 'walking', 'dance', 'cycling', 'light-activity')) return 1;
  if (hasTag(a, 'seated', 'accessible')) return 0;
  return DEFAULT_PHYSICAL[a.category];
}

function inferCommitment(a: Activity): ChallengeScore {
  let score = 0;
  const minutes = a.duration?.minMinutes;
  if (minutes !== undefined) score += minutes >= 240 ? 2 : minutes >= 120 ? 1 : 0;
  if (a.price && a.price.minAmount >= 40) score += 1;
  if (hasTag(a, 'booking-required', 'multi-session')) score += 1;
  return Math.min(2, score) as ChallengeScore;
}

export interface ChallengeAssessment {
  level: ChallengeLevel;
  factors: ChallengeFactors;
  /** Plain-language reasons, strongest first. Empty for easy, low-key activities. */
  notes: string[];
}

export function challengeFactors(activity: Activity): ChallengeFactors {
  const explicit = activity.challenge ?? {};
  return {
    novelty: explicit.novelty ?? inferNovelty(activity),
    social: explicit.social ?? inferSocial(activity),
    physical: explicit.physical ?? inferPhysical(activity),
    commitment: explicit.commitment ?? inferCommitment(activity),
  };
}

export function levelFromFactors(f: ChallengeFactors): ChallengeLevel {
  const total = f.novelty + f.social + f.physical + f.commitment;
  if (total >= 5) return 'stretch';
  if (total >= 3) return 'moderate';
  return 'easy';
}

const NOTE_TEXT: Record<keyof ChallengeFactors, [string, string]> = {
  novelty: ['A little out of the ordinary', 'Something genuinely new for most people'],
  social: ['Some chatting with others', 'Involves strangers or being in the spotlight'],
  physical: ['Light physical activity', 'Physically demanding'],
  commitment: ['Takes a bit of time or money', 'A bigger time, money or booking commitment'],
};

export function assessChallenge(activity: Activity): ChallengeAssessment {
  const factors = challengeFactors(activity);
  const notes = (Object.keys(NOTE_TEXT) as (keyof ChallengeFactors)[])
    .filter((key) => factors[key] > 0)
    .sort((a, b) => factors[b] - factors[a])
    .map((key) => NOTE_TEXT[key][factors[key] - 1]!);
  return { level: levelFromFactors(factors), factors, notes };
}

export const CHALLENGE_ORDER: Record<ChallengeLevel, number> = { easy: 0, moderate: 1, stretch: 2 };

export const CHALLENGE_LABEL: Record<ChallengeLevel, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  stretch: 'Stretch',
};
