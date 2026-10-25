/**
 * Settings: discovery preferences (location, distance, budget, time,
 * interests, nudge), activity data (import / sources), export, delete, and a
 * link to the privacy page.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { detectFormat, summarizeImport, type ImportReport } from '@/core/importer';
import { CATEGORIES, type Category, type NudgeLevel } from '@/core/types';
import { CURRENCY_OPTIONS, NUDGE_OPTIONS } from '@/data/local/preferences';
import { pickActivityFile, shareJson } from '@/services/files';
import { useApp } from '@/state/AppProvider';
import { CATEGORY_LABEL } from '@/ui/activityMeta';
import { BudgetChoice, DistanceInput, TimeChoice } from '@/ui/components/DiscoveryFilters';
import { Notice } from '@/ui/components/feedback';
import { LocationField, useLocationEntry } from '@/ui/components/LocationField';
import {
  AppText,
  Button,
  Card,
  Chip,
  ChoiceRow,
  Divider,
  Icon,
  LinkButton,
  Row,
  Screen,
  ScreenHeader,
  Section,
} from '@/ui/components/primitives';
import { colors, radius, spacing } from '@/ui/theme';

const NUDGE_TEXT: Record<NudgeLevel, { label: string; detail: string }> = {
  gentle: { label: 'Gentle', detail: 'Stick to easy, familiar things.' },
  balanced: { label: 'Balanced', detail: 'Mostly comfortable, with the occasional something new.' },
  bold: { label: 'Bold', detail: 'Lean into new experiences and bigger stretches.' },
};

export default function Settings() {
  const app = useApp();
  const router = useRouter();
  const { preferences, catalog, history } = app;
  const location = useLocationEntry(preferences.location);
  const [locMessage, setLocMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [exportFailed, setExportFailed] = useState(false);

  async function saveLocation() {
    setBusy('location');
    try {
      const next = await location.resolve();
      await app.updatePreferences({ location: next });
      setLocMessage(
        !next
          ? 'Location cleared. Huddle will measure from the city center.'
          : next.latitude !== undefined
            ? 'Saved. Distances will be estimated from there.'
            : 'Saved. Distances stay unknown until Huddle has coordinates (tap “Use my location” to add them).',
      );
    } finally {
      setBusy(null);
    }
  }

  function toggleInterest(category: Category) {
    const has = preferences.interests.includes(category);
    void app.updatePreferences({
      interests: has ? preferences.interests.filter((c) => c !== category) : [...preferences.interests, category],
    });
  }

  async function importFile() {
    setMessage(null);
    setImportReport(null);
    setBusy('import');
    const picked = await pickActivityFile();
    if ('text' in picked) {
      const report = await app.importFromText(picked.text, detectFormat(picked.name, picked.text));
      setImportReport(report);
    } else if ('error' in picked) {
      setMessage({ tone: 'warning', text: picked.error });
    }
    setBusy(null);
  }

  async function exportHistory() {
    setBusy('export');
    setExportFailed(false);
    try {
      const json = await app.exportHistoryJson();
      await shareJson(`huddle-history-${new Date().toISOString().slice(0, 10)}.json`, json);
    } catch {
      setExportFailed(true);
    }
    setBusy(null);
  }

  function confirmDelete() {
    const planned = history.adventures.some((a) => a.status === 'planned');
    Alert.alert(
      'Delete local history?',
      `This will permanently delete your locally stored adventure history, including completed activities and private reflections.${
        planned ? ' Your current planned adventure will be deleted too.' : ''
      } Your preferences stay. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete history',
          style: 'destructive',
          onPress: async () => {
            await app.clearHistory();
            setMessage({ tone: 'success', text: 'Your local history was deleted.' });
          },
        },
      ],
    );
  }

  function confirmRemoveImported() {
    Alert.alert('Remove imported activities?', 'Activities you imported from files will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void app.clearImported() },
    ]);
  }

  const source = describeSource(catalog);

  return (
    <Screen inTabs>
      <ScreenHeader title="Settings" subtitle="No account needed. Everything here stays on this phone." />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Section title="Discovery preferences">
        <Card>
          <LocationField entry={location} label="Default location" onSubmit={() => void saveLocation()} />
          <Button
            label="Save location"
            variant="soft"
            compact
            onPress={() => void saveLocation()}
            loading={busy === 'location'}
          />
          {locMessage ? <AppText variant="small">{locMessage}</AppText> : null}
        </Card>
        <Card>
          <DistanceInput
            label="Preferred distance"
            km={preferences.maxDistanceKm}
            onChange={(maxDistanceKm) => void app.updatePreferences({ maxDistanceKm })}
            hasOrigin={!!app.origin}
          />
          <Divider />
          <BudgetChoice
            value={preferences.budget}
            onChange={(budget) => void app.updatePreferences({ budget })}
            currency={preferences.currency}
          />
          <Divider />
          <TimeChoice
            label="Time you usually have"
            value={preferences.availableMinutes}
            onChange={(availableMinutes) => void app.updatePreferences({ availableMinutes })}
          />
          <Divider />
          <ChoiceRow
            label="Currency"
            options={CURRENCY_OPTIONS}
            value={preferences.currency}
            onChange={(currency) => void app.updatePreferences({ currency })}
            format={(c) => c}
          />
        </Card>
        <Card>
          <AppText variant="smallStrong">Interests</AppText>
          <AppText variant="small">Optional. Things you pick here get a small boost, never a filter.</AppText>
          <View style={styles.chips}>
            {CATEGORIES.filter((c) => c !== 'other').map((category) => (
              <Chip
                key={category}
                label={CATEGORY_LABEL[category]}
                selected={preferences.interests.includes(category)}
                onPress={() => toggleInterest(category)}
              />
            ))}
          </View>
        </Card>
        <Card>
          <ChoiceRow
            label="How much should Huddle nudge you?"
            options={NUDGE_OPTIONS}
            value={preferences.nudge}
            onChange={(nudge) => void app.updatePreferences({ nudge })}
            format={(n) => NUDGE_TEXT[n].label}
          />
          <AppText variant="small">{NUDGE_TEXT[preferences.nudge].detail}</AppText>
          <Divider />
          <Row gap={spacing.md}>
            <View style={styles.flex}>
              <AppText variant="smallStrong">Include unverified listings</AppText>
              <AppText variant="small">They’re always labeled. Check details with the organizer before going.</AppText>
            </View>
            <Switch
              value={preferences.includeUnverified}
              onValueChange={(includeUnverified) => void app.updatePreferences({ includeUnverified })}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Include unverified listings"
            />
          </Row>
        </Card>
      </Section>

      <Section title="Activity data">
        <Card>
          <AppText variant="smallStrong">Source</AppText>
          <AppText variant="small">{source}</AppText>
          <Row gap={spacing.sm} wrap>
            <Button
              label="Import CSV or JSON"
              variant="soft"
              icon="document-text-outline"
              compact
              onPress={importFile}
              loading={busy === 'import'}
            />
            <Button
              label="Refresh"
              variant="secondary"
              icon="refresh"
              compact
              onPress={() => void app.reloadCatalog()}
              loading={app.catalogLoading}
            />
          </Row>
          {importReport ? <ImportResult report={importReport} /> : null}
          {catalog && catalog.importedCount > 0 ? (
            <Button
              label={`Remove ${catalog.importedCount} imported activities`}
              variant="ghost"
              compact
              onPress={confirmRemoveImported}
            />
          ) : null}
        </Card>
      </Section>

      <Section title="Your data">
        <Card>
          <Button
            label="Export my history"
            variant="secondary"
            icon="download-outline"
            onPress={exportHistory}
            loading={busy === 'export'}
            accessibilityHint="Shares your planned and completed adventures as a JSON file"
          />
          {exportFailed ? (
            <Notice tone="warning">
              <AppText variant="small" color={colors.warning}>
                Export didn’t work.
              </AppText>
              <LinkButton label="Try again" icon="refresh" color={colors.warning} onPress={() => void exportHistory()} />
            </Notice>
          ) : null}
          <Button label="Delete local history" variant="danger" icon="trash-outline" onPress={confirmDelete} />
        </Card>
      </Section>

      <Section title="Privacy">
        <Pressable
          onPress={() => router.push('/privacy')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: colors.surfaceAlt }]}
        >
          <Icon name="lock-closed-outline" size={20} color={colors.primaryInk} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">How Huddle handles your data</AppText>
            <AppText variant="small">No account, no analytics, no tracking.</AppText>
          </View>
          <Icon name="chevron-forward" size={20} color={colors.inkMuted} />
        </Pressable>
      </Section>
    </Screen>
  );
}

function ImportResult({ report }: { report: ImportReport }) {
  const issues = [...report.invalid, ...report.warnings].slice(0, 5);
  return (
    <Notice tone={report.activities.length ? 'success' : 'warning'}>
      <AppText variant="smallStrong" color={report.activities.length ? colors.success : colors.warning}>
        {summarizeImport(report)}
      </AppText>
      {report.unknownColumns.length ? (
        <AppText variant="small">Ignored columns: {report.unknownColumns.join(', ')}</AppText>
      ) : null}
      {issues.map((issue) => (
        <AppText key={`${issue.row}-${issue.messages[0]}`} variant="small">
          {issue.row > 0 ? `Row ${issue.row}` : 'File'}
          {issue.title ? ` (${issue.title})` : ''}: {issue.messages.slice(0, 2).join('; ')}
        </AppText>
      ))}
      {report.activities.length ? (
        <AppText variant="small">
          Imported activities are marked unverified unless the file says otherwise, and they replace the sample town.
        </AppText>
      ) : null}
    </Notice>
  );
}

function describeSource(catalog: ReturnType<typeof useApp>['catalog']): string {
  if (!catalog) return 'Loading…';
  const parts: string[] = [];
  if (catalog.remoteStatus === 'live') parts.push('Online catalog (Supabase), up to date');
  if (catalog.remoteStatus === 'cached') parts.push('Online catalog unreachable; using the saved copy');
  if (catalog.remoteStatus === 'unavailable') parts.push('Online catalog unreachable');
  if (catalog.importedCount) parts.push(`${catalog.importedCount} activities you imported`);
  if (catalog.usesDemo) parts.push('Sample activities in a made-up town (no real listings yet)');
  if (catalog.remoteStatus === 'not_configured' && !catalog.usesDemo && !catalog.importedCount)
    parts.push('No activities');
  return `${parts.join(' · ')}. ${catalog.activities.length} activities available.`;
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
});
