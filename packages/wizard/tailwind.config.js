/**
 * Blueprint palette (Phase 1 direction B): a deep navy drawing board with light "drawings" on it.
 * Every text pairing is checked against WCAG AA in tests/contrast.test.ts; see DESIGN.md for the
 * reasoning behind each choice.
 */
export const palette = {
  paper: '#111827', // page background
  canvas: '#0D1322', // the map's drawing board
  surface: '#1E2A3B', // cards and fields
  panel: '#1A2438', // sidebars and the side panel
  ink: '#E8EDF5', // body text
  'ink-soft': '#A7B3C7', // secondary text
  rule: '#2A3A52', // decorative dividers only (never the only cue)
  edge: '#74859F', // control borders (3:1 against paper, panel and surface)
  stamp: '#6C9BF2', // accent: actions, focus ring, progress
  'stamp-dark': '#9DBDF7', // accent on hover (lighter on a dark board)
  'stamp-tint': '#1C2C4C',
  pass: '#4ADE9A',
  'pass-tint': '#12302A',
  fail: '#FA9191',
  'fail-tint': '#3A1C20',
  warn: '#FBC54A',
  'warn-tint': '#3A2F14',
  // One colour per journey on the map, like an architect's mark-up lines.
  j1: '#B69CFB',
  j2: '#6FB0FA',
  j3: '#4ADE9A',
  j4: '#F59AC6',
  j5: '#FBA35C',
};

/**
 * The same tokens for paper: the report can be read and printed light (DESIGN.md: the working
 * screens stay on the dark board). Checked against WCAG AA in tests/contrast.test.ts too.
 */
export const lightPalette = {
  paper: '#F8FAFC',
  canvas: '#EEF2F7',
  surface: '#FFFFFF',
  panel: '#F1F5F9',
  ink: '#0F172A',
  'ink-soft': '#475569',
  rule: '#CBD5E1',
  edge: '#64748B',
  stamp: '#1D4ED8',
  'stamp-dark': '#1E3A8A',
  'stamp-tint': '#DBEAFE',
  pass: '#047857',
  'pass-tint': '#D1FAE5',
  fail: '#B91C1C',
  'fail-tint': '#FEE2E2',
  warn: '#92400E',
  'warn-tint': '#FEF3C7',
  j1: '#6D28D9',
  j2: '#1D4ED8',
  j3: '#047857',
  j4: '#BE185D',
  j5: '#C2410C',
};

/** A palette as CSS variables of "r g b", so classes like bg-surface/60 still work. */
function asVariables(colors) {
  return Object.fromEntries(
    Object.entries(colors).map(([name, hex]) => [
      `--c-${name}`,
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' '),
    ])
  );
}

/** @type {import('tailwindcss').Config} */
export default {
  // relative: globs resolve from this file, so the dev server works from any working directory
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: Object.fromEntries(Object.keys(palette).map((name) => [name, `rgb(var(--c-${name}) / <alpha-value>)`])),
      fontFamily: {
        sans: ['"Atkinson Hyperlegible Next Variable"', 'system-ui', 'sans-serif'],
        stamp: ['"Big Shoulders Stencil Display"', 'Impact', 'sans-serif'],
        // Reference labels on the map (pg-01 · /cart): a system monospace, nothing to download.
        mono: ['ui-monospace', '"Cascadia Mono"', 'Consolas', '"SF Mono"', 'monospace'],
      },
      fontSize: {
        // 18px base: this audience reads, it does not scan
        base: ['1.125rem', { lineHeight: '1.6' }],
        question: ['clamp(1.875rem, 1.4rem + 2vw, 2.75rem)', { lineHeight: '1.1', letterSpacing: '-0.015em' }],
      },
      boxShadow: {
        'level-1': '0 1px 2px 0 rgb(0 0 0 / 0.3)',
        'level-2': '0 4px 6px -1px rgb(0 0 0 / 0.4)',
        'level-3': '0 10px 15px -3px rgb(0 0 0 / 0.4)',
        'level-4': '0 20px 25px -5px rgb(0 0 0 / 0.5)',
      },
      borderRadius: {
        control: '6px',
        card: '8px',
        panel: '12px',
        pill: '9999px',
      },
      maxWidth: {
        prose: '38rem',
      },
    },
  },
  plugins: [
    ({ addBase }) =>
      addBase({
        ':root': asVariables(palette),
        ':root[data-theme="light"]': { ...asVariables(lightPalette), colorScheme: 'light' },
        '@media print': { ':root': { ...asVariables(lightPalette), colorScheme: 'light' } },
      }),
  ],
};
