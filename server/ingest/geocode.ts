/**
 * Optional geocoding of venue names (from Instagram location tags) using
 * OpenStreetMap's Nominatim service, restricted to a bounding box so
 * "The Chapel" resolves inside San Francisco rather than anywhere on Earth.
 *
 * Nominatim's usage policy: max 1 request per second, an identifying
 * User-Agent, and cache results. All three are handled here. Results are
 * cached in a JSON file so re-runs don't repeat lookups.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Roughly the city of San Francisco. */
export const SF_BOUNDS: BoundingBox = { west: -122.52, south: 37.7, east: -122.35, north: 37.84 };

export type GeoHit = { latitude: number; longitude: number; displayName: string } | null;

export interface GeocoderOptions {
  bounds: BoundingBox;
  cacheFile?: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
}

export function createGeocoder(options: GeocoderOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minInterval = options.minIntervalMs ?? 1100;
  const cache: Record<string, GeoHit> =
    options.cacheFile && existsSync(options.cacheFile) ? JSON.parse(readFileSync(options.cacheFile, 'utf8')) : {};
  let lastRequest = 0;

  const inBounds = (lat: number, lng: number) =>
    lat >= options.bounds.south &&
    lat <= options.bounds.north &&
    lng >= options.bounds.west &&
    lng <= options.bounds.east;

  async function lookup(query: string): Promise<GeoHit> {
    const key = query.trim().toLowerCase();
    if (!key) return null;
    if (key in cache) return cache[key] ?? null;

    const wait = lastRequest + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();

    const b = options.bounds;
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '1',
      bounded: '1',
      viewbox: `${b.west},${b.north},${b.east},${b.south}`,
    });
    let hit: GeoHit = null;
    try {
      const response = await fetchImpl(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { 'User-Agent': options.userAgent, Accept: 'application/json' },
      });
      if (response.ok) {
        const rows = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[];
        const first = Array.isArray(rows) ? rows[0] : undefined;
        const lat = Number(first?.lat);
        const lng = Number(first?.lon);
        if (first && Number.isFinite(lat) && Number.isFinite(lng) && inBounds(lat, lng)) {
          hit = { latitude: lat, longitude: lng, displayName: first.display_name ?? query };
        }
      } else if (response.status === 429 || response.status >= 500) {
        return null; // transient: don't cache, try again next run
      }
    } catch {
      return null; // offline: don't cache
    }
    cache[key] = hit;
    return hit;
  }

  return {
    lookup,
    save() {
      if (options.cacheFile) writeFileSync(options.cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
    },
  };
}
