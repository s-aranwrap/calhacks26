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
import { SF_PLACE_HOURS, type PlaceHours } from './sfHours.ts';
import { SF_PLACE_HOURS_GENERATED } from './sfHours.generated.ts';
import { SF_INSTAGRAM_GENERATED_AT, SF_INSTAGRAM_RECORDS } from './sfInstagram.generated.ts';
import { nextOccurrence, SF_RECURRING_EVENTS } from './sfRecurring.ts';

export interface CityPack {
  city: string;
  /** Where distances are measured from until the user shares their location. */
  center: GeoPoint;
  centerLabel: string;
  /** When the Instagram events were last refreshed, if ever. */
  eventsUpdatedAt: string | null;
  records: (now: Date) => readonly unknown[];
}

/** Adds opening hours to place records; generated (Google Maps) hours win over hand-researched ones. */
export function withHours(
  records: readonly Record<string, unknown>[],
  ...tables: Record<string, PlaceHours>[]
): Record<string, unknown>[] {
  return records.map((record) => {
    const id = typeof record.id === 'string' ? record.id : '';
    const found = tables.map((t) => t[id]).find((h) => h !== undefined);
    return found ? { ...record, opening_hours: found.hours, opening_hours_source: found.source } : record;
  });
}

export const SF_PACK: CityPack = {
  city: 'San Francisco',
  center: { latitude: 37.788, longitude: -122.4075 },
  centerLabel: 'Union Square',
  eventsUpdatedAt: SF_INSTAGRAM_GENERATED_AT,
  records: (now) => [
    ...withHours(SF_EVERGREEN_RECORDS, SF_PLACE_HOURS_GENERATED, SF_PLACE_HOURS),
    ...SF_RECURRING_EVENTS.map((e) => nextOccurrence(e, now)),
    ...SF_INSTAGRAM_RECORDS,
  ],
};

export function buildPackCatalog(pack: CityPack, now: Date): Activity[] {
  const activities: Activity[] = [];
  for (const record of pack.records(now)) {
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
