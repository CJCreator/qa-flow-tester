import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lostContactHint } from '../src/lib/lost-contact';
import { anySignal } from '../src/api';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('lost-contact hint', () => {
  it('the hosted copy is not told to use a terminal', () => {
    expect(lostContactHint(true)).not.toMatch(/pnpm|terminal/);
    expect(lostContactHint(false)).toContain('pnpm start');
  });

  it('App picks the hint from the status', () => {
    expect(read('../src/App.tsx')).toContain('lostContactHint(!!status?.beta)');
  });
});

describe('anySignal fallback', () => {
  const real = AbortSignal.any;

  beforeEach(() => {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(AbortSignal, 'any', { value: real, configurable: true });
  });

  it('aborts when the first signal aborts, with its reason', () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = anySignal([a.signal, b.signal]);
    a.abort('gone');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('gone');
  });

  it('aborts when the timeout fires', async () => {
    const combined = anySignal([new AbortController().signal, AbortSignal.timeout(10)]);
    await new Promise((r) => setTimeout(r, 30));
    expect(combined.aborted).toBe(true);
  });

  it('is aborted at once when a signal already is', () => {
    const combined = anySignal([AbortSignal.abort('x')]);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('x');
  });
});

describe('anySignal with the built-in', () => {
  it('uses the built-in when there is one', () => {
    expect(typeof AbortSignal.any).toBe('function');
    const a = new AbortController();
    const combined = anySignal([a.signal]);
    a.abort();
    expect(combined.aborted).toBe(true);
  });
});
