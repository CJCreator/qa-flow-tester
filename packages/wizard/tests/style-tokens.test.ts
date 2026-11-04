import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config, { palette } from '../tailwind.config.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Tailwind built-in colour keywords that need no palette entry. */
const BUILT_IN = new Set(['white', 'black', 'transparent', 'current', 'inherit']);

/** Non-colour utilities that share the bg-/text-/border-/ring- prefixes. */
const NON_COLOUR = new Set([
  // text
  'xs',
  'sm',
  'base',
  'lg',
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  'question',
  // bg
  'none',
  'cover',
  'contain',
  'auto',
  'fixed',
  'local',
  'scroll',
  'top',
  'bottom',
  'repeat',
  'no-repeat',
  'clip-text',
  'origin-center',
  // border
  'collapse',
  'separate',
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'spacing',
  // ring
  'inset',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

const paletteKeys = new Set(Object.keys(palette as Record<string, string>));
const css = readFileSync(join(SRC, 'index.css'), 'utf8');
const customClasses = new Set([...css.matchAll(/\.((?:bg|text|border|ring)-[a-z0-9-]+)/g)].map((m) => m[1]));
const definedButtons = new Set([...css.matchAll(/\.(btn-[a-z0-9-]+)/g)].map((m) => m[1]));

/** Colour tokens used in a source file, as [token, line]. Pure function, tested below. */
export function colourTokens(rawSource: string): Array<[string, number]> {
  // element ids and labels are not classes
  const source = rawSource.replace(/(?<![\w-])(?:id|htmlFor|name)="[^"]*"/g, (m) => ' '.repeat(m.length));
  const found: Array<[string, number]> = [];
  const re = /(?<![\w-])(?:[a-z0-9[\]-]+:)*(?:bg|text|border|ring)-([a-z][a-z0-9-]*)(?:\/[\w.]+)?(?![\w[-])/g;
  for (const m of source.matchAll(re)) {
    // Drop side/offset words: border-t-stamp, ring-offset-surface
    const token = m[1].replace(/^(?:[tblrxyse]|offset)-/, '');
    if (NON_COLOUR.has(token) || NON_COLOUR.has(m[1])) continue;
    if (/^(?:[tblrxyse]|offset)$/.test(token) || /^\d/.test(token) || /^\d*xl$/.test(token)) continue;
    if (/^(?:gradient|opacity|size|position|blend|clip|origin)(?:-|$)/.test(token)) continue;
    if (/^(?:ellipsis|clip|wrap|nowrap)$/.test(token)) continue;
    if (customClasses.has(m[0].split(':').pop()!.replace(/\/.*$/, ''))) continue;
    const line = source.slice(0, m.index).split('\n').length;
    found.push([token, line]);
  }
  return found;
}

describe('colour token scanner', () => {
  it('ignores non-colour utilities', () => {
    const src = '<p className="text-sm border-2 border-t bg-none ring-2 ring-offset-2 text-center bg-gradient-to-r">';
    expect(colourTokens(src)).toEqual([]);
  });

  it('finds colours with opacity, variant prefixes and side words', () => {
    const src = '<p className="bg-accent/10 hover:text-stamp focus:ring-nope border-t-ghost">';
    expect(colourTokens(src).map(([t]) => t)).toEqual(['accent', 'stamp', 'nope', 'ghost']);
  });
});

describe('style tokens', () => {
  const files = walk(SRC);

  it('reads the palette and the button classes from the config and CSS', () => {
    expect(config).toBeTruthy();
    expect(paletteKeys.has('stamp')).toBe(true);
    expect(definedButtons.has('btn-primary')).toBe(true);
  });

  it('uses only btn- classes that index.css defines', () => {
    const bad: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/(?<![\w-])(btn-[a-z0-9-]+)/g)) {
        if (!definedButtons.has(m[1])) {
          bad.push(`${relative(SRC, file)}:${source.slice(0, m.index).split('\n').length} ${m[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('uses only card classes that index.css defines', () => {
    const definedCards = new Set([...css.matchAll(/\.(card(?:-[a-z0-9]+)?)\b/g)].map((m) => m[1]));
    const bad: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Class lists only: className="..." and className={`...`}, so prose that says "card" is not read.
      for (const m of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const cls of (m[1] ?? m[2]).split(/\s+/)) {
          if (/^card(?:-[a-z0-9]+)?$/.test(cls) && !definedCards.has(cls)) {
            bad.push(`${relative(SRC, file)}:${source.slice(0, m.index).split('\n').length} ${cls}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('uses only colours that are palette keys or Tailwind built-ins', () => {
    const bad: string[] = [];
    for (const file of files) {
      for (const [token, line] of colourTokens(readFileSync(file, 'utf8'))) {
        if (!paletteKeys.has(token) && !BUILT_IN.has(token)) bad.push(`${relative(SRC, file)}:${line} ${token}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
