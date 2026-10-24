/**
 * Huddle's penguin: an original mascot drawn from simple vector shapes
 * (no external art). Variants change the scarf color, expression and pose so
 * the penguins welcomed into a user's huddle look a little different.
 *
 * The same shapes live in assets/mascot.svg, which scripts/generate-icons.mjs
 * uses to render the app icon and splash image.
 */
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { colors } from '../theme';

export type MascotPose = 'standing' | 'waving' | 'cheering';
export type MascotFace = 'happy' | 'calm' | 'sleepy';

export interface MascotProps {
  size?: number;
  scarf?: string;
  pose?: MascotPose;
  face?: MascotFace;
  /** Decorative by default; pass a label when the penguin conveys meaning. */
  accessibilityLabel?: string;
}

export const SCARF_COLORS = ['#F4B596', '#7DB9E8', '#9ED2B5', '#F2C66D', '#C9A7E6', '#F28F8F'] as const;

const BODY = 'M60 18 C36 18 30 44 30 70 C30 96 42 108 60 108 C78 108 90 96 90 70 C90 44 84 18 60 18 Z';
const BELLY = 'M60 40 C46 40 40 56 40 74 C40 94 48 102 60 102 C72 102 80 94 80 74 C80 56 74 40 60 40 Z';
const SCARF = 'M38 58 C50 64 70 64 82 58 L82 66 C70 72 50 72 38 66 Z';
const SCARF_TAIL = 'M70 64 L78 84 L70 82 L66 66 Z';
const WING_DOWN_LEFT = 'M36 66 C24 76 22 92 28 102 C34 94 40 84 44 74 Z';
const WING_DOWN_RIGHT = 'M84 66 C96 76 98 92 92 102 C86 94 80 84 76 74 Z';
const WING_UP_LEFT = 'M38 70 C22 58 18 42 24 34 C30 44 36 54 44 62 Z';
const WING_UP_RIGHT = 'M82 70 C98 58 102 42 96 34 C90 44 84 54 76 62 Z';

export function Mascot({
  size = 120,
  scarf = SCARF_COLORS[0],
  pose = 'standing',
  face = 'happy',
  accessibilityLabel,
}: MascotProps) {
  const leftWing = pose === 'cheering' ? WING_UP_LEFT : WING_DOWN_LEFT;
  const rightWing = pose === 'standing' ? WING_DOWN_RIGHT : WING_UP_RIGHT;
  const labelled = !!accessibilityLabel;

  return (
    <View
      style={{ width: size, height: size }}
      accessible={labelled}
      accessibilityRole={labelled ? 'image' : 'none'}
      {...(labelled ? { accessibilityLabel } : {})}
      accessibilityElementsHidden={!labelled}
      importantForAccessibility={labelled ? 'yes' : 'no-hide-descendants'}
    >
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Ellipse cx={60} cy={112} rx={28} ry={5} fill="#000000" opacity={0.07} />
        <G>
          <Path d={leftWing} fill={colors.penguin} />
          <Path d={rightWing} fill={colors.penguin} />
          <Path d={BODY} fill={colors.penguin} />
          <Path d={BELLY} fill={colors.penguinBelly} />
          <Ellipse cx={60} cy={44} rx={20} ry={14} fill={colors.penguinBelly} />
          <Ellipse cx={49} cy={108} rx={8} ry={4} fill={colors.beak} />
          <Ellipse cx={71} cy={108} rx={8} ry={4} fill={colors.beak} />
          <Path d={SCARF} fill={scarf} />
          <Path d={SCARF_TAIL} fill={scarf} />
          {face === 'sleepy' ? (
            <>
              <Path
                d="M47 41 Q51 44 55 41"
                stroke={colors.penguin}
                strokeWidth={2.4}
                strokeLinecap="round"
                fill="none"
              />
              <Path
                d="M65 41 Q69 44 73 41"
                stroke={colors.penguin}
                strokeWidth={2.4}
                strokeLinecap="round"
                fill="none"
              />
            </>
          ) : (
            <>
              <Circle cx={51} cy={41} r={3.4} fill={colors.penguin} />
              <Circle cx={69} cy={41} r={3.4} fill={colors.penguin} />
              <Circle cx={52.2} cy={39.8} r={1.1} fill="#FFFFFF" />
              <Circle cx={70.2} cy={39.8} r={1.1} fill="#FFFFFF" />
            </>
          )}
          <Circle cx={45} cy={48} r={3.2} fill={colors.peach} opacity={face === 'calm' ? 0.35 : 0.6} />
          <Circle cx={75} cy={48} r={3.2} fill={colors.peach} opacity={face === 'calm' ? 0.35 : 0.6} />
          <Path d={face === 'happy' ? 'M55 48 L65 48 L60 54 Z' : 'M56 48 L64 48 L60 52 Z'} fill={colors.beak} />
        </G>
      </Svg>
    </View>
  );
}

/** A row of small penguins, one per completed adventure (capped). Decorative. */
export function PenguinHuddle({ count, size = 40, max = 8 }: { count: number; size?: number; max?: number }) {
  const shown = Math.min(count, max);
  if (shown === 0) return null;
  const viewWidth = shown * 86 + 34;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={(viewWidth / 120) * size} height={size} viewBox={`0 0 ${viewWidth} 120`}>
        {Array.from({ length: shown }, (_, i) => (
          <G key={i} transform={`translate(${i * 86 - 13}, 0)`}>
            <Path d={BODY} fill={colors.penguin} />
            <Path d={BELLY} fill={colors.penguinBelly} />
            <Ellipse cx={60} cy={44} rx={20} ry={14} fill={colors.penguinBelly} />
            <Path d={SCARF} fill={SCARF_COLORS[i % SCARF_COLORS.length]} />
            <Circle cx={51} cy={41} r={3.4} fill={colors.penguin} />
            <Circle cx={69} cy={41} r={3.4} fill={colors.penguin} />
            <Path d="M55 48 L65 48 L60 54 Z" fill={colors.beak} />
          </G>
        ))}
      </Svg>
    </View>
  );
}
