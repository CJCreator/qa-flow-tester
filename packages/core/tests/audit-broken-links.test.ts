import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import type { ContentLink, PageContent } from '@qa/types';
import type { FetchFn, FetchedResponse } from '@qa/checkers';
import { checkLinks, type CheckLinksOptions } from '../src/audit/analysis/broken-links.js';
import { createFindingIdAllocator } from '../src/audit/analysis/finding-ids.js';
import { isAbortError } from '../src/abort.js';
import { RobotsPolicy } from '../src/competitive/robots.js';

const ORIGIN = 'https://bakery.example';

function link(to: string, sectionId = 's1', leavesSite = false): ContentLink {
  return { text: `to ${to}`, to, region: 'internal', sectionId, ...(leavesSite ? { leavesSite: true } : {}) };
}

function page(urlPath: string, links: ContentLink[]): PageContent {
  return {
    urlPath,
    title: urlPath,
    description: null,
    text: 'text',
    headings: [],
    images: [],
    links,
    forms: [],
    ctas: [],
    language: { primary: 'en', others: [], declared: null },
    sections: [
      { id: 's1', kind: 'header', start: 0, end: 2 },
      { id: 's2', kind: 'main', start: 2, end: 4 },
    ],
  };
}

/** A fake FetchFn: answers from a table (null when absent), records calls and checks they never overlap. */
function fakeFetch(statuses: Record<string, number | null | 'throw'>, delayMs = 2) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch: FetchFn = async (url) => {
    calls.push(url);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, delayMs));
      const status = statuses[url];
      if (status === 'throw') throw new Error('network');
      if (status === undefined || status === null) return null;
      const res: FetchedResponse = { status, headers: {}, text: async () => '' };
      return res;
    } finally {
      inFlight--;
    }
  };
  return { fetch, calls, maxInFlight: () => maxInFlight };
}

function options(overrides: Partial<CheckLinksOptions> & Pick<CheckLinksOptions, 'fetch'>): CheckLinksOptions {
  return { origin: ORIGIN, statusByPath: new Map(), skippedPaths: [], maxRequests: 50, ...overrides };
}

const CLAIM_WORDS = /\b(compliant|accessible|secure|passes)\b/i;

describe('checkLinks', () => {
  it('a 404 from the crawl gives one finding naming the page and the target (REQ-014 AC-1)', async () => {
    const f = fakeFetch({});
    const findings = await checkLinks(
      [page('/', [link('/about')]), page('/about', [link('/gone', 's2')])],
      options({
        fetch: f.fetch,
        statusByPath: new Map([
          ['/', 200],
          ['/about', 200],
          ['/gone', 404],
        ]),
      }),
      createFindingIdAllocator()
    );
    expect(f.calls).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'AF-001',
      rule: 'broken-link',
      urlPath: '/about',
      target: '/gone',
      pages: ['/about'],
      sectionId: 's2',
      source: 'rule',
    });
    expect(findings[0].detail).toContain('/about');
    expect(findings[0].detail).toContain('/gone');
    expect(findings[0].detail).toContain('404');
  });

  it('a 404 from the injected FetchFn gives a finding; one per target with every linking page', async () => {
    const f = fakeFetch({ [`${ORIGIN}/old`]: 404, [`${ORIGIN}/ok`]: 200, [`${ORIGIN}/moved`]: 301 });
    const findings = await checkLinks(
      [
        page('/', [link('/old'), link('/ok'), link('/moved')]),
        page('/a', [link('/old', 's2'), link('/old')]),
        page('/b', [link('/old')]),
      ],
      options({ fetch: f.fetch, statusByPath: { '/': 200, '/a': 200, '/b': 200 } }),
      createFindingIdAllocator()
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].target).toBe('/old');
    expect(findings[0].urlPath).toBe('/');
    expect(findings[0].pages).toEqual(['/', '/a', '/b']);
    expect(f.calls).toEqual([`${ORIGIN}/old`, `${ORIGIN}/ok`, `${ORIGIN}/moved`]);
  });

  it('410 and 5xx are broken; a null or failed request is not reported', async () => {
    const f = fakeFetch({
      [`${ORIGIN}/gone`]: 410,
      [`${ORIGIN}/err`]: 503,
      [`${ORIGIN}/nothing`]: null,
      [`${ORIGIN}/boom`]: 'throw',
      [`${ORIGIN}/private`]: 403,
    });
    const findings = await checkLinks(
      [
        page(
          '/',
          ['/gone', '/err', '/nothing', '/boom', '/private'].map((to) => link(to))
        ),
      ],
      options({ fetch: f.fetch }),
      createFindingIdAllocator()
    );
    expect(findings.map((x) => x.target)).toEqual(['/gone', '/err']);
  });

  it('Skipped Pages are never requested and never reported, even with a crawl status', async () => {
    const skippedPaths = ['/login', '/checkout', '/private', '/excluded', '/deep'];
    const f = fakeFetch(Object.fromEntries(skippedPaths.map((p) => [`${ORIGIN}${p}`, 404])));
    const findings = await checkLinks(
      [
        page(
          '/',
          skippedPaths.map((to) => link(to))
        ),
      ],
      options({ fetch: f.fetch, skippedPaths, statusByPath: new Map([['/login', 404]]) }),
      createFindingIdAllocator()
    );
    expect(f.calls).toEqual([]);
    expect(findings).toEqual([]);
  });

  it('a Skipped Page covers its query, fragment, slash, case and dot-segment variants (regression QA-300)', async () => {
    const variants = [
      '/shop/checkout?item=x',
      '/shop/checkout?item=diwali-box#pay',
      '/shop/checkout/',
      '/Shop/Checkout',
      '/shop/./checkout',
      '/shop/x/../checkout?item=y',
      '/shop/%63heckout',
    ];
    const f = fakeFetch(Object.fromEntries(variants.map((p) => [`${ORIGIN}${p}`, 404])));
    const findings = await checkLinks(
      [page('/shop', [...variants.map((to) => link(to)), link('/shop/cart?step=1')])],
      options({
        fetch: f.fetch,
        skippedPaths: ['/shop/checkout'],
        statusByPath: new Map([['/shop/checkout?item=x', 404]]),
      }),
      createFindingIdAllocator()
    );
    // Only the non-skipped link is requested; no skipped variant is reported even with a crawl 404.
    expect(f.calls).toEqual([`${ORIGIN}/shop/cart?step=1`]);
    expect(findings).toEqual([]);
  });

  it('a skipped path given with a query still covers the bare path', async () => {
    const f = fakeFetch({ [`${ORIGIN}/login`]: 404 });
    const findings = await checkLinks(
      [page('/', [link('/login'), link('/login?next=/')])],
      options({ fetch: f.fetch, skippedPaths: ['/login?next=/account'] }),
      createFindingIdAllocator()
    );
    expect(f.calls).toEqual([]);
    expect(findings).toEqual([]);
  });

  it('recorded pages and links leaving the site are not requested', async () => {
    const f = fakeFetch({});
    await checkLinks(
      [page('/', [link('/about'), link('https://other.example/x', 's1', true)]), page('/about', [])],
      options({ fetch: f.fetch }),
      createFindingIdAllocator()
    );
    expect(f.calls).toEqual([]);
  });

  it('no target is requested twice, requests never overlap and stop at maxRequests', async () => {
    const targets = Array.from({ length: 8 }, (_, i) => `/p${i}`);
    const f = fakeFetch(Object.fromEntries(targets.map((p) => [`${ORIGIN}${p}`, 404])));
    const findings = await checkLinks(
      [
        page(
          '/',
          targets.map((to) => link(to))
        ),
        page(
          '/2',
          targets.map((to) => link(to))
        ),
      ],
      options({ fetch: f.fetch, maxRequests: 5 }),
      createFindingIdAllocator()
    );
    expect(f.calls).toHaveLength(5);
    expect(new Set(f.calls).size).toBe(5);
    expect(f.maxInFlight()).toBe(1);
    expect(findings).toHaveLength(5);
    expect(findings[0].pages).toEqual(['/', '/2']);
  });

  it('a maxRequests of 0 or not a number makes no request', async () => {
    for (const maxRequests of [0, -3, Number.NaN]) {
      const f = fakeFetch({ [`${ORIGIN}/x`]: 404 });
      const findings = await checkLinks(
        [page('/', [link('/x')])],
        options({ fetch: f.fetch, maxRequests }),
        createFindingIdAllocator()
      );
      expect(f.calls).toEqual([]);
      expect(findings).toEqual([]);
    }
  });

  it('requests stay on the audited origin: a path starting with // is not resolved to another host', async () => {
    const f = fakeFetch({});
    await checkLinks(
      [page('/', [link('//evil.example/x'), link('/a?token=***')])],
      options({ fetch: f.fetch }),
      createFindingIdAllocator()
    );
    expect(f.calls).toEqual([`${ORIGIN}//evil.example/x`]);
    expect(f.calls.every((u) => new URL(u).origin === ORIGIN)).toBe(true);
  });

  it('every finding is complete and free of ADR 0018 claim words', async () => {
    const f = fakeFetch({ [`${ORIGIN}/a`]: 404, [`${ORIGIN}/b`]: 500 });
    const findings = await checkLinks(
      [page('/', [link('/a'), link('/b')]), page('/c', [link('/a')])],
      options({ fetch: f.fetch }),
      createFindingIdAllocator()
    );
    expect(findings).toHaveLength(2);
    for (const x of findings) {
      for (const key of [
        'rule',
        'group',
        'area',
        'title',
        'detail',
        'suggestion',
        'impact',
        'effort',
        'urlPath',
      ] as const) {
        expect(typeof x[key]).toBe('string');
        expect(x[key]).not.toBe('');
      }
      expect(x).toHaveProperty('sectionId');
      for (const text of [x.title, x.detail, x.suggestion]) expect(text).not.toMatch(CLAIM_WORDS);
    }
  });

  // F-054 / REQ-036: the Skipped Page list is incomplete once the crawl's time is up, so the crawl's rules
  // are applied again before any request.
  it('a link robots.txt disallows is not fetched and not reported, even when not listed as skipped', async () => {
    const robots = RobotsPolicy.parse('User-agent: *\nDisallow: /private\nDisallow: /*?sort=\n', 'QA-Benchmarking-Bot');
    const f = fakeFetch({
      [`${ORIGIN}/private/report`]: 404,
      [`${ORIGIN}/list?sort=asc`]: 404,
      [`${ORIGIN}/public`]: 200,
    });
    const findings = await checkLinks(
      [page('/', [link('/private/report'), link('/list?sort=asc'), link('/public')])],
      options({ fetch: f.fetch, robots }),
      createFindingIdAllocator()
    );
    expect(f.calls).toEqual([`${ORIGIN}/public`]);
    expect(findings).toEqual([]);
  });

  it('a checkout or payment path is not fetched or reported, even with no policy passed', async () => {
    const checkout = [
      '/checkout',
      '/shop/pay',
      '/billing?step=2',
      '/cart/check-out/',
      '/shop/%63heckout',
      '/shop/x/../payment',
    ];
    const f = fakeFetch({
      ...Object.fromEntries(checkout.map((p) => [`${ORIGIN}${p}`, 404])),
      [`${ORIGIN}/checkout-guide`]: 404,
    });
    const findings = await checkLinks(
      [page('/', [...checkout.map((to) => link(to)), link('/checkout-guide')])],
      // One request only: refused targets must not use it up. A crawl 404 on a checkout path is not reported.
      options({ fetch: f.fetch, maxRequests: 1, statusByPath: new Map([['/checkout', 404]]) }),
      createFindingIdAllocator()
    );
    // '/checkout-guide' is not a checkout segment: it is still checked.
    expect(f.calls).toEqual([`${ORIGIN}/checkout-guide`]);
    expect(findings.map((x) => x.target)).toEqual(['/checkout-guide']);
  });

  it('a link outside the include/exclude limits is not fetched or reported', async () => {
    const f = fakeFetch({
      [`${ORIGIN}/admin/users`]: 404,
      [`${ORIGIN}/shop/item`]: 404,
      [`${ORIGIN}/blog/post`]: 404,
    });
    const findings = await checkLinks(
      [page('/blog', [link('/admin/users'), link('/shop/item'), link('/blog/post')])],
      options({
        fetch: f.fetch,
        pathLimits: { includePaths: ['/blog'], excludePaths: ['/admin'], startPath: '/blog' },
      }),
      createFindingIdAllocator()
    );
    expect(f.calls).toEqual([`${ORIGIN}/blog/post`]);
    expect(findings.map((x) => x.target)).toEqual(['/blog/post']);
  });

  it('an allowed link is still checked with robots.txt and limits passed', async () => {
    const robots = RobotsPolicy.parse(
      'User-agent: *\nDisallow: /private\nAllow: /private/open\n',
      'QA-Benchmarking-Bot'
    );
    const f = fakeFetch({ [`${ORIGIN}/about-us`]: 404, [`${ORIGIN}/private/open`]: 503, [`${ORIGIN}/private/x`]: 404 });
    const findings = await checkLinks(
      [page('/', [link('/about-us'), link('/private/open', 's2'), link('/private/x')])],
      options({ fetch: f.fetch, robots, pathLimits: { includePaths: [], excludePaths: ['/tmp'], startPath: '/' } }),
      createFindingIdAllocator()
    );
    expect(f.calls).toEqual([`${ORIGIN}/about-us`, `${ORIGIN}/private/open`]);
    expect(findings.map((x) => [x.target, x.sectionId])).toEqual([
      ['/about-us', 's1'],
      ['/private/open', 's2'],
    ]);
  });

  it('Stop ends the link check before the next request', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const fetch: FetchFn = async (url) => {
      calls.push(url);
      if (calls.length === 2) controller.abort();
      return null;
    };
    const promise = checkLinks(
      [page('/', [link('/a'), link('/b', 's2'), link('/c')])],
      options({ fetch, maxRequests: 10, signal: controller.signal }),
      createFindingIdAllocator()
    );
    await expect(promise).rejects.toSatisfy((err) => isAbortError(err));
    expect(calls).toHaveLength(2);
  });

  it('the module makes requests only through the injected FetchFn', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/audit/analysis/broken-links.ts', import.meta.url)),
      'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    // No global fetch: the only call is `opts.fetch(`.
    expect(code).not.toMatch(/(?<![.\w])fetch\s*\(/);
    expect(code).not.toMatch(/\.request\b|request\.(fetch|get|head)|playwright|node:https?|from ['"]https?['"]/);
    expect(code).toMatch(/opts\.fetch\(/);
  });
});
