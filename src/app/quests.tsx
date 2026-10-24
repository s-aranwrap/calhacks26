/**
 * Exactly three quests per request (or an honest "only N" / empty state).
 * No infinite feed: "Show me three more" is a deliberate action, and after a
 * few rounds Huddle suggests adjusting filters instead of more browsing.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { budgetLabel, distanceOptionLabel, timeOptionLabel } from '@/core/format';
import type { FilterSuggestion } from '@/core/recommend';
import { useApp, type DiscoveryFilters } from '@/state/AppProvider';
import { CatalogNotice } from '@/ui/components/CatalogNotice';
import { LoadingState, Notice, StateView } from '@/ui/components/feedback';
import { AppText, Button, LinkButton, Screen, TopBar } from '@/ui/components/primitives';
import { QuestCard } from '@/ui/components/QuestCard';
import { colors, spacing } from '@/ui/theme';

/** After this many rounds, gently suggest changing filters rather than browsing more. */
const ROUNDS_BEFORE_NUDGE = 3;

const MOOD_TITLE: Record<DiscoveryFilters['mood'], string> = {
  surprise: 'A few surprises',
  chill: 'Something chill',
  social: 'Something social',
  active: 'Something active',
  creative: 'Something creative',
};

export default function Quests() {
  const router = useRouter();
  const app = useApp();
  const { discovery, catalog, preferences } = app;
  const now = new Date();

  if (!catalog) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <LoadingState label="Gathering ideas…" />
      </Screen>
    );
  }

  if (!discovery) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <StateView
          title="Pick a mood first"
          message="Choose how you feel and we’ll find three ideas."
          actions={<Button label="Back to Discover" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const { result, filters, round, dismissedIds } = discovery;
  const summary = [
    budgetLabel(filters.budget, preferences.currency),
    distanceOptionLabel(filters.maxDistanceKm),
    timeOptionLabel(filters.availableMinutes),
  ].join(' · ');

  function applySuggestion(suggestion: FilterSuggestion) {
    switch (suggestion) {
      case 'raise_budget':
        return app.startDiscovery({ ...filters, budget: 'any' });
      case 'widen_distance':
        return app.startDiscovery({ ...filters, maxDistanceKm: null });
      case 'more_time':
        return app.startDiscovery({ ...filters, availableMinutes: null });
      case 'change_mood':
        return app.startDiscovery({ ...filters, mood: 'surprise' });
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

  const nudge = round >= ROUNDS_BEFORE_NUDGE;
  const allDismissed =
    result.recommendations.length > 0 && result.recommendations.every((r) => dismissedIds.includes(r.activity.id));

  return (
    <Screen
      footer={
        result.status === 'empty' ? undefined : nudge ? (
          <>
            <Button
              label="Adjust my filters"
              variant="secondary"
              icon="options-outline"
              onPress={() => router.back()}
            />
            <LinkButton label="Show three more anyway" onPress={app.showMore} />
          </>
        ) : (
          <Button
            label="Show me three more"
            variant={allDismissed ? 'primary' : 'secondary'}
            icon="shuffle"
            onPress={app.showMore}
          />
        )
      }
    >
      <TopBar onBack={() => router.back()} />
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header">
          {MOOD_TITLE[filters.mood]}
        </AppText>
        <AppText variant="small">{summary}</AppText>
      </View>

      <CatalogNotice />

      {result.status === 'empty' ? (
        <StateView
          title={round > 1 ? 'That’s everything that fits' : 'Nothing fits those filters yet'}
          message={
            round > 1
              ? 'You’ve seen every option that matches. Loosening a filter will bring in new ideas.'
              : 'We’d rather show nothing than something that doesn’t fit. Try loosening one of these:'
          }
          actions={
            <>
              {suggestionButtons}
              <Button label="Back to Discover" variant="ghost" onPress={() => router.back()} />
            </>
          }
        />
      ) : (
        <>
          {nudge ? (
            <Notice tone="info" icon="footsteps-outline">
              {`That’s ${discovery.shownIds.length} ideas so far. Often the best pick is one you’ve already seen, so maybe give one a go?`}
            </Notice>
          ) : null}
          {result.recommendations.map((rec) => (
            <QuestCard
              key={rec.activity.id}
              recommendation={rec}
              now={now}
              dismissed={dismissedIds.includes(rec.activity.id)}
              onOpen={() => router.push({ pathname: '/activity/[id]', params: { id: rec.activity.id } })}
              onDismiss={(reason) => void app.dismiss(rec, reason)}
            />
          ))}
          {result.status === 'limited' ? (
            <Notice tone="info">
              <AppText variant="small" color={colors.skyInk}>
                {result.recommendations.length === 1
                  ? 'Only one good match right now.'
                  : `Only ${result.recommendations.length} good matches right now.`}{' '}
                We won’t pad the list with things that don’t fit.
              </AppText>
              {suggestionButtons.length ? <View style={styles.suggestions}>{suggestionButtons}</View> : null}
            </Notice>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const SUGGESTION_LABEL: Record<FilterSuggestion, string> = {
  raise_budget: 'Any budget',
  widen_distance: 'Any distance',
  more_time: 'No time limit',
  change_mood: 'Try “Surprise me”',
  include_unverified: 'Include unverified listings',
  bolder_nudge: 'Allow a bit more challenge',
  start_fresh: 'Start over with these filters',
};

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
