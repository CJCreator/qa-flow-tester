import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { RoleCredential } from '@qa/types';
import { BrowserManager } from '../src/browser.js';
import { PreFlightChecker } from '../src/preflight.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

describe('PreFlightChecker.signIn', () => {
  const FIXTURE_PORT = 3611;
  const HANG_PORT = 3612;
  const CLOSED_PORT = 3616;
  const baseUrl = `http://localhost:${FIXTURE_PORT}`;
  const browser = new BrowserManager();
  const checker = new PreFlightChecker();
  let hangServer: http.Server;

  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    // Accepts the connection and never answers.
    hangServer = http.createServer(() => {});
    await new Promise<void>((resolve) => hangServer.listen(HANG_PORT, () => resolve()));
  });

  afterAll(async () => {
    await browser.close();
    hangServer.closeAllConnections?.();
    await new Promise<void>((resolve) => hangServer.close(() => resolve()));
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  });

  async function trySignIn(
    credential: RoleCredential,
    url = baseUrl,
    options?: { gotoTimeoutMs?: number }
  ): Promise<Awaited<ReturnType<PreFlightChecker['signIn']>>> {
    const context = await browser.createContext({ baseUrl: url });
    try {
      return await checker.signIn(context, url, credential, undefined, options);
    } finally {
      await context.close();
    }
  }

  const manager = (loginPath: string, password = 'manager-password'): RoleCredential => ({
    role: 'manager',
    username: 'manager@example.com',
    password,
    loginPath,
  });
  const twoStep = (password = 'two-step-password', username = 'two-step@example.com'): RoleCredential => ({
    role: 'manager',
    username,
    password,
    loginPath: '/login-two-step',
  });

  it('success carries no reason', async () => {
    const result = await trySignIn(manager('/signin'));
    expect(result.ok).toBe(true);
    expect(result.landingPath).toBe('/account');
    expect(result.reason).toBeUndefined();
  }, 60000);

  it('signs in on a two-step login (username, then password)', async () => {
    const result = await trySignIn(twoStep());
    expect(result).toEqual({ ok: true, landingPath: '/account' });
  }, 60000);

  it('signs in on a login that opens in a modal', async () => {
    const result = await trySignIn(manager('/login-modal'));
    expect(result.ok).toBe(true);
    expect(result.landingPath).toBe('/account');
  }, 60000);

  it('reports wrong-details for a wrong password on single-step, two-step and modal logins', async () => {
    const cases: Array<[string, RoleCredential]> = [
      ['single-step', manager('/signin', 'not-the-password')],
      ['two-step', twoStep('not-the-password')],
      ['modal', manager('/login-modal', 'not-the-password')],
    ];
    for (const [name, credential] of cases) {
      const result = await trySignIn(credential);
      expect({ name, ok: result.ok, reason: result.reason }).toEqual({ name, ok: false, reason: 'wrong-details' });
    }
  }, 120000);

  it('reports wrong-details for a wrong username on step one of a two-step login', async () => {
    const result = await trySignIn(twoStep('two-step-password', 'nobody@example.com'));
    expect(result.reason).toBe('wrong-details');
  }, 60000);

  it('reports no-form when the page has no sign-in form', async () => {
    const result = await trySignIn(manager('/login-nothing'));
    expect(result).toEqual({ ok: false, reason: 'no-form' });
  }, 60000);

  it('reports needs-more for a CAPTCHA', async () => {
    const result = await trySignIn(manager('/login-captcha'));
    expect(result).toEqual({ ok: false, reason: 'needs-more' });
  }, 60000);

  it('reports needs-more for a single-sign-on-only page', async () => {
    const result = await trySignIn(manager('/login-sso'));
    expect(result).toEqual({ ok: false, reason: 'needs-more' });
  }, 60000);

  it('reports unreachable when the site refuses connection', async () => {
    const result = await trySignIn(manager('/signin'), `http://localhost:${CLOSED_PORT}`);
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  }, 60000);

  it('reports unreachable on a timeout', async () => {
    const result = await trySignIn(manager('/signin'), `http://localhost:${HANG_PORT}`, { gotoTimeoutMs: 1500 });
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  }, 60000);

  it('gives the same reason every time for the same failure', async () => {
    const first = await trySignIn(manager('/signin', 'not-the-password'));
    const second = await trySignIn(manager('/signin', 'not-the-password'));
    expect(second.reason).toBe(first.reason);
    expect(first.reason).toBe('wrong-details');
  }, 60000);
});
