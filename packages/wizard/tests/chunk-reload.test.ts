import { describe, expect, it } from 'vitest';
import { shouldReloadForChunk } from '../src/lib/chunk-reload';

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('reload when a code file is gone', () => {
  it('reloads the first time', () => {
    expect(shouldReloadForChunk(memoryStore(), 1_000_000)).toBe(true);
  });
  it('does not reload again inside a minute, so the page cannot loop', () => {
    const store = memoryStore();
    expect(shouldReloadForChunk(store, 1_000_000)).toBe(true);
    expect(shouldReloadForChunk(store, 1_030_000)).toBe(false);
  });
  it('reloads again after a minute', () => {
    const store = memoryStore();
    shouldReloadForChunk(store, 1_000_000);
    expect(shouldReloadForChunk(store, 1_061_000)).toBe(true);
  });
});
