/**
 * Deduplication across sources.
 *
 * Two records are considered the same listing when any of these match:
 *  1. same platform + source ID (e.g. the same Instagram shortcode),
 *  2. same canonical source URL (tracking params, www., trailing slashes ignored),
 *  3. same fingerprint: normalized title + start minute (or "evergreen") + venue.
 *
 * When duplicates collide we keep the most trustworthy record and only fill
 * its *missing* optional fields from the others; we never overwrite a value.
 */
import type { Activity, VerificationStatus } from './types.ts';
import { canonicalizeUrl } from './urls.ts';
import { normalizeText } from './util.ts';

export interface DuplicateReport {
  keptId: string;
  droppedId: string;
  matchedOn: 'source_id' | 'url' | 'fingerprint' | 'id';
}

export function dedupeKeys(activity: Activity): { key: string; kind: DuplicateReport['matchedOn'] }[] {
  const keys: { key: string; kind: DuplicateReport['matchedOn'] }[] = [{ key: `id:${activity.id}`, kind: 'id' }];
  if (activity.source.sourceId) {
    keys.push({ key: `src:${activity.source.platform}:${activity.source.sourceId}`, kind: 'source_id' });
  }
  const canonical = canonicalizeUrl(activity.source.url);
  if (canonical) keys.push({ key: `url:${canonical}`, kind: 'url' });
  const venueKey = activity.venue
    ? normalizeText(activity.venue.name) ||
      (activity.venue.latitude !== undefined && activity.venue.longitude !== undefined
        ? `${activity.venue.latitude.toFixed(3)},${activity.venue.longitude.toFixed(3)}`
        : '')
    : '';
  const when = activity.kind === 'event' ? (activity.startAt?.slice(0, 16) ?? 'undated') : 'evergreen';
  keys.push({ key: `fp:${normalizeText(activity.title)}|${when}|${venueKey}`, kind: 'fingerprint' });
  return keys;
}

const STATUS_RANK: Record<VerificationStatus, number> = { verified: 3, unverified: 2, demo: 1, candidate: 0 };

function completeness(a: Activity): number {
  return [
    a.venue?.address,
    a.venue?.latitude,
    a.price,
    a.duration,
    a.startAt,
    a.source.url,
    a.whatToExpect,
    a.imageUrl,
  ].filter((v) => v !== undefined).length;
}

/** Higher is better: verification status, then freshness of last check, then completeness. */
export function compareQuality(a: Activity, b: Activity): number {
  const status = STATUS_RANK[a.verification.status] - STATUS_RANK[b.verification.status];
  if (status !== 0) return status;
  const checkedA = Date.parse(a.verification.lastCheckedAt ?? '') || 0;
  const checkedB = Date.parse(b.verification.lastCheckedAt ?? '') || 0;
  if (checkedA !== checkedB) return checkedA - checkedB;
  return completeness(a) - completeness(b);
}

/** Fill only missing optional fields of `primary` from `secondary`. */
function fillMissing(primary: Activity, secondary: Activity): Activity {
  const merged: Activity = { ...primary };
  if (!merged.venue && secondary.venue) merged.venue = secondary.venue;
  else if (merged.venue && secondary.venue) {
    merged.venue = { ...merged.venue };
    if (merged.venue.address === undefined && secondary.venue.address !== undefined)
      merged.venue.address = secondary.venue.address;
    if (merged.venue.area === undefined && secondary.venue.area !== undefined) merged.venue.area = secondary.venue.area;
    if (
      merged.venue.latitude === undefined &&
      secondary.venue.latitude !== undefined &&
      secondary.venue.longitude !== undefined
    ) {
      merged.venue.latitude = secondary.venue.latitude;
      merged.venue.longitude = secondary.venue.longitude;
    }
  }
  if (!merged.description && secondary.description) merged.description = secondary.description;
  if (!merged.duration && secondary.duration) merged.duration = secondary.duration;
  if (!merged.price && secondary.price) merged.price = secondary.price;
  if (!merged.imageUrl && secondary.imageUrl) merged.imageUrl = secondary.imageUrl;
  if (!merged.whatToExpect && secondary.whatToExpect) merged.whatToExpect = secondary.whatToExpect;
  if (!merged.whyTry && secondary.whyTry) merged.whyTry = secondary.whyTry;
  if (!merged.openingHours && secondary.openingHours) merged.openingHours = secondary.openingHours;
  if (!merged.source.url && secondary.source.url) merged.source = { ...merged.source, url: secondary.source.url };
  if (merged.tags.length === 0 && secondary.tags.length) merged.tags = secondary.tags;
  return merged;
}

export interface DedupeResult {
  activities: Activity[];
  duplicates: DuplicateReport[];
}

/**
 * Removes duplicates while preserving the input order of the surviving records.
 * O(n) with a key index; groups are merged transitively.
 */
export function dedupeActivities(input: readonly Activity[]): DedupeResult {
  const kept: Activity[] = [];
  const keyToIndex = new Map<string, number>();
  const duplicates: DuplicateReport[] = [];

  for (const candidate of input) {
    const keys = dedupeKeys(candidate);
    const hit = keys.find((k) => keyToIndex.has(k.key));
    if (!hit) {
      const index = kept.push(candidate) - 1;
      for (const k of keys) keyToIndex.set(k.key, index);
      continue;
    }
    const index = keyToIndex.get(hit.key)!;
    const existing = kept[index]!;
    const candidateWins = compareQuality(candidate, existing) > 0;
    const winner = candidateWins ? fillMissing(candidate, existing) : fillMissing(existing, candidate);
    kept[index] = winner;
    duplicates.push({
      keptId: winner.id,
      droppedId: candidateWins ? existing.id : candidate.id,
      matchedOn: hit.kind,
    });
    // Index the merged record under every key either side had.
    for (const k of [...keys, ...dedupeKeys(winner)]) keyToIndex.set(k.key, index);
  }

  return { activities: kept, duplicates };
}
