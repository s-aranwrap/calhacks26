/** External links: maps directions for real venues. Demo venues get none. */
import { Platform } from 'react-native';

import type { Activity } from '@/core/types';

export function directionsUrl(activity: Activity): string | null {
  const v = activity.venue;
  if (!v || activity.verification.status === 'demo') return null;
  const query =
    v.latitude !== undefined && v.longitude !== undefined
      ? `${v.latitude},${v.longitude}`
      : v.address
        ? `${v.name}, ${v.address}`
        : null;
  if (!query) return null;
  const q = encodeURIComponent(query);
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Short, human name for a source link ("example.org"). */
export function sourceHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
