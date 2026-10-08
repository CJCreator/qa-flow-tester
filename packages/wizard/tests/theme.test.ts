import { describe, it, expect } from 'vitest';
import { THEME_KEY, applyTheme, parseTheme, readTheme, saveTheme, toggled } from '../src/lib/theme';

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
}

describe('landing theme', () => {
  it('parseTheme defaults to dark', () => {
    expect(parseTheme(null)).toBe('dark');
    expect(parseTheme(undefined)).toBe('dark');
    expect(parseTheme('')).toBe('dark');
    expect(parseTheme('blue')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
  });

  it('toggled flips', () => {
    expect(toggled('dark')).toBe('light');
    expect(toggled('light')).toBe('dark');
  });

  it('readTheme survives a throwing storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readTheme(broken)).toBe('dark');
    expect(readTheme({ getItem: (k: string) => (k === THEME_KEY ? 'light' : null) })).toBe('light');
    expect(readTheme(undefined)).toBe('dark');
  });

  it('saveTheme survives a throwing storage and writes the key', () => {
    const seen: string[] = [];
    saveTheme('light', { setItem: (k, v) => void seen.push(`${k}=${v}`) });
    expect(seen).toEqual(['qa-theme=light']);
    expect(() =>
      saveTheme('dark', {
        setItem: () => {
          throw new Error('full');
        },
      })
    ).not.toThrow();
  });

  it('applyTheme sets and removes data-theme', () => {
    const root = fakeRoot();
    applyTheme('light', root);
    expect(root.attrs.get('data-theme')).toBe('light');
    applyTheme('dark', root);
    expect(root.attrs.has('data-theme')).toBe(false);
  });
});
