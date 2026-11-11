/**
 * Certificate palette: an inspection certificate. Quiet white paper, green-grey ink, cobalt for actions,
 * and the verdict colours. Light is the default; dark follows the device or a saved choice
 * (src/lib/theme.ts). Every text pairing is checked against WCAG AA in tests/contrast.test.ts; see
 * DESIGN.md for the reasoning behind each choice.
 */
export const palette = {
  paper: '#F4F6F4', // page background
  canvas: '#ECEFEC', // the map's drawing board, sunk areas, step bar
  surface: '#FFFFFF', // cards and fields
  panel: '#EEF1EE', // sidebars and side panels
  raised: '#FFFFFF', // menus, dialogs, sticky bars (lifted by a shadow)
  ink: '#121A17', // body text
  'ink-soft': '#4C5853', // secondary text
  rule: '#D8DDDA', // decorative dividers only (never the only cue)
  edge: '#7A8580', // control borders (3:1 against paper, panel and surface)
  stamp: '#1D3FD0', // accent: actions, links, focus ring, progress
  'stamp-dark': '#1733A8', // accent on hover
  'stamp-tint': '#E8EDFF',
  'on-stamp': '#FFFFFF', // text on the accent
  pass: '#0B7547',
  'pass-tint': '#E2F3E9',
  fail: '#B42318',
  'fail-tint': '#FCE8E6',
  warn: '#8A5000',
  'warn-tint': '#FBEFD9',
  // One colour per journey on the map, like mark-up lines on a drawing.
  j1: '#6D28D9',
  j2: '#0E6F9C',
  j3: '#047857',
  j4: '#BE185D',
  j5: '#B43F0A',
};

/** The same tokens in the dark: green-black paper, the same roles. Checked by tests/contrast.test.ts too. */
export const darkPalette = {
  paper: '#0E1311',
  canvas: '#0A0E0C',
  surface: '#161D1A',
  panel: '#121815',
  raised: '#1C2420',
  ink: '#E8EEEA',
  'ink-soft': '#A8B4AE',
  rule: '#26302C',
  edge: '#6F7C76',
  stamp: '#8FA6FF',
  'stamp-dark': '#B3C3FF',
  'stamp-tint': '#1A2347',
  'on-stamp': '#0A1233',
  pass: '#5CD39B',
  'pass-tint': '#11291F',
  fail: '#FF9D93',
  'fail-tint': '#33191A',
  warn: '#F0B85A',
  'warn-tint': '#2E2412',
  j1: '#B69CFB',
  j2: '#6FB0FA',
  j3: '#4ADE9A',
  j4: '#F59AC6',
  j5: '#FBA35C',
};

/** Shadows: soft on paper, deeper in the dark where they are the only lift. */
const shadows = {
  light: {
    '--shadow-1': '0 1px 2px 0 rgb(18 26 23 / 0.06)',
    '--shadow-2': '0 1px 2px 0 rgb(18 26 23 / 0.06), 0 4px 12px -2px rgb(18 26 23 / 0.08)',
    '--shadow-3': '0 2px 4px 0 rgb(18 26 23 / 0.06), 0 12px 24px -6px rgb(18 26 23 / 0.14)',
    '--shadow-4': '0 4px 8px 0 rgb(18 26 23 / 0.08), 0 24px 48px -12px rgb(18 26 23 / 0.22)',
  },
  dark: {
    '--shadow-1': '0 1px 2px 0 rgb(0 0 0 / 0.35)',
    '--shadow-2': '0 1px 2px 0 rgb(0 0 0 / 0.3), 0 4px 12px -2px rgb(0 0 0 / 0.45)',
    '--shadow-3': '0 2px 4px 0 rgb(0 0 0 / 0.3), 0 12px 24px -6px rgb(0 0 0 / 0.55)',
    '--shadow-4': '0 4px 8px 0 rgb(0 0 0 / 0.35), 0 24px 48px -12px rgb(0 0 0 / 0.65)',
  },
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

const light = { ...asVariables(palette), ...shadows.light, colorScheme: 'light' };
const dark = { ...asVariables(darkPalette), ...shadows.dark, colorScheme: 'dark' };

/** @type {import('tailwindcss').Config} */
export default {
  // relative: globs resolve from this file, so the dev server works from any working directory
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: Object.fromEntries(Object.keys(palette).map((name) => [name, `rgb(var(--c-${name}) / <alpha-value>)`])),
      fontFamily: {
        // Anek Latin and Anek Tamil: one family from one foundry, so English and Tamil match.
        sans: ['"Anek Latin Variable"', '"Anek Tamil Variable"', 'system-ui', 'sans-serif'],
        // The verdict and headings: the same family, condensed (font-stretch is set in index.css).
        stamp: ['"Anek Latin Variable"', '"Anek Tamil Variable"', 'system-ui', 'sans-serif'],
        // Addresses, paths and code only: a system monospace, nothing to download.
        mono: ['ui-monospace', '"Cascadia Mono"', 'Consolas', '"SF Mono"', 'monospace'],
      },
      fontSize: {
        // 14px is the floor for anything people need to read.
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
        sm: ['0.9375rem', { lineHeight: '1.375rem' }],
        base: ['1.0625rem', { lineHeight: '1.65' }],
        lg: ['1.1875rem', { lineHeight: '1.55' }],
        xl: ['1.375rem', { lineHeight: '1.35' }],
        '2xl': ['1.625rem', { lineHeight: '1.25' }],
        '3xl': ['2rem', { lineHeight: '1.15' }],
        '4xl': ['2.5rem', { lineHeight: '1.1' }],
        '5xl': ['3.25rem', { lineHeight: '1.05' }],
        question: ['clamp(1.875rem, 1.4rem + 2vw, 2.75rem)', { lineHeight: '1.1', letterSpacing: '-0.015em' }],
        verdict: ['clamp(2.75rem, 2rem + 3vw, 4.25rem)', { lineHeight: '0.95', letterSpacing: '-0.01em' }],
      },
      boxShadow: {
        'level-1': 'var(--shadow-1)',
        'level-2': 'var(--shadow-2)',
        'level-3': 'var(--shadow-3)',
        'level-4': 'var(--shadow-4)',
      },
      borderRadius: {
        control: '6px',
        card: '10px',
        panel: '14px',
        pill: '9999px',
      },
      maxWidth: {
        prose: '38rem', // reading
        form: '44rem', // one-column forms
        workspace: '72rem', // plan, report, map
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
        exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
      },
      zIndex: {
        sticky: '20',
        header: '40',
        menu: '50',
        dialog: '60',
        toast: '70',
      },
    },
  },
  plugins: [
    ({ addBase }) =>
      addBase({
        // Light by default; dark when the device asks for it, unless light was chosen; dark when chosen.
        ':root': light,
        '@media (prefers-color-scheme: dark)': { ':root:not([data-theme="light"])': dark },
        ':root[data-theme="dark"]': dark,
        // Paper is always light.
        '@media print': { ':root, :root[data-theme="dark"]': light },
      }),
  ],
};
