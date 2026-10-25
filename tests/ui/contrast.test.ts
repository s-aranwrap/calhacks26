/**
 * WCAG contrast checks for the text/background pairs the UI actually uses.
 * Body text needs 4.5:1 (AA); outlines and other non-text UI need 3:1.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { brand, colors } from '../../src/ui/palette.ts';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string, string][] = [
  ['navy on butter', colors.ink, colors.bg],
  ['navy on white', colors.ink, colors.surface],
  ['soft ink on butter', colors.inkSoft, colors.bg],
  ['muted ink on butter', colors.inkMuted, colors.bg],
  ['muted ink on pressed butter', colors.inkMuted, colors.surfaceAlt],
  ['muted ink on white', colors.inkMuted, colors.surface],
  ['white on primary button', colors.white, colors.primary],
  ['white on pressed primary button', colors.white, colors.primaryPressed],
  ['primary ink on butter', colors.primaryInk, colors.bg],
  ['primary ink on white', colors.primaryInk, colors.surface],
  ['primary ink on primary tint', colors.primaryInk, colors.primaryTint],
  ['blush ink on blush tint', colors.blushInk, colors.blushTint],
  ['sky ink on sky tint', colors.skyInk, colors.skyTint],
  ['teal ink on teal tint', colors.tealInk, colors.tealTint],
  ['navy on sky blue', colors.ink, brand.sky],
  ['navy on muted teal', colors.ink, brand.teal],
  ['navy on pastel pink', colors.ink, brand.pink],
  ['success on tint', colors.success, colors.successTint],
  ['warning on tint', colors.warning, colors.warningTint],
  ['danger on tint', colors.danger, colors.dangerTint],
  ['danger on butter', colors.danger, colors.bg],
];

for (const [name, fg, bg] of TEXT_PAIRS) {
  test(`text contrast: ${name} is at least 4.5:1`, () => {
    assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${contrast(fg, bg).toFixed(2)}:1`);
  });
}

test('selected-state outlines reach 3:1 against butter and white', () => {
  assert.ok(contrast(colors.primaryAccent, colors.bg) >= 3);
  assert.ok(contrast(colors.primaryAccent, colors.surface) >= 3);
});

test('the raw brand mauve is not used behind white text (documented failure)', () => {
  assert.ok(contrast(colors.white, brand.mauve) < 4.5);
  assert.notEqual(colors.primary, brand.mauve);
});
