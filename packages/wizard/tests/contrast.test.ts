import { describe, it, expect } from 'vitest';
import { lightPalette, palette } from '../tailwind.config.js';
import { GRADE_TOKENS } from '../src/lib/grades';

/** WCAG relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Token = keyof typeof palette;
const BACKGROUNDS: Token[] = ['paper', 'canvas', 'surface', 'panel'];
const JOURNEYS: Token[] = ['j1', 'j2', 'j3', 'j4', 'j5'];

/** Every foreground/background pairing the wizard actually uses for text. */
const TEXT_PAIRS: Array<[Token, Token]> = [
  ...BACKGROUNDS.flatMap((bg) =>
    (['ink', 'ink-soft', 'stamp', 'pass', 'fail', 'warn'] as Token[]).map((fg): [Token, Token] => [fg, bg])
  ),
  ['ink', 'stamp-tint'],
  ['stamp', 'stamp-tint'],
  ['paper', 'stamp'], // text on a primary button
  ['paper', 'stamp-dark'], // …while hovered
  ['pass', 'pass-tint'],
  ['fail', 'fail-tint'],
  ['warn', 'warn-tint'],
  ['ink', 'fail-tint'],
  ['ink', 'warn-tint'],
  // Journey names are written in their colour on cards and panels
  ...JOURNEYS.flatMap((j) => (['surface', 'panel'] as Token[]).map((bg): [Token, Token] => [j, bg])),
];

/** Boundaries and lines people must see (WCAG 1.4.11: 3:1). */
const NON_TEXT_PAIRS: Array<[Token, Token]> = [
  ['edge', 'paper'],
  ['edge', 'surface'],
  ['edge', 'panel'],
  ['edge', 'canvas'],
  ['stamp', 'paper'], // focus ring
  ['stamp', 'canvas'],
  ['stamp', 'stamp-tint'], // progress bar fill on its track
  // Journey paths on the drawing board, and page status borders
  ...JOURNEYS.map((j): [Token, Token] => [j, 'canvas']),
  ['pass', 'canvas'],
  ['fail', 'canvas'],
  ['warn', 'canvas'],
];

describe.each([
  ['dark board', palette],
  ['light, printable', lightPalette],
])('wizard palette (%s) meets WCAG 2.2 AA', (_name, colors: Record<Token, string>) => {
  it.each(TEXT_PAIRS)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('%s against %s is at least 3:1', (fg, bg) => {
    expect(contrast(colors[fg], colors[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe('grade colours use the palette only', () => {
  it.each(Object.entries(GRADE_TOKENS))('grade %s is readable on its tint and on a card', (_grade, { text, tint }) => {
    expect(contrast(palette[text], palette[tint])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette[text], palette.surface)).toBeGreaterThanOrEqual(4.5);
    // Its border marks the grade against the card.
    expect(contrast(palette[text], palette.surface)).toBeGreaterThanOrEqual(3);
  });
});
