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

import { colors, gutter, radius, shadow, spacing, touchTarget, type, type TypeVariant } from '../theme';

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
  primary: { bg: colors.primary, pressed: colors.primaryPressed, fg: colors.white },
  secondary: { bg: colors.surface, pressed: colors.surfaceAlt, fg: colors.ink, border: colors.primaryAccent },
  soft: { bg: colors.primaryTint, pressed: '#F1D3DC', fg: colors.primaryInk },
  ghost: { bg: 'transparent', pressed: colors.surfaceAlt, fg: colors.primaryInk },
  danger: { bg: colors.dangerTint, pressed: '#F5CDD1', fg: colors.danger },
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
        c.border ? { borderWidth: 1.5, borderColor: c.border } : null,
        inactive ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={c.fg} /> : null}
          <AppText variant={compact ? 'bodyStrong' : 'label'} color={c.fg} numberOfLines={2} center>
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
  color = colors.primaryInk,
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
  accessibilityHint?: string;
}

/** Selected chips get a tint, a stronger outline and a check, so the state never rests on color alone. */
export function Chip({ label, selected, onPress, emoji, icon, accessibilityHint }: ChipProps) {
  const active = { bg: colors.primaryTint, border: colors.primaryAccent, fg: colors.primaryInk };
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
      {selected && onPress && !icon && !emoji ? <Icon name="checkmark" size={16} color={active.fg} /> : null}
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
  tone?: CardTone;
}) {
  const t = CARD_TONES[tone];
  return <View style={[styles.card, { backgroundColor: t.bg, borderColor: t.border }, tone !== 'surface' && styles.flat, style]}>{children}</View>;
}

export type CardTone = 'surface' | 'primary' | 'blush' | 'sky' | 'teal';
const CARD_TONES: Record<CardTone, { bg: string; border: string }> = {
  surface: { bg: colors.surface, border: colors.borderSoft },
  primary: { bg: colors.primaryTint, border: colors.primaryTint },
  blush: { bg: colors.blushTint, border: colors.blushTint },
  sky: { bg: colors.skyTint, border: colors.skyTint },
  teal: { bg: colors.tealTint, border: colors.tealTint },
};

/** Screen title with an optional one-line subtitle. */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.screenHeader}>
      <View style={styles.screenHeaderText}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? <AppText variant="body" color={colors.inkSoft}>{subtitle}</AppText> : null}
      </View>
      {right}
    </View>
  );
}

/** A labelled show/hide section (progressive disclosure). */
export function Disclosure({
  label,
  open,
  onToggle,
  summary,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.disclosure}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        {...(summary ? { accessibilityHint: summary } : {})}
        style={({ pressed }) => [styles.disclosureHeader, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.shrink}>
          <AppText variant="bodyStrong">{label}</AppText>
          {summary && !open ? (
            <AppText variant="caption" numberOfLines={1}>
              {summary}
            </AppText>
          ) : null}
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.ink} />
      </Pressable>
      {open ? <View style={styles.disclosureBody}>{children}</View> : null}
    </View>
  );
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
    <View style={styles.screen}>
      {/* Scrolling screens: dragging or tapping empty space closes the keyboard ("handled" lets
          buttons still receive the tap). Don't wrap the ScrollView in a Pressable: it fights the scroll gesture. */}
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
        // Non-scrolling screens have nothing to drag, so a tap on empty space closes the keyboard.
        <Pressable style={[content, styles.fill]} onPress={Keyboard.dismiss} accessible={false}>
          {children}
        </Pressable>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: bottomPad }]}>{footer}</View> : null}
    </View>
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
          style={({ pressed }) => [styles.iconButton, styles.backButton, pressed && { backgroundColor: colors.surfaceAlt }]}
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
  content: { paddingHorizontal: gutter, gap: spacing.lg },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  button: {
    minHeight: 54,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonCompact: { minHeight: 44, borderRadius: 14, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
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
  shrink: { flexShrink: 1 },
  flat: { shadowOpacity: 0, elevation: 0 },
  screenHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  screenHeaderText: { flex: 1, gap: spacing.xs },
  disclosure: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  disclosureHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  disclosureBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xl },
  emoji: { fontSize: 16 },
  choiceGroup: { gap: spacing.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg + 2,
    gap: spacing.md,
    borderWidth: 1,
    ...shadow,
  },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget, gap: spacing.sm },
  topBarTitle: { flex: 1, textAlign: 'center' },
  topBarRight: { minWidth: touchTarget, alignItems: 'flex-end' },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
