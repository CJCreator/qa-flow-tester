/**
 * BE-200: the Spider's opt-in hooks for the Website Audit (REQ-002, REQ-003, REQ-005, REQ-006, REQ-036), and
 * `depth-limit` listed as a Skipped Page instead of dropped silently.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { chromium, type Browser } from 'playwright';
import type { SkippedPageInfo } from '@qa/types';
import { DeterministicSpider, type SpiderPageInventoryItem } from '../src/discovery/deterministic-spider.js';

const html = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="en"><head><title>${title}</title>${head}</head><body><main><h1>${title}</h1>${body}</main></body></html>`;

const PAGES: Record<string, string> = {
  '/': html(
    'Home',
    `<a href="/a">A</a> <a href="/blog/x">Blog</a> <a href="/pay">Pay</a> <a href="/signin">Sign in</a>
     <a href="/formpage">Form</a> <a href="/script">Script</a>`
  ),
  '/a': html('A', `<a href="/a/b">B</a> <a href="/a/b2">B2</a>`),
  '/a/b': html('B', `<a href="/a/b/c">C</a>`),
  '/a/b2': html('B2', `<a href="/a/b/c">C again</a>`),
  '/a/b/c': html('C', '<p>Too deep</p>'),
  '/blog/start': html('Blog start', `<a href="/blog/x">Post</a> <a href="/a">A</a>`),
  '/blog/x': html('Blog post', '<p>Post</p>'),
  '/blog/y': html('Blog post y', '<p>Post y</p>'),
  // A payment page: a navigation-like button that would be click-explored, and a link found only here.
  '/pay': html(
    'Payment',
    `<a href="/pay-only">Receipt</a>
     <button type="button" onclick="location.href='/pay-clicked'">View details</button>
     <nav><button type="button" onclick="location.href='/pay-nav-clicked'">Home</button></nav>`
  ),
  '/pay-only': html('Receipt', ''),
  '/signin': html(
    'Sign in',
    `<a href="/signin-only">Help</a>
     <form method="post" action="/session"><label for="u">User</label><input id="u" name="u">
     <button type="button" onclick="location.href='/signin-clicked'">Continue</button></form>
     <nav><button type="button" onclick="location.href='/signin-nav-clicked'">Home</button></nav>`
  ),
  '/signin-only': html('Help', ''),
  '/formpage': html('Search', `<form method="get" action="/search"><input name="q"><button>Go</button></form>`),
  '/search': html('Results', ''),
  // Text and a link put in by script after load: only a rendered page has them.
  '/script': html(
    'Script',
    '<div id="late"></div>',
    `<script>window.addEventListener('load', () => setTimeout(() => {
       document.getElementById('late').innerHTML = '<p>Inserted by script</p><a href="/late">Late link</a>';
     }, 100));</script>`
  ),
  '/late': html('Late', ''),
};

const SITEMAP = (base: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/blog/y</loc></url><url><loc>${base}/a</loc></url></urlset>`;

describe('DeterministicSpider audit hooks (BE-200)', () => {
  let browser: Browser;
  let server: http.Server;
  let base = '';
  let requests: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      requests.push(url.pathname);
      if (url.pathname === '/sitemap.xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(SITEMAP(base));
        return;
      }
      const body = PAGES[url.pathname];
      if (!body) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(html('Not found', ''));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const crawl = async (start: string, opts: Parameters<DeterministicSpider['crawl']>[2]) => {
    requests = [];
    const context = await browser.newContext();
    try {
      return await new DeterministicSpider([], 50).crawl(context, `${base}${start}`, {
        pageDelayMs: 0,
        concurrency: 1,
        ...opts,
      });
    } finally {
      await context.close();
    }
  };

  it('lists a page past the max depth once as depth-limit, without any new option set', async () => {
    const result = await crawl('/', { maxDepth: 2, seedSitemap: false, exploreClicks: false });
    const paths = result.pages.map((p) => p.urlPath);
    expect(paths).toEqual(expect.arrayContaining(['/', '/a', '/a/b', '/a/b2']));
    expect(paths).not.toContain('/a/b/c');
    expect(requests).not.toContain('/a/b/c');
    const deep = (result.skipped || []).filter((s) => s.why === 'depth-limit');
    expect(deep).toEqual([{ urlPath: '/a/b/c', why: 'depth-limit' }]);
    // Without the option, GET form actions are still followed.
    expect(paths).toContain('/search');
  }, 90000);

  it('runs every hook: admitPath, inspectPage, followFormActions, onRecordedPage, onSkipped', async () => {
    const admitAsked: string[] = [];
    const inspected: string[] = [];
    const heard: SkippedPageInfo[] = [];
    const rendered = new Map<string, { text: string; hrefs: string[]; item: SpiderPageInventoryItem }>();

    const result = await crawl('/', {
      maxDepth: 2,
      seedSitemap: true,
      followFormActions: false,
      admitPath: (url) => {
        admitAsked.push(url.pathname);
        return url.pathname.startsWith('/blog') ? { why: 'excluded' } : undefined;
      },
      inspectPage: async (_page, landed) => {
        inspected.push(landed.pathname);
        if (landed.pathname === '/pay') return { why: 'payment', detail: 'card-field' };
        if (landed.pathname === '/signin') return { why: 'sign-in', detail: 'sign-in-form' };
        return undefined;
      },
      onRecordedPage: async (page, item) => {
        rendered.set(item.urlPath, {
          text: await page.locator('body').innerText(),
          hrefs: await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href') || '')),
          item,
        });
      },
      onSkipped: (info) => heard.push(info),
    });

    const paths = result.pages.map((p) => p.urlPath);
    const skipped = result.skipped || [];
    const reasons = (p: string) => skipped.filter((s) => s.urlPath === p).map((s) => s.why);

    // admitPath: /blog/x (link) and /blog/y (sitemap) are never requested; the start address is never asked.
    expect(requests).not.toContain('/blog/x');
    expect(requests).not.toContain('/blog/y');
    expect(reasons('/blog/x')).toEqual(['excluded']);
    expect(reasons('/blog/y')).toEqual(['excluded']);
    expect(admitAsked).not.toContain('/');
    expect(admitAsked.filter((p) => p === '/blog/x')).toHaveLength(1);

    // inspectPage payment: not recorded, nothing clicked, its own link never requested.
    expect(paths).not.toContain('/pay');
    expect(reasons('/pay')).toEqual(['payment']);
    expect(skipped.find((s) => s.urlPath === '/pay')?.detail).toBe('card-field');
    expect(requests).not.toContain('/pay-only');
    expect(requests).not.toContain('/pay-clicked');
    expect(requests).not.toContain('/pay-nav-clicked');

    // inspectPage sign-in: listed as a wall, nothing clicked or followed.
    expect(paths).not.toContain('/signin');
    expect(reasons('/signin')).toEqual(['sign-in']);
    expect(result.signInWalls).toContain('/signin');
    expect(requests).not.toContain('/signin-only');
    expect(requests).not.toContain('/signin-clicked');
    expect(requests).not.toContain('/signin-nav-clicked');
    expect(requests).not.toContain('/session');
    expect(inspected).toEqual(expect.arrayContaining(['/', '/pay', '/signin']));

    // followFormActions false: the GET form's action is neither queued nor submitted.
    expect(paths).toContain('/formpage');
    expect(requests).not.toContain('/search');

    // onRecordedPage: the live page after script ran, and every recorded item carries its depth.
    const script = rendered.get('/script');
    expect(script?.text).toContain('Inserted by script');
    expect(script?.hrefs).toContain('/late');
    expect(paths).toContain('/late');
    expect([...rendered.keys()].sort()).toEqual([...paths].sort());
    for (const p of result.pages) expect(rendered.get(p.urlPath)?.item).toBe(p);
    const depthOf = (p: string) => result.pages.find((x) => x.urlPath === p)?.depth;
    expect(depthOf('/')).toBe(0);
    expect(depthOf('/a')).toBe(1);
    expect(depthOf('/a/b')).toBe(2);
    expect(depthOf('/script')).toBe(1);
    expect(depthOf('/late')).toBe(2);

    // depth-limit still listed once alongside the hooks.
    expect(reasons('/a/b/c')).toEqual(['depth-limit']);

    // onSkipped: once per entry, the same entries in the same order.
    expect(heard).toHaveLength(skipped.length);
    heard.forEach((h, i) => expect(h).toBe(skipped[i]));
  }, 120000);

  it('never asks admitPath about the start address, even when its rule would refuse it', async () => {
    const admitAsked: string[] = [];
    const result = await crawl('/blog/start', {
      seedSitemap: false,
      maxDepth: 1,
      admitPath: (url) => {
        admitAsked.push(url.pathname);
        return url.pathname.startsWith('/blog') ? { why: 'excluded' } : undefined;
      },
    });
    const paths = result.pages.map((p) => p.urlPath);
    expect(paths).toContain('/blog/start');
    expect(admitAsked).not.toContain('/blog/start');
    expect(requests).not.toContain('/blog/x');
    expect((result.skipped || []).filter((s) => s.urlPath === '/blog/x').map((s) => s.why)).toEqual(['excluded']);
    expect(paths).toContain('/a');
  }, 90000);
});
