/**
 * Activity details and commitment. Facts are grouped as When, Where, Cost,
 * What to know and Source, with estimated and unknown values labelled.
 * "Let's Adventure!" plans it (one plan at a time; replacing one asks first),
 * "Maybe" just goes back, and "Not for me" passes it for this session.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { assessAvailability } from '@/core/availability';
import type { Activity } from '@/core/types';
import { focusAdventure, useApp } from '@/state/AppProvider';
import { ActivityImage } from '@/ui/components/ActivityImage';
import { DetailsBody } from '@/ui/components/ActivityDetails';
import { Notice, StateView } from '@/ui/components/feedback';
import { Mascot } from '@/ui/components/Mascot';
import { AppText, Button, Icon, LinkButton, Row, Screen, TopBar } from '@/ui/components/primitives';
import { colors, radius, spacing } from '@/ui/theme';

export default function ActivityDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const [committed, setCommitted] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const activity = id ? app.findActivity(id) : null;
  if (!activity) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <StateView
          title="This activity isn’t available"
          message="It may have been removed from the catalog."
          actions={<Button label="Back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const now = new Date();
  const entry = app.entryFor(activity.id);
  const recommendation = app.discovery?.result.recommendations.find((r) => r.activity.id === activity.id);
  const passed = !!app.discovery?.dismissedIds.includes(activity.id);
  const availability = assessAvailability(activity, now);
  const backToDiscover = () => router.dismissTo('/discover');

  if (committed) {
    return (
      <Screen
        footer={
          <>
            <Button
              label="View My Adventure"
              iconRight="arrow-forward"
              onPress={() => router.replace({ pathname: '/adventure/[id]', params: { id: activity.id } })}
            />
            <Button label="Back to Discover" variant="ghost" onPress={backToDiscover} />
          </>
        }
      >
        <View style={styles.success} accessibilityLiveRegion="polite">
          <Mascot size={150} pose="cheering" accessibilityLabel="The Huddle penguin cheering" />
          <AppText variant="title" center accessibilityRole="header">
            It’s happening! 🎉
          </AppText>
          <AppText variant="body" center>
            {activity.title} is your next adventure.
          </AppText>
          <AppText variant="small" center>
            {activity.restrictions && /reserv|book|ticket|rsvp|regist/i.test(activity.restrictions)
              ? 'Heads up: this one needs a booking or reservation. Planning it in Huddle doesn’t book anything, so sort that with the organizer.'
              : 'Planning it in Huddle doesn’t buy tickets or make a reservation. Check the source if you need to book.'}
          </AppText>
        </View>
      </Screen>
    );
  }

  async function open(url: string) {
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError('Couldn’t open that link on this device.');
    }
  }

  async function commitTo(target: Activity, replacing: string | null) {
    if (committing.current) return;
    committing.current = true;
    setBusy(true);
    try {
      if (replacing) await app.replacePlan(replacing, target);
      else await app.plan(target);
      setCommitted(true);
    } finally {
      committing.current = false;
      setBusy(false);
    }
  }

  function letsAdventure() {
    if (!activity || committing.current) return;
    const current = focusAdventure(app.history.adventures);
    if (current && current.activityId !== activity.id) {
      Alert.alert(
        'Replace your current plan?',
        `You’re already planning “${current.activity.title}”. Huddle keeps one adventure at a time, so this would replace it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Keep current plan', onPress: () => router.back() },
          { text: 'Replace my plan', style: 'destructive', onPress: () => void commitTo(activity, current.activityId) },
        ],
      );
      return;
    }
    void commitTo(activity, null);
  }

  function notForMe() {
    if (recommendation && !passed) void app.dismiss(recommendation, 'not_my_thing');
    router.back();
  }

  const footer =
    entry?.status === 'planned' ? (
      <Button
        label="Open my adventure"
        iconRight="arrow-forward"
        onPress={() => router.replace({ pathname: '/adventure/[id]', params: { id: activity.id } })}
      />
    ) : entry?.status === 'completed' ? (
      <Button
        label="You did this. See your reflection"
        variant="soft"
        icon="checkmark-circle-outline"
        onPress={() => router.replace({ pathname: '/adventure/[id]', params: { id: activity.id } })}
      />
    ) : (
      <>
        <View style={styles.commitHeading}>
          <AppText variant="bodyStrong">Ready to do this? 🐧</AppText>
          <AppText variant="small">Make it your next adventure.</AppText>
        </View>
        <Button
          label="Let’s Adventure!"
          icon="flag-outline"
          onPress={letsAdventure}
          loading={busy}
          disabled={!availability.viable}
          accessibilityHint={
            availability.viable ? 'Plans this as your next adventure' : `${availability.label}, so it can’t be planned`
          }
        />
        <Row gap={spacing.sm}>
          <Button
            label="Maybe"
            variant="secondary"
            compact
            style={styles.flex}
            onPress={() => router.back()}
            accessibilityHint="Goes back without planning or saving"
          />
          <Button
            label={passed ? 'Passed' : 'Not for me'}
            variant="ghost"
            compact
            style={styles.flex}
            disabled={passed}
            onPress={notForMe}
            accessibilityHint="Passes on this idea and goes back"
          />
        </Row>
      </>
    );

  return (
    <Screen footer={footer}>
      <TopBar onBack={() => router.back()} />
      <ActivityImage activity={activity} rounded="all" aspectRatio={16 / 10} />
      <DetailsBody activity={activity} now={now} distance={recommendation?.distanceKm} onOpen={open} />
      {recommendation?.reasons.length ? (
        <View style={styles.why}>
          <AppText variant="smallStrong" color={colors.blushInk}>
            Why Huddle suggested it
          </AppText>
          {recommendation.reasons.map((reason) => (
            <Row key={reason} gap={spacing.sm}>
              <Icon name="sparkles" size={14} color={colors.blushInk} />
              <AppText variant="small" color={colors.blushInk} style={styles.shrink}>
                {reason}
              </AppText>
            </Row>
          ))}
        </View>
      ) : null}
      {linkError ? <Notice tone="warning">{linkError}</Notice> : null}
      {!entry || entry.status === 'saved' ? (
        <LinkButton
          label={entry ? 'Saved for later. Tap to remove' : 'Save for later'}
          icon={entry ? 'bookmark' : 'bookmark-outline'}
          onPress={() => void (entry ? app.unsave(activity.id) : app.save(activity))}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  why: { gap: spacing.sm, backgroundColor: colors.blushTint, borderRadius: radius.md, padding: spacing.md },
  commitHeading: { gap: 2 },
  success: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl * 2 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
});
