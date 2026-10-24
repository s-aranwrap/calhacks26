/**
 * Activity details: everything needed to decide, with verified, estimated
 * and unknown facts clearly distinguished. The primary action commits
 * ("I'm going" / "I'll try this") and switches to the focused adventure view.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { assessAvailability } from '@/core/availability';
import { assessChallenge, CHALLENGE_LABEL } from '@/core/challenge';
import { formatDuration, formatPrice } from '@/core/format';
import { formatCheckedAgo, isValidTimeZone } from '@/core/time';
import { distanceKm, formatDistance } from '@/core/util';
import { useApp } from '@/state/AppProvider';
import { ChallengeBadge, FactRow, Notice, StateView, TrustBadge } from '@/ui/components/feedback';
import { AppText, Button, Card, Icon, Row, Screen, Section, TopBar } from '@/ui/components/primitives';
import { CATEGORY_ICON, CATEGORY_LABEL, whenText } from '@/ui/components/QuestCard';
import { directionsUrl, sourceHost } from '@/ui/links';
import { colors, radius, spacing, touchTarget } from '@/ui/theme';

export default function ActivityDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const app = useApp();
  const [busy, setBusy] = useState(false);
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
  const availability = assessAvailability(activity, now);
  const challenge = assessChallenge(activity);
  const price = formatPrice(activity.price);
  const duration = formatDuration(activity.duration);
  const when = whenText(activity, now);
  const distance =
    recommendation?.distanceKm ??
    (app.origin && activity.venue?.latitude !== undefined && activity.venue.longitude !== undefined
      ? distanceKm(app.origin, { latitude: activity.venue.latitude, longitude: activity.venue.longitude })
      : undefined);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showZone = activity.kind === 'event' && isValidTimeZone(activity.timeZone) && activity.timeZone !== deviceZone;
  const directions = directionsUrl(activity);
  const isDemo = activity.verification.status === 'demo';
  const checked = formatCheckedAgo(activity.verification.lastCheckedAt, now);

  async function open(url: string) {
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError('Couldn’t open that link on this device.');
    }
  }

  async function commit() {
    if (!activity) return;
    setBusy(true);
    try {
      await app.plan(activity);
      router.replace({ pathname: '/adventure/[id]', params: { id: activity.id } });
    } finally {
      setBusy(false);
    }
  }

  const saved = !!entry;
  const primary =
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
      <Button
        label={activity.kind === 'event' ? 'I’m going' : 'I’ll try this'}
        icon="flag-outline"
        onPress={commit}
        loading={busy}
        disabled={!availability.viable}
        accessibilityHint="Adds this to your plans and focuses the app on it"
      />
    );

  return (
    <Screen
      footer={
        <>
          {primary}
          {!entry || entry.status === 'saved' ? (
            <Button
              label={saved ? 'Saved for later' : 'Save for later'}
              variant="secondary"
              icon={saved ? 'bookmark' : 'bookmark-outline'}
              onPress={() => void (saved ? app.unsave(activity.id) : app.save(activity))}
              accessibilityHint={saved ? 'Removes it from Saved' : 'Keeps it in My adventures without committing'}
            />
          ) : null}
        </>
      }
    >
      <TopBar onBack={() => router.back()} />

      <View style={styles.titleBlock}>
        <Row gap={spacing.sm}>
          <Icon name={CATEGORY_ICON[activity.category]} size={16} color={colors.skyInk} />
          <AppText variant="caption" color={colors.skyInk}>
            {CATEGORY_LABEL[activity.category].toUpperCase()} · {activity.kind === 'event' ? 'EVENT' : 'ANY TIME'}
          </AppText>
        </Row>
        <AppText variant="display" accessibilityRole="header" style={styles.title}>
          {activity.title}
        </AppText>
        <Row gap={spacing.sm} wrap>
          <ChallengeBadge challenge={challenge} />
          <TrustBadge activity={activity} />
        </Row>
      </View>

      {!availability.viable ? (
        <Notice tone="warning">{`${availability.label}. It can’t be planned right now.`}</Notice>
      ) : isDemo ? (
        <Notice tone="info" icon="flask-outline">
          This is a made-up sample listing for trying the app. Nothing here is a real event, venue or price.
        </Notice>
      ) : !availability.confirmed ? (
        <Notice tone="warning">{availability.label}</Notice>
      ) : (
        <Notice tone="success">{availability.label}</Notice>
      )}

      {activity.description ? <AppText variant="body">{activity.description}</AppText> : null}

      <Card>
        <FactRow
          icon={when.icon}
          text={when.text}
          certainty={when.known ? undefined : 'unknown'}
          detail={showZone ? `Times shown in ${activity.timeZone}` : undefined}
        />
        <FactRow icon="hourglass-outline" text={duration.text} certainty={duration.certainty} />
        <FactRow icon="wallet-outline" text={price.text} certainty={price.certainty} detail={activity.price?.note} />
        <FactRow
          icon="location-outline"
          text={activity.venue?.name ?? 'Location not listed'}
          certainty={activity.venue ? undefined : 'unknown'}
          detail={
            [
              activity.venue?.address,
              distance !== undefined
                ? `${formatDistance(distance)} away${isDemo ? ' (in the sample town)' : ''}`
                : activity.venue
                  ? 'Distance unknown'
                  : undefined,
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />
        {activity.restrictions ? <FactRow icon="information-circle-outline" text={activity.restrictions} /> : null}
        {directions ? (
          <Button
            label="Get directions"
            variant="soft"
            icon="navigate-outline"
            compact
            onPress={() => void open(directions)}
          />
        ) : null}
      </Card>

      {activity.whatToExpect ? (
        <Section title="What to expect">
          <AppText variant="body">{activity.whatToExpect}</AppText>
        </Section>
      ) : null}

      {activity.whyTry || recommendation ? (
        <Section title="Why it might be worth it">
          {activity.whyTry ? <AppText variant="body">{activity.whyTry}</AppText> : null}
          {recommendation ? (
            <View style={styles.why}>
              <AppText variant="smallStrong" color={colors.peachInk}>
                Why Huddle suggested it
              </AppText>
              {recommendation.reasons.map((reason) => (
                <Row key={reason} gap={spacing.sm}>
                  <Icon name="sparkles" size={14} color={colors.peachInk} />
                  <AppText variant="small" color={colors.peachInk} style={styles.shrink}>
                    {reason}
                  </AppText>
                </Row>
              ))}
            </View>
          ) : null}
        </Section>
      ) : null}

      <Section title={`Challenge: ${CHALLENGE_LABEL[challenge.level]}`}>
        <AppText variant="small">
          {challenge.notes.length
            ? challenge.notes.join(' · ')
            : 'Low-key: familiar, relaxed and easy to leave early if you want to.'}
        </AppText>
      </Section>

      <Section title="Source">
        <Card>
          <FactRow
            icon={activity.verification.status === 'verified' ? 'shield-checkmark-outline' : 'help-circle-outline'}
            text={
              isDemo
                ? 'Huddle sample data (fictional)'
                : (activity.source.label ?? sourceHost(activity.source.url) ?? 'Source not named')
            }
            detail={
              activity.verification.status === 'verified'
                ? `Verified with the organizer${checked ? ` · ${checked.toLowerCase()}` : ''}`
                : isDemo
                  ? 'Not a real listing'
                  : 'Not verified. Check the details with the organizer before you go.'
            }
          />
          {activity.source.url ? (
            <Pressable
              onPress={() => void open(activity.source.url!)}
              accessibilityRole="link"
              accessibilityLabel="Open the organizer’s page"
              style={({ pressed }) => [styles.sourceLink, pressed && { opacity: 0.7 }]}
            >
              <Icon name="open-outline" size={16} color={colors.skyInk} />
              <AppText variant="smallStrong" color={colors.skyInk}>
                Open the organizer’s page
              </AppText>
            </Pressable>
          ) : null}
          {linkError ? <Notice tone="warning">{linkError}</Notice> : null}
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBlock: { gap: spacing.sm },
  title: { fontSize: 28, lineHeight: 34 },
  why: { gap: spacing.sm, backgroundColor: colors.peachTint, borderRadius: radius.md, padding: spacing.md },
  shrink: { flexShrink: 1 },
  sourceLink: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
