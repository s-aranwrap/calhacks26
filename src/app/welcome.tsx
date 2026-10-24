/**
 * Welcome & onboarding: one screen, no account, no questionnaire.
 * Manual location entry is the default; device location is an optional shortcut.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import type { UserLocation } from '@/core/types';
import { geocodeIfPermitted, locateDevice } from '@/services/location';
import { useApp } from '@/state/AppProvider';
import { Notice } from '@/ui/components/feedback';
import { Mascot } from '@/ui/components/Mascot';
import { AppText, Button, LinkButton, Screen } from '@/ui/components/primitives';
import { colors, fonts, radius, spacing } from '@/ui/theme';

export default function Welcome() {
  const router = useRouter();
  const { completeOnboarding } = useApp();
  const [place, setPlace] = useState('');
  const [deviceLocation, setDeviceLocation] = useState<UserLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  const trimmed = place.trim();
  const canContinue = !!deviceLocation || trimmed.length >= 2;

  async function useMyLocation() {
    setLocating(true);
    setLocationMessage(null);
    const result = await locateDevice();
    setLocating(false);
    if (result.ok) {
      setDeviceLocation(result.location);
      setPlace(result.location.label);
    } else {
      setLocationMessage(
        result.reason === 'denied'
          ? 'No problem. Just type your city or neighbourhood instead.'
          : 'Couldn’t get your location right now. Typing a place works just as well.',
      );
    }
  }

  async function letsGo() {
    if (!canContinue || saving) return;
    setSaving(true);
    let location: UserLocation;
    if (deviceLocation && trimmed === deviceLocation.label) {
      location = deviceLocation;
    } else {
      const coords = await geocodeIfPermitted(trimmed);
      location = { label: trimmed, source: 'manual', ...(coords ?? {}) };
    }
    await completeOnboarding(location);
    router.replace('/discover');
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        footer={
          <Button
            label="Let’s go"
            iconRight="arrow-forward"
            onPress={letsGo}
            disabled={!canContinue}
            loading={saving}
            accessibilityHint={canContinue ? 'Start discovering activities' : 'Enter a city or area first'}
          />
        }
      >
        <View style={styles.hero}>
          <Mascot size={150} pose="waving" accessibilityLabel="Huddle's penguin waving hello" />
          <AppText variant="display" center accessibilityRole="header">
            Huddle
          </AppText>
          <AppText variant="heading" color={colors.skyInk} center>
            Less scrolling. More living.
          </AppText>
          <AppText variant="body" center color={colors.inkSoft}>
            Tell us roughly where you are and how you feel. We’ll suggest three things worth doing, and then get out of
            your way so you can go do one.
          </AppText>
        </View>

        <View style={styles.field}>
          <AppText variant="smallStrong" nativeID="location-label">
            Where are you exploring?
          </AppText>
          <TextInput
            value={place}
            onChangeText={(text) => {
              setPlace(text);
              if (deviceLocation && text.trim() !== deviceLocation.label) setDeviceLocation(null);
            }}
            placeholder="City or neighbourhood"
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={letsGo}
            accessibilityLabel="City or neighbourhood"
            accessibilityLabelledBy="location-label"
            maxLength={80}
          />
          <LinkButton
            label={locating ? 'Finding you…' : 'Use my location instead'}
            icon="navigate-outline"
            onPress={useMyLocation}
          />
          {locationMessage ? <Notice tone="info">{locationMessage}</Notice> : null}
        </View>

        <Notice tone="offline" icon="lock-closed-outline">
          No account, no tracking. Your preferences and history stay on this phone.
        </Notice>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  field: { gap: spacing.sm },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.semibold,
    fontSize: 17,
    color: colors.ink,
  },
});
