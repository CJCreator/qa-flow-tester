import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { SeoChecker } from '../src/seo.js';
import type { FetchFn } from '../src/security-depth.js';

const BASE = 'http://localhost:3050';

function createPage(sameSiteLinks: string[]): Page {
  const details = {
    title: 'Home',
    metaDescription: 'Home page',
    h1Count: 1,
    headings: [{ level: 1, text: 'Home' }],
    htmlLang: 'en',
    sameSiteLinks,
    canonicalUrl: `${BASE}/`,
    canonicalCount: 1,
    hasViewportMeta: true,
    hasFavicon: true,
    imagesWithoutAltCount: 0,
  };
  return { evaluate: async () => details } as unknown as Page;
}

function countingFetch(statusFor: (url: string) => number = () => 200) {
  const requested: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    requested.push(url);
    return { status: statusFor(url), headers: {}, text: async () => '' };
  };
  return { fetchFn, requested };
}

const searchOff = { searchChecks: false };

describe('SEO link check once per page and cache (T-55)', () => {
  const checker = new SeoChecker();

  it('requests a link once per run when two pages link to it, with a run-wide cache', async () => {
    const { fetchFn, requested } = countingFetch();
    const linkCache = new Map<string, Promise<number | null>>();
    const ctx = { role: 'visitor', breakpoint: '1440px' as const, baseUrl: BASE, fetchFn, linkCache, ...searchOff };

    await checker.checkPage(createPage(['/shared']), { ...ctx, urlPath: '/a' });
    await checker.checkPage(createPage(['/shared']), { ...ctx, urlPath: '/b' });

    expect(requested.filter((u) => u === `${BASE}/shared`)).toHaveLength(1);
  });

  it('still reports a broken link on each page that links to it', async () => {
    const { fetchFn } = countingFetch((url) => (url.endsWith('/gone') ? 404 : 200));
    const linkCache = new Map<string, Promise<number | null>>();
    const ctx = { role: 'visitor', breakpoint: '1440px' as const, baseUrl: BASE, fetchFn, linkCache, ...searchOff };

    const first = await checker.checkPage(createPage(['/gone']), { ...ctx, urlPath: '/a' });
    const second = await checker.checkPage(createPage(['/gone']), { ...ctx, urlPath: '/b' });

    expect(first.filter((f) => f.title.includes('Broken link found'))).toHaveLength(1);
    expect(second.filter((f) => f.title.includes('Broken link found'))).toHaveLength(1);
    expect(second[0].where.urlPath).toBe('/b');
  });

  it('does not request links without a cache when none is given (no shared memory between calls)', async () => {
    const { fetchFn, requested } = countingFetch();
    const ctx = { role: 'visitor', breakpoint: '1440px' as const, baseUrl: BASE, fetchFn, ...searchOff };

    await checker.checkPage(createPage(['/shared']), { ...ctx, urlPath: '/a' });
    await checker.checkPage(createPage(['/shared']), { ...ctx, urlPath: '/b' });

    expect(requested.filter((u) => u === `${BASE}/shared`)).toHaveLength(2);
  });

  it('makes no link request when checkLinks is false', async () => {
    const { fetchFn, requested } = countingFetch();
    const findings = await checker.checkPage(createPage(['/a1', '/a2']), {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: BASE,
      fetchFn,
      checkLinks: false,
      ...searchOff,
    });

    expect(requested).toHaveLength(0);
    expect(findings).toHaveLength(0);
  });

  it('makes no link request when checkLinks is false and search checks are on', async () => {
    const { fetchFn, requested } = countingFetch();
    await checker.checkPage(createPage(['/a1']), {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: BASE,
      fetchFn,
      checkLinks: false,
    });

    expect(requested.some((u) => u.endsWith('/a1'))).toBe(false);
  });

  it('checks at most 5 links, 4 at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const requested: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      requested.push(url);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return { status: 200, headers: {}, text: async () => '' };
    };

    await checker.checkPage(createPage(['/l1', '/l2', '/l3', '/l4', '/l5', '/l6', '/l7']), {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: BASE,
      fetchFn,
      linkCache: new Map(),
      ...searchOff,
    });

    expect(requested).toHaveLength(5);
    expect(peak).toBe(4);
  });

  it('keeps the order of the broken-link findings', async () => {
    const { fetchFn } = countingFetch((url) => (/\/(x|z)$/.test(url) ? 404 : 200));
    const findings = await checker.checkPage(createPage(['/x', '/y', '/z']), {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: BASE,
      fetchFn,
      linkCache: new Map(),
      ...searchOff,
    });

    const broken = findings.filter((f) => f.title.includes('Broken link found'));
    expect(broken.map((f) => f.title)).toEqual([
      'Broken link found: /x returned HTTP 404',
      'Broken link found: /z returned HTTP 404',
    ]);
    expect(broken.map((f) => f.id)).toEqual([
      expect.stringContaining('BROKENLINK-1'),
      expect.stringContaining('BROKENLINK-2'),
    ]);
  });

  it('treats a network error as no finding and caches the failed answer', async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls++;
      throw new Error('timeout');
    };
    const linkCache = new Map<string, Promise<number | null>>();
    const ctx = { role: 'visitor', breakpoint: '1440px' as const, baseUrl: BASE, fetchFn, linkCache, ...searchOff };

    const first = await checker.checkPage(createPage(['/slow']), { ...ctx, urlPath: '/a' });
    const second = await checker.checkPage(createPage(['/slow']), { ...ctx, urlPath: '/b' });

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(0);
    expect(calls).toBe(1);
  });
});
