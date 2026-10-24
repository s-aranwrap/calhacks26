/**
 * Demo catalog adapter: works instantly, offline, with no credentials.
 * Runs the bundled sample records through the same normalize + dedupe
 * pipeline as every other source.
 */
import { dedupeActivities } from '../../core/dedupe.ts';
import { normalizeActivity } from '../../core/normalize.ts';
import type { ActivityRepository } from '../../core/ports.ts';
import type { Activity } from '../../core/types.ts';
import { buildDemoRecords } from '../fixtures/demoActivities.ts';

export interface DemoRepositoryOptions {
  now?: () => Date;
  currency?: () => string;
}

export function buildDemoCatalog(now: Date, currency = 'USD'): Activity[] {
  const activities: Activity[] = [];
  for (const record of buildDemoRecords(now, currency)) {
    const result = normalizeActivity(record, { platform: 'demo', now, defaultCurrency: currency });
    if (result.ok) activities.push(result.activity);
  }
  return dedupeActivities(activities).activities;
}

export function createDemoRepository(options: DemoRepositoryOptions = {}): ActivityRepository {
  const now = options.now ?? (() => new Date());
  const currency = options.currency ?? (() => 'USD');
  return {
    name: 'demo',
    async listActivities() {
      return buildDemoCatalog(now(), currency());
    },
  };
}
