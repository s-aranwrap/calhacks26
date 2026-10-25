/**
 * Discover: pick up to three penguin moods (or none), optionally fine-tune
 * when / how far / budget / time, and get three ideas. A planned adventure
 * stays one tap away at the top, and an unfinished set of ideas can be
 * reopened without asking again.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ANYTIME, toggleMoodPick, whenLabel, type MoodPick } from '@/core/discovery';
import { budgetLabel, timeOptionLabel } from '@/core/format';
import { formatDistance } from '@/core/util';
import { focusAdventure, useApp, type DiscoveryFilters } from '@/state/AppProvider';
import { CatalogNotice } from '@/ui/components/CatalogNotice';
import { BudgetChoice, DistanceInput, TimeChoice, WhenPicker } from '@/ui/components/DiscoveryFilters';
import { LocationSheet } from '@/ui/components/LocationField';
import { Mascot } from '@/ui/components/Mascot';
import { MoodGarden } from '@/ui/components/MoodGarden';
import { AppText, Button, Disclosure, Icon, Row, Screen } from '@/ui/components/primitives';
import { colors, radius, spacing } from '@/ui/theme';

export default function Discover() {
  const router = useRouter();
  const app = useApp();
  const { preferences, catalog, history, discovery } = app;
  const focus = focusAdventure(history.adventures);
  const [moods, setMoods] = useState<MoodPick[]>([]);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [distanceValid, setDistanceValid] = useState(true);
  // Only what the user changed here is stored; everything else follows the
  // defaults in Settings, so editing those updates this tab too.
  const [overrides, setOverrides] = useState<Partial<DiscoveryFilters>>({});
  const filters: DiscoveryFilters = {
    moods,
    when: ANYTIME,
    budget: preferences.budget,
    maxDistanceKm: preferences.maxDistanceKm,
    availableMinutes: preferences.availableMinutes,
    ...overrides,
  };
  const setFilter = <K extends keyof DiscoveryFilters>(key: K, value: DiscoveryFilters[K]) =>
    setOverrides((o) => ({ ...o, [key]: value }));

  function toggle(mood: MoodPick) {
    const next = toggleMoodPick(moods, mood);
    setMoods(next.picks);
    setLimitMessage(next.limitReached ? 'Three moods is the limit. Tap one of your picks to swap it out.' : null);
  }

  function find() {
    if (!catalog || !distanceValid) return;
    app.startDiscovery({ ...filters, moods });
    router.push('/quests');
  }

  const filterSummary = [
    whenLabel(filters.when),
    filters.maxDistanceKm === null ? 'Any distance' : `Within ${formatDistance(filters.maxDistanceKm)}`,
    filters.budget === 'any' ? 'Any budget' : budgetLabel(filters.budget, preferences.currency),
    timeOptionLabel(filters.availableMinutes),
  ].join(' · ');

  const openPicks = discovery
    ? discovery.result.recommendations.filter((r) => !discovery.dismissedIds.includes(r.activity.id)).length
    : 0;

  return (
    <Screen
      inTabs
      footer={
        <Button
          label={catalog ? 'Find my next adventure' : 'Finding something worth waddling out for…'}
          icon={catalog ? 'sparkles' : undefined}
          onPress={find}
          loading={!catalog}
          disabled={!distanceValid}
          accessibilityHint={distanceValid ? 'Shows up to three ideas' : 'Fix the distance first'}
        />
      }
    >
      <View style={styles.header}>
        <Row gap={spacing.xs}>
          <Mascot size={36} />
          <AppText variant="label" accessibilityRole="header">
            Huddle
          </AppText>
        </Row>
        <Pressable
          onPress={() => setEditingLocation(true)}
          accessibilityRole="button"
          accessibilityLabel={
            preferences.location ? `Location: ${preferences.location.label}. Edit` : 'Add a location'
          }
          style={({ pressed }) => [styles.location, pressed && { opacity: 0.7 }]}
        >
          <Icon name="location-outline" size={16} color={colors.ink} />
          <AppText variant="small" color={colors.ink} numberOfLines={1} style={styles.shrink}>
            {preferences.location ? preferences.location.label : 'Add location'}
          </AppText>
          {preferences.location ? (
            <AppText variant="smallStrong" color={colors.primaryInk}>
              · Edit
            </AppText>
          ) : null}
        </Pressable>
      </View>

      {focus ? (
        <Pressable
          onPress={() => router.push({ pathname: '/adventure/[id]', params: { id: focus.activityId } })}
          accessibilityRole="button"
          accessibilityLabel={`Your next adventure: ${focus.activity.title}. Open it`}
          style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}
        >
          <Icon name="flag" size={18} color={colors.tealInk} />
          <View style={styles.shrink}>
            <AppText variant="caption" color={colors.tealInk}>
              YOUR NEXT ADVENTURE
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {focus.activity.title}
            </AppText>
          </View>
          <Icon name="chevron-forward" size={18} color={colors.tealInk} />
        </Pressable>
      ) : null}

      {discovery && openPicks > 0 ? (
        <Pressable
          onPress={() => router.push('/quests')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.resume, pressed && { opacity: 0.7 }]}
        >
          <Icon name="albums-outline" size={18} color={colors.primaryInk} />
          <AppText variant="smallStrong" color={colors.primaryInk}>
            Back to your ideas ({openPicks} still open)
          </AppText>
        </Pressable>
      ) : null}

      <View style={styles.intro}>
        <AppText variant="title" accessibilityRole="header">
          What are you in the mood for?
        </AppText>
        <AppText variant="body" color={colors.inkSoft}>
          Pick up to 3 moods, or skip ahead.
        </AppText>
      </View>

      <MoodGarden selected={moods} onToggle={toggle} limitMessage={limitMessage} />

      <Disclosure
        label="Fine-tune your adventure"
        open={showFilters}
        onToggle={() => setShowFilters((s) => !s)}
        summary={filterSummary}
      >
        <WhenPicker value={filters.when} onChange={(when) => setFilter('when', when)} />
        <DistanceInput
          km={filters.maxDistanceKm}
          onChange={(km) => setFilter('maxDistanceKm', km)}
          hasOrigin={!!app.origin}
          onValidityChange={setDistanceValid}
        />
        <BudgetChoice
          value={filters.budget}
          onChange={(budget) => setFilter('budget', budget)}
          currency={preferences.currency}
        />
        <TimeChoice value={filters.availableMinutes} onChange={(minutes) => setFilter('availableMinutes', minutes)} />
      </Disclosure>

      <CatalogNotice />

      <LocationSheet
        visible={editingLocation}
        initial={preferences.location}
        onClose={() => setEditingLocation(false)}
        onSave={(location) => app.updatePreferences({ location })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    maxWidth: '60%',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.tealTint,
    minHeight: 56,
  },
  resume: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  intro: { gap: spacing.xs, marginTop: spacing.sm },
  shrink: { flexShrink: 1 },
});
