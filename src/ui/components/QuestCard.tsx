/**
 * One recommendation. Shows the facts needed to decide at a glance (when,
 * where, how long, cost, challenge, trust) plus why it was suggested.
 * "Not for me" flips the card into an optional reason picker; after that the
 * card collapses to a single line, with no refill (to avoid a swipe-feed loop).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { assessAvailability } from '@/core/availability';
import { formatDuration, formatPrice } from '@/core/format';
import type { Recommendation } from '@/core/recommend';
import { describeOpening } from '@/core/hours';
import { formatActivityWhen } from '@/core/time';
import type { Activity, Category, DismissReason } from '@/core/types';
import { formatDistance } from '@/core/util';

import { sourceHost } from '../links';
import { colors, radius, shadow, spacing } from '../theme';
import { ChallengeBadge, CertaintyTag, TrustBadge } from './feedback';
import { AppText, Button, Chip, Icon, Row, type IconName } from './primitives';

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

export const DISMISS_REASONS: { reason: DismissReason; label: string }[] = [
  { reason: 'too_expensive', label: 'Too expensive' },
  { reason: 'too_far', label: 'Too far away' },
  { reason: 'wrong_timing', label: 'Wrong timing' },
  { reason: 'unavailable', label: 'Not available / full' },
  { reason: 'not_my_thing', label: 'Not my thing' },
];

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

interface QuestCardProps {
  recommendation: Recommendation;
  now: Date;
  dismissed: boolean;
  onOpen: () => void;
  onDismiss: (reason: DismissReason | undefined) => void;
}

export function QuestCard({ recommendation, now, dismissed, onOpen, onDismiss }: QuestCardProps) {
  const { activity, reasons, challenge, distanceKm, slot } = recommendation;
  const [choosingReason, setChoosingReason] = useState(false);

  if (dismissed) {
    return (
      <View style={[styles.card, styles.collapsed]} accessibilityLiveRegion="polite">
        <Icon name="eye-off-outline" size={16} color={colors.inkMuted} />
        <AppText variant="small" numberOfLines={1} style={styles.flex}>
          Hidden: {activity.title}
        </AppText>
      </View>
    );
  }

  const price = formatPrice(activity.price);
  const duration = formatDuration(activity.duration);
  const when = whenText(activity, now);
  const availability = assessAvailability(activity, now);

  return (
    <View style={styles.card}>
      {slot === 'novel' ? (
        <View style={styles.novelRibbon}>
          <Icon name="sparkles-outline" size={14} color={colors.peachInk} />
          <AppText variant="caption" color={colors.peachInk}>
            A little different
          </AppText>
        </View>
      ) : null}

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${activity.title}. Open details`}
        style={styles.body}
      >
        <Row gap={spacing.sm} wrap>
          <Icon name={CATEGORY_ICON[activity.category]} size={16} color={colors.skyInk} />
          <AppText variant="caption" color={colors.skyInk}>
            {CATEGORY_LABEL[activity.category].toUpperCase()} · {activity.kind === 'event' ? 'EVENT' : 'ANY TIME'}
          </AppText>
        </Row>
        <AppText variant="title" style={styles.title}>
          {activity.title}
        </AppText>
        {activity.description ? (
          <AppText variant="small" numberOfLines={3}>
            {activity.description}
          </AppText>
        ) : null}

        <View style={styles.facts}>
          <MiniFact icon={when.icon} text={when.text} muted={!when.known} />
          <MiniFact icon="location-outline" text={whereText(activity, distanceKm)} muted={!activity.venue} />
          <Row gap={spacing.lg} wrap>
            <MiniFact
              icon="hourglass-outline"
              text={duration.text}
              muted={duration.certainty === 'unknown'}
              tag={duration.certainty}
            />
            <MiniFact
              icon="wallet-outline"
              text={price.text}
              muted={price.certainty === 'unknown'}
              tag={price.certainty}
            />
          </Row>
        </View>

        {activity.whatToExpect ? (
          <AppText variant="small" numberOfLines={2}>
            <AppText variant="smallStrong">What to expect: </AppText>
            {activity.whatToExpect}
          </AppText>
        ) : null}

        <View style={styles.why}>
          <Icon name="sparkles" size={14} color={colors.peachInk} />
          <AppText variant="small" color={colors.peachInk} style={styles.flex}>
            {reasons.join(' · ')}
          </AppText>
        </View>
        {activity.whyTry ? (
          <AppText variant="small" numberOfLines={2}>
            <AppText variant="smallStrong">Why try it: </AppText>
            {activity.whyTry}
          </AppText>
        ) : null}

        <Row gap={spacing.sm} wrap>
          <ChallengeBadge challenge={challenge} />
          <TrustBadge activity={activity} />
          <AppText variant="caption" numberOfLines={1} style={styles.shrink}>
            {sourceLine(activity)}
          </AppText>
          {!availability.confirmed && activity.kind === 'event' && activity.verification.status !== 'demo' ? (
            <AppText variant="caption">Availability not verified</AppText>
          ) : null}
        </Row>
      </Pressable>

      {choosingReason ? (
        <View style={styles.reasonPanel} accessibilityLiveRegion="polite">
          <AppText variant="smallStrong">What didn’t fit? (optional)</AppText>
          <View style={styles.reasonChips}>
            {DISMISS_REASONS.map(({ reason, label }) => (
              <Chip key={reason} label={label} onPress={() => onDismiss(reason)} />
            ))}
          </View>
          <Row gap={spacing.sm}>
            <Button label="Just hide it" variant="ghost" compact onPress={() => onDismiss(undefined)} />
            <Button label="Keep it" variant="secondary" compact onPress={() => setChoosingReason(false)} />
          </Row>
        </View>
      ) : (
        <Row gap={spacing.sm} style={styles.actions}>
          <Button
            label="Not for me"
            variant="secondary"
            compact
            onPress={() => setChoosingReason(true)}
            style={styles.flex}
          />
          <Button
            label="Try this"
            iconRight="arrow-forward"
            compact
            onPress={onOpen}
            style={styles.flex}
            accessibilityHint="Opens the details so you can decide"
          />
        </Row>
      )}
    </View>
  );
}

function MiniFact({
  icon,
  text,
  muted,
  tag,
}: {
  icon: IconName;
  text: string;
  muted?: boolean;
  tag?: 'verified' | 'estimated' | 'unknown';
}) {
  return (
    <Row gap={6} style={styles.miniFact}>
      <Icon name={icon} size={16} color={muted ? colors.inkMuted : colors.inkSoft} />
      <AppText variant="small" color={muted ? colors.inkMuted : colors.ink} style={styles.shrink}>
        {text}
      </AppText>
      {tag === 'estimated' ? <CertaintyTag certainty="estimated" /> : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow,
  },
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  novelRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.peachTint,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
  },
  body: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 22, lineHeight: 28 },
  facts: { gap: spacing.sm },
  miniFact: { alignItems: 'flex-start' },
  why: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.peachTint,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  actions: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  reasonPanel: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
});
