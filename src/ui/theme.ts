/**
 * Visual tokens: warm ivory backgrounds, soft sky-blue accents, gentle peach
 * highlights. Text/background pairs were chosen for WCAG AA contrast
 * (≥ 4.5:1 for body text); the light "tint" colors are only ever used behind
 * their matching dark "ink" color.
 */
import { Platform } from 'react-native';

export const colors = {
  bg: '#FBF7EF',
  surface: '#FFFDF9',
  surfaceAlt: '#F4EEE3',
  border: '#E8DFD0',
  ink: '#2B2A33',
  inkSoft: '#57535F',
  inkMuted: '#6B6774',
  white: '#FFFFFF',

  sky: '#2F7FC1',
  skyPressed: '#276CA5',
  skyTint: '#E1F0FB',
  skyInk: '#1D5A8C',

  peach: '#F4B596',
  peachTint: '#FDEBE1',
  peachInk: '#94401F',

  success: '#2F7D5B',
  successTint: '#DFF2E8',
  warning: '#8A5410',
  warningTint: '#FBEFD8',
  danger: '#B23A33',
  dangerTint: '#F9E1DF',

  penguin: '#2E3440',
  penguinBelly: '#FFFDF9',
  beak: '#F2A25C',
} as const;

export const fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

/** Minimum touch target (Apple HIG 44pt, Material 48dp). */
export const touchTarget = 48;

export const shadow = Platform.select({
  ios: { shadowColor: '#5A4320', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 2 },
  default: {},
});

export const type = {
  display: { fontFamily: fonts.extrabold, fontSize: 32, lineHeight: 38, color: colors.ink },
  title: { fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 30, color: colors.ink },
  heading: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: colors.ink },
  bodyStrong: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 23, color: colors.ink },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  smallStrong: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.ink },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.inkMuted },
} as const;

export type TypeVariant = keyof typeof type;
