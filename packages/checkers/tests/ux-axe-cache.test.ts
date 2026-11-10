/**
 * PERF-2: axe runs once per (page URL, viewport) within a run; a failed scan is not cached.
 * Unit tier: axe is mocked, no browser. The fake page only has what the axe step reads; the rest of
 * check() may throw on it, so each call is allowed to reject after the axe step has run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';

const axe = vi.hoisted(() => ({ calls: 0, fail: false }));

vi.mock('@axe-core/playwright', () => {
  class AxeBuilder {
    constructor(_opts: unknown) {}
    withTags(_tags: string[]) {
      return this;
    }
    async analyze() {
      axe.calls++;
      if (axe.fail) throw new Error('axe failed');
      return { violations: [] };
    }
  }
  return { default: AxeBuilder };
});

import { UXQualityChecker, type AxeCache } from '../src/ux-quality.js';

function fakePage(url: string, vp: { width: number; height: number } | null) {
  return {
    url: () => url,
    viewportSize: () => vp,
    evaluate: async () => undefined,
    locator: () => ({ count: async () => 0, first: () => ({}) }),
  } as unknown as Page;
}

const ctx = { role: 'visitor', breakpoint: '1440px' as const, urlPath: '/' };

describe('UXQualityChecker axe cache (PERF-2)', () => {
  let checker: UXQualityChecker;
  beforeEach(() => {
    axe.calls = 0;
    axe.fail = false;
    checker = new UXQualityChecker();
  });

  it('runs axe once for the same URL and viewport, twice when the viewport differs', async () => {
    const cache: AxeCache = new Map();
    const p1 = fakePage('https://site.test/a', { width: 1440, height: 900 });
    await checker.check(p1, { ...ctx, axeCache: cache }).catch(() => undefined);
    await checker.check(p1, { ...ctx, axeCache: cache }).catch(() => undefined);
    expect(axe.calls).toBe(1);
    const p2 = fakePage('https://site.test/a', { width: 375, height: 800 });
    await checker.check(p2, { ...ctx, axeCache: cache }).catch(() => undefined);
    expect(axe.calls).toBe(2);
  });

  it('runs axe again for another Role on the same URL and viewport', async () => {
    const cache: AxeCache = new Map();
    const p = fakePage('https://site.test/a', { width: 1440, height: 900 });
    await checker.check(p, { ...ctx, role: 'admin', axeCache: cache }).catch(() => undefined);
    await checker.check(p, { ...ctx, role: 'admin', axeCache: cache }).catch(() => undefined);
    expect(axe.calls).toBe(1);
    await checker.check(p, { ...ctx, role: 'member', axeCache: cache }).catch(() => undefined);
    expect(axe.calls).toBe(2);
  });

  it('does not cache a failed scan: the next check runs axe again', async () => {
    const cache: AxeCache = new Map();
    const p = fakePage('https://site.test/b', { width: 1440, height: 900 });
    axe.fail = true;
    await checker.check(p, { ...ctx, axeCache: cache }).catch(() => undefined);
    axe.fail = false;
    await checker.check(p, { ...ctx, axeCache: cache }).catch(() => undefined);
    expect(axe.calls).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('without a cache every call runs axe', async () => {
    const p = fakePage('https://site.test/c', { width: 1440, height: 900 });
    await checker.check(p, ctx).catch(() => undefined);
    await checker.check(p, ctx).catch(() => undefined);
    expect(axe.calls).toBe(2);
  });
});
