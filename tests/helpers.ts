/** Test factories. Keep fixtures tiny and explicit so each test reads on its own. */
import type { DiscoveryRequest, RecommendationPreferences } from '../src/core/recommend.ts';
import type { Activity, ActivityFeedback, AdventureEntry, UserHistory } from '../src/core/types.ts';

export const NOW = new Date('2026-11-04T15:00:00.000Z');
export const ORIGIN = { latitude: 51.5, longitude: -0.12 };

let counter = 0;

/** A plain, eligible evergreen activity close to ORIGIN. Override what the test cares about. */
export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  counter++;
  return {
    id: overrides.id ?? `a${counter}`,
    kind: 'evergreen',
    title: `Activity ${counter}`,
    description: 'Test activity',
    category: 'outdoors',
    moods: ['chill'],
    tags: [],
    venue: { name: `Venue ${counter}`, latitude: ORIGIN.latitude + 0.005, longitude: ORIGIN.longitude },
    duration: { minMinutes: 60, certainty: 'estimated' },
    price: { minAmount: 0, currency: 'USD', certainty: 'estimated' },
    source: { platform: 'manual' },
    verification: { status: 'unverified' },
    availability: 'unknown',
    ...overrides,
  };
}

export function makeEvent(hoursFromNow: number, overrides: Partial<Activity> = {}): Activity {
  const start = new Date(NOW.getTime() + hoursFromNow * 3_600_000).toISOString();
  return makeActivity({ kind: 'event', startAt: start, ...overrides });
}

export function request(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return {
    mood: 'chill',
    budget: 'any',
    maxDistanceKm: null,
    availableMinutes: null,
    origin: ORIGIN,
    now: NOW,
    seed: 42,
    ...overrides,
  };
}

export const PREFS: RecommendationPreferences = {
  interests: [],
  nudge: 'balanced',
  includeUnverified: true,
  currency: 'USD',
};

export const EMPTY_HISTORY: UserHistory = { feedback: [], adventures: [] };

export function dismissal(activity: Activity, reason: ActivityFeedback['reason'], daysAgo = 0): ActivityFeedback {
  return {
    id: `fb-${activity.id}-${daysAgo}`,
    activityId: activity.id,
    kind: 'dismissed',
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    context: {
      category: activity.category,
      tags: activity.tags,
      ...(activity.price ? { priceMin: activity.price.minAmount } : {}),
      ...(activity.startAt ? { startAt: activity.startAt } : {}),
    },
    ...(reason ? { reason } : {}),
  };
}

export function adventure(
  activity: Activity,
  status: AdventureEntry['status'],
  extra: Partial<AdventureEntry> = {},
): AdventureEntry {
  const iso = NOW.toISOString();
  return {
    activityId: activity.id,
    status,
    updatedAt: iso,
    activity,
    ...(status === 'completed' ? { completedAt: iso } : {}),
    ...extra,
  };
}

/** km → degrees of latitude, for placing venues at known distances north of ORIGIN. */
export function north(km: number) {
  return { latitude: ORIGIN.latitude + km / 111.2, longitude: ORIGIN.longitude };
}
