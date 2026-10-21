/**
 * T-52: each target host gets its own browser process (the Chromium `--no-sandbox` setting is only ever
 * used inside that per-host process), and a target URL is logged without its user name and password.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserManager, urlForLog } from '../src/browser.js';

const launched = vi.hoisted(() => [] as Array<{ args: string[] }>);

vi.mock('playwright', () => {
  const makeBrowser = () => ({
    isConnected: () => true,
    close: async () => {},
    newContext: async () => ({
      route: async () => {},
      once: () => {},
      newPage: async () => ({}),
      close: async () => {},
    }),
  });
  return {
    chromium: {
      launch: vi.fn(async (opts: { args?: string[] }) => {
        launched.push({ args: opts.args ?? [] });
        return makeBrowser();
      }),
    },
    webkit: { launch: vi.fn(async () => makeBrowser()) },
    firefox: { launch: vi.fn(async () => makeBrowser()) },
  };
});

describe('Browser processes are isolated per target host', () => {
  let manager: BrowserManager;

  beforeEach(() => {
    launched.length = 0;
    manager = new BrowserManager();
  });

  afterEach(async () => {
    await manager.close();
  });

  it('starts one Chromium process per target host, each with --no-sandbox', async () => {
    await manager.createContext({ baseUrl: 'https://a.example.com' });
    await manager.createContext({ baseUrl: 'https://b.example.com' });

    expect(launched).toHaveLength(2);
    for (const call of launched) expect(call.args).toContain('--no-sandbox');
  });

  it('reuses the process for the same host, ignoring case and path', async () => {
    await manager.createContext({ baseUrl: 'https://a.example.com' });
    await manager.createContext({ baseUrl: 'https://A.example.com/login' });

    expect(launched).toHaveLength(1);
  });

  it('keeps openPage on the target host process too', async () => {
    const first = await manager.openPage({ baseUrl: 'https://a.example.com' });
    const second = await manager.openPage({ baseUrl: 'https://b.example.com' });
    const again = await manager.openPage({ baseUrl: 'https://a.example.com/other' });

    expect(launched).toHaveLength(2);
    expect(first.page).toBeDefined();
    expect(second.page).toBeDefined();
    expect(again.page).toBeDefined();
  });

  it('gives a second host its own process even when the first is still open', async () => {
    await manager.createContext({ baseUrl: 'https://a.example.com' });
    await manager.createContext({ baseUrl: 'https://b.example.com' });
    await manager.createContext({ baseUrl: 'https://c.example.com' });

    expect(launched).toHaveLength(3);
  });
});

describe('urlForLog', () => {
  it('removes the user name and password and keeps the rest of the URL', () => {
    expect(urlForLog('https://qa-user:s3cret@site.example.com/app?x=1')).toBe('https://site.example.com/app?x=1');
  });

  it('removes a user name without a password', () => {
    expect(urlForLog('https://token@site.example.com/')).toBe('https://site.example.com/');
  });

  it('leaves a URL without credentials unchanged', () => {
    expect(urlForLog('https://site.example.com/path')).toBe('https://site.example.com/path');
  });

  it('cuts credentials out of text that is not a parseable URL', () => {
    expect(urlForLog('not a url //qa-user:s3cret@host.example/x')).toBe('not a url //host.example/x');
  });
});
