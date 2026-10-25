/**
 * Small, dependency-free helpers shared by the core modules.
 */
import type { GeoPoint } from './types.ts';

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

/** Returns epoch millis for a valid ISO-ish date string, otherwise undefined. */
export function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/**
 * FNV-1a 32-bit hash rendered as hex. Used for deterministic IDs. Not cryptographic,
 * which is fine: IDs only need to be stable and well-spread, not secret.
 */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Lowercase, strip accents and punctuation, collapse whitespace. Used for fuzzy matching. */
export function normalizeText(value: string): string {
  let decomposed = value;
  try {
    // Splits accented letters into base letter + combining mark (é → e + ´).
    decomposed = value.normalize('NFKD');
  } catch {
    // Some JS engines lack full Unicode normalization; matching still works without it.
  }
  return decomposed
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Seeded pseudo-random generator (mulberry32). The recommender uses it so
 * "Surprise me" varies between sessions but stays reproducible in tests.
 */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Formats a distance (given in km) in miles for humans: "0.3 mi", "2.4 mi", "15 mi". */
export function formatDistance(km: number): string {
  const miles = km / 1.609344;
  if (miles < 10) return `${Math.max(0.1, Math.round(miles * 10) / 10)} mi`;
  return `${Math.round(miles)} mi`;
}

/** Formats minutes as "45 min", "1.5 hr", "3 hr". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}

/** Unique ID for locally created records (feedback rows). Not used for catalog IDs. */
export function localId(prefix: string, now: number = Date.now()): string {
  return `${prefix}_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
