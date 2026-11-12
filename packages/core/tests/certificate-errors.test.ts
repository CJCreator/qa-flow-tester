import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Page } from 'playwright';
import { BrowserManager, ignoresCertificateErrors } from '../src/browser.js';
import { navigate } from '../src/navigate.js';

const launch = vi.fn();
vi.mock('playwright', () => ({
  chromium: {
    launch: (...a: unknown[]) => launch(...a),
  },
}));

function fakeBrowser() {
  const options: Array<Record<string, unknown>> = [];
  const browser = {
    isConnected: () => true,
    close: async () => {},
    newContext: async (o: Record<string, unknown>) => {
      options.push(o);
      return { route: async () => {}, routeWebSocket: async () => {} };
    },
  };
  return { browser, options };
}

describe('ignoresCertificateErrors', () => {
  it('is true for this machine and private network addresses', () => {
    for (const url of [
      'https://localhost:8443/',
      'https://app.localhost/',
      'https://127.0.0.1/',
      'https://192.168.1.20/',
      'https://[::1]/',
    ]) {
      expect(ignoresCertificateErrors(url, false), url).toBe(true);
    }
  });

  it('is false for public addresses', () => {
    expect(ignoresCertificateErrors('https://example.com/', false)).toBe(false);
    expect(ignoresCertificateErrors('https://8.8.8.8/', false)).toBe(false);
  });

  it('is true for a Test Copy on a public name', () => {
    expect(ignoresCertificateErrors('https://staging.example.com/', true)).toBe(true);
  });

  it('is false for a missing or bad address', () => {
    expect(ignoresCertificateErrors(undefined, false)).toBe(false);
    expect(ignoresCertificateErrors('not a url', false)).toBe(false);
  });
});

describe('BrowserManager.createContext certificate policy', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('checks certificates for a public live App', async () => {
    const { browser, options } = fakeBrowser();
    launch.mockResolvedValue(browser);
    await new BrowserManager().createContext({ baseUrl: 'https://example.com/' });
    expect(options[0].ignoreHTTPSErrors).toBe(false);
  });

  it('ignores certificates on localhost', async () => {
    const { browser, options } = fakeBrowser();
    launch.mockResolvedValue(browser);
    await new BrowserManager().createContext({ baseUrl: 'https://localhost:3000/' });
    expect(options[0].ignoreHTTPSErrors).toBe(true);
  });

  it('ignores certificates when the manager is set to trust them (a Test Copy)', async () => {
    const { browser, options } = fakeBrowser();
    launch.mockResolvedValue(browser);
    const manager = new BrowserManager();
    manager.trustInvalidCertificates = true;
    await manager.createContext({ baseUrl: 'https://example.com/' });
    expect(options[0].ignoreHTTPSErrors).toBe(true);
  });

  it('lets the per-call option win over the manager field', async () => {
    const { browser, options } = fakeBrowser();
    launch.mockResolvedValue(browser);
    const manager = new BrowserManager();
    manager.trustInvalidCertificates = true;
    await manager.createContext({ baseUrl: 'https://example.com/', trustInvalidCertificates: false });
    expect(options[0].ignoreHTTPSErrors).toBe(false);
  });
});

describe('navigate classifies certificate errors', () => {
  function pageWithGoto(goto: Page['goto']): Page {
    return {
      goto,
      isClosed: () => false,
      url: () => '',
    } as unknown as Page;
  }

  it('reports a certificate error as tls, without a retry', async () => {
    const goto = vi
      .fn()
      .mockRejectedValue(new Error('page.goto: net::ERR_CERT_DATE_INVALID at https://expired.example/'));
    const result = await navigate(pageWithGoto(goto as unknown as Page['goto']), 'https://expired.example/');
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('tls');
    expect(result.attempts).toBe(1);
  });

  it('still reports a refused connection as net', async () => {
    const goto = vi.fn().mockRejectedValue(new Error('page.goto: net::ERR_CONNECTION_REFUSED at http://down.example/'));
    const result = await navigate(pageWithGoto(goto as unknown as Page['goto']), 'http://down.example/');
    expect(result.error?.kind).toBe('net');
  });
});
