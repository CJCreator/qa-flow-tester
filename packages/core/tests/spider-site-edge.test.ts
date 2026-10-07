/**
 * Where the crawl's site begins and ends: the host the start address lands on, redirects within the
 * site, and a sign-in service on another host. 127.0.0.1 and localhost reach the same test server
 * but are different hosts, standing in for example.com and www.example.com.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { chromium, type Browser } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';

const PORT = 3531;
const LANDING = `http://localhost:${PORT}`;
const OTHER_HOST = `http://127.0.0.1:${PORT}`;

const html = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

/** Pages on the landing host (localhost). */
const LANDING_PAGES: Record<string, string> = {
  '/': html(
    'Home',
    `<nav>
      <a href="${LANDING}/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/old">Old address</a>
      <a href="/docs">Docs</a>
      <a href="https://elsewhere.invalid/page">Partner site</a>
    </nav>`
  ),
  '/about': html('About', '<p>About us</p>'),
  '/contact': html('Contact', '<p>Write to us</p>'),
  '/docs/': html('Docs', '<a href="intro">Introduction</a>'),
  '/docs/intro': html('Introduction', '<p>Start here</p>'),
};
const LANDING_REDIRECTS: Record<string, string> = {
  '/old': '/about',
  '/docs': '/docs/',
  // Members are sent to a sign-in service on another host.
  '/members': `${OTHER_HOST}/sso/login`,
};
/** Pages on the other host (127.0.0.1). */
const OTHER_PAGES: Record<string, string> = {
  '/sso/login': html(
    'Sign in',
    '<form><input name="user"><input type="password" name="pw"><button>Sign in</button></form><a href="/sso/help">Help</a>'
  ),
  '/sso/help': html('Sign-in help', '<p>Help</p>'),
};

describe('DeterministicSpider: where the site begins and ends', () => {
  let server: http.Server;
  let browser: Browser;
  const requests: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const host = req.headers.host || '';
      const { pathname } = new URL(req.url || '/', `http://${host}`);
      requests.push(`${host}${pathname}`);
      const onLanding = host.startsWith('localhost');
      // The start address as typed lands on the other host, as example.com lands on www.example.com.
      const redirect = onLanding ? LANDING_REDIRECTS[pathname] : pathname === '/' ? `${LANDING}/` : undefined;
      if (redirect) {
        res.writeHead(302, { Location: redirect });
        res.end();
        return;
      }
      const page = (onLanding ? LANDING_PAGES : OTHER_PAGES)[pathname];
      res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html' });
      res.end(page || 'Not found');
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('crawls the host the start address lands on, and records each redirected page once under its real address', async () => {
    const context = await browser.newContext();
    const result = await new DeterministicSpider().crawl(context, `${OTHER_HOST}/`);
    await context.close();

    // Absolute links to the landing host are followed, and a relative link on a redirected page
    // resolves against where the page really is (/docs/ → /docs/intro, not /intro).
    expect(result.pages.map((p) => p.urlPath).sort()).toEqual(['/', '/about', '/contact', '/docs/', '/docs/intro']);
    expect(result.signInWalls).toEqual([]);
    // Where each link goes, and where a redirected one really lands: the facts Navigation Checks use.
    const home = result.pages.find((p) => p.urlPath === '/')!;
    expect(home.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'About', to: '/about', landmark: 'nav' }),
        expect.objectContaining({ name: 'Old address', to: '/old', landsOn: '/about' }),
        expect.objectContaining({ name: 'Docs', to: '/docs', landsOn: '/docs/' }),
        expect.objectContaining({ name: 'Partner site', to: 'https://elsewhere.invalid/page', leavesSite: true }),
      ])
    );
    expect(home.contentKey).toMatch(/^[a-z0-9]+$/);
    // After landing, pages are loaded from the landing host, not through the redirect each time.
    expect(requests).toContain(`localhost:${PORT}/contact`);
    expect(requests).not.toContain(`127.0.0.1:${PORT}/contact`);
  });

  it('does not follow a start address onto a sign-in service on another host', async () => {
    requests.length = 0;
    const context = await browser.newContext();
    const result = await new DeterministicSpider().crawl(context, `${LANDING}/members`);
    await context.close();

    expect(result.signInWalls).toEqual(['/members']);
    expect(result.pages).toEqual([]);
    expect(requests.some((r) => r.endsWith('/sso/help'))).toBe(false);
  });
});
