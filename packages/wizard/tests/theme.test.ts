import { describe, it, expect } from 'vitest';
import {
  THEME_KEY,
  applyTheme,
  effectiveTheme,
  parseTheme,
  readTheme,
  saveTheme,
  toggled,
} from '../src/lib/theme';

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
}

describe('theme', () => {
  it('parseTheme follows the device unless light or dark was chosen', () => {
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme(undefined)).toBe('system');
    expect(parseTheme('')).toBe('system');
    expect(parseTheme('blue')).toBe('system');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
  });

  it('effectiveTheme resolves "system" from the device', () => {
    expect(effectiveTheme('system', false)).toBe('light');
    expect(effectiveTheme('system', true)).toBe('dark');
    expect(effectiveTheme('light', true)).toBe('light');
    expect(effectiveTheme('dark', false)).toBe('dark');
  });

  it('toggled flips what is on screen', () => {
    expect(toggled('dark', false)).toBe('light');
    expect(toggled('light', true)).toBe('dark');
    expect(toggled('system', false)).toBe('dark');
    expect(toggled('system', true)).toBe('light');
  });

  it('readTheme survives a throwing storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readTheme(broken)).toBe('system');
    expect(readTheme({ getItem: (k: string) => (k === THEME_KEY ? 'light' : null) })).toBe('light');
    expect(readTheme(undefined)).toBe('system');
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

  it('applyTheme sets data-theme for a choice and removes it for the device', () => {
    const root = fakeRoot();
    applyTheme('light', root);
    expect(root.attrs.get('data-theme')).toBe('light');
    applyTheme('dark', root);
    expect(root.attrs.get('data-theme')).toBe('dark');
    applyTheme('system', root);
    expect(root.attrs.has('data-theme')).toBe(false);
  });
});
