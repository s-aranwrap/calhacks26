/**
 * Recommendations, one card at a time: at most three per request, never
 * padded with things that don't fit. Passing marks a card and moves on but
 * never fetches more; "Show me three more" is always a deliberate tap. The
 * current card is kept in app state, so coming back from details (or from
 * Discover) lands on the same one.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Linking, Pressable, StyleSheet, View } from 'react-native';

import type { FilterSuggestion } from '@/core/recommend';
import { useApp } from '@/state/AppProvider';
import { CatalogNotice } from '@/ui/components/CatalogNotice';
import { LoadingState, Notice, StateView } from '@/ui/components/feedback';
import { Mascot } from '@/ui/components/Mascot';
import { AppText, Button, Icon, Row, Screen, TopBar } from '@/ui/components/primitives';
import { QuestCard } from '@/ui/components/QuestCard';
import { colors, radius, spacing } from '@/ui/theme';
import { useReducedMotion } from '@/ui/useReducedMotion';

/** After this many rounds, gently suggest changing filters rather than browsing more. */
const ROUNDS_BEFORE_NUDGE = 3;

export default function Quests() {
  const router = useRouter();
  const app = useApp();
  const { discovery, catalog } = app;
  const reduceMotion = useReducedMotion();
  const [fade] = useState(() => new Animated.Value(1));
  const [linkError, setLinkError] = useState<string | null>(null);
  const index = discovery?.index ?? 0;

  useEffect(() => {
    if (reduceMotion) return;
    fade.setValue(0.3);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [fade, index, reduceMotion]);

  if (!catalog) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <LoadingState label="Finding something worth waddling out for…" />
      </Screen>
    );
  }

  if (!discovery) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <StateView
          title="Let’s find you some ideas"
          message="Pick a mood (or none) on Discover and we’ll suggest three."
          actions={<Button label="Back to Discover" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const { result, filters, round, dismissedIds } = discovery;
  const recs = result.recommendations;
  const now = new Date();
  const atEnd = index >= recs.length;
  const current = atEnd ? undefined : recs[index];
  const passed = !!current && dismissedIds.includes(current.activity.id);

  const go = (next: number) => app.setDiscoveryIndex(Math.max(0, Math.min(next, recs.length)));

  function pass() {
    if (!current) return;
    void app.dismiss(current, undefined);
    const nextOpen = recs.findIndex((r, i) => i > index && !dismissedIds.includes(r.activity.id));
    go(nextOpen === -1 ? recs.length : nextOpen);
  }

  function openDetails() {
    if (current) router.push({ pathname: '/activity/[id]', params: { id: current.activity.id } });
  }

  async function openSource(url: string) {
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError('Couldn’t open that link on this device.');
    }
  }

  function applySuggestion(suggestion: FilterSuggestion) {
    switch (suggestion) {
      case 'raise_budget':
        return app.startDiscovery({ ...filters, budget: 'any' });
      case 'widen_distance':
        return app.startDiscovery({ ...filters, maxDistanceKm: null });
      case 'more_time':
        return app.startDiscovery({ ...filters, availableMinutes: null });
      case 'change_mood':
        return app.startDiscovery({ ...filters, moods: [] });
      case 'any_time':
        return app.startDiscovery({ ...filters, when: { kind: 'anytime' } });
      case 'start_fresh':
        return app.startDiscovery(filters);
      case 'include_unverified':
        return void app.updatePreferences({ includeUnverified: true }).then(() => app.startDiscovery(filters));
      case 'bolder_nudge':
        return void app.updatePreferences({ nudge: 'balanced' }).then(() => app.startDiscovery(filters));
    }
  }

  const suggestionButtons = result.suggestions.map((s) => (
    <Button key={s} label={SUGGESTION_LABEL[s]} variant="soft" compact onPress={() => applySuggestion(s)} />
  ));

  if (result.status === 'empty') {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <StateView
          title={round > 1 ? 'That’s everything that fits' : 'Nothing quite fits those filters.'}
          message={
            round > 1
              ? 'You’ve seen every idea that matches. Loosening a filter will bring in new ones.'
              : 'Try widening your search or removing a filter.'
          }
          actions={
            <>
              {suggestionButtons}
              <Button label="Adjust filters" variant="secondary" icon="options-outline" onPress={() => router.back()} />
              <Button label="Try again" variant="ghost" icon="refresh" onPress={() => app.startDiscovery(filters)} />
            </>
          }
        />
        <CatalogNotice />
      </Screen>
    );
  }

  const nudge = round >= ROUNDS_BEFORE_NUDGE;

  return (
    <Screen
      footer={
        current ? (
          <Row gap={spacing.sm}>
            {passed ? null : (
              <Button
                label="Pass"
                variant="secondary"
                onPress={pass}
                style={styles.flex}
                accessibilityHint="Marks this idea as passed and shows the next one"
              />
            )}
            <Button
              label="Let’s Go!"
              iconRight="arrow-forward"
              onPress={openDetails}
              style={styles.grow}
              accessibilityHint="Opens the details so you can commit"
            />
          </Row>
        ) : (
          <>
            <Button
              label={nudge ? 'Adjust my preferences' : 'Show me three more'}
              icon={nudge ? 'options-outline' : 'shuffle'}
              onPress={nudge ? () => router.back() : app.showMore}
            />
            <Button
              label={nudge ? 'Show me three more anyway' : 'Adjust my preferences'}
              variant="ghost"
              onPress={nudge ? app.showMore : () => router.back()}
            />
          </>
        )
      }
    >
      <TopBar
        onBack={() => router.back()}
        right={
          <AppText variant="smallStrong" color={colors.inkSoft} accessibilityLiveRegion="polite">
            {atEnd ? 'Done' : `${index + 1} of ${recs.length}`}
          </AppText>
        }
      />
      <AppText variant="title" accessibilityRole="header">
        Your next adventure awaits.
      </AppText>

      <Row style={styles.nav}>
        <NavButton icon="chevron-back" label="Previous" disabled={index === 0} onPress={() => go(index - 1)} />
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {recs.map((r, i) => (
            <View
              key={r.activity.id}
              style={[
                styles.dot,
                dismissedIds.includes(r.activity.id) && styles.dotPassed,
                i === index && styles.dotCurrent,
              ]}
            />
          ))}
        </View>
        <NavButton
          icon="chevron-forward"
          label="Next"
          disabled={atEnd}
          onPress={() => go(index + 1)}
          iconRight
        />
      </Row>

      <Animated.View style={{ opacity: fade }}>
        {current ? (
          <QuestCard
            key={current.activity.id}
            recommendation={current}
            now={now}
            passed={passed}
            onOpen={openDetails}
            onOpenSource={(url) => void openSource(url)}
          />
        ) : (
          <View style={styles.end}>
            <Mascot size={104} pose="waving" />
            <AppText variant="heading" center accessibilityRole="header">
              {recs.length === 3 ? 'That’s all three for now!' : `That’s all ${recs.length} for now!`}
            </AppText>
            <AppText variant="body" center color={colors.inkSoft}>
              {nudge
                ? `That’s ${discovery.shownIds.length} ideas so far. Often the best pick is one you’ve already seen, so maybe give one a go?`
                : 'Want to see what else is out there?'}
            </AppText>
            {result.status === 'limited' ? (
              <Notice tone="info">
                <AppText variant="small" color={colors.skyInk}>
                  {recs.length === 1 ? 'Only one idea fits' : `Only ${recs.length} ideas fit`} your filters right
                  now. We won’t pad the list with things that don’t.
                </AppText>
                {suggestionButtons.length ? <View style={styles.suggestions}>{suggestionButtons}</View> : null}
              </Notice>
            ) : null}
          </View>
        )}
      </Animated.View>

      {linkError ? <Notice tone="warning">{linkError}</Notice> : null}
      <CatalogNotice />
    </Screen>
  );
}

function NavButton({
  icon,
  label,
  disabled,
  onPress,
  iconRight,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  disabled: boolean;
  onPress: () => void;
  iconRight?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label} idea`}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.navButton, disabled && styles.navDisabled, pressed && { opacity: 0.6 }]}
    >
      {iconRight ? null : <Icon name={icon} size={18} color={colors.ink} />}
      <AppText variant="smallStrong">{label}</AppText>
      {iconRight ? <Icon name={icon} size={18} color={colors.ink} /> : null}
    </Pressable>
  );
}

const SUGGESTION_LABEL: Record<FilterSuggestion, string> = {
  raise_budget: 'Any budget',
  widen_distance: 'Any distance',
  more_time: 'No time limit',
  change_mood: 'Any mood',
  any_time: 'Any day',
  include_unverified: 'Include unverified listings',
  bolder_nudge: 'Allow a bit more challenge',
  start_fresh: 'Start over with these filters',
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1.4 },
  nav: { justifyContent: 'space-between' },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  navDisabled: { opacity: 0.35 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotPassed: { backgroundColor: colors.inkMuted, opacity: 0.4 },
  dotCurrent: { backgroundColor: colors.primary, width: 20 },
  end: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
