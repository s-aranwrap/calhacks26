/**
 * Status UI: loading / empty / error / offline states, notices, trust and
 * challenge badges, and fact rows that label estimated and unknown values.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { CHALLENGE_LABEL, type ChallengeAssessment } from '@/core/challenge';
import type { FactCertainty } from '@/core/format';
import type { Activity, ChallengeLevel } from '@/core/types';

import { colors, radius, spacing } from '../theme';
import { Mascot, type MascotFace } from './Mascot';
import { AppText, Button, Icon, type IconName } from './primitives';

// ---------------------------------------------------------------------------
// Full-area states
// ---------------------------------------------------------------------------

export function LoadingState({ label = 'Just a moment…' }: { label?: string }) {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} size="large" />
      <AppText variant="small" center>
        {label}
      </AppText>
    </View>
  );
}

export interface StateViewProps {
  title: string;
  message?: string;
  face?: MascotFace;
  actions?: ReactNode;
}

/** Friendly empty/error state with the mascot. */
export function StateView({ title, message, face = 'calm', actions }: StateViewProps) {
  return (
    <View style={styles.state}>
      <Mascot size={96} face={face} />
      <AppText variant="heading" center accessibilityRole="header">
        {title}
      </AppText>
      {message ? (
        <AppText variant="small" center>
          {message}
        </AppText>
      ) : null}
      {actions ? <View style={styles.stateActions}>{actions}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <StateView
      title="Something went sideways"
      message={message}
      face="sleepy"
      actions={onRetry ? <Button label="Try again" icon="refresh" variant="secondary" onPress={onRetry} /> : null}
    />
  );
}

// ---------------------------------------------------------------------------
// Inline notices
// ---------------------------------------------------------------------------

type NoticeTone = 'info' | 'warning' | 'success' | 'offline';

const NOTICE: Record<NoticeTone, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: colors.skyTint, fg: colors.skyInk, icon: 'information-circle-outline' },
  warning: { bg: colors.warningTint, fg: colors.warning, icon: 'alert-circle-outline' },
  success: { bg: colors.successTint, fg: colors.success, icon: 'checkmark-circle-outline' },
  offline: { bg: colors.surfaceAlt, fg: colors.inkSoft, icon: 'cloud-offline-outline' },
};

export function Notice({ tone = 'info', children, icon }: { tone?: NoticeTone; children: ReactNode; icon?: IconName }) {
  const n = NOTICE[tone];
  return (
    <View style={[styles.notice, { backgroundColor: n.bg }]} accessibilityRole="text">
      <Icon name={icon ?? n.icon} size={18} color={n.fg} />
      <View style={styles.noticeBody}>
        {isTextLike(children) ? (
          <AppText variant="small" color={n.fg}>
            {children}
          </AppText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** Plain text (or an array of text pieces) must be wrapped in <Text> on native. */
function isTextLike(node: ReactNode): boolean {
  if (typeof node === 'string' || typeof node === 'number') return true;
  return Array.isArray(node) && node.every((n) => typeof n === 'string' || typeof n === 'number');
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const CHALLENGE_STYLE: Record<ChallengeLevel, { bg: string; fg: string; icon: IconName }> = {
  easy: { bg: colors.successTint, fg: colors.success, icon: 'leaf-outline' },
  moderate: { bg: colors.skyTint, fg: colors.skyInk, icon: 'trending-up-outline' },
  stretch: { bg: colors.blushTint, fg: colors.blushInk, icon: 'flash-outline' },
};

export function ChallengeBadge({ challenge }: { challenge: ChallengeAssessment | ChallengeLevel }) {
  const level = typeof challenge === 'string' ? challenge : challenge.level;
  const s = CHALLENGE_STYLE[level];
  return (
    <View
      style={[styles.badge, { backgroundColor: s.bg }]}
      accessibilityLabel={`Challenge level: ${CHALLENGE_LABEL[level]}`}
      accessible
    >
      <Icon name={s.icon} size={13} color={s.fg} />
      <AppText variant="caption" color={s.fg}>
        {CHALLENGE_LABEL[level]}
      </AppText>
    </View>
  );
}

export function TrustBadge({ activity }: { activity: Activity }) {
  const status = activity.verification.status;
  const config =
    status === 'verified'
      ? { label: 'Verified', bg: colors.successTint, fg: colors.success, icon: 'shield-checkmark-outline' as IconName }
      : status === 'demo'
        ? { label: 'Sample', bg: colors.surfaceAlt, fg: colors.inkSoft, icon: 'flask-outline' as IconName }
        : { label: 'Unverified', bg: colors.warningTint, fg: colors.warning, icon: 'help-circle-outline' as IconName };
  const a11y =
    status === 'demo'
      ? 'Sample listing, not a real event'
      : status === 'verified'
        ? 'Details verified by the source'
        : 'Details not verified';
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]} accessible accessibilityLabel={a11y}>
      <Icon name={config.icon} size={13} color={config.fg} />
      <AppText variant="caption" color={config.fg}>
        {config.label}
      </AppText>
    </View>
  );
}

export function CertaintyTag({ certainty }: { certainty: FactCertainty }) {
  if (certainty === 'verified') return null;
  return (
    <View style={[styles.tag, certainty === 'unknown' ? styles.tagUnknown : styles.tagEstimated]}>
      <AppText variant="caption" color={certainty === 'unknown' ? colors.inkMuted : colors.warning}>
        {certainty === 'unknown' ? 'unknown' : 'estimate'}
      </AppText>
    </View>
  );
}

/** Icon + text, with an "estimate"/"unknown" tag when the value isn't verified. */
export function FactRow({
  icon,
  text,
  certainty,
  detail,
}: {
  icon: IconName;
  text: string;
  certainty?: FactCertainty;
  detail?: string;
}) {
  const suffix = certainty === 'estimated' ? ', estimated' : certainty === 'unknown' ? ', not known' : '';
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${text}${detail ? `, ${detail}` : ''}${suffix}`}>
      <Icon name={icon} size={18} color={colors.inkSoft} />
      <View style={styles.factBody}>
        <View style={styles.factLine}>
          <AppText variant="body" color={certainty === 'unknown' ? colors.inkMuted : colors.ink}>
            {text}
          </AppText>
          {certainty ? <CertaintyTag certainty={certainty} /> : null}
        </View>
        {detail ? <AppText variant="small">{detail}</AppText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  state: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  stateActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  noticeBody: { flex: 1, gap: spacing.xs },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm },
  tagEstimated: { backgroundColor: colors.warningTint },
  tagUnknown: { backgroundColor: colors.surfaceAlt },
  fact: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  factBody: { flex: 1, gap: 2 },
  factLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});
