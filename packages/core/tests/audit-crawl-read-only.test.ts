/**
 * QA-200: the Website Audit crawl only reads (REQ-003 AC-2/AC-3, REQ-006 AC-1, REQ-036 AC-1).
 * Independent of BE-204's functional test: everything here is asserted on what the servers were sent.
 * Two crawls, both through the test-only deps (Chromium maps a test host name to 127.0.0.1, a fake DNS gives
 * that name a public address, connections are redirected to 127.0.0.1):
 *  1. fixtures/audit-site with default limits;
 *  2. a small inline site with a 401 page, a sign-in form, a card-number page, a provider-frame page, a
 *     click-only element and a form with a GET action, each leading to a page nothing else links to.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { AuditRequest } from '@qa/types';
import { runAuditCrawl, type AuditCrawlDeps, type AuditCrawlResult } from '../src/audit/crawl/index.js';
import { defaultNetDeps, type NetDeps } from '../src/safe-net.js';
import { AUDIT_SITE_PAGES as P, startAuditSite, type AuditSiteServer } from './helpers/audit-site-server.js';

const SITE_HOST = 'kaveri.test';
const SHOP_HOST = 'inline.test';
const PUBLIC_ADDRESS = '93.184.216.34';
const LOOPBACK = /^(127\.|localhost$|::1$|\[::1\]$|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.)/;

interface LoggedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  bodyBytes: number;
}

let browser: Browser;
let site: AuditSiteServer;
let inline: { port: number; requests: LoggedRequest[]; close: () => Promise<void> };
/** Capture for the crawl in progress: the browser's own requests (before the guard) and every DNS lookup / connect. */
let browserRequests: Array<{ method: string; url: string; postData: string | null }> = [];
let lookups: string[] = [];
let connects: string[] = [];

const netDeps: NetDeps = {
  async lookup(host) {
    lookups.push(host);
    if (host === SITE_HOST || host === SHOP_HOST) return [PUBLIC_ADDRESS];
    throw new Error('ENOTFOUND');
  },
  connect(req) {
    connects.push(req.url.toString());
    return defaultNetDeps.connect({ ...req, address: '127.0.0.1' });
  },
};

const browserManager: AuditCrawlDeps['browserManager'] = {
  async createContext(): Promise<BrowserContext> {
    const context = await browser.newContext();
    context.on('request', (r) => browserRequests.push({ method: r.method(), url: r.url(), postData: r.postData() }));
    return context;
  },
};

const deps: AuditCrawlDeps = { browserManager, netDeps };

function auditRequest(url: string): AuditRequest {
  return { url, limits: { maxPages: 200, maxDepth: 8, includePaths: [], excludePaths: [] }, language: 'en' };
}

const pathOf = (p: string) => new URL(p, 'http://x.invalid').pathname;
const recordedPaths = (r: AuditCrawlResult) => r.pages.map((p) => pathOf(p.urlPath));
const skippedAs = (r: AuditCrawlResult, why: string) =>
  r.coverage.skipped.filter((s) => s.why === why).map((s) => s.urlPath);

function resetCapture() {
  browserRequests = [];
  lookups = [];
  connects = [];
}

/** Rules every crawl must satisfy, whatever the site: reads only, nothing sent, nowhere but the start host. */
function expectOnlyReads(
  log: ReadonlyArray<{ method: string; path: string }>,
  startHost: string,
  extraHeaderLog?: LoggedRequest[]
) {
  expect(log.length).toBeGreaterThan(0);
  expect(log.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')).toEqual([]);
  expect(browserRequests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')).toEqual([]);
  expect(browserRequests.filter((r) => r.postData)).toEqual([]);
  for (const r of extraHeaderLog ?? []) {
    expect(r.headers.authorization, `Authorization on ${r.path}`).toBeUndefined();
    expect(r.headers.cookie, `Cookie on ${r.path}`).toBeUndefined();
    expect(r.bodyBytes, `body on ${r.path}`).toBe(0);
  }
  // Nothing outside the start host: every connection went to it, and no private or loopback name was looked up.
  expect(connects.length).toBeGreaterThan(0);
  for (const c of connects) expect(new URL(c).hostname, c).toBe(startHost);
  for (const h of lookups) expect(LOOPBACK.test(h), `looked up ${h}`).toBe(false);
  for (const r of browserRequests) {
    const host = new URL(r.url).hostname;
    expect(
      ['facebook.com', 'instagram.com', 'example.invalid'].some((x) => host.endsWith(x)),
      r.url
    ).toBe(false);
  }
}

async function startInlineSite() {
  const requests: LoggedRequest[] = [];
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
  const pages: Record<string, { status?: number; html: string }> = {
    '/': {
      html: page(
        'Inline home',
        `<a href="/gate">Members</a> <a href="/sign-in">Sign in</a> <a href="/pay-card">Pay by card</a>
         <a href="/pay-frame">Pay with provider</a> <a href="/about">About</a>
         <a href="https://www.facebook.com/inline.example">Facebook</a>
         <button type="button" onclick="location.href='/click-only-target'">Offers</button>
         <div role="link" tabindex="0" onclick="location.href='/click-only-div'">More</div>
         <form action="/form-target" method="get"><label for="q">Search</label><input id="q" name="q" type="text" />
           <button type="submit">Go</button></form>`
      ),
    },
    '/about': { html: page('About', '<p>About us.</p> <a href="/">Home</a>') },
    '/gate': {
      status: 401,
      html: page('Members only', '<p>Please sign in.</p> <a href="/gate-only-target">Inside</a>'),
    },
    '/sign-in': {
      html: page(
        'Sign in',
        `<form action="/sign-in-post" method="post"><label for="u">Email</label><input id="u" name="log" type="text" />
         <label for="p">Password</label><input id="p" name="pwd" type="password" /><button type="submit">Sign in</button></form>
         <a href="/sign-in-only-target">Help</a>`
      ),
    },
    '/pay-card': {
      html: page(
        'Pay by card',
        `<form action="/pay-card-post" method="post"><label for="cn">Card number</label>
         <input id="cn" name="cardnumber" type="text" autocomplete="cc-number" /><button type="submit">Pay</button></form>
         <a href="/card-only-target">Terms</a>`
      ),
    },
    '/pay-frame': {
      html: page(
        'Pay with provider',
        `<iframe title="pay" src="https://js.stripe.com/v3/elements-inner.html" width="300" height="100"></iframe>
         <a href="/frame-only-target">Terms</a>`
      ),
    },
  };
  const server = http.createServer((req, res) => {
    const entry: LoggedRequest = {
      method: req.method || 'GET',
      path: req.url || '/',
      headers: req.headers,
      bodyBytes: 0,
    };
    requests.push(entry);
    req.on('data', (c: Buffer) => (entry.bodyBytes += c.length));
    res.setHeader('Cache-Control', 'no-store');
    const found = pages[pathOf(entry.path)];
    if (found) {
      res.writeHead(found.status ?? 200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(found.html);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as { port: number }).port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

beforeAll(async () => {
  site = await startAuditSite();
  inline = await startInlineSite();
  browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1, MAP ${SHOP_HOST} 127.0.0.1`],
  });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
  await inline?.close();
});

describe('read-only crawl of fixtures/audit-site with default limits', () => {
  let result: AuditCrawlResult;

  beforeAll(async () => {
    site.clearRequests();
    resetCapture();
    result = await runAuditCrawl(auditRequest(`http://${SITE_HOST}:${site.port}/`), { deps });
  }, 240_000);

  it('only GET and HEAD reach the site; no payment submit, no sign-in POST (REQ-003 AC-3)', () => {
    expectOnlyReads(site.requests, SITE_HOST);
    expect(result.pages.length).toBeGreaterThan(5);
    const paths = site.requests.map((r) => pathOf(r.path));
    expect(paths).not.toContain('/shop/checkout/pay');
    expect(paths).not.toContain('/enquiry');
    expect(site.requests.filter((r) => r.path.startsWith(P.signIn) && r.method !== 'GET')).toEqual([]);
  });

  it('the sign-in page is a sign-in Skipped Page and nothing is entered into it (REQ-006 AC-1)', () => {
    expect(skippedAs(result, 'sign-in')).toContain(P.signIn);
    expect(recordedPaths(result)).not.toContain(P.signIn);
    expect(browserRequests.filter((r) => r.url.includes('pwd=') || r.url.includes('log='))).toEqual([]);
  });

  it('the checkout is a payment Skipped Page; what only it links to is never requested (REQ-036 AC-1)', () => {
    expect(skippedAs(result, 'payment')).toContain(P.checkout);
    const paths = site.requests.map((r) => pathOf(r.path));
    expect(paths.filter((p) => p.startsWith(P.checkout))).toEqual([]);
    expect(paths).not.toContain(P.checkoutOnlyTarget);
    expect(recordedPaths(result)).not.toContain(P.checkoutOnlyTarget);
  });

  it('no request goes to Facebook, Instagram or the off-site robots.txt Sitemap host (REQ-003 AC-2)', () => {
    const all = [...browserRequests.map((r) => r.url), ...connects, ...lookups];
    for (const host of ['facebook.com', 'instagram.com', 'sitemaps.example.invalid', 'example.invalid']) {
      expect(
        all.filter((x) => x.includes(host)),
        host
      ).toEqual([]);
    }
    expect(result.leavingSite.some((l) => l.to.includes('facebook.com'))).toBe(true);
    expect(site.requests.map((r) => pathOf(r.path))).toContain('/sitemap.xml');
  });
});

describe('read-only crawl of an inline site with sign-in, payment, click-only and form-action routes', () => {
  let result: AuditCrawlResult;

  beforeAll(async () => {
    inline.requests.length = 0;
    resetCapture();
    result = await runAuditCrawl(auditRequest(`http://${SHOP_HOST}:${inline.port}/`), { deps });
  }, 120_000);

  it('records only the ordinary pages and sends nothing but GET requests with no credentials', () => {
    expect(recordedPaths(result).sort()).toEqual(['/', '/about']);
    expectOnlyReads(inline.requests, SHOP_HOST, inline.requests);
  });

  it('the 401 page and the sign-in form are sign-in Skipped Pages; no POST, nothing behind them (REQ-006 AC-1)', () => {
    const skipped = skippedAs(result, 'sign-in');
    expect(skipped).toContain('/gate');
    expect(skipped).toContain('/sign-in');
    expect(result.signInWalls).toEqual(expect.arrayContaining(['/gate', '/sign-in']));
    const paths = inline.requests.map((r) => pathOf(r.path));
    expect(paths).not.toContain('/sign-in-post');
    expect(paths).not.toContain('/gate-only-target');
    expect(paths).not.toContain('/sign-in-only-target');
    expect(inline.requests.filter((r) => r.path.includes('pwd='))).toEqual([]);
  });

  it('the card-number page and the provider-frame page are payment Skipped Pages with nothing behind them (REQ-036 AC-1)', () => {
    const skipped = skippedAs(result, 'payment');
    expect(skipped).toContain('/pay-card');
    expect(skipped).toContain('/pay-frame');
    expect(result.paymentAreas).toEqual(expect.arrayContaining(['/pay-card', '/pay-frame']));
    const paths = inline.requests.map((r) => pathOf(r.path));
    for (const p of ['/pay-card-post', '/card-only-target', '/frame-only-target']) expect(paths).not.toContain(p);
    // The page's own frame is only checked by the guard (a lookup that fails here); no connection is made to it.
    expect(connects.some((c) => c.includes('stripe.com'))).toBe(false);
  });

  it('turns on no exploring clicks and follows no form action (REQ-003 AC-3)', () => {
    const paths = inline.requests.map((r) => pathOf(r.path));
    expect(paths).not.toContain('/click-only-target');
    expect(paths).not.toContain('/click-only-div');
    expect(paths).not.toContain('/form-target');
    expect(inline.requests.some((r) => r.path.includes('q='))).toBe(false);
  });

  it('lists the Facebook link as leaving the site and never requests it (REQ-003 AC-2)', () => {
    expect(result.leavingSite.some((l) => l.to.includes('facebook.com'))).toBe(true);
    expect(browserRequests.some((r) => r.url.includes('facebook.com'))).toBe(false);
    expect(lookups.some((h) => h.includes('facebook.com'))).toBe(false);
  });
});
