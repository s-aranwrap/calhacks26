/**
 * Optional device location. Manual entry is the default; GPS is only
 * requested when the user taps "Use my location". Coordinates are stored on
 * the device and used only for on-device distance estimates.
 */
import * as Location from 'expo-location';

import type { UserLocation } from '@/core/types';

export type LocateResult = { ok: true; location: UserLocation } | { ok: false; reason: 'denied' | 'unavailable' };

export async function locateDevice(): Promise<LocateResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'denied' };
    const position =
      (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    const { latitude, longitude } = position.coords;

    let label = 'Near me';
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      label = place?.city ?? place?.district ?? place?.subregion ?? place?.region ?? label;
    } catch {
      // Reverse geocoding may need a network connection; the coordinates are enough.
    }
    return { ok: true, location: { label, latitude, longitude, source: 'device' } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Best-effort coordinates for a typed place name. Only attempted when the user
 * has already granted location permission (Android requires it for the
 * platform geocoder), and it usually needs a network connection. Returns
 * null rather than guessing.
 */
export async function geocodeIfPermitted(text: string): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const [result] = await Location.geocodeAsync(text);
    return result ? { latitude: result.latitude, longitude: result.longitude } : null;
  } catch {
    return null;
  }
}
