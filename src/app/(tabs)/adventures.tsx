/**
 * My Adventures: the one planned adventure up front, ideas saved for later,
 * and completed adventures (newest first) with their emoji reaction. No
 * streaks or scores; changing your mind is always free.
 */
import { useRouter } from 'expo-router';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { isExpired } from '@/core/availability';
import { formatPrice } from '@/core/format';
import type { AdventureEntry } from '@/core/types';
import { focusAdventure, useApp } from '@/state/AppProvider';
import { CATEGORY_ICON, whenText, whereText } from '@/ui/activityMeta';
import { ActivityImage } from '@/ui/components/ActivityImage';
import { Mascot, PenguinHuddle } from '@/ui/components/Mascot';
import { AppText, Button, Icon, LinkButton, Row, Screen, ScreenHeader, Section } from '@/ui/components/primitives';
import { REACTION_META } from '@/ui/components/reactions';
import { directionsUrl } from '@/ui/links';
import { colors, radius, shadow, spacing } from '@/ui/theme';

export default function Adventures() {
  const router = useRouter();
  const app = useApp();
  const { history } = app;
  const focus = focusAdventure(history.adventures);
  const otherPlanned = history.adventures.filter((a) => a.status === 'planned' && a !== focus);
  const saved = history.adventures.filter((a) => a.status === 'saved');
  const completed = history.adventures
    .filter((a) => a.status === 'completed')
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));

  const openAdventure = (entry: AdventureEntry) =>
    router.push({ pathname: '/adventure/[id]', params: { id: entry.activityId } });

  function confirmCompleted(entry: AdventureEntry) {
    Alert.alert('Did you do this adventure?', entry.activity.title, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Yes, I did!',
        onPress: async () => {
          await app.complete(app.findActivity(entry.activityId) ?? entry.activity);
          openAdventure(entry);
        },
      },
    ]);
  }

  function confirmCancel(entry: AdventureEntry) {
    Alert.alert('Cancel this plan?', `“${entry.activity.title}” will be removed from Planned. Nothing else changes.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel plan', style: 'destructive', onPress: () => void app.cancelPlan(entry.activityId) },
    ]);
  }

  return (
    <Screen inTabs>
      <ScreenHeader title="My Adventures" subtitle="Plans worth looking forward to." />

      <Section title="Planned">
        {focus ? (
          <PlannedAdventureCard
            entry={focus}
            onView={() => openAdventure(focus)}
            onComplete={() => confirmCompleted(focus)}
            onChange={() => router.navigate('/discover')}
            onCancel={() => confirmCancel(focus)}
          />
        ) : (
          <View style={styles.empty}>
            <Mascot size={104} face="calm" />
            <AppText variant="heading" center accessibilityRole="header">
              Your next adventure starts here.
            </AppText>
            <AppText variant="body" center color={colors.inkSoft}>
              Find something fun to do and make it happen.
            </AppText>
            <Button label="Find an adventure" icon="compass-outline" onPress={() => router.navigate('/discover')} />
          </View>
        )}
        {otherPlanned.map((entry) => (
          <AdventureRow key={entry.activityId} entry={entry} onPress={() => openAdventure(entry)} />
        ))}
      </Section>

      {saved.length ? (
        <Section title="Saved for later">
          {saved.map((entry) => (
            <AdventureRow
              key={entry.activityId}
              entry={entry}
              onPress={() => router.push({ pathname: '/activity/[id]', params: { id: entry.activityId } })}
              onRemove={() => void app.unsave(entry.activityId)}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Completed">
        {completed.length ? (
          <>
            <Row gap={spacing.md}>
              <PenguinHuddle count={completed.length} size={36} />
              <AppText variant="caption" style={styles.shrink}>
                {completed.length === 1 ? 'One penguin in your huddle.' : `${completed.length} penguins in your huddle.`}
              </AppText>
            </Row>
            {completed.map((entry) => (
              <AdventureRow key={entry.activityId} entry={entry} onPress={() => openAdventure(entry)} />
            ))}
          </>
        ) : (
          <AppText variant="small">Adventures you finish will show up here, with any notes you keep.</AppText>
        )}
      </Section>
    </Screen>
  );
}

function PlannedAdventureCard({
  entry,
  onView,
  onComplete,
  onChange,
  onCancel,
}: {
  entry: AdventureEntry;
  onView: () => void;
  onComplete: () => void;
  onChange: () => void;
  onCancel: () => void;
}) {
  const { activity } = entry;
  const now = new Date();
  const when = whenText(activity, now);
  const price = formatPrice(activity.price);
  const directions = directionsUrl(activity);
  const ended = isExpired(activity, now);
  const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

  return (
    <View style={styles.card}>
      <ActivityImage activity={activity} aspectRatio={2.4} />
      <View style={styles.cardBody}>
        <AppText variant="heading">{activity.title}</AppText>
        <View style={styles.facts}>
          <Fact icon="calendar-outline" text={ended ? 'This has ended' : activity.startAt ? when.text : 'Date not set'} />
          {!activity.startAt && when.known ? <Fact icon="time-outline" text={when.text} /> : null}
          <Fact icon="location-outline" text={whereText(activity, undefined)} />
          {price.certainty !== 'unknown' ? <Fact icon="wallet-outline" text={price.text} /> : null}
        </View>
        <Row gap={spacing.lg} wrap>
          {directions ? <LinkButton label="Directions" icon="navigate-outline" onPress={() => open(directions)} /> : null}
          {activity.source.url && activity.verification.status !== 'demo' ? (
            <LinkButton label="Original source" icon="open-outline" onPress={() => open(activity.source.url!)} />
          ) : null}
        </Row>
        <Button label="View details" iconRight="arrow-forward" onPress={onView} />
        <Button label="Mark completed" variant="soft" icon="checkmark-circle-outline" compact onPress={onComplete} />
        <Row gap={spacing.sm}>
          <Button label="Change plan" variant="secondary" compact style={styles.flex} onPress={onChange} />
          <Button label="Cancel plan" variant="ghost" compact style={styles.flex} onPress={onCancel} />
        </Row>
      </View>
    </View>
  );
}

function Fact({ icon, text }: { icon: Parameters<typeof Icon>[0]['name']; text: string }) {
  return (
    <Row gap={spacing.sm} style={styles.fact}>
      <Icon name={icon} size={17} color={colors.inkSoft} />
      <AppText variant="small" color={colors.ink} style={styles.shrink}>
        {text}
      </AppText>
    </Row>
  );
}

function AdventureRow({
  entry,
  onPress,
  onRemove,
}: {
  entry: AdventureEntry;
  onPress: () => void;
  onRemove?: () => void;
}) {
  const now = new Date();
  const reaction = entry.reaction ? REACTION_META[entry.reaction] : undefined;
  const ended = entry.status !== 'completed' && isExpired(entry.activity, now);
  const detail =
    entry.status === 'completed'
      ? `${reaction ? `${reaction.emoji} ${reaction.label} · ` : ''}${formatDay(entry.completedAt)}`
      : ended
        ? 'This has ended'
        : whenText(entry.activity, now).text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.activity.title}. ${detail}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.rowIcon}>
        <Icon name={CATEGORY_ICON[entry.activity.category]} size={20} color={colors.primaryInk} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {entry.activity.title}
        </AppText>
        <AppText variant="small" color={ended ? colors.warning : colors.inkSoft}>
          {detail}
        </AppText>
      </View>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${entry.activity.title} from Saved`}
          hitSlop={8}
          style={styles.remove}
        >
          <Icon name="close" size={20} color={colors.inkMuted} />
        </Pressable>
      ) : (
        <Icon name="chevron-forward" size={20} color={colors.inkMuted} />
      )}
    </Pressable>
  );
}

function formatDay(iso: string | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return 'Date not recorded';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
  } catch {
    return new Date(ms).toDateString();
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  shrink: { flexShrink: 1 },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
    ...shadow,
  },
  cardBody: { padding: spacing.lg + 2, gap: spacing.md },
  facts: { gap: spacing.sm },
  fact: { alignItems: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    minHeight: 64,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
