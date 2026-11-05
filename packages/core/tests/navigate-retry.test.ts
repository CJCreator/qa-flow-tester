/**
 * ADR 0043: navigate retries and retryDelayMs.
 * Unit tier: fake Playwright page with controlled goto and waitForTimeout.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import { navigate } from '../src/navigate.js';

interface FakePageOptions {
  gotoImpl?: (url: string, opts?: { timeout?: number }) => Promise<any>;
}

function createFakePage(opts: FakePageOptions = {}) {
  const delays: number[] = [];
  const gotos: Array<{ url: string; timeout?: number }> = [];
  let closed = false;

  const page = {
    isClosed: () => closed,
    close: async () => {
      closed = true;
    },
    url: () => 'https://example.com/test',
    goto: async (url: string, options?: { timeout?: number }) => {
      gotos.push({ url, timeout: options?.timeout });
      if (opts.gotoImpl) {
        return opts.gotoImpl(url, options);
      }
      return {
        status: () => 200,
        request: () => ({ redirectedFrom: () => null }),
        headers: () => ({}),
      };
    },
    waitForLoadState: async () => {},
    waitForTimeout: async (ms: number) => {
      delays.push(ms);
    },
    locator: () => ({
      count: async () => 0,
      first: () => ({
        waitFor: async () => {},
      }),
    }),
  } as unknown as Page;

  return { page, delays, gotos };
}

describe('navigate with retryDelayMs', () => {
  it('defaults retryDelayMs to 0: retries a network error without delay', async () => {
    let callCount = 0;
    const { page, delays } = createFakePage({
      gotoImpl: async (url) => {
        if (url === 'about:blank') return null;
        callCount++;
        if (callCount === 1) {
          throw new Error('net::ERR_CONNECTION_REFUSED');
        }
        return {
          status: () => 200,
          request: () => ({ redirectedFrom: () => null }),
          headers: () => ({}),
        };
      },
    });

    const res = await navigate(page, 'https://example.com/test');
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(delays).toEqual([3000]); // only settleMs waitForTimeout
  });

  it('waits retryDelayMs before retrying a network error', async () => {
    let callCount = 0;
    const retryCalls: number[] = [];
    const { page, delays } = createFakePage({
      gotoImpl: async (url) => {
        if (url === 'about:blank') return null;
        callCount++;
        if (callCount === 1) {
          throw new Error('net::ERR_CONNECTION_RESET');
        }
        return {
          status: () => 200,
          request: () => ({ redirectedFrom: () => null }),
          headers: () => ({}),
        };
      },
    });

    const res = await navigate(page, 'https://example.com/test', {
      retryDelayMs: 5000,
      onRetry: () => retryCalls.push(Date.now()),
    });

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(retryCalls).toHaveLength(1);
    expect(delays).toContain(5000);
  });

  it('does NOT wait retryDelayMs on a timeout error', async () => {
    let callCount = 0;
    const { page, delays } = createFakePage({
      gotoImpl: async (url) => {
        if (url === 'about:blank') return null;
        callCount++;
        if (callCount === 1) {
          const err = new Error('page.goto: Timeout 15000ms exceeded.');
          err.name = 'TimeoutError';
          throw err;
        }
        return {
          status: () => 200,
          request: () => ({ redirectedFrom: () => null }),
          headers: () => ({}),
        };
      },
    });

    const res = await navigate(page, 'https://example.com/test', {
      retryDelayMs: 5000,
    });

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(delays).not.toContain(5000);
  });

  it('returns ok: false and classified error if retry also fails', async () => {
    const { page, delays } = createFakePage({
      gotoImpl: async (url) => {
        if (url === 'about:blank') return null;
        throw new Error('net::ERR_CONNECTION_REFUSED');
      },
    });

    const res = await navigate(page, 'https://example.com/test', {
      retryDelayMs: 5000,
    });

    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(2);
    expect(res.error?.kind).toBe('net');
    expect(delays).toContain(5000);
  });

  it('retries: 0 does not retry and never waits retryDelayMs', async () => {
    const { page, delays } = createFakePage({
      gotoImpl: async (url) => {
        if (url === 'about:blank') return null;
        throw new Error('net::ERR_CONNECTION_REFUSED');
      },
    });

    const res = await navigate(page, 'https://example.com/test', {
      retries: 0,
      retryDelayMs: 5000,
    });

    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(1);
    expect(delays).toEqual([]);
  });
});
