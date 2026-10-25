/**
 * Small, shared descriptions of an activity: category icon and label, the
 * "when" line, the source line and the "where" line.
 */
import { describeOpening } from '@/core/hours';
import { formatActivityWhen } from '@/core/time';
import type { Activity, Category, DismissReason } from '@/core/types';
import { formatDistance } from '@/core/util';

import type { IconName } from './components/primitives';
import { sourceHost } from './links';

export const CATEGORY_ICON: Record<Category, IconName> = {
  outdoors: 'leaf-outline',
  arts: 'color-palette-outline',
  music: 'musical-notes-outline',
  food: 'restaurant-outline',
  learning: 'school-outline',
  community: 'people-outline',
  wellness: 'flower-outline',
  fitness: 'bicycle-outline',
  games: 'dice-outline',
  culture: 'library-outline',
  other: 'sparkles-outline',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  outdoors: 'Outdoors',
  arts: 'Arts & making',
  music: 'Music',
  food: 'Food',
  learning: 'Learning',
  community: 'Community',
  wellness: 'Wellness',
  fitness: 'Movement',
  games: 'Games',
  culture: 'Culture',
  other: 'Something else',
};

/** "Today · 6:00 PM" for events, opening info for evergreen activities. */
export function whenText(activity: Activity, now: Date): { text: string; icon: IconName; known: boolean } {
  if (activity.kind === 'event') {
    return activity.startAt
      ? { text: formatActivityWhen(activity, now), icon: 'calendar-outline', known: !activity.allDay }
      : { text: 'Date not announced', icon: 'calendar-outline', known: false };
  }
  const opening = describeOpening(activity.openingHours, now, activity.timeZone);
  return opening
    ? { text: opening.text, icon: 'time-outline', known: true }
    : { text: 'Opening hours unknown', icon: 'time-outline', known: false };
}

export function sourceLine(activity: Activity): string {
  if (activity.verification.status === 'demo') return 'Sample data';
  return `via ${activity.source.label ?? sourceHost(activity.source.url) ?? activity.source.platform}`;
}

export function whereText(activity: Activity, distanceKm: number | undefined): string {
  const place = activity.venue?.area ?? activity.venue?.name;
  const distance = distanceKm !== undefined ? formatDistance(distanceKm) : undefined;
  if (place && distance) return `${distance} · ${place}`;
  return place ?? distance ?? 'Location not listed';
}

export const DISMISS_REASONS: { reason: DismissReason; label: string }[] = [
  { reason: 'too_expensive', label: 'Too expensive' },
  { reason: 'too_far', label: 'Too far away' },
  { reason: 'wrong_timing', label: 'Wrong timing' },
  { reason: 'unavailable', label: 'Not available / full' },
  { reason: 'not_my_thing', label: 'Not my thing' },
];
