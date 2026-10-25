/**
 * Focused adventure view. Once someone commits, the app narrows to this one
 * thing: when, where, how to get there, and "I did it". Changing plans is one
 * tap and has no penalty. After completion: an optional emoji reaction and a
 * private reflection, plus a small penguin moment.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { assessAvailability } from '@/core/availability';
import { formatDuration, formatPrice } from '@/core/format';
import { REACTIONS, type Reaction } from '@/core/types';
import { useApp } from '@/state/AppProvider';
import { Celebration } from '@/ui/components/Celebration';
import { FactRow, Notice, StateView } from '@/ui/components/feedback';
import { Mascot } from '@/ui/components/Mascot';
import { AppText, Button, Card, LinkButton, Row, Screen, TopBar } from '@/ui/components/primitives';
import { whenText } from '@/ui/activityMeta';
import { REACTION_META } from '@/ui/components/reactions';
import { directionsUrl } from '@/ui/links';
import { colors, fonts, radius, spacing } from '@/ui/theme';

export default function AdventureFocus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const app = useApp();
  const entry = id ? app.entryFor(id) : undefined;
  const [justCompleted, setJustCompleted] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pop back to Discover if it's in the stack, otherwise replace this screen with it.
  const goHome = () => router.dismissTo('/discover');

  if (!entry) {
    return (
      <Screen>
        <TopBar onBack={goHome} />
        <StateView
          title="No plan here"
          message="This adventure was cancelled or removed. Nothing lost."
          actions={<Button label="Back to Discover" onPress={goHome} />}
        />
      </Screen>
    );
  }

  // Prefer the latest catalog copy so a cancellation reported after planning is visible.
  const activity = app.findActivity(entry.activityId) ?? entry.activity;
  const now = new Date();
  const when = whenText(activity, now);
  const availability = assessAvailability(activity, now);
  const directions = directionsUrl(activity);
  const completedCount = app.history.adventures.filter((a) => a.status === 'completed').length;

  function confirmDone() {
    Alert.alert('Did you do this adventure?', activity.title, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Yes, I did!', onPress: () => void markDone() },
    ]);
  }

  async function markDone() {
    setBusy(true);
    try {
      await app.complete(activity);
      setJustCompleted(true);
    } finally {
      setBusy(false);
    }
  }

  function changePlans() {
    Alert.alert('Cancel this plan?', 'No worries, nothing is lost. It won’t count as completed.', [
      { text: 'Keep my plan', style: 'cancel' },
      {
        text: entry?.savedAt ? 'Move back to Saved' : 'Cancel plan',
        style: 'destructive',
        onPress: async () => {
          await app.cancelPlan(activity.id);
          goHome();
        },
      },
    ]);
  }

  if (entry.status === 'completed') {
    return (
      <Screen>
        <TopBar onBack={goHome} />
        {justCompleted ? <Celebration penguinNumber={completedCount} /> : null}
        <View style={styles.hero}>
          <AppText variant="caption" color={colors.success}>
            ADVENTURE COMPLETE
          </AppText>
          <AppText variant="title" accessibilityRole="header">
            {activity.title}
          </AppText>
        </View>
        <ReflectionForm
          key={entry.activityId}
          initialReaction={entry.reaction}
          initialText={entry.reflection ?? ''}
          skipLabel={justCompleted ? 'Skip' : 'Back'}
          onSkip={goHome}
          onSave={async (reaction, text) => {
            await app.reflect(activity.id, reaction, text);
            // Saving the reflection wraps up the adventure.
            goHome();
          }}
        />
      </Screen>
    );
  }

  const price = formatPrice(activity.price);
  const duration = formatDuration(activity.duration);

  return (
    <Screen
      footer={
        <>
          <Button
            label="Mark completed"
            icon="checkmark-circle-outline"
            onPress={confirmDone}
            loading={busy}
            accessibilityHint="Asks to confirm, then moves this to Completed"
          />
          <Row gap={spacing.sm}>
            <Button
              label="Change plan"
              variant="secondary"
              compact
              style={styles.flex}
              onPress={() => router.navigate('/discover')}
              accessibilityHint="Your plan stays until you pick a new one"
            />
            <Button label="Cancel plan" variant="ghost" compact style={styles.flex} onPress={changePlans} />
          </Row>
        </>
      }
    >
      <TopBar onBack={goHome} />
      <View style={styles.hero}>
        <Mascot size={120} pose="cheering" accessibilityLabel="Penguin cheering you on" />
        <AppText variant="caption" color={colors.primaryInk}>
          {entry.status === 'planned' ? 'YOU’RE GOING' : 'SAVED FOR LATER'}
        </AppText>
        <AppText variant="title" center accessibilityRole="header">
          {activity.title}
        </AppText>
        <AppText variant="body" center color={colors.inkSoft}>
          Phone down, shoes on. Huddle will be here when you get back.
        </AppText>
      </View>

      {!availability.viable && availability.state !== 'ended' ? (
        <Notice tone="warning">{`Heads up: this now shows as “${availability.label.toLowerCase()}”. Check with the organizer before heading out.`}</Notice>
      ) : availability.state === 'ended' ? (
        <Notice tone="info">This has finished. If you went, tap “I did it!” and tell yourself how it was.</Notice>
      ) : activity.verification.status !== 'demo' && !availability.confirmed ? (
        <Notice tone="warning">{availability.label}</Notice>
      ) : null}

      <Card>
        <FactRow icon={when.icon} text={when.text} certainty={when.known ? undefined : 'unknown'} />
        <FactRow
          icon="location-outline"
          text={activity.venue?.name ?? 'Location not listed'}
          certainty={activity.venue ? undefined : 'unknown'}
          detail={activity.venue?.address}
        />
        <FactRow icon="hourglass-outline" text={duration.text} certainty={duration.certainty} />
        <FactRow icon="wallet-outline" text={price.text} certainty={price.certainty} detail={activity.price?.note} />
        {activity.restrictions ? <FactRow icon="information-circle-outline" text={activity.restrictions} /> : null}
        {directions ? (
          <Button
            label="Get directions"
            variant="soft"
            icon="navigate-outline"
            compact
            onPress={() => void Linking.openURL(directions).catch(() => undefined)}
          />
        ) : null}
        {activity.source.url && activity.verification.status !== 'demo' ? (
          <LinkButton
            label="Organizer’s page"
            icon="open-outline"
            onPress={() => void Linking.openURL(activity.source.url!).catch(() => undefined)}
          />
        ) : null}
      </Card>

      {activity.whatToExpect ? (
        <Card tone="blush">
          <AppText variant="smallStrong" color={colors.blushInk}>
            What to expect
          </AppText>
          <AppText variant="body">{activity.whatToExpect}</AppText>
        </Card>
      ) : null}
    </Screen>
  );
}

function ReflectionForm({
  initialReaction,
  initialText,
  onSave,
  onSkip,
  skipLabel,
}: {
  initialReaction: Reaction | undefined;
  initialText: string;
  onSave: (reaction: Reaction | undefined, text: string | undefined) => Promise<void>;
  onSkip: () => void;
  skipLabel: string;
}) {
  const [reaction, setReaction] = useState<Reaction | undefined>(initialReaction);
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const dirty = reaction !== initialReaction || text.trim() !== initialText.trim();

  async function done() {
    if (!dirty) return onSkip();
    setSaving(true);
    try {
      await onSave(reaction, text.trim() || undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <AppText variant="heading" accessibilityRole="header">
        How was it?
      </AppText>
      <AppText variant="small">
        Optional. Your reaction helps Huddle suggest better things next time.
      </AppText>
      <View style={styles.reactions} accessibilityRole="radiogroup" accessibilityLabel="Your reaction">
        {REACTIONS.map((r) => {
          const meta = REACTION_META[r];
          const selected = reaction === r;
          return (
            <Pressable
              key={r}
              onPress={() => setReaction(selected ? undefined : r)}
              accessibilityRole="radio"
              accessibilityLabel={meta.label}
              accessibilityState={{ selected, checked: selected }}
              style={({ pressed }) => [
                styles.reaction,
                selected && styles.reactionSelected,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.reactionEmoji} accessibilityElementsHidden importantForAccessibility="no">
                {meta.emoji}
              </Text>
              <AppText variant="caption" color={selected ? colors.primaryInk : colors.inkMuted} center numberOfLines={2}>
                {meta.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Anything you want to remember?"
        placeholderTextColor={colors.inkMuted}
        multiline
        // The Return key closes the keyboard instead of adding a new line.
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        maxLength={1000}
        style={styles.reflection}
        accessibilityLabel="Private reflection"
        accessibilityHint="Stays on this phone"
        textAlignVertical="top"
      />
      <AppText variant="caption">Private. Stays on this phone unless you export it.</AppText>
      <Button label="Done" onPress={() => void done()} loading={saving} />
      <Button label={skipLabel} variant="ghost" onPress={onSkip} />
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  reactions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  reaction: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 2,
  },
  reactionSelected: { borderColor: colors.primaryAccent, backgroundColor: colors.primaryTint, borderWidth: 2 },
  reactionEmoji: { fontSize: 26 },
  reflection: {
    minHeight: 110,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.ink,
  },
});
