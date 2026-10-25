/**
 * A small, inline "a penguin joined your huddle" moment after completing an
 * adventure. It never blocks the screen and is static when the system's
 * Reduce Motion setting is on.
 */
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '../useReducedMotion';
import { colors, radius, spacing } from '../theme';
import { Mascot, SCARF_COLORS } from './Mascot';
import { AppText } from './primitives';

const PENGUIN_NAMES = [
  'Pip',
  'Juniper',
  'Biscuit',
  'Sol',
  'Maple',
  'Nori',
  'Pebble',
  'Clementine',
  'Fig',
  'Ollie',
  'Wren',
  'Toast',
];

/** The nth penguin (1-based) always has the same name and scarf. */
export function penguinFor(n: number): { name: string; scarf: string } {
  const index = Math.max(0, n - 1);
  return {
    name: PENGUIN_NAMES[index % PENGUIN_NAMES.length]!,
    scarf: SCARF_COLORS[index % SCARF_COLORS.length]!,
  };
}

export function Celebration({ penguinNumber }: { penguinNumber: number }) {
  const reduceMotion = useReducedMotion();
  // Lazy state keeps one Animated.Value per mount without reading refs during render.
  const [scale] = useState(() => new Animated.Value(reduceMotion ? 1 : 0.6));
  const [opacity] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  const { name, scarf } = penguinFor(penguinNumber);

  useEffect(() => {
    if (reduceMotion) {
      scale.setValue(1);
      opacity.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [opacity, reduceMotion, scale]);

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${name} the penguin joined your huddle`}
    >
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <Mascot size={88} scarf={scarf} pose="cheering" />
      </Animated.View>
      <View style={styles.text}>
        <AppText variant="heading">{name} joined your huddle</AppText>
        <AppText variant="small">
          {penguinNumber === 1
            ? 'Your first adventure! Every one you finish welcomes another penguin.'
            : `That makes ${penguinNumber} penguins. Nice going.`}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.blushTint,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  text: { flex: 1, gap: spacing.xs },
});
