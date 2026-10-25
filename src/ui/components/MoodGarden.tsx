/**
 * The Penguin Mood Garden: six penguin characters scattered like a little
 * huddle. The penguins themselves are the controls. Selecting one draws a
 * soft blob behind it, adds a check badge and bolds its label (so selection
 * never relies on color alone); a fourth pick is refused with an inline note.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { MAX_MOOD_PICKS, MOOD_PICKS, type MoodPick } from '@/core/discovery';

import { colors, fonts, spacing } from '../theme';
import { useReducedMotion } from '../useReducedMotion';
import { PENGUIN_VIEWBOX, PenguinArt, type PenguinArtProps } from './Mascot';
import { AppText } from './primitives';

export const MOOD_META: Record<MoodPick, { label: string; hint: string; highlight: string }> = {
  chill: { label: 'Chill', hint: 'Easygoing, low-key plans', highlight: colors.sky },
  creative: { label: 'Creative', hint: 'Making, art and ideas', highlight: colors.blush },
  social: { label: 'Social', hint: 'Being around people', highlight: colors.blush },
  peaceful: { label: 'Peaceful', hint: 'Quiet and restful', highlight: colors.teal },
  adventurous: { label: 'Adventurous', hint: 'Out and about, something new', highlight: colors.teal },
  energetic: { label: 'Energetic', hint: 'Get moving', highlight: colors.sky },
};

// --- Characters --------------------------------------------------------------

const brush = (
  <G>
    <Path d="M846 640 L912 506" stroke={colors.primaryAccent} strokeWidth={18} strokeLinecap="round" />
    <Path d="M900 520 C904 488 922 470 940 468 C944 490 934 516 912 530 Z" fill={colors.sky} />
  </G>
);

const beret = (
  <G>
    <Path d="M372 268 C380 196 560 150 660 214 C700 240 690 284 640 284 C560 262 450 268 372 268 Z" fill={colors.blush} />
    <Circle cx={548} cy={184} r={20} fill={colors.blush} />
  </G>
);

const backpack = (
  <G>
    <Rect x={650} y={470} width={150} height={250} rx={46} fill={colors.teal} />
    <Rect x={672} y={500} width={106} height={70} rx={26} fill={colors.sky} />
  </G>
);

const backpackStraps = (
  <G>
    <Path d="M404 556 C398 620 400 680 410 740" stroke={colors.tealInk} strokeWidth={22} strokeLinecap="round" fill="none" />
    <Path d="M620 556 C626 620 624 680 614 740" stroke={colors.tealInk} strokeWidth={22} strokeLinecap="round" fill="none" />
  </G>
);

const bowTie = (
  <G>
    <Path d="M512 592 L446 560 L446 624 Z" fill={colors.primaryAccent} />
    <Path d="M512 592 L578 560 L578 624 Z" fill={colors.primaryAccent} />
    <Circle cx={512} cy={592} r={18} fill={colors.primary} />
  </G>
);

const waveLines = (
  <G stroke={colors.sky} strokeWidth={14} strokeLinecap="round" fill="none">
    <Path d="M190 300 Q160 330 168 370" />
    <Path d="M150 270 Q110 320 122 380" />
  </G>
);

const flower = (
  <G>
    {[0, 72, 144, 216, 288].map((a) => (
      <Circle
        key={a}
        cx={650 + 26 * Math.cos((a * Math.PI) / 180)}
        cy={246 + 26 * Math.sin((a * Math.PI) / 180)}
        r={20}
        fill={colors.blush}
      />
    ))}
    <Circle cx={650} cy={246} r={14} fill="#F2D98A" />
  </G>
);

const headband = (
  <G>
    <Path d="M318 352 C420 300 604 300 706 352 L706 392 C604 344 420 344 318 392 Z" fill={colors.blush} />
  </G>
);

const sparkles = (
  <G fill={colors.blush}>
    <Path d="M180 300 L192 330 L222 342 L192 354 L180 384 L168 354 L138 342 L168 330 Z" />
    <Path d="M858 280 L866 300 L886 308 L866 316 L858 336 L850 316 L830 308 L850 300 Z" />
  </G>
);

const CHARACTERS: Record<MoodPick, PenguinArtProps> = {
  chill: { lean: -9, eyes: 'relaxed', scarf: colors.sky, cheekOpacity: 0.7 },
  creative: { rightFlipper: 40, front: <>{beret}{brush}</> },
  social: { leftFlipper: 122, behind: waveLines, front: bowTie },
  peaceful: { eyes: 'closed', cheekOpacity: 0.8, front: flower },
  adventurous: { behind: backpack, front: backpackStraps, rightFlipper: 12 },
  energetic: { leftFlipper: 104, rightFlipper: 104, eyes: 'joyful', behind: sparkles, front: headband },
};

// Organic highlight: one irregular blob, turned differently per penguin.
const BLOB =
  'M540 206 C650 170 790 230 834 360 C870 470 880 560 828 670 C772 790 660 860 530 840 C420 824 360 870 262 812 C160 752 150 620 186 520 C214 440 190 360 252 290 C330 204 440 238 540 206 Z';
const BLOB_TURN: Record<MoodPick, number> = {
  chill: 0,
  creative: 70,
  social: 150,
  peaceful: 220,
  adventurous: 290,
  energetic: 330,
};

// --- Layout -------------------------------------------------------------------

/** Center x (fraction of width) and a vertical nudge (fraction of penguin size) per mood. */
const SPOTS: Record<MoodPick, { x: number; dy: number }> = {
  chill: { x: 0.27, dy: 0 },
  creative: { x: 0.74, dy: 0.22 },
  social: { x: 0.22, dy: 0.12 },
  peaceful: { x: 0.7, dy: 0.34 },
  adventurous: { x: 0.31, dy: 0.18 },
  energetic: { x: 0.77, dy: 0.42 },
};

const LABEL_SPACE = 30;

export interface MoodGardenProps {
  selected: readonly MoodPick[];
  onToggle: (mood: MoodPick) => void;
  /** Shown under the garden after a refused fourth pick. */
  limitMessage?: string | null;
}

export function MoodGarden({ selected, onToggle, limitMessage }: MoodGardenProps) {
  const [width, setWidth] = useState(0);
  const { height: screenHeight } = useWindowDimensions();
  const full = selected.length >= MAX_MOOD_PICKS;

  // Penguins grow with the width but shrink on short screens so all six stay in view.
  const size = width ? Math.round(Math.max(76, Math.min(width * 0.3, (screenHeight - 400) / 3.4, 124))) : 0;
  const rowHeight = size + LABEL_SPACE + spacing.sm;
  const height = size ? rowHeight * 3 + size * 0.42 : 0;

  return (
    <View>
      <View
        style={[styles.garden, { height: height || 360 }]}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      >
        {size
          ? MOOD_PICKS.map((mood, i) => {
              const spot = SPOTS[mood];
              const itemWidth = size + spacing.lg;
              return (
                <View
                  key={mood}
                  style={[
                    styles.spot,
                    {
                      width: itemWidth,
                      left: Math.min(Math.max(0, spot.x * width - itemWidth / 2), width - itemWidth),
                      top: Math.floor(i / 2) * rowHeight + spot.dy * size,
                    },
                  ]}
                >
                  <MoodPenguinButton
                    mood={mood}
                    size={size}
                    selected={selected.includes(mood)}
                    muted={full && !selected.includes(mood)}
                    onPress={() => onToggle(mood)}
                  />
                </View>
              );
            })
          : null}
      </View>
      <View accessibilityLiveRegion="polite" style={styles.limit}>
        {limitMessage ? (
          <AppText variant="small" center color={colors.primaryInk}>
            {limitMessage}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export function MoodPenguinButton({
  mood,
  size,
  selected,
  muted,
  onPress,
}: {
  mood: MoodPick;
  size: number;
  selected: boolean;
  muted: boolean;
  onPress: () => void;
}) {
  const meta = MOOD_META[mood];
  const reduceMotion = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!selected || reduceMotion) return;
    scale.setValue(0.92);
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [reduceMotion, scale, selected]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} mood`}
      accessibilityHint={muted ? 'Three moods already picked. Deselect one first.' : meta.hint}
      accessibilityState={{ selected, disabled: muted }}
      style={({ pressed }) => [styles.penguin, muted && styles.muted, pressed && styles.pressed]}
    >
      <Animated.View style={{ width: size, height: size, transform: [{ scale }] }}>
        <Svg width={size} height={size} viewBox={PENGUIN_VIEWBOX}>
          {selected ? (
            <Path d={BLOB} fill={meta.highlight} opacity={0.55} transform={`rotate(${BLOB_TURN[mood]} 512 540)`} />
          ) : null}
          <Ellipse cx={512} cy={884} rx={230} ry={24} fill={colors.ink} opacity={0.07} />
          <PenguinArt {...CHARACTERS[mood]} />
        </Svg>
        {selected ? <CheckBadge /> : null}
      </Animated.View>
      <AppText
        variant="small"
        center
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={[styles.label, selected && styles.labelSelected]}
      >
        {meta.label}
      </AppText>
    </Pressable>
  );
}

function CheckBadge(): ReactNode {
  return (
    <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name="checkmark" size={16} color={colors.white} />
    </View>
  );
}

const styles = StyleSheet.create({
  garden: { width: '100%' },
  spot: { position: 'absolute', alignItems: 'center' },
  penguin: { alignItems: 'center', gap: 2, minWidth: 44, minHeight: 44 },
  muted: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  label: { color: colors.ink, fontFamily: fonts.medium },
  labelSelected: { fontFamily: fonts.bold, color: colors.primaryInk },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limit: { minHeight: 22, marginTop: spacing.xs },
});
