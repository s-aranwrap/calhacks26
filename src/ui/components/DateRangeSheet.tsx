/**
 * "Choose dates": a small month calendar in a bottom sheet. Tap a day for a
 * single date, tap a second day for a range. Cancel leaves the previously
 * applied dates untouched; Apply hands back the new range.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dayKey, isWithinHorizon, parseDayKey } from '@/core/discovery';

import { colors, gutter, radius, spacing } from '../theme';
import { AppText, Button, Icon, Row } from './primitives';

export interface DateRange {
  start: string;
  end: string;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function monthTitle(year: number, month: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
  } catch {
    return `${month + 1}/${year}`;
  }
}

function longDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
  } catch {
    return date.toDateString();
  }
}

export function DateRangeSheet({
  visible,
  initial,
  onCancel,
  onApply,
}: {
  visible: boolean;
  initial: DateRange | null;
  onCancel: () => void;
  onApply: (range: DateRange) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      {visible ? <Body initial={initial} onCancel={onCancel} onApply={onApply} /> : null}
    </Modal>
  );
}

function Body({
  initial,
  onCancel,
  onApply,
}: {
  initial: DateRange | null;
  onCancel: () => void;
  onApply: (range: DateRange) => void;
}) {
  const now = new Date();
  const insets = useSafeAreaInsets();
  const [start, setStart] = useState<string | null>(initial?.start ?? null);
  const [end, setEnd] = useState<string | null>(initial?.end ?? null);
  const first = (initial && parseDayKey(initial.start)) || now;
  const [view, setView] = useState({ year: first.getFullYear(), month: first.getMonth() });

  const thisMonth = now.getFullYear() * 12 + now.getMonth();
  const shown = view.year * 12 + view.month;
  const canPrev = shown > thisMonth;
  const canNext = shown < thisMonth + 2;
  const shift = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  function pick(key: string) {
    if (!start || end) {
      setStart(key);
      setEnd(null);
    } else if (key >= start) {
      setEnd(key);
    } else {
      setStart(key);
    }
  }

  const leading = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(view.year, view.month, i + 1)),
  ];
  while (cells.length % 7) cells.push(null);

  const rangeEnd = end ?? start;
  const summary = !start
    ? 'Pick a day, or two days for a range.'
    : start === rangeEnd
      ? longDate(parseDayKey(start)!)
      : `${longDate(parseDayKey(start)!)} to ${longDate(parseDayKey(rangeEnd!)!)}`;

  return (
    <View style={styles.backdrop}>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel="Cancel" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} accessibilityViewIsModal>
        <AppText variant="heading" accessibilityRole="header">
          Choose dates
        </AppText>
        <Row style={styles.monthRow}>
          <MonthArrow icon="chevron-back" label="Previous month" disabled={!canPrev} onPress={() => shift(-1)} />
          <AppText variant="bodyStrong" accessibilityRole="header" accessibilityLiveRegion="polite">
            {monthTitle(view.year, view.month)}
          </AppText>
          <MonthArrow icon="chevron-forward" label="Next month" disabled={!canNext} onPress={() => shift(1)} />
        </Row>
        <View style={styles.grid}>
          {WEEKDAYS.map((d, i) => (
            <View key={`h${i}`} style={styles.cell} accessibilityElementsHidden importantForAccessibility="no">
              <AppText variant="caption">{d}</AppText>
            </View>
          ))}
          {cells.map((date, i) => {
            if (!date) return <View key={`e${i}`} style={styles.cell} />;
            const key = dayKey(date);
            const enabled = isWithinHorizon(date, now);
            const isEdge = key === start || key === rangeEnd;
            const inRange = !!start && !!rangeEnd && key > start && key < rangeEnd;
            return (
              <Pressable
                key={key}
                onPress={() => pick(key)}
                disabled={!enabled}
                accessibilityRole="button"
                accessibilityLabel={`${WEEKDAY_NAMES[date.getDay()]}, ${longDate(date)}`}
                accessibilityState={{ selected: isEdge || inRange, disabled: !enabled }}
                style={({ pressed }) => [
                  styles.cell,
                  styles.day,
                  inRange && styles.inRange,
                  isEdge && styles.edge,
                  pressed && enabled && { opacity: 0.7 },
                ]}
              >
                <AppText
                  variant="smallStrong"
                  color={isEdge ? colors.white : enabled ? colors.ink : colors.inkMuted}
                  style={!enabled && styles.disabledDay}
                >
                  {date.getDate()}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="small" accessibilityLiveRegion="polite">
          {summary}
        </AppText>
        <Button
          label="Apply"
          disabled={!start}
          onPress={() => start && onApply({ start, end: rangeEnd ?? start })}
        />
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
      </View>
    </View>
  );
}

function MonthArrow({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.arrow, disabled && { opacity: 0.3 }, pressed && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={22} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(36, 52, 71, 0.35)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  monthRow: { justifyContent: 'space-between' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  day: { borderRadius: 22 },
  inRange: { backgroundColor: colors.primaryTint, borderRadius: 0 },
  edge: { backgroundColor: colors.primary },
  disabledDay: { opacity: 0.45 },
});
