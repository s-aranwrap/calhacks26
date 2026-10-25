/**
 * One recommendation, shown one at a time. The card carries only what's
 * needed to decide at a glance (where, when, price, category, trust);
 * "More details" reveals the description, schedule, source and caveats.
 * Restrictions stay visible because they can be deal-breakers.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { assessAvailability } from '@/core/availability';
import { formatPrice } from '@/core/format';
import { formatWeeklyHours, parsedHours } from '@/core/hours';
import type { Recommendation } from '@/core/recommend';

import { CATEGORY_ICON, CATEGORY_LABEL, sourceLine, whenText, whereText } from '../activityMeta';
import { sourceHost } from '../links';
import { colors, radius, shadow, spacing } from '../theme';
import { ActivityImage } from './ActivityImage';
import { CertaintyTag, TrustBadge } from './feedback';
import { AppText, Icon, LinkButton, Row, type IconName } from './primitives';

export { CATEGORY_ICON, CATEGORY_LABEL, DISMISS_REASONS, sourceLine, whenText, whereText } from '../activityMeta';

interface QuestCardProps {
  recommendation: Recommendation;
  now: Date;
  passed: boolean;
  onOpen: () => void;
  onOpenSource: (url: string) => void;
}

export function QuestCard({ recommendation, now, passed, onOpen, onOpenSource }: QuestCardProps) {
  const { activity, reasons, distanceKm, slot } = recommendation;
  const [expanded, setExpanded] = useState(false);
  const price = formatPrice(activity.price);
  const when = whenText(activity, now);
  const availability = assessAvailability(activity, now);
  const weekly = activity.kind === 'evergreen' ? parsedHours(activity.openingHours) : null;
  const freeVerified = activity.price?.minAmount === 0 && activity.price.certainty === 'verified';

  return (
    <View style={[styles.card, passed && styles.passedCard]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${activity.title}${passed ? ', passed' : ''}. Open details`}
      >
        <ActivityImage activity={activity} />
        <View style={styles.body}>
          <Row gap={spacing.sm} wrap>
            <Icon name={CATEGORY_ICON[activity.category]} size={16} color={colors.primaryInk} />
            <AppText variant="caption" color={colors.primaryInk}>
              {CATEGORY_LABEL[activity.category]} · {activity.kind === 'event' ? 'Event' : 'Any time'}
            </AppText>
            {slot === 'novel' ? (
              <View style={styles.tag}>
                <AppText variant="caption" color={colors.blushInk}>
                  A little different
                </AppText>
              </View>
            ) : null}
            {passed ? (
              <View style={[styles.tag, styles.passedTag]}>
                <Icon name="close-circle-outline" size={14} color={colors.inkSoft} />
                <AppText variant="caption" color={colors.inkSoft}>
                  Passed
                </AppText>
              </View>
            ) : null}
          </Row>
          <AppText variant="heading" style={styles.title}>
            {activity.title}
          </AppText>

          <View style={styles.facts}>
            <MiniFact icon="location-outline" text={whereText(activity, distanceKm)} muted={!activity.venue} />
            <MiniFact icon={when.icon} text={when.text} muted={!when.known} />
            <MiniFact
              icon="wallet-outline"
              text={freeVerified ? 'Free entry (confirmed)' : price.text}
              muted={price.certainty === 'unknown'}
              tag={price.certainty}
            />
          </View>
          {activity.restrictions ? (
            <MiniFact icon="information-circle-outline" text={activity.restrictions} />
          ) : null}
          <Row gap={spacing.sm} wrap>
            <TrustBadge activity={activity} />
            <AppText variant="caption" numberOfLines={1} style={styles.shrink}>
              {sourceLine(activity)}
            </AppText>
          </Row>
        </View>
      </Pressable>

      <View style={styles.more}>
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          accessibilityLabel="More details"
          accessibilityState={{ expanded }}
          style={({ pressed }) => [styles.moreToggle, pressed && { opacity: 0.7 }]}
        >
          <AppText variant="smallStrong" color={colors.primaryInk}>
            {expanded ? 'Fewer details' : 'More details'}
          </AppText>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primaryInk} />
        </Pressable>
        {expanded ? (
          <View style={styles.moreBody}>
            {activity.description ? <AppText variant="body">{activity.description}</AppText> : null}
            {weekly ? <AppText variant="small">Hours: {formatWeeklyHours(weekly)}</AppText> : null}
            {reasons.length ? (
              <AppText variant="small" color={colors.blushInk}>
                Why Huddle picked it: {reasons.join(' · ')}
              </AppText>
            ) : null}
            {activity.verification.status !== 'demo' ? (
              <AppText variant="small" color={colors.warning}>
                {availability.label}
              </AppText>
            ) : null}
            {activity.source.url && activity.verification.status !== 'demo' ? (
              <LinkButton
                label={`Original source (${sourceHost(activity.source.url) ?? 'link'})`}
                icon="open-outline"
                onPress={() => onOpenSource(activity.source.url!)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
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
    <Row gap={spacing.sm} style={styles.miniFact}>
      <Icon name={icon} size={17} color={muted ? colors.inkMuted : colors.inkSoft} />
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
    borderColor: colors.borderSoft,
    overflow: 'hidden',
    ...shadow,
  },
  passedCard: { opacity: 0.85 },
  body: { padding: spacing.lg + 2, gap: spacing.md },
  title: { color: colors.ink },
  facts: { gap: spacing.sm },
  miniFact: { alignItems: 'flex-start' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.blushTint,
  },
  passedTag: { backgroundColor: colors.surfaceAlt },
  more: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.lg + 2 },
  moreToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  moreBody: { gap: spacing.sm, paddingBottom: spacing.lg },
  shrink: { flexShrink: 1 },
});
