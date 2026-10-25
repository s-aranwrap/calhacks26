/**
 * Activity artwork with one branded fallback, used everywhere an activity
 * appears (recommendations, details, My Adventures). Images keep a fixed
 * aspect ratio and cover-crop; a missing or broken image never shows a
 * broken-image icon.
 */
import { useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Activity, Category } from '@/core/types';

import { colors, radius } from '../theme';
import { Mascot } from './Mascot';
import { Icon } from './primitives';
import { CATEGORY_ICON, CATEGORY_LABEL } from '../activityMeta';

const FALLBACK_TINT: Record<Category, { bg: string; fg: string }> = {
  outdoors: { bg: colors.tealTint, fg: colors.tealInk },
  wellness: { bg: colors.tealTint, fg: colors.tealInk },
  fitness: { bg: colors.skyTint, fg: colors.skyInk },
  games: { bg: colors.skyTint, fg: colors.skyInk },
  learning: { bg: colors.skyTint, fg: colors.skyInk },
  arts: { bg: colors.blushTint, fg: colors.blushInk },
  music: { bg: colors.blushTint, fg: colors.blushInk },
  culture: { bg: colors.primaryTint, fg: colors.primaryInk },
  food: { bg: colors.primaryTint, fg: colors.primaryInk },
  community: { bg: colors.blushTint, fg: colors.blushInk },
  other: { bg: colors.surfaceAlt, fg: colors.inkSoft },
};

export function ActivityImage({
  activity,
  aspectRatio = 16 / 9,
  rounded = 'top',
  style,
}: {
  activity: Activity;
  aspectRatio?: number;
  rounded?: 'top' | 'all' | 'none';
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const corners =
    rounded === 'all'
      ? { borderRadius: radius.lg }
      : rounded === 'top'
        ? { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }
        : null;

  if (activity.imageUrl && !failed) {
    return (
      <View style={[styles.frame, { aspectRatio }, corners, style]}>
        <Image
          source={{ uri: activity.imageUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed(true)}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Photo for ${activity.title}`}
        />
      </View>
    );
  }
  return <ActivityImageFallback category={activity.category} aspectRatio={aspectRatio} style={[corners, style]} />;
}

/** Decorative: a calm tinted panel with the category icon and a small penguin. */
export function ActivityImageFallback({
  category,
  aspectRatio = 16 / 9,
  style,
}: {
  category: Category;
  aspectRatio?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const tint = FALLBACK_TINT[category];
  return (
    <View
      style={[styles.frame, styles.fallback, { aspectRatio, backgroundColor: tint.bg }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessibilityLabel={CATEGORY_LABEL[category]}
    >
      <View style={[styles.iconBubble, { borderColor: tint.fg }]}>
        <Icon name={CATEGORY_ICON[category]} size={26} color={tint.fg} />
      </View>
      <View style={styles.penguin}>
        <Mascot size={64} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  iconBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  penguin: { position: 'absolute', right: 12, bottom: -6 },
});
