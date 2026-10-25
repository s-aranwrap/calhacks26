/**
 * Core domain models for Huddle.
 *
 * Everything in `src/core` is plain TypeScript with no React Native or Expo
 * imports, so it runs unchanged in the app, in the Node ingestion scripts and
 * in the unit tests. Relative imports inside `src/core` use explicit `.ts`
 * extensions because Node's built-in type stripping requires them.
 */

/** Time-bound events have a start time; evergreen activities can be done any time they're open. */
export type ActivityKind = 'event' | 'evergreen';

export const MOODS = ['surprise', 'chill', 'social', 'active', 'creative'] as const;
export type Mood = (typeof MOODS)[number];

/** Moods an activity can be tagged with. "Surprise me" is a discovery mode, not an activity trait. */
export type ActivityMood = Exclude<Mood, 'surprise'>;
export const ACTIVITY_MOODS: readonly ActivityMood[] = ['chill', 'social', 'active', 'creative'];

export const CATEGORIES = [
  'outdoors',
  'arts',
  'music',
  'food',
  'learning',
  'community',
  'wellness',
  'fitness',
  'games',
  'culture',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * How much we trust a catalog record as a whole.
 * - verified:   checked against an authoritative source at `lastCheckedAt`.
 * - unverified: came from a source but nobody has confirmed the details.
 * - candidate:  discovered automatically (e.g. a social post). Never shown in the app.
 * - demo:       fictional sample content bundled with the app.
 */
export type VerificationStatus = 'verified' | 'unverified' | 'candidate' | 'demo';

/** Per-field certainty for values that are often guessed (price, duration). Absent value = unknown. */
export type Certainty = 'verified' | 'estimated';

/** Booking / capacity state as reported by the source. `unknown` is the honest default. */
export type Availability = 'available' | 'limited' | 'sold_out' | 'cancelled' | 'unknown';

export type SourcePlatform = 'demo' | 'organizer' | 'csv' | 'json' | 'instagram' | 'manual' | 'supabase';

export interface Venue {
  name: string;
  address?: string;
  /** Neighbourhood or area label, e.g. "Old Harbour". */
  area?: string;
  latitude?: number;
  longitude?: number;
}

export interface ActivitySource {
  platform: SourcePlatform;
  /** Organizer, booking or original post URL. Only http(s) URLs survive normalization. */
  url?: string;
  /** Stable ID within the source platform (e.g. an Instagram shortcode). Used for deduplication. */
  sourceId?: string;
  /** Human label, e.g. "Harbourside Library events page". */
  label?: string;
  /** When the source published the listing. Not the same thing as the event start time. */
  publishedAt?: string;
  /** When our ingestion retrieved it. */
  retrievedAt?: string;
}

export interface Price {
  /** 0 means free. */
  minAmount: number;
  maxAmount?: number;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
  certainty: Certainty;
  /** e.g. "Pay what you can", "Includes materials". */
  note?: string;
}

export interface Duration {
  minMinutes: number;
  maxMinutes?: number;
  certainty: Certainty;
  /**
   * "event_window": worked out from an event's start and end. A 7–10 PM show
   * or a 10 AM–2 PM market doesn't mean you must stay the whole time, so this
   * kind never rules an event out for "I only have 2 hours".
   */
  basis?: 'stated' | 'event_window';
}

/** 0 = none, 1 = some, 2 = a lot. Optional metadata; missing factors are inferred. */
export type ChallengeScore = 0 | 1 | 2;
export interface ChallengeFactors {
  novelty: ChallengeScore;
  social: ChallengeScore;
  physical: ChallengeScore;
  commitment: ChallengeScore;
}
export type ChallengeLevel = 'easy' | 'moderate' | 'stretch';

export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  description: string;
  category: Category;
  moods: ActivityMood[];
  tags: string[];
  venue?: Venue;
  /** ISO 8601 instants. Only meaningful for events. */
  startAt?: string;
  endAt?: string;
  /**
   * The source gave a date but no clock time (or a multi-day run such as an
   * exhibition). startAt is local midnight of the first day and endAt the end
   * of the last day, and times are shown as "time not listed".
   */
  allDay?: boolean;
  /** IANA zone used to display event times, e.g. "America/Los_Angeles". */
  timeZone?: string;
  /**
   * Opening info for evergreen activities. Either weekly hours in the OSM
   * subset understood by core/hours.ts ("Mo-Fr 10:00-17:00; Sa off"), which
   * lets Huddle say "Open now · until 5 PM" and skip closed places, or free
   * text ("Daily, sunrise to sunset"), which is only displayed.
   */
  openingHours?: string;
  /** Where the hours came from and when, e.g. "Google Maps, checked Oct 25, 2026". */
  openingHoursSource?: string;
  duration?: Duration;
  price?: Price;
  source: ActivitySource;
  verification: {
    status: VerificationStatus;
    lastCheckedAt?: string;
  };
  availability: Availability;
  imageUrl?: string;
  whatToExpect?: string;
  whyTry?: string;
  restrictions?: string;
  challenge?: Partial<ChallengeFactors>;
}

// ---------------------------------------------------------------------------
// User-side models (stored only on the device)
// ---------------------------------------------------------------------------

export type BudgetLevel = 'free' | 'low' | 'medium' | 'any';
/** How strongly Huddle nudges toward unfamiliar or challenging activities. */
export type NudgeLevel = 'gentle' | 'balanced' | 'bold';

export interface UserLocation {
  label: string;
  latitude?: number;
  longitude?: number;
  /** Where the coordinates came from. Manual entries without coordinates disable distance filtering. */
  source: 'manual' | 'device' | 'demo';
}

export interface UserPreferences {
  location: UserLocation | null;
  interests: Category[];
  budget: BudgetLevel;
  /** null = any distance. */
  maxDistanceKm: number | null;
  /** null = no time limit. */
  availableMinutes: number | null;
  nudge: NudgeLevel;
  /** Whether unverified (but published) catalog records may be recommended. */
  includeUnverified: boolean;
  currency: string;
  onboardedAt?: string;
}

export type DismissReason = 'too_expensive' | 'too_far' | 'wrong_timing' | 'unavailable' | 'not_my_thing';

export interface ActivityFeedback {
  id: string;
  activityId: string;
  kind: 'dismissed';
  reason?: DismissReason;
  createdAt: string;
  /** What the activity looked like when dismissed, so learning survives catalog changes. */
  context: {
    category: Category;
    tags: string[];
    priceMin?: number;
    distanceKm?: number;
    startAt?: string;
  };
}

export type AdventureStatus = 'saved' | 'planned' | 'completed';

export const REACTIONS = ['loved', 'fun', 'calm', 'okay', 'meh'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** One row per activity the user has interacted with beyond dismissing it. */
export interface AdventureEntry {
  activityId: string;
  status: AdventureStatus;
  savedAt?: string;
  plannedAt?: string;
  completedAt?: string;
  updatedAt: string;
  reaction?: Reaction;
  /** Private reflection. Never leaves the device unless the user exports it. */
  reflection?: string;
  /** Snapshot so history renders even if the catalog record disappears. */
  activity: Activity;
}

/** A completed adventure, as surfaced in history and the export. */
export interface CompletedQuest {
  activityId: string;
  completedAt: string;
  reaction?: Reaction;
  reflection?: string;
  activity: Activity;
}

/** Everything the recommender needs to know about the user's past. */
export interface UserHistory {
  feedback: ActivityFeedback[];
  adventures: AdventureEntry[];
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}
