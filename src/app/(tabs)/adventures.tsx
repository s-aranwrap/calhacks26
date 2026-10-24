/**
 * My adventures: a simple personal history split into Planned, Saved and
 * Completed. Completed adventures show their emoji reaction and private
 * reflection; each one has welcomed a penguin into the user's huddle.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { isExpired } from '@/core/availability';
import type { AdventureEntry, AdventureStatus } from '@/core/types';
import { useApp } from '@/state/AppProvider';
import { StateView } from '@/ui/components/feedback';
import { PenguinHuddle } from '@/ui/components/Mascot';
import { AppText, Button, Card, Chip, Icon, Row, Screen } from '@/ui/components/primitives';
import { CATEGORY_ICON, whenText } from '@/ui/components/QuestCard';
import { REACTION_META } from '@/ui/components/reactions';
import { colors, radius, spacing } from '@/ui/theme';

const TABS: { status: AdventureStatus; label: string }[] = [
  { status: 'planned', label: 'Planned' },
  { status: 'saved', label: 'Saved' },
  { status: 'completed', label: 'Completed' },
];

const EMPTY: Record<AdventureStatus, { title: string; message: string }> = {
  planned: {
    title: 'Nothing planned yet',
    message: 'When something catches your eye, tap “I’m going” and it will wait for you here.',
  },
  saved: { title: 'Nothing saved', message: 'Save ideas you like but aren’t ready to commit to.' },
  completed: {
    title: 'No adventures completed yet',
    message: 'Each one you finish welcomes a penguin into your huddle.',
  },
};

export default function Adventures() {
  const router = useRouter();
  const { history, unsave } = useApp();
  const byStatus = (s: AdventureStatus) => history.adventures.filter((a) => a.status === s);
  const [tab, setTab] = useState<AdventureStatus>(() =>
    byStatus('planned').length ? 'planned' : byStatus('saved').length ? 'saved' : 'completed',
  );
  const completed = byStatus('completed');
  const list = byStatus(tab).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const now = new Date();

  function open(entry: AdventureEntry) {
    if (entry.status === 'saved') router.push({ pathname: '/activity/[id]', params: { id: entry.activityId } });
    else router.push({ pathname: '/adventure/[id]', params: { id: entry.activityId } });
  }

  return (
    <Screen inTabs>
      <AppText variant="title" accessibilityRole="header">
        My adventures
      </AppText>

      <Card tone="peach">
        <Row style={styles.huddleRow}>
          <View style={styles.flex}>
            <AppText variant="heading">Your huddle</AppText>
            <AppText variant="small" color={colors.peachInk}>
              {completed.length === 0
                ? 'Finish an adventure to welcome your first penguin.'
                : `${completed.length} ${completed.length === 1 ? 'penguin' : 'penguins'}, one for each adventure you’ve finished.`}
            </AppText>
          </View>
        </Row>
        {completed.length ? <PenguinHuddle count={completed.length} size={44} /> : null}
      </Card>

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map(({ status, label }) => (
          <Chip
            key={status}
            label={`${label} (${byStatus(status).length})`}
            selected={tab === status}
            onPress={() => setTab(status)}
          />
        ))}
      </View>

      {list.length === 0 ? (
        <StateView
          title={EMPTY[tab].title}
          message={EMPTY[tab].message}
          face="sleepy"
          actions={
            tab !== 'completed' ? (
              <Button label="Find something to do" variant="soft" onPress={() => router.navigate('/discover')} />
            ) : null
          }
        />
      ) : (
        list.map((entry) => {
          const when = whenText(entry.activity, now);
          const ended = entry.status !== 'completed' && isExpired(entry.activity, now);
          const reaction = entry.reaction ? REACTION_META[entry.reaction] : undefined;
          return (
            <Pressable
              key={entry.activityId}
              onPress={() => open(entry)}
              accessibilityRole="button"
              accessibilityLabel={`${entry.activity.title}${ended ? ', ended' : ''}`}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceAlt }]}
            >
              <View style={styles.itemIcon}>
                <Icon name={CATEGORY_ICON[entry.activity.category]} size={20} color={colors.skyInk} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {entry.activity.title}
                </AppText>
                {entry.status === 'completed' ? (
                  <>
                    <AppText variant="small">
                      {reaction ? `${reaction.emoji} ${reaction.label} · ` : ''}
                      {formatDay(entry.completedAt ?? entry.updatedAt)}
                    </AppText>
                    {entry.reflection ? (
                      <AppText variant="small" numberOfLines={2} style={styles.reflection}>
                        “{entry.reflection}”
                      </AppText>
                    ) : null}
                  </>
                ) : (
                  <AppText variant="small" color={ended ? colors.warning : colors.inkSoft}>
                    {ended ? 'This has ended' : when.text}
                  </AppText>
                )}
              </View>
              {entry.status === 'saved' ? (
                <Pressable
                  onPress={() => void unsave(entry.activityId)}
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
        })
      )}
    </Screen>
  );
}

function sortKey(entry: AdventureEntry): string {
  return entry.completedAt ?? entry.plannedAt ?? entry.savedAt ?? entry.updatedAt;
}

function formatDay(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
  } catch {
    return new Date(ms).toDateString();
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  huddleRow: { justifyContent: 'space-between' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 64,
  },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.skyTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reflection: { fontStyle: 'italic' },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
