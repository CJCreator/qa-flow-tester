import type { Config } from 'tailwindcss';

/** Types for tailwind.config.js (plain JS so Tailwind loads it directly). Keep the keys in step with it. */
type PaletteToken =
  | 'paper'
  | 'canvas'
  | 'surface'
  | 'panel'
  | 'raised'
  | 'ink'
  | 'ink-soft'
  | 'rule'
  | 'edge'
  | 'stamp'
  | 'stamp-dark'
  | 'stamp-tint'
  | 'on-stamp'
  | 'pass'
  | 'pass-tint'
  | 'fail'
  | 'fail-tint'
  | 'warn'
  | 'warn-tint'
  | 'j1'
  | 'j2'
  | 'j3'
  | 'j4'
  | 'j5';

export declare const palette: Record<PaletteToken, string>;
export declare const darkPalette: Record<PaletteToken, string>;
export declare const lightPalette: Record<PaletteToken, string>;

declare const config: Config;
export default config;
