import { describe, it, expect, vi, afterEach } from 'vitest';
import { BrowserManager } from '../src/browser.js';
import { isAbortError } from '../src/abort.js';

afterEach(() => vi.useRealTimers());

const browsersOf = (manager: BrowserManager) => (manager as unknown as { browsers: Map<string, unknown> }).browsers;

describe('BrowserManager.abandon', () => {
  it('makes launch() and createContext() reject with an abort error', async () => {
    const manager = new BrowserManager();
    await manager.abandon();
    const launched = await manager.launch().catch((e: unknown) => e);
    expect(isAbortError(launched)).toBe(true);
    const created = await manager.createContext().catch((e: unknown) => e);
    expect(isAbortError(created)).toBe(true);
  });

  it('closes a browser once and resolves even when close() never settles', async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => new Promise<void>(() => {}));
    const manager = new BrowserManager();
    browsersOf(manager).set('chromium', { close });
    let done = false;
    const abandoning = manager.abandon().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await abandoning;
    expect(close).toHaveBeenCalledTimes(1);
    expect(browsersOf(manager).size).toBe(0);
  });
});
