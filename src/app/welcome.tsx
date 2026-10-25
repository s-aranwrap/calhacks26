/**
 * Welcome: one screen, no account, no questionnaire. Location is optional;
 * device location is only requested when the user taps "Use my location".
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { useApp } from '@/state/AppProvider';
import { LocationField, useLocationEntry } from '@/ui/components/LocationField';
import { Mascot } from '@/ui/components/Mascot';
import { AppText, Button, Screen } from '@/ui/components/primitives';
import { colors, fonts, spacing } from '@/ui/theme';

export default function Welcome() {
  const router = useRouter();
  const { completeOnboarding, preferences } = useApp();
  const entry = useLocationEntry(preferences.location);
  const [saving, setSaving] = useState(false);

  async function explore() {
    if (saving) return;
    setSaving(true);
    try {
      await completeOnboarding(await entry.resolve());
      router.replace('/discover');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        footer={
          <Button
            label="Ready to explore?"
            iconRight="arrow-forward"
            onPress={() => void explore()}
            loading={saving}
            accessibilityHint="Opens Discover. A location is optional."
          />
        }
      >
        <View style={styles.hero}>
          <Mascot size={168} pose="waving" accessibilityLabel="The Huddle penguin waving hello" />
          <AppText variant="display" center accessibilityRole="header">
            Huddle
          </AppText>
          <AppText variant="heading" color={colors.primaryInk} center style={styles.tagline}>
            Less wondering. More waddling.
          </AppText>
          <AppText variant="body" center color={colors.inkSoft}>
            Find something fun to do. Then go do it.
          </AppText>
        </View>

        <View style={styles.location}>
          <LocationField entry={entry} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  tagline: { fontFamily: fonts.bold },
  location: { marginTop: spacing.lg },
});
