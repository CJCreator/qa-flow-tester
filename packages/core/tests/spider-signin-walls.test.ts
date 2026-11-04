/**
 * T-301 (LC-002, LC-009). A page that shows a password field for its own reasons — a change-password
 * form, a two-factor step — is a page like any other. It must be recorded, must not end a Role's crawl,
 * and the path reported to the person must be the one that was asked for, not the frontier's route key.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { chromium, type Browser } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';

// Own port: spider-concurrency.test.ts uses 3538, and the two clashed when they ran at the same time.
const PORT = 3543;
const BASE = `http://localhost:${PORT}`;

const html = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><nav><a href="/">Home</a></nav><main><h1>${title}</h1>${body}</main></body></html>`;

const HOME_LINKS = `<a href="/Settings">Settings</a> <a href="/security">Security</a> <a href="/orders">Orders</a> <a href="/Missing-Page">Missing</a>`;

const SIGN_IN_FORM = `<form method="post" action="/login">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="password">Password</label><input id="password" name="password" type="password">
  <button type="submit">Sign in</button>
</form>`;

/** Not a sign-in form: a password field beside a field a sign-in never asks for. */
const CHANGE_PASSWORD_FORM = `<form method="post" action="/account/security">
  <label for="current-password">Current password</label><input id="current-password" name="current-password" type="password">
  <label for="display-name">Display name</label><input id="display-name" name="display-name" type="text">
  <button type="submit">Save</button>
</form>`;

describe('DeterministicSpider: sign-in walls and the paths it reports (T-301)', () => {
  let server: http.Server;
  let browser: Browser;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', BASE);
      const raw = url.pathname;
      const lower = raw.toLowerCase();
      const path = lower.length > 1 && lower.endsWith('/') ? lower.slice(0, -1) : lower;

      const send = (body: string, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end(body);
      };
      // The site answers with the path it really uses, the way a case-sensitive server does.
      const canonical =
        path === '/settings' ? '/settings/' : path === '/account/security' ? '/account/security/' : path;
      if (canonical !== raw) {
        res.writeHead(302, { Location: canonical });
        res.end();
        return;
      }

      switch (path) {
        case '/':
          return send(html('Home', HOME_LINKS));
        case '/settings':
          return send(html('Settings', '<p>An ordinary page</p>'));
        case '/security':
          res.writeHead(302, { Location: '/account/security/' });
          return res.end();
        case '/account/security':
          return send(html('Security', CHANGE_PASSWORD_FORM));
        case '/orders':
          res.writeHead(302, { Location: '/login' });
          return res.end();
        case '/login':
          return send(html('Sign in', SIGN_IN_FORM));
        default:
          return send('Not found', 404);
      }
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('records a password-field page reached through a redirect, and keeps why it was decided', async () => {
    const context = await browser.newContext();
    const result = await new DeterministicSpider([], 1).crawl(context, `${BASE}/security`, {
      concurrency: 1,
      exploreClicks: false,
      isSignedIn: true,
      role: 'member',
      knownLoginPaths: ['/login'],
    });
    await context.close();

    expect(result.pages.map((p) => p.urlPath)).toEqual(['/account/security/']);
    expect(result.signInWalls).toEqual([]);
    expect(result.forms.map((f) => f.urlPath)).toEqual(['/account/security/']);
    expect(result.routes?.find((r) => r.requestedPath === '/security')).toMatchObject({ outcome: 'recorded' });
    // The page keeps the fact that a password field was on it.
    expect(result.pages[0].hasSignInForm).toBe(true);
  }, 60000);

  it('records a password-field page once under its real path when asked by a case-different path', async () => {
    const context = await browser.newContext();
    const result = await new DeterministicSpider([], 1).crawl(context, `${BASE}/Account/Security/`, {
      concurrency: 1,
      exploreClicks: false,
      isSignedIn: true,
      role: 'member',
      knownLoginPaths: ['/login'],
    });
    await context.close();

    expect(result.pages.map((p) => p.urlPath)).toEqual(['/account/security/']);
    expect(result.signInWalls).toEqual([]);
  }, 60000);

  it('still calls a Role bounced to the sign-in page a wall, and reports the path as asked', async () => {
    const context = await browser.newContext();
    const result = await new DeterministicSpider([], 1).crawl(context, `${BASE}/Orders/`, {
      concurrency: 1,
      exploreClicks: false,
      isSignedIn: true,
      role: 'member',
      knownLoginPaths: ['/login'],
    });
    await context.close();

    expect(result.signInWalls).toEqual(['/Orders/']);
    expect(result.pages).toEqual([]);
    expect(result.routes?.find((r) => r.requestedPath === '/orders')).toMatchObject({
      outcome: 'skipped',
      skipReason: 'session-lost',
      detail: 'login-path',
    });
  }, 60000);

  it('treats a bounce to the sign-in page as a wall for a visitor, and still records the sign-in page', async () => {
    const context = await browser.newContext();
    const result = await new DeterministicSpider([], 2).crawl(context, `${BASE}/orders`, {
      concurrency: 1,
      exploreClicks: false,
      role: 'visitor',
      isSignedIn: false,
    });
    await context.close();

    expect(result.signInWalls).toEqual(['/orders']);
    expect(result.skipped?.find((s) => s.urlPath === '/orders')).toMatchObject({ why: 'sign-in' });
    // The visitor can open the sign-in page itself, so it is recorded as a page with a sign-in form.
    expect(result.pages.find((p) => p.urlPath === '/login')?.hasSignInForm).toBe(true);
  }, 60000);

  it('reports the requested path, not the lower-cased route key', async () => {
    const context = await browser.newContext();
    const result = await new DeterministicSpider([], 2).crawl(context, `${BASE}/Missing-Page`, {
      concurrency: 1,
      exploreClicks: false,
    });
    await context.close();

    expect(result.pages).toEqual([]);
    expect(result.skipped?.find((s) => s.why === 'http-error')?.urlPath).toBe('/Missing-Page');
    // The route telemetry keeps its own value: the route key the frontier dedupes on.
    expect(result.routes?.[0]?.requestedPath).toBe('/missing-page');
  }, 60000);
});
