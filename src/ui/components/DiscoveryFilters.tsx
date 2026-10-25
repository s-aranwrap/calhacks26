/**
 * The optional "Fine-tune your adventure" controls: when, distance (in
 * miles), budget and time. Used on Discover and, for defaults, in Settings.
 */
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { kmToMilesText, parseMiles, whenLabel, type WhenFilter } from '@/core/discovery';
import { budgetLabel, timeOptionLabel } from '@/core/format';
import type { BudgetLevel } from '@/core/types';
import { BUDGET_OPTIONS, TIME_OPTIONS_MINUTES } from '@/data/local/preferences';

import { colors, fonts, radius, spacing } from '../theme';
import { DateRangeSheet } from './DateRangeSheet';
import { AppText, Chip, ChoiceRow, Row } from './primitives';

const QUICK_WHEN: WhenFilter[] = [{ kind: 'anytime' }, { kind: 'today' }, { kind: 'tomorrow' }, { kind: 'weekend' }];

export function WhenPicker({ value, onChange }: { value: WhenFilter; onChange: (when: WhenFilter) => void }) {
  const [choosing, setChoosing] = useState(false);
  const dates = value.kind === 'dates' ? value : null;
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="When">
      <AppText variant="smallStrong">When</AppText>
      <View style={styles.wrap}>
        {QUICK_WHEN.map((option) => (
          <Chip
            key={option.kind}
            label={whenLabel(option)}
            selected={value.kind === option.kind}
            onPress={() => onChange(option)}
          />
        ))}
        <Chip
          label={dates ? whenLabel(dates) : 'Choose dates'}
          icon="calendar-outline"
          selected={!!dates}
          onPress={() => setChoosing(true)}
          accessibilityHint="Opens a calendar"
        />
      </View>
      <DateRangeSheet
        visible={choosing}
        initial={dates ? { start: dates.start, end: dates.end } : null}
        onCancel={() => setChoosing(false)}
        onApply={(range) => {
          setChoosing(false);
          onChange({ kind: 'dates', ...range });
        }}
      />
    </View>
  );
}

/**
 * Numeric miles field. Blank means any distance. Invalid text is reported
 * inline and not applied (onValidityChange lets the screen hold its button).
 */
export function DistanceInput({
  km,
  onChange,
  hasOrigin,
  onValidityChange,
  label = 'How far are you willing to go?',
}: {
  km: number | null;
  onChange: (km: number | null) => void;
  hasOrigin: boolean;
  onValidityChange?: (valid: boolean) => void;
  label?: string;
}) {
  const [text, setText] = useState(() => kmToMilesText(km));
  const [error, setError] = useState<string | null>(null);

  function update(next: string) {
    setText(next);
    const parsed = parseMiles(next);
    if (parsed.ok) {
      setError(null);
      onChange(parsed.km);
    } else {
      setError(parsed.error);
    }
    onValidityChange?.(parsed.ok);
  }

  return (
    <View style={styles.group}>
      <AppText variant="smallStrong" nativeID="distance-label">
        {label}
      </AppText>
      <Row gap={spacing.sm}>
        <TextInput
          value={text}
          onChangeText={update}
          placeholder="Any"
          placeholderTextColor={colors.inkMuted}
          keyboardType="decimal-pad"
          returnKeyType="done"
          maxLength={5}
          style={[styles.input, error ? styles.inputError : null]}
          accessibilityLabel="Maximum distance in miles"
          accessibilityHint="Leave blank for any distance"
          accessibilityLabelledBy="distance-label"
        />
        <AppText variant="body">miles</AppText>
      </Row>
      {error ? (
        <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : !hasOrigin && text.trim() ? (
        <AppText variant="small">
          Distance needs a starting point. Add your location so Huddle can measure from there; until then this
          filter can’t rule anything out.
        </AppText>
      ) : null}
    </View>
  );
}

export function BudgetChoice({
  value,
  onChange,
  currency,
}: {
  value: BudgetLevel;
  onChange: (budget: BudgetLevel) => void;
  currency: string;
}) {
  return (
    <View style={styles.group}>
      <ChoiceRow
        label="What’s your budget?"
        options={BUDGET_OPTIONS}
        value={value}
        onChange={onChange}
        format={(v) => (v === 'free' ? 'Free only' : v === 'any' ? 'Any budget' : budgetLabel(v, currency))}
      />
      <AppText variant="caption">
        {value === 'any'
          ? 'No budget limit.'
          : `${value === 'free' ? 'Free entry only' : `${budgetLabel(value, currency)} per person`}. Places with an unlisted price still show up, marked “price not listed”.`}
      </AppText>
    </View>
  );
}

export function TimeChoice({
  value,
  onChange,
  label = 'How much time do you have?',
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
  label?: string;
}) {
  return <ChoiceRow label={label} options={TIME_OPTIONS_MINUTES} value={value} onChange={onChange} format={timeOptionLabel} />;
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    width: 110,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.medium,
    fontSize: 17,
    color: colors.ink,
  },
  inputError: { borderColor: colors.danger },
});
