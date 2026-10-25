/**
 * Discover: pick a mood, optionally tweak three filters, get three quests.
 * When an adventure is already planned, that adventure leads the screen and
 * browsing is tucked behind a link, so planning ends the browsing.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { describeOpening } from '@/core/hours';
import { formatActivityWhen } from '@/core/time';
import type { Mood } from '@/core/types';
import { budgetLabel, distanceOptionLabel, timeOptionLabel } from '@/core/format';
import { BUDGET_OPTIONS, DISTANCE_OPTIONS_KM, TIME_OPTIONS_MINUTES } from '@/data/local/preferences';
import { focusAdventure, useApp, type DiscoveryFilters } from '@/state/AppProvider';
import { CatalogNotice } from '@/ui/components/CatalogNotice';
import { Notice } from '@/ui/components/feedback';
import { Mascot } from '@/ui/components/Mascot';
import { AppText, Button, Card, Chip, ChoiceRow, Icon, LinkButton, Row, Screen } from '@/ui/components/primitives';
import { colors, spacing } from '@/ui/theme';

const MOOD_CHIPS: { mood: Mood; label: string; emoji: string }[] = [
  { mood: 'surprise', label: 'Surprise me', emoji: '🎲' },
  { mood: 'chill', label: 'Chill', emoji: '🌿' },
  { mood: 'social', label: 'Social', emoji: '💬' },
  { mood: 'active', label: 'Active', emoji: '🏃' },
  { mood: 'creative', label: 'Creative', emoji: '🎨' },
];

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'Up late?';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Discover() {
  const router = useRouter();
  const app = useApp();
  const { preferences, catalog, history } = app;
  const focus = focusAdventure(history.adventures);
  const [exploreAnyway, setExploreAnyway] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Only what the user changed here is stored; everything else follows the
  // defaults in Settings, so editing those updates this tab too.
  const [overrides, setOverrides] = useState<Partial<DiscoveryFilters>>({});
  const filters: DiscoveryFilters = {
    mood: 'surprise',
    budget: preferences.budget,
    maxDistanceKm: preferences.maxDistanceKm,
    availableMinutes: preferences.availableMinutes,
    ...overrides,
  };

  const now = new Date();
  const setFilter = <K extends keyof DiscoveryFilters>(key: K, value: DiscoveryFilters[K]) =>
    setOverrides((o) => ({ ...o, [key]: value }));

  const filterSummary = [
    budgetLabel(filters.budget, preferences.currency),
    distanceOptionLabel(filters.maxDistanceKm),
    timeOptionLabel(filters.availableMinutes),
  ].join(' · ');

  function findQuests() {
    app.startDiscovery(filters);
    router.push('/quests');
  }

  const showSetup = !focus || exploreAnyway;
  // The sample-town notice below explains when activities aren't from this place.
  const locationLabel = preferences.location?.label ?? 'Location not set';

  return (
    <Screen
      inTabs
      footer={
        showSetup ? (
          <Button
            label="Find my next quest"
            icon="sparkles"
            onPress={findQuests}
            loading={!catalog}
            accessibilityHint="Shows three suggestions"
          />
        ) : undefined
      }
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="title" accessibilityRole="header">
            {greeting(now)}
          </AppText>
          <Row gap={4}>
            <Icon name="location-outline" size={16} />
            <AppText variant="small" numberOfLines={1} style={styles.shrink}>
              {locationLabel}
            </AppText>
          </Row>
        </View>
        <Mascot size={64} face={focus ? 'happy' : 'calm'} />
      </View>

      <CatalogNotice />

      {focus ? (
        <Card tone="sky">
          <AppText variant="caption" color={colors.skyInk}>
            YOUR NEXT ADVENTURE
          </AppText>
          <AppText variant="title">{focus.activity.title}</AppText>
          <AppText variant="small" color={colors.skyInk}>
            {focus.activity.startAt
              ? formatActivityWhen(focus.activity, now)
              : (describeOpening(focus.activity.openingHours, now, focus.activity.timeZone)?.text ??
                'Whenever suits you')}
            {focus.activity.venue ? ` · ${focus.activity.venue.area ?? focus.activity.venue.name}` : ''}
          </AppText>
          <Button
            label="Open my adventure"
            iconRight="arrow-forward"
            onPress={() => router.push({ pathname: '/adventure/[id]', params: { id: focus.activityId } })}
          />
          {!exploreAnyway ? (
            <LinkButton label="Explore something else anyway" onPress={() => setExploreAnyway(true)} />
          ) : null}
        </Card>
      ) : null}

      {showSetup ? (
        <>
          <View style={styles.block}>
            <AppText variant="heading" accessibilityRole="header">
              What are you in the mood for?
            </AppText>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Mood">
              {MOOD_CHIPS.map(({ mood, label, emoji }) => (
                <Chip
                  key={mood}
                  label={label}
                  emoji={emoji}
                  selected={filters.mood === mood}
                  tone={mood === 'surprise' ? 'peach' : 'sky'}
                  onPress={() => setFilter('mood', mood)}
                />
              ))}
            </View>
          </View>

          <Card>
            <Row style={styles.filterHeader}>
              <View style={styles.shrink}>
                <AppText variant="smallStrong">Filters</AppText>
                <AppText variant="small">{filterSummary}</AppText>
              </View>
              <LinkButton
                label={showFilters ? 'Done' : 'Adjust'}
                icon={showFilters ? 'checkmark' : 'options-outline'}
                onPress={() => setShowFilters((s) => !s)}
              />
            </Row>
            {showFilters ? (
              <View style={styles.filters}>
                <ChoiceRow
                  label="Budget"
                  options={BUDGET_OPTIONS}
                  value={filters.budget}
                  onChange={(v) => setFilter('budget', v)}
                  format={(v) => budgetLabel(v, preferences.currency)}
                />
                <ChoiceRow
                  label="Distance"
                  options={DISTANCE_OPTIONS_KM}
                  value={filters.maxDistanceKm}
                  onChange={(v) => setFilter('maxDistanceKm', v)}
                  format={distanceOptionLabel}
                />
                <ChoiceRow
                  label="Time you have"
                  options={TIME_OPTIONS_MINUTES}
                  value={filters.availableMinutes}
                  onChange={(v) => setFilter('availableMinutes', v)}
                  format={timeOptionLabel}
                />
                {!app.origin ? (
                  <Notice tone="info">
                    Distances are unknown until Huddle has coordinates. You can use your location in Settings.
                  </Notice>
                ) : null}
              </View>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1, gap: spacing.xs },
  block: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterHeader: { justifyContent: 'space-between' },
  filters: { gap: spacing.lg },
  shrink: { flexShrink: 1 },
});
