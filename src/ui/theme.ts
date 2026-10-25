/**
 * Visual tokens: butter-yellow backgrounds, white cards, dusty-mauve actions
 * and deep-navy text, set in Quicksand. Colors live in ./palette (checked for
 * contrast in tests/ui/contrast.test.ts); this file adds type, spacing and
 * surface treatments.
 */
import { Platform } from 'react-native';

import { colors } from './palette';

export { brand, colors } from './palette';

/**
 * Quicksand is bundled with the app (no network font request). Its 400 weight
 * is thin on butter yellow, so body copy uses 500.
 */
export const fonts = {
  regular: 'Quicksand_500Medium',
  medium: 'Quicksand_600SemiBold',
  semibold: 'Quicksand_600SemiBold',
  bold: 'Quicksand_700Bold',
  extrabold: 'Quicksand_700Bold',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** Horizontal screen padding. */
export const gutter = 20;
/** Tags 10, buttons and inputs 16, cards 20, sheets 24. */
export const radius = { sm: 10, md: 16, lg: 20, xl: 24, pill: 999 } as const;

/** Minimum touch target (Apple HIG 44pt, Material 48dp). */
export const touchTarget = 48;

export const shadow = Platform.select({
  ios: { shadowColor: colors.ink, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 2 },
  default: {},
});

export const type = {
  display: { fontFamily: fonts.bold, fontSize: 38, lineHeight: 44, color: colors.ink },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, color: colors.ink },
  heading: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, color: colors.ink },
  label: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.ink },
  bodyStrong: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.ink },
  small: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.inkSoft },
  smallStrong: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, color: colors.ink },
  caption: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
} as const;

export type TypeVariant = keyof typeof type;
