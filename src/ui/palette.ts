/**
 * Huddle's color tokens, kept free of React Native imports so the contrast
 * tests in tests/ui can check the real values.
 *
 * Brand swatches are used as given for backgrounds, borders and decoration.
 * Text and filled buttons use the darker "ink"/"strong" variants because
 * several brand pairs fail WCAG AA for body text (white on dusty mauve is
 * only 3.8:1, navy on mauve 3.4:1).
 */
export const brand = {
  butter: '#FFFCD4',
  mauve: '#B37083',
  pink: '#FFBACE',
  sky: '#81BACC',
  teal: '#79A5B3',
  navy: '#243447',
  white: '#FFFFFF',
} as const;

export const colors = {
  bg: brand.butter,
  surface: brand.white,
  /** Pressed rows and quiet fills on butter. */
  surfaceAlt: '#F5F0C6',
  border: '#E7DFB4',
  /** Hairlines on white cards. */
  borderSoft: '#EFEADA',
  ink: brand.navy,
  inkSoft: '#3E4C5E',
  inkMuted: '#5B6778',
  white: brand.white,

  /** Filled primary buttons: darkened mauve so white labels reach 5:1. */
  primary: '#9A5D6F',
  primaryPressed: '#864F60',
  /** Selected outlines and decorative emphasis (non-text, ≥3:1 on butter and white). */
  primaryAccent: brand.mauve,
  primaryTint: '#F8E4EA',
  primaryInk: '#8B4B5E',

  blush: brand.pink,
  blushTint: '#FFE8EF',
  blushInk: '#7A4053',

  sky: brand.sky,
  skyTint: '#E1F0F4',
  skyInk: '#2C5A69',

  teal: brand.teal,
  tealTint: '#E3EEF1',
  tealInk: '#2D5563',

  success: '#2F6F52',
  successTint: '#E0F1E6',
  warning: '#8A5410',
  warningTint: '#FBEFD8',
  danger: '#A8323A',
  dangerTint: '#FBE1E3',

  // The original mascot's own colors (assets/mascot.svg).
  penguin: '#292B38',
  penguinBelly: '#FFFDF9',
  beak: '#FFA936',
  cheek: '#FFB9B3',
} as const;

export type ColorToken = keyof typeof colors;
