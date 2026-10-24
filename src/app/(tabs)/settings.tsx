/**
 * Settings: location, interests, default filters, recommendation style,
 * activity data (import / sources), export, delete and privacy information.
 */
import { useState } from 'react';
import { Alert, StyleSheet, Switch, TextInput, View } from 'react-native';

import { budgetLabel, distanceOptionLabel, timeOptionLabel } from '@/core/format';
import { detectFormat, summarizeImport, type ImportReport } from '@/core/importer';
import { CATEGORIES, type Category, type NudgeLevel } from '@/core/types';
import {
  BUDGET_OPTIONS,
  CURRENCY_OPTIONS,
  DISTANCE_OPTIONS_KM,
  NUDGE_OPTIONS,
  TIME_OPTIONS_MINUTES,
} from '@/data/local/preferences';
import { pickActivityFile, shareJson } from '@/services/files';
import { geocodeIfPermitted, locateDevice } from '@/services/location';
import { useApp } from '@/state/AppProvider';
import { Notice } from '@/ui/components/feedback';
import { AppText, Button, Card, Chip, ChoiceRow, Divider, Row, Screen, Section } from '@/ui/components/primitives';
import { CATEGORY_LABEL } from '@/ui/components/QuestCard';
import { colors, fonts, radius, spacing } from '@/ui/theme';

const NUDGE_TEXT: Record<NudgeLevel, { label: string; detail: string }> = {
  gentle: { label: 'Gentle', detail: 'Stick to easy, familiar things.' },
  balanced: { label: 'Balanced', detail: 'Mostly comfortable, with the occasional something new.' },
  bold: { label: 'Bold', detail: 'Lean into new experiences and bigger stretches.' },
};

export default function Settings() {
  const app = useApp();
  const { preferences, catalog } = app;
  const [place, setPlace] = useState(preferences.location?.label ?? '');
  const [locMessage, setLocMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  async function saveTypedLocation() {
    const label = place.trim();
    if (label.length < 2) return;
    setBusy('location');
    const coords = await geocodeIfPermitted(label);
    await app.updatePreferences({ location: { label, source: 'manual', ...(coords ?? {}) } });
    setLocMessage(
      coords
        ? 'Saved. Distances will be estimated from there.'
        : 'Saved. Distances stay unknown until Huddle has coordinates (use your location, or import activities with coordinates).',
    );
    setBusy(null);
  }

  async function useDevice() {
    setBusy('device');
    const result = await locateDevice();
    if (result.ok) {
      await app.updatePreferences({ location: result.location });
      setPlace(result.location.label);
      setLocMessage('Using your current location. It stays on this phone.');
    } else {
      setLocMessage(
        result.reason === 'denied'
          ? 'Location permission wasn’t granted. Typing a place works too.'
          : 'Couldn’t get your location right now.',
      );
    }
    setBusy(null);
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
    try {
      const json = await app.exportHistoryJson();
      await shareJson(`huddle-history-${new Date().toISOString().slice(0, 10)}.json`, json);
    } catch {
      setMessage({ tone: 'warning', text: 'Export didn’t work. Please try again.' });
    }
    setBusy(null);
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your history?',
      'This permanently removes saved, planned and completed adventures, reactions, reflections and feedback from this phone. Your settings stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await app.clearHistory();
            setMessage({ tone: 'success', text: 'Your history was deleted.' });
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
      <AppText variant="title" accessibilityRole="header">
        Settings
      </AppText>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Section title="Location">
        <Card>
          <TextInput
            value={place}
            onChangeText={setPlace}
            placeholder="City or neighbourhood"
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={saveTypedLocation}
            accessibilityLabel="City or neighbourhood"
            maxLength={80}
          />
          <Row gap={spacing.sm} wrap>
            <Button
              label="Save place"
              variant="soft"
              compact
              onPress={saveTypedLocation}
              loading={busy === 'location'}
              disabled={place.trim().length < 2}
            />
            <Button
              label="Use my location"
              variant="secondary"
              icon="navigate-outline"
              compact
              onPress={useDevice}
              loading={busy === 'device'}
            />
          </Row>
          {locMessage ? <AppText variant="small">{locMessage}</AppText> : null}
        </Card>
      </Section>

      <Section title="Interests">
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
      </Section>

      <Section title="Default filters">
        <Card>
          <ChoiceRow
            label="Budget"
            options={BUDGET_OPTIONS}
            value={preferences.budget}
            onChange={(budget) => void app.updatePreferences({ budget })}
            format={(v) => budgetLabel(v, preferences.currency)}
          />
          <ChoiceRow
            label="Distance"
            options={DISTANCE_OPTIONS_KM}
            value={preferences.maxDistanceKm}
            onChange={(maxDistanceKm) => void app.updatePreferences({ maxDistanceKm })}
            format={distanceOptionLabel}
          />
          <ChoiceRow
            label="Time you usually have"
            options={TIME_OPTIONS_MINUTES}
            value={preferences.availableMinutes}
            onChange={(availableMinutes) => void app.updatePreferences({ availableMinutes })}
            format={timeOptionLabel}
          />
          <ChoiceRow
            label="Currency"
            options={CURRENCY_OPTIONS}
            value={preferences.currency}
            onChange={(currency) => void app.updatePreferences({ currency })}
            format={(c) => c}
          />
        </Card>
      </Section>

      <Section title="Recommendations">
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
              trackColor={{ true: colors.sky, false: colors.border }}
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
            label="Export history (JSON)"
            variant="secondary"
            icon="download-outline"
            onPress={exportHistory}
            loading={busy === 'export'}
          />
          <Button label="Delete history" variant="danger" icon="trash-outline" onPress={confirmDelete} />
        </Card>
      </Section>

      <Section title="Privacy">
        <Card>
          <AppText variant="small">
            Huddle has no accounts, no analytics and no tracking. Your preferences, plans, reactions and reflections are
            stored only in a database on this phone. They’re never uploaded. Your location is used on the phone to
            estimate distances and isn’t sent anywhere. When an online catalog is configured, the app only downloads
            public activity listings from it. Export creates a file you choose where to share; Delete removes your
            history from this phone.
          </AppText>
        </Card>
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
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
  },
});
