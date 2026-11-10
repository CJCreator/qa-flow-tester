import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTE_SKIP_REASONS } from '@qa/types/src/browser.js';
import type { SlowerThanLastTime } from '@qa/types';
import { skipReasonText } from '../src/lib/coverage-text';
import { keySourceText } from '../src/lib/key-source';
import { slowerNote } from '../src/lib/slower-note';

describe('skipReasonText', () => {
  it('has plain words for every skip reason', () => {
    for (const reason of ROUTE_SKIP_REASONS) {
      const text = skipReasonText(reason);
      expect(text, reason).not.toBe('Skipped');
      expect(text.length, reason).toBeGreaterThan(5);
    }
  });
  it('falls back for an unknown reason', () => {
    expect(skipReasonText('something-new')).toBe('Skipped');
  });
});

describe('keySourceText', () => {
  it('names where the key is kept and never anything else', () => {
    expect(keySourceText('keychain')).toMatch(/keychain/i);
    expect(keySourceText('byok_file')).toMatch(/encrypted file/i);
    expect(keySourceText('env')).toMatch(/environment variable/i);
    expect(keySourceText('cli')).toMatch(/command line/i);
    expect(keySourceText(undefined)).toBeNull();
  });
});

describe('slowerNote', () => {
  const base: SlowerThanLastTime = {
    urlPath: '/pricing',
    role: 'visitor',
    breakpoint: '375px',
    aspect: 'Fast and mobile',
    checker: 'performance',
    metric: 'lcp',
    previousMs: 1200,
    currentMs: 2100,
    increaseMs: 900,
    increasePercent: 75,
    loads: 3,
    throttled: true,
    summary: 'x',
  };
  it('says which page, then and now, and how it was measured', () => {
    const note = slowerNote(base);
    expect(note).toContain('/pricing');
    expect(note).toContain('1.2 s');
    expect(note).toContain('2.1 s');
    expect(note).toMatch(/largest content/i);
    expect(note).toContain('3 loads');
    expect(note).toMatch(/slowed/i);
  });
  it('says so when the connection was not slowed', () => {
    const note = slowerNote({ ...base, metric: 'domReady', throttled: false, loads: 1 });
    expect(note).toMatch(/page was ready/i);
    expect(note).toMatch(/1 load\b/);
    expect(note).toMatch(/connection was not slowed/i);
  });
});

describe('Settings model picker', () => {
  it('builds a new model picker for each AI service, so one service’s model id is never saved for another', () => {
    const settings = readFileSync(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(settings).toMatch(/<ModelChoice key=\{setup\.provider \?\? 'openrouter'\}/);
  });
});
