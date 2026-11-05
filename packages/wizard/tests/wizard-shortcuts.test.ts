import { describe, expect, it } from 'vitest';
import {
  isSingleKeyShortcut,
  isTypingTarget,
  readSingleKeyShortcuts,
  writeSingleKeyShortcuts,
  type FocusLike,
} from '../src/lib/shortcuts';

function el(tagName: string, attrs: Record<string, string> = {}, isContentEditable = false): FocusLike {
  return { tagName, isContentEditable, getAttribute: (n) => attrs[n] ?? null };
}

function memoryStore(initial: string | null = null) {
  const data = new Map<string, string>(initial === null ? [] : [['qa-single-key-shortcuts', initial]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('single-key shortcuts (W11, WCAG 2.1.4)', () => {
  it('guards j, k, g and G only', () => {
    for (const k of ['j', 'k', 'g', 'G']) expect(isSingleKeyShortcut(k)).toBe(true);
    for (const k of ['s', 'Escape', 'Enter', ' ', 'J']) expect(isSingleKeyShortcut(k)).toBe(false);
  });

  it('treats input, textarea, select and contenteditable as typing targets', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
    expect(isTypingTarget(el('DIV', {}, true))).toBe(true);
    expect(isTypingTarget(el('DIV', { contenteditable: '' }))).toBe(true);
    expect(isTypingTarget(el('DIV', { role: 'textbox' }))).toBe(true);
  });

  it('does not treat buttons, links, or no element as typing targets', () => {
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('A'))).toBe(false);
    expect(isTypingTarget(el('DIV', { contenteditable: 'false' }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('is on by default and reads the saved choice', () => {
    expect(readSingleKeyShortcuts(memoryStore())).toBe(true);
    expect(readSingleKeyShortcuts(memoryStore('off'))).toBe(false);
    expect(readSingleKeyShortcuts(memoryStore('on'))).toBe(true);
    expect(readSingleKeyShortcuts(undefined)).toBe(true);
  });

  it('saves the choice and survives blocked storage', () => {
    const store = memoryStore();
    writeSingleKeyShortcuts(false, store);
    expect(readSingleKeyShortcuts(store)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readSingleKeyShortcuts(blocked)).toBe(true);
    expect(() => writeSingleKeyShortcuts(false, blocked)).not.toThrow();
  });
});
