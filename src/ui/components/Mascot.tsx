/**
 * Huddle's penguin, drawn from the original mascot artwork (assets/mascot.svg,
 * which scripts/generate-icons.mjs also uses for the app icon). Every penguin
 * in the app shares this silhouette: rounded head, plump charcoal body, white
 * face and belly, small flippers and orange feet. Poses, eyes and tiny
 * accessories give the mood penguins their personalities.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { colors } from '../theme';

export type MascotPose = 'standing' | 'waving' | 'cheering';
export type MascotFace = 'happy' | 'calm' | 'sleepy';

/** Flipper angle in degrees around the shoulder; 0 hangs down like the original art. */
export type FlipperAngle = number;
export type PenguinEyes = 'open' | 'relaxed' | 'closed' | 'joyful';

export interface PenguinArtProps {
  leftFlipper?: FlipperAngle;
  rightFlipper?: FlipperAngle;
  eyes?: PenguinEyes;
  /** Whole-body lean in degrees (negative leans left), pivoting at the feet. */
  lean?: number;
  /** Drawn behind the penguin (backpacks, highlights). */
  behind?: ReactNode;
  /** Drawn on top (hats, scarves, props). */
  front?: ReactNode;
  scarf?: string;
  cheekOpacity?: number;
}

/** Shared view box: the 1024-unit original, cropped so raised flippers and props still fit. */
export const PENGUIN_VIEWBOX = '112 120 800 800';

const FOOT_LEFT = 'M355 824 C316 819 289 844 301 865 C313 885 376 889 424 873 C447 865 444 846 420 836 Z';
const FOOT_RIGHT = 'M669 824 C708 819 735 844 723 865 C711 885 648 889 600 873 C577 865 580 846 604 836 Z';
const FLIPPER_LEFT = 'M350 505 C300 539 258 619 247 694 C242 726 263 743 290 729 L365 681 Z';
const FLIPPER_RIGHT = 'M674 505 C724 539 766 619 777 694 C782 726 761 743 734 729 L659 681 Z';
const BODY =
  'M302 437 C302 278 392 190 512 190 C632 190 722 278 722 437 L722 692 C722 789 636 832 512 832 C388 832 302 789 302 692 Z';
const FACE =
  'M330 434 C330 319 405 259 465 282 C489 291 499 317 512 317 C525 317 535 291 559 282 C619 259 694 319 694 434 C694 524 631 581 512 581 C393 581 330 524 330 434 Z';
const BELLY =
  'M337 601 C371 560 423 543 512 543 C601 543 653 560 687 601 C707 627 710 685 694 733 C672 790 607 807 512 807 C417 807 352 790 330 733 C314 685 317 627 337 601 Z';
const BEAK = 'M468 445 C482 431 542 431 556 445 C565 454 543 477 512 491 C481 477 459 454 468 445 Z';
const SCARF = 'M330 556 C420 598 604 598 694 556 L700 606 C604 650 420 650 324 606 Z';
const SCARF_TAIL = 'M596 612 L640 702 L604 708 L578 624 Z';

const EYE_X = [419, 605] as const;

function Eyes({ kind }: { kind: PenguinEyes }) {
  const stroke = { stroke: colors.penguin, strokeWidth: 16, strokeLinecap: 'round' as const, fill: 'none' };
  switch (kind) {
    case 'closed':
      return (
        <>
          {EYE_X.map((x) => (
            <Path key={x} d={`M${x - 30} 418 Q${x} 446 ${x + 30} 418`} {...stroke} />
          ))}
        </>
      );
    case 'joyful':
      return (
        <>
          {EYE_X.map((x) => (
            <Path key={x} d={`M${x - 30} 432 Q${x} 396 ${x + 30} 432`} {...stroke} />
          ))}
        </>
      );
    case 'relaxed':
      return (
        <>
          {EYE_X.map((x) => (
            <G key={x}>
              <Path d={`M${x - 32} 416 A32 30 0 0 0 ${x + 32} 416 Z`} fill={colors.penguin} />
              <Path d={`M${x - 36} 414 L${x + 36} 414`} {...stroke} strokeWidth={12} />
            </G>
          ))}
        </>
      );
    case 'open':
      return (
        <>
          <Ellipse cx={419} cy={419} rx={32} ry={39} fill={colors.penguin} />
          <Ellipse cx={605} cy={419} rx={32} ry={39} fill={colors.penguin} />
          <Circle cx={429} cy={405} r={9} fill="#FFFFFF" />
          <Circle cx={615} cy={405} r={9} fill="#FFFFFF" />
        </>
      );
  }
}

/** The penguin itself, as SVG children (no <Svg> wrapper) so callers can compose scenes. */
export function PenguinArt({
  leftFlipper = 0,
  rightFlipper = 0,
  eyes = 'open',
  lean = 0,
  behind,
  front,
  scarf,
  cheekOpacity = 1,
}: PenguinArtProps) {
  return (
    <G transform={lean ? `rotate(${lean} 512 860)` : undefined}>
      {behind}
      <Path d={FOOT_LEFT} fill={colors.beak} />
      <Path d={FOOT_RIGHT} fill={colors.beak} />
      <Path d={FLIPPER_LEFT} fill={colors.penguin} transform={`rotate(${leftFlipper} 350 515)`} />
      <Path d={FLIPPER_RIGHT} fill={colors.penguin} transform={`rotate(${-rightFlipper} 674 515)`} />
      <Path d={BODY} fill={colors.penguin} />
      <Path d={FACE} fill={colors.penguinBelly} />
      <Path d={BELLY} fill={colors.penguinBelly} />
      <Eyes kind={eyes} />
      <Ellipse cx={371} cy={469} rx={30} ry={20} fill={colors.cheek} opacity={cheekOpacity} />
      <Ellipse cx={653} cy={469} rx={30} ry={20} fill={colors.cheek} opacity={cheekOpacity} />
      <Path d={BEAK} fill={colors.beak} />
      {scarf ? (
        <>
          <Path d={SCARF} fill={scarf} />
          <Path d={SCARF_TAIL} fill={scarf} />
        </>
      ) : null}
      {front}
    </G>
  );
}

export interface MascotProps {
  size?: number;
  /** Optional little scarf, used to tell huddle penguins apart. */
  scarf?: string;
  pose?: MascotPose;
  face?: MascotFace;
  /** Decorative by default; pass a label when the penguin conveys meaning. */
  accessibilityLabel?: string;
}

/** Pastel scarves from the Huddle palette. */
export const SCARF_COLORS = [colors.blush, colors.sky, colors.teal, colors.primaryAccent, '#F2D98A'] as const;

const POSE_FLIPPERS: Record<MascotPose, [number, number]> = {
  standing: [0, 0],
  waving: [0, 118],
  cheering: [100, 100],
};

const FACE_EYES: Record<MascotFace, PenguinEyes> = { happy: 'open', calm: 'open', sleepy: 'closed' };

export function Mascot({ size = 120, scarf, pose = 'standing', face = 'happy', accessibilityLabel }: MascotProps) {
  const labelled = !!accessibilityLabel;
  const [left, right] = POSE_FLIPPERS[pose];
  return (
    <View
      style={{ width: size, height: size }}
      accessible={labelled}
      accessibilityRole={labelled ? 'image' : 'none'}
      {...(labelled ? { accessibilityLabel } : {})}
      accessibilityElementsHidden={!labelled}
      importantForAccessibility={labelled ? 'yes' : 'no-hide-descendants'}
    >
      <Svg width={size} height={size} viewBox={PENGUIN_VIEWBOX}>
        <Ellipse cx={512} cy={880} rx={240} ry={26} fill={colors.ink} opacity={0.06} />
        <PenguinArt
          leftFlipper={left}
          rightFlipper={right}
          eyes={FACE_EYES[face]}
          cheekOpacity={face === 'calm' ? 0.6 : 1}
          {...(scarf ? { scarf } : {})}
        />
      </Svg>
    </View>
  );
}

/** A row of small penguins, one per completed adventure (capped). Decorative. */
export function PenguinHuddle({ count, size = 40, max = 8 }: { count: number; size?: number; max?: number }) {
  const shown = Math.min(count, max);
  if (shown === 0) return null;
  const step = 470;
  const viewWidth = (shown - 1) * step + 560;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={(viewWidth / 720) * size} height={size} viewBox={`232 170 ${viewWidth} 720`}>
        {Array.from({ length: shown }, (_, i) => (
          <G key={i} transform={`translate(${i * step}, 0)`}>
            <PenguinArt scarf={SCARF_COLORS[i % SCARF_COLORS.length]} />
          </G>
        ))}
      </Svg>
    </View>
  );
}
