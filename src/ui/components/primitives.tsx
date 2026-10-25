/**
 * Small, reusable building blocks: text, buttons, chips, cards and layout.
 * All interactive elements meet the 48pt touch target and expose
 * accessibility roles and states.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadow, spacing, touchTarget, type, type TypeVariant } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  color?: string;
  center?: boolean;
}

export function AppText({
  variant = 'body',
  color,
  center,
  style,
  maxFontSizeMultiplier = 1.6,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[type[variant], color ? { color } : null, center ? styles.center : null, style]}
    />
  );
}

export function Icon({ name, size = 18, color = colors.inkSoft }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

const BUTTON_COLORS: Record<ButtonVariant, { bg: string; pressed: string; fg: string; border?: string }> = {
  primary: { bg: colors.sky, pressed: colors.skyPressed, fg: colors.white },
  secondary: { bg: colors.surface, pressed: colors.surfaceAlt, fg: colors.ink, border: colors.border },
  soft: { bg: colors.skyTint, pressed: '#CFE5F7', fg: colors.skyInk },
  ghost: { bg: 'transparent', pressed: colors.surfaceAlt, fg: colors.skyInk },
  danger: { bg: colors.dangerTint, pressed: '#F2CFCB', fg: colors.danger },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  iconRight,
  disabled,
  loading,
  accessibilityHint,
  style,
  compact,
}: ButtonProps) {
  const c = BUTTON_COLORS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      hitSlop={compact ? 6 : 0}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: pressed ? c.pressed : c.bg },
        c.border ? { borderWidth: 1, borderColor: c.border } : null,
        inactive ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={c.fg} /> : null}
          <AppText variant="bodyStrong" color={c.fg} numberOfLines={2} center>
            {label}
          </AppText>
          {iconRight ? <Icon name={iconRight} size={18} color={c.fg} /> : null}
        </>
      )}
    </Pressable>
  );
}

/** Text-style link button with a full-size touch target. */
export function LinkButton({
  label,
  onPress,
  icon,
  color = colors.skyInk,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      {icon ? <Icon name={icon} size={16} color={color} /> : null}
      <AppText variant="smallStrong" color={color}>
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  emoji?: string;
  icon?: IconName;
  tone?: 'sky' | 'peach';
  accessibilityHint?: string;
}

export function Chip({ label, selected, onPress, emoji, icon, tone = 'sky', accessibilityHint }: ChipProps) {
  const active =
    tone === 'peach'
      ? { bg: colors.peachTint, border: colors.peach, fg: colors.peachInk }
      : { bg: colors.skyTint, border: colors.sky, fg: colors.skyInk };
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        selected ? { backgroundColor: active.bg, borderColor: active.border } : null,
        pressed && onPress ? { opacity: 0.75 } : null,
      ]}
    >
      {emoji ? (
        <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">
          {emoji}
        </Text>
      ) : null}
      {icon ? <Icon name={icon} size={16} color={selected ? active.fg : colors.inkSoft} /> : null}
      <AppText variant="smallStrong" color={selected ? active.fg : colors.ink}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Single-choice row of chips (filters, settings). */
export function ChoiceRow<T>({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
}) {
  return (
    <View style={styles.choiceGroup} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <AppText variant="smallStrong">{label}</AppText>
      <View style={styles.wrapRow}>
        {options.map((option) => (
          <Chip
            key={String(option)}
            label={format(option)}
            selected={option === value}
            onPress={() => onChange(option)}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  tone = 'surface',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'surface' | 'sky' | 'peach';
}) {
  const bg = tone === 'sky' ? colors.skyTint : tone === 'peach' ? colors.peachTint : colors.surface;
  return <View style={[styles.card, { backgroundColor: bg }, style]}>{children}</View>;
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
        {action}
      </View>
      {children}
    </View>
  );
}

export interface ScreenProps {
  children: ReactNode;
  /** Pinned under the scroll content (primary actions). */
  footer?: ReactNode;
  scroll?: boolean;
  /** Tab screens already sit above the tab bar, so they skip the bottom inset. */
  inTabs?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({ children, footer, scroll = true, inTabs = false, contentStyle }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = inTabs ? spacing.lg : Math.max(insets.bottom, spacing.lg);
  const content = [
    styles.content,
    { paddingTop: insets.top + spacing.md },
    !footer && { paddingBottom: bottomPad + spacing.lg },
    contentStyle,
  ];
  return (
    // Tapping any empty area closes the keyboard. Buttons and inputs inside still get their own taps.
    <Pressable style={styles.screen} onPress={Keyboard.dismiss} accessible={false}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[content, styles.fill]}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: bottomPad }]}>{footer}</View> : null}
    </Pressable>
  );
}

export function TopBar({ onBack, title, right }: { onBack?: () => void; title?: string; right?: ReactNode }) {
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.surfaceAlt }]}
        >
          <Icon name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
      ) : (
        <View style={styles.iconButton} />
      )}
      {title ? (
        <AppText variant="smallStrong" numberOfLines={1} style={styles.topBarTitle} accessibilityRole="header">
          {title}
        </AppText>
      ) : (
        <View style={styles.topBarTitle} />
      )}
      <View style={styles.topBarRight}>{right}</View>
    </View>
  );
}

export function Row({
  children,
  gap = spacing.sm,
  style,
  wrap,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  return <View style={[styles.row, { gap }, wrap ? { flexWrap: 'wrap' } : null, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  button: {
    minHeight: touchTarget + 4,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonCompact: { minHeight: 44, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  disabled: { opacity: 0.5 },
  link: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    alignSelf: 'flex-start',
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  emoji: { fontSize: 16 },
  choiceGroup: { gap: spacing.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget, marginHorizontal: -spacing.sm },
  topBarTitle: { flex: 1, textAlign: 'center' },
  topBarRight: { minWidth: touchTarget, alignItems: 'flex-end' },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
