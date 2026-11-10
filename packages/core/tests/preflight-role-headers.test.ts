import { describe, it, expect, vi } from 'vitest';
import { PreFlightChecker } from '../src/preflight.js';
import type { BrowserContext, Route } from 'playwright';

describe('preflight role headers', () => {
  it('scopes role headers to the site and never sends them to third parties', async () => {
    let routeHandler: ((route: Route) => Promise<void>) | undefined;
    const setExtraHTTPHeaders = vi.fn();
    const fakeContext = {
      route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => {
        routeHandler = handler;
      }),
      setExtraHTTPHeaders,
      addInitScript: vi.fn(async () => {}),
      newPage: vi.fn(async () => {
        throw new Error('stop');
      }),
    } as unknown as BrowserContext;

    const checker = new PreFlightChecker();
    try {
      await checker.signIn(fakeContext, 'https://app.example.com', {
        role: 'member',
        token: 'abc',
        headers: { 'X-Team': 'red' },
      });
    } catch {
      // Expected to fail at newPage
    }

    expect(setExtraHTTPHeaders).not.toHaveBeenCalled();
    expect(routeHandler).toBeDefined();

    // 1. Same host request gets headers
    const fallbackOnSite = vi.fn();
    const onSiteRoute = {
      request: () => ({
        url: () => 'https://app.example.com/login',
        headers: () => ({ accept: '*/*' }),
      }),
      fallback: fallbackOnSite,
    } as unknown as Route;
    await routeHandler!(onSiteRoute);
    expect(fallbackOnSite).toHaveBeenCalledWith({
      headers: {
        accept: '*/*',
        'X-Team': 'red',
        Authorization: 'Bearer abc',
      },
    });

    // 2. Third-party request gets no extra headers
    const fallbackThirdParty = vi.fn();
    const thirdPartyRoute = {
      request: () => ({
        url: () => 'https://www.google-analytics.com/analytics.js',
        headers: () => ({ accept: '*/*' }),
      }),
      fallback: fallbackThirdParty,
    } as unknown as Route;
    await routeHandler!(thirdPartyRoute);
    expect(fallbackThirdParty).toHaveBeenCalledWith();

    // 3. Same site (e.g. www twin) gets headers
    const fallbackTwin = vi.fn();
    const twinRoute = {
      request: () => ({
        url: () => 'https://www.app.example.com/x.js',
        headers: () => ({ accept: '*/*' }),
      }),
      fallback: fallbackTwin,
    } as unknown as Route;
    await routeHandler!(twinRoute);
    expect(fallbackTwin).toHaveBeenCalledWith({
      headers: {
        accept: '*/*',
        'X-Team': 'red',
        Authorization: 'Bearer abc',
      },
    });
  });
});
