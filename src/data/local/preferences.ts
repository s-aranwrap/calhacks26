/**
 * Preference defaults and validation. Stored preferences are re-validated on
 * every read so an old or hand-edited value can't put the app in a bad state.
 */
import {
  CATEGORIES,
  type BudgetLevel,
  type Category,
  type NudgeLevel,
  type UserLocation,
  type UserPreferences,
} from '../../core/types.ts';
import { isValidLatitude, isValidLongitude } from '../../core/util.ts';

export const DISTANCE_OPTIONS_KM: readonly (number | null)[] = [2, 5, 10, null];
export const TIME_OPTIONS_MINUTES: readonly (number | null)[] = [60, 120, 240, null];
export const BUDGET_OPTIONS: readonly BudgetLevel[] = ['free', 'low', 'medium', 'any'];
export const NUDGE_OPTIONS: readonly NudgeLevel[] = ['gentle', 'balanced', 'bold'];
export const CURRENCY_OPTIONS: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
];

export const DEFAULT_PREFERENCES: UserPreferences = {
  location: null,
  interests: [],
  budget: 'medium',
  maxDistanceKm: 5,
  availableMinutes: 120,
  nudge: 'balanced',
  includeUnverified: true,
  currency: 'USD',
};

function sanitizeLocation(value: unknown): UserLocation | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<UserLocation>;
  const label = typeof v.label === 'string' ? v.label.trim().slice(0, 80) : '';
  if (!label) return null;
  const source = v.source === 'device' || v.source === 'demo' ? v.source : 'manual';
  const hasCoords = isValidLatitude(v.latitude) && isValidLongitude(v.longitude);
  return { label, source, ...(hasCoords ? { latitude: v.latitude!, longitude: v.longitude! } : {}) };
}

export function sanitizePreferences(value: unknown): UserPreferences {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<UserPreferences>;
  const interests = Array.isArray(v.interests)
    ? [...new Set(v.interests.filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c as string)))]
    : [];
  return {
    location: sanitizeLocation(v.location),
    interests,
    budget: BUDGET_OPTIONS.includes(v.budget as BudgetLevel) ? (v.budget as BudgetLevel) : DEFAULT_PREFERENCES.budget,
    maxDistanceKm:
      v.maxDistanceKm === null || (typeof v.maxDistanceKm === 'number' && v.maxDistanceKm > 0 && v.maxDistanceKm <= 500)
        ? (v.maxDistanceKm ?? null)
        : DEFAULT_PREFERENCES.maxDistanceKm,
    availableMinutes:
      v.availableMinutes === null ||
      (typeof v.availableMinutes === 'number' && v.availableMinutes > 0 && v.availableMinutes <= 24 * 60)
        ? (v.availableMinutes ?? null)
        : DEFAULT_PREFERENCES.availableMinutes,
    nudge: NUDGE_OPTIONS.includes(v.nudge as NudgeLevel) ? (v.nudge as NudgeLevel) : DEFAULT_PREFERENCES.nudge,
    includeUnverified:
      typeof v.includeUnverified === 'boolean' ? v.includeUnverified : DEFAULT_PREFERENCES.includeUnverified,
    currency:
      typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency) ? v.currency : DEFAULT_PREFERENCES.currency,
    ...(typeof v.onboardedAt === 'string' ? { onboardedAt: v.onboardedAt } : {}),
  };
}
