/**
 * Bundled city packs. A pack ships with the app, so the demo works offline
 * and without Supabase. When a pack is present it replaces the fictional
 * Pebblewick sample data.
 */
import { dedupeActivities } from '../../core/dedupe.ts';
import { normalizeActivity } from '../../core/normalize.ts';
import type { ActivityRepository } from '../../core/ports.ts';
import type { Activity, GeoPoint } from '../../core/types.ts';
import { SF_EVERGREEN_RECORDS } from './sfEvergreen.ts';
import { SF_INSTAGRAM_GENERATED_AT, SF_INSTAGRAM_RECORDS } from './sfInstagram.generated.ts';

export interface CityPack {
  city: string;
  /** Where distances are measured from until the user shares their location. */
  center: GeoPoint;
  centerLabel: string;
  /** When the Instagram events were last refreshed, if ever. */
  eventsUpdatedAt: string | null;
  records: () => readonly unknown[];
}

export const SF_PACK: CityPack = {
  city: 'San Francisco',
  center: { latitude: 37.788, longitude: -122.4075 },
  centerLabel: 'Union Square',
  eventsUpdatedAt: SF_INSTAGRAM_GENERATED_AT,
  records: () => [...SF_EVERGREEN_RECORDS, ...SF_INSTAGRAM_RECORDS],
};

export function buildPackCatalog(pack: CityPack, now: Date): Activity[] {
  const activities: Activity[] = [];
  for (const record of pack.records()) {
    const result = normalizeActivity(record, { platform: 'json', now, defaultCurrency: 'USD' });
    if (result.ok) activities.push(result.activity);
  }
  return dedupeActivities(activities).activities;
}

export function createPackRepository(pack: CityPack, now: () => Date = () => new Date()): ActivityRepository {
  return {
    name: `pack:${pack.city}`,
    async listActivities() {
      return buildPackCatalog(pack, now());
    },
  };
}
