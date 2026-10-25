/**
 * Optional location entry, shared by Welcome, the Discover header and
 * Settings. Typing a place is the default; device location is requested only
 * when the user taps "Use my location", after a one-line explanation.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { UserLocation } from '@/core/types';
import { geocodeIfPermitted, locateDevice } from '@/services/location';

import { colors, fonts, gutter, radius, spacing } from '../theme';
import { Notice } from './feedback';
import { AppText, Button, LinkButton } from './primitives';

type LocateStatus = 'idle' | 'locating' | 'denied' | 'unavailable' | 'found';

export interface LocationEntry {
  place: string;
  setPlace: (text: string) => void;
  status: LocateStatus;
  locateMe: () => Promise<void>;
  /** The location to store: the device fix if the text still matches it, else the typed place, else null. */
  resolve: () => Promise<UserLocation | null>;
}

export function useLocationEntry(initial: UserLocation | null): LocationEntry {
  const [place, setPlaceText] = useState(initial?.label ?? '');
  const [device, setDevice] = useState<UserLocation | null>(initial?.source === 'device' ? initial : null);
  const [status, setStatus] = useState<LocateStatus>('idle');

  function setPlace(text: string) {
    setPlaceText(text);
    if (device && text.trim() !== device.label) setDevice(null);
    if (status !== 'locating') setStatus('idle');
  }

  async function locateMe() {
    setStatus('locating');
    const result = await locateDevice();
    if (result.ok) {
      setDevice(result.location);
      setPlaceText(result.location.label);
      setStatus('found');
    } else {
      setStatus(result.reason);
    }
  }

  async function resolve(): Promise<UserLocation | null> {
    const label = place.trim();
    if (device && label === device.label) return device;
    if (label.length < 2) return null;
    // Keep coordinates we already had for the same label (e.g. re-saving an unchanged place).
    if (initial && initial.label === label) return initial;
    const coords = await geocodeIfPermitted(label);
    return { label, source: 'manual', ...(coords ?? {}) };
  }

  return { place, setPlace, status, locateMe, resolve };
}

export function LocationField({
  entry,
  label = 'Where are you exploring?',
  onSubmit,
}: {
  entry: LocationEntry;
  label?: string;
  onSubmit?: () => void;
}) {
  const { place, setPlace, status, locateMe } = entry;
  return (
    <View style={styles.field}>
      <AppText variant="bodyStrong" nativeID="location-label">
        {label}
      </AppText>
      <TextInput
        value={place}
        onChangeText={setPlace}
        placeholder="Enter a city or area"
        placeholderTextColor={colors.inkMuted}
        style={styles.input}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="off"
        textContentType="addressCity"
        returnKeyType="done"
        {...(onSubmit ? { onSubmitEditing: onSubmit } : {})}
        accessibilityLabel="City or area"
        accessibilityHint="Optional. Helps Huddle estimate distances."
        accessibilityLabelledBy="location-label"
        maxLength={80}
      />
      <LinkButton
        label={status === 'locating' ? 'Finding you…' : 'Use my location'}
        icon="navigate-outline"
        onPress={() => void locateMe()}
      />
      {status === 'idle' || status === 'found' ? (
        <AppText variant="caption">
          {status === 'found'
            ? 'Got it. Your location stays on this phone.'
            : 'Optional. Your location helps estimate distances and stays on this phone.'}
        </AppText>
      ) : null}
      {status === 'denied' ? (
        <Notice tone="info">
          <AppText variant="small" color={colors.skyInk}>
            No problem. Typing a city or area works just as well.
          </AppText>
          {Platform.OS !== 'web' ? (
            <LinkButton
              label="Open Settings to allow location"
              icon="settings-outline"
              color={colors.skyInk}
              onPress={() => void Linking.openSettings().catch(() => undefined)}
            />
          ) : null}
        </Notice>
      ) : null}
      {status === 'unavailable' ? (
        <Notice tone="info">Couldn’t get your location right now. Typing a place works just as well.</Notice>
      ) : null}
    </View>
  );
}

/** A small bottom sheet for editing the location from the Discover header. */
export function LocationSheet({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: UserLocation | null;
  onClose: () => void;
  onSave: (location: UserLocation | null) => Promise<void>;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Remount per opening so the field starts from the saved value. */}
      {visible ? <LocationSheetBody initial={initial} onClose={onClose} onSave={onSave} /> : null}
    </Modal>
  );
}

function LocationSheetBody({
  initial,
  onClose,
  onSave,
}: {
  initial: UserLocation | null;
  onClose: () => void;
  onSave: (location: UserLocation | null) => Promise<void>;
}) {
  const entry = useLocationEntry(initial);
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  async function save() {
    setSaving(true);
    try {
      await onSave(await entry.resolve());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} accessibilityViewIsModal>
        <AppText variant="heading" accessibilityRole="header">
          Change location
        </AppText>
        <LocationField entry={entry} onSubmit={() => void save()} />
        <Button label="Save location" onPress={() => void save()} loading={saving} />
        <Button label="Cancel" variant="ghost" onPress={onClose} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.medium,
    fontSize: 17,
    color: colors.ink,
  },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(36, 52, 71, 0.35)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
});
