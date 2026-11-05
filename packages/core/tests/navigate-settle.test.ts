/**
 * PERF-1: settle waits after DOMContentLoaded use two animation frames, capped, not networkidle.
 * Unit tier: fake Playwright page; no browser.
 */
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { settleFrames, settlePage } from '../src/navigate.js';

function fakePage(opts: { evaluate?: () => Promise<unknown>; waitForLoadState?: () => Promise<void> }) {
  const waits: number[] = [];
  const calls: string[] = [];
  const page = {
    evaluate: async () => {
      calls.push('evaluate');
      return opts.evaluate ? opts.evaluate() : undefined;
    },
    waitForLoadState: async () => {
      calls.push('waitForLoadState');
      if (opts.waitForLoadState) await opts.waitForLoadState();
    },
    waitForTimeout: async (ms: number) => {
      waits.push(ms);
    },
    locator: () => ({
      count: async () => 2,
      first: () => ({ waitFor: async () => {} }),
    }),
  } as unknown as Page;
  return { page, waits, calls };
}

describe('settleFrames / settlePage (PERF-1)', () => {
  it('runs the frame micro-wait and never waits for networkidle', async () => {
    const f = fakePage({
      waitForLoadState: async () => {
        throw new Error('networkidle must not be awaited');
      },
    });
    const res = await settlePage(f.page, { settleMs: 3000 });
    expect(res.settled).toBe(true);
    expect(f.calls).toEqual(['evaluate']);
    expect(f.waits).toEqual([3000]); // the cap only
  });

  it('resolves at the cap when frames never fire (hidden or hung page)', async () => {
    const f = fakePage({ evaluate: () => new Promise(() => {}) });
    await settleFrames(f.page, 250);
    expect(f.waits).toEqual([250]);
  });

  it('survives a page that cannot evaluate (closed page) without throwing', async () => {
    const page = {
      evaluate: async () => {
        throw new Error('Target closed');
      },
      waitForTimeout: async () => {},
    } as unknown as Page;
    await expect(settleFrames(page, 100)).resolves.toBeUndefined();
  });
});
