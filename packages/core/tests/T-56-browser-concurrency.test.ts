/**
 * T-56: concurrent callers for the same engine|host key share one launch, a failed launch clears its entry,
 * and a page failure in a browser that other lanes still use does not close that browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserManager } from '../src/browser.js';

const state = vi.hoisted(() => ({
  launches: 0,
  launchFailures: 0,
  pageFailures: 0,
  browsers: [] as Array<{ connected: boolean }>,
}));

vi.mock('playwright', () => {
  const makeBrowser = () => {
    const b = {
      connected: true,
      isConnected: () => b.connected,
      close: async () => {
        b.connected = false;
      },
      newContext: async () => {
        const closeListeners: Array<() => void> = [];
        return {
          route: async () => {},
          once: (_event: string, fn: () => void) => {
            closeListeners.push(fn);
          },
          newPage: async () => {
            if (state.pageFailures > 0) {
              state.pageFailures--;
              throw new Error('Target page, context or browser has been closed');
            }
            return {};
          },
          close: async () => {
            closeListeners.forEach((fn) => fn());
          },
        };
      },
    };
    state.browsers.push(b);
    return b;
  };
  const launch = async () => {
    state.launches++;
    if (state.launchFailures > 0) {
      state.launchFailures--;
      throw new Error('launch failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    return makeBrowser();
  };
  return {
    chromium: { launch },
    webkit: { launch },
    firefox: { launch },
  };
});

describe('Browser launches are shared per engine and host', () => {
  let manager: BrowserManager;

  beforeEach(() => {
    state.launches = 0;
    state.launchFailures = 0;
    state.pageFailures = 0;
    state.browsers.length = 0;
    manager = new BrowserManager();
  });

  afterEach(async () => {
    await manager.close();
  });

  it('gives concurrent callers for the same key one shared launch', async () => {
    const [a, b] = await Promise.all([
      manager.launch('chromium', true, 'a.example.com'),
      manager.launch('chromium', true, 'a.example.com'),
    ]);

    expect(state.launches).toBe(1);
    expect(a).toBe(b);
  });

  it('clears the in-flight entry when a launch fails, so the next caller launches again', async () => {
    state.launchFailures = 1;
    await expect(manager.launch('chromium', true, 'b.example.com')).rejects.toThrow('launch failed');

    await expect(manager.launch('chromium', true, 'b.example.com')).resolves.toBeDefined();
    expect(state.launches).toBe(2);
  });

  it('does not close a shared browser when one page fails and another lane is live', async () => {
    await manager.openPage({ baseUrl: 'https://a.example.com' });
    state.pageFailures = 1;

    const second = await manager.openPage({ baseUrl: 'https://a.example.com' });

    expect(state.launches).toBe(1);
    expect(state.browsers[0].connected).toBe(true);
    expect(second.page).toBeDefined();
  });

  it('still restarts the browser for a single lane whose page fails', async () => {
    const first = await manager.openPage({ baseUrl: 'https://a.example.com' });
    await first.context.close();
    state.pageFailures = 1;

    await manager.openPage({ baseUrl: 'https://a.example.com' });

    expect(state.launches).toBe(2);
  });
});
