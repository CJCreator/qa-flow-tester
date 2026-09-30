import { describe, it, expect } from 'vitest';
import { palette } from '../tailwind.config.js';
import { gradeTone } from '../src/screens/ReportScreen';

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
  ...BACKGROUNDS.flatMap((bg) => (['ink', 'ink-soft', 'stamp', 'pass', 'fail', 'warn'] as Token[]).map((fg): [Token, Token] => [fg, bg])),
  ['ink', 'stamp-tint'],
  ['stamp', 'stamp-tint'],
  ['paper', 'stamp'], // text on a primary button
  ['paper', 'stamp-dark'], // …while hovered
  ['surface', 'stamp'], // the primary button's text is the surface colour
  ['surface', 'stamp-dark'],
  ['surface', 'fail'], // a confirm button that throws something away
  ['ink', 'pass-tint'], // a notice's text on its tint
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

/** Every grade is written in its status colour on a card, and the stamp in its colour on its tint. */
const GRADE_PAIRS: Array<[string, Token, Token]> = (['A', 'B', 'C', 'D', 'F'] as const).flatMap((grade): Array<[string, Token, Token]> => {
  const tone = gradeTone(grade);
  return [
    [grade, tone, 'surface'],
    [grade, tone, `${tone}-tint` as Token],
  ];
});

describe('wizard palette meets WCAG 2.2 AA', () => {
  it.each(GRADE_PAIRS)('grade %s: %s on %s is at least 4.5:1', (_grade, fg, bg) => {
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TEXT_PAIRS)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('%s against %s is at least 3:1', (fg, bg) => {
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(3);
  });
});
