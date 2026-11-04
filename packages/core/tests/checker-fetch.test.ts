/**
 * ADR 0031 (REQ-047 AC-1/AC-2 for checker paths, AC-7): the checkers' FetchFn is built by makeCheckerFetch on the
 * pinned, redirect-checked path. With a browser guard set, a link, security.txt or source map address that resolves
 * to 127.0.0.1 or 169.254.169.254, or redirects there, is never connected to. Fake network only.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Page } from 'playwright';
import { SecurityDepthChecker, SeoChecker } from '@qa/checkers';
import { makeCheckerFetch, checkLinkStatus } from '../src/checker-fetch.js';
import type { NetDeps, PinnedRequest, RawResponse } from '../src/safe-net.js';
import { setBrowserPolicy } from '../src/browser.js';

function fake(names: Record<string, string[]>, responses: Record<string, RawResponse>) {
  const connects: PinnedRequest[] = [];
  const deps: NetDeps = {
    async lookup(host) {
      const answer = names[host];
      if (!answer) throw new Error('ENOTFOUND');
      return answer;
    },
    async connect(req) {
      connects.push(req);
      const r = responses[req.url.toString()];
      if (!r) throw new Error('refused');
      return r;
    },
  };
  return { deps, connects };
}

const ok = (body = '', status = 200): RawResponse => ({ status, headers: { 'content-type': 'text/plain' }, body });
const redirect = (to: string, status = 302): RawResponse => ({ status, headers: { location: to }, body: '' });
const guardOn = () => setBrowserPolicy({ guard: async () => true });

afterEach(() => setBrowserPolicy(null));

function securityPage(url: string, scripts: string[]): Page {
  return {
    url: () => url,
    evaluate: vi.fn().mockResolvedValue(scripts.map((s) => ({ tag: 'script', url: s, hasIntegrity: false }))),
  } as unknown as Page;
}

function seoPage(links: string[]): Page {
  return {
    url: () => 'http://site.test/',
    evaluate: async () => ({
      title: 'Home',
      metaDescription: 'Home page',
      h1Count: 1,
      headings: [{ level: 1, text: 'Home' }],
      htmlLang: 'en',
      sameSiteLinks: links,
      canonicalUrl: 'http://site.test/',
      canonicalCount: 1,
      hasViewportMeta: true,
      hasFavicon: true,
      imagesWithoutAltCount: 0,
    }),
    // Any use of Playwright's request API fails the test.
    context: () => {
      throw new Error('Playwright request API used');
    },
  } as unknown as Page;
}

const ctx = (baseUrl: string) => ({
  testCaseId: 'TC1',
  role: 'visitor',
  breakpoint: '1440px' as const,
  urlPath: '/',
  baseUrl,
  siteWide: new Set<string>(),
});

describe('makeCheckerFetch with a browser guard set (shared machine)', () => {
  it('security.txt and source maps on a host resolving to 127.0.0.1 or 169.254.169.254 are not requested', async () => {
    guardOn();
    const f = fake(
      { 'loop.test': ['127.0.0.1'], 'meta.test': ['169.254.169.254'] },
      {
        'http://loop.test/.well-known/security.txt': ok('Contact: x'),
        'http://loop.test/app.js': ok('//# sourceMappingURL=app.js.map'),
        'http://meta.test/.well-known/security.txt': ok('SECRET'),
        'http://meta.test/app.js': ok('//# sourceMappingURL=app.js.map'),
      }
    );
    const fetchFn = makeCheckerFetch({ deps: f.deps });
    for (const origin of ['http://loop.test', 'http://meta.test']) {
      const findings = await new SecurityDepthChecker().checkPage(
        securityPage(`${origin}/`, [`${origin}/app.js`]),
        ctx(origin),
        fetchFn
      );
      // The request was refused, so security.txt says "could not be checked", never a pass.
      expect(findings.some((x) => x.title === 'security.txt could not be checked')).toBe(true);
      expect(findings.some((x) => x.title === 'Source map is publicly reachable')).toBe(false);
    }
    expect(f.connects).toHaveLength(0);
  });

  it('a security.txt or script on a public host that redirects to a private address is refused at the redirect', async () => {
    guardOn();
    const f = fake(
      { 'good.test': ['93.184.216.34'], 'meta.test': ['169.254.169.254'] },
      {
        'http://good.test/.well-known/security.txt': redirect('http://meta.test/latest'),
        'http://meta.test/latest': ok('SECRET'),
      }
    );
    // The checkers' fetch returns a 3xx as the response, it does not follow it.
    const fetchFn = makeCheckerFetch({ deps: f.deps });
    expect((await fetchFn('http://good.test/.well-known/security.txt'))?.status).toBe(302);
    // Even when redirects are followed, the private hop is refused.
    expect(
      await makeCheckerFetch({ deps: f.deps, maxRedirects: 5 })('http://good.test/.well-known/security.txt')
    ).toBeNull();
    expect(f.connects.map((c) => c.url.hostname)).toEqual(['good.test', 'good.test']);
  });

  it('broken-link check: links resolving to private addresses are not requested, one GET per public link', async () => {
    guardOn();
    const f = fake(
      { 'loop.test': ['127.0.0.1'], 'meta.test': ['169.254.169.254'], 'site.test': ['93.184.216.34'] },
      {
        'http://site.test/a': ok('a'),
        'http://site.test/dead': ok('', 404),
        'http://loop.test/x': ok('x'),
        'http://meta.test/latest': ok('SECRET'),
      }
    );
    const findings = await new SeoChecker().checkPage(
      seoPage(['/a', '/dead', 'http://loop.test/x', 'http://meta.test/latest']),
      {
        ...ctx('http://site.test'),
        urlPath: '/about',
        visibility: { search: false, answers: false, aiSearch: false, marketing: false },
      },
      makeCheckerFetch({ deps: f.deps })
    );
    expect(f.connects.map((c) => c.url.toString())).toEqual(['http://site.test/a', 'http://site.test/dead']);
    expect(findings.map((x) => x.title)).toEqual(['Broken link found: /dead returned HTTP 404']);
  });

  it('allowPrivate: true cannot widen past the guard', async () => {
    guardOn();
    const f = fake({ 'loop.test': ['127.0.0.1'] }, { 'http://loop.test/': ok('x') });
    expect(await makeCheckerFetch({ allowPrivate: true, deps: f.deps })('http://loop.test/')).toBeNull();
    expect(f.connects).toHaveLength(0);
  });
});

describe('makeCheckerFetch on a local run (no browser guard)', () => {
  it('reaches a private address, and allowPrivate: false narrows it', async () => {
    const f = fake({ 'loop.test': ['127.0.0.1'] }, { 'http://loop.test/': ok('x') });
    expect((await makeCheckerFetch({ deps: f.deps })('http://loop.test/'))?.status).toBe(200);
    expect(await makeCheckerFetch({ allowPrivate: false, deps: f.deps })('http://loop.test/')).toBeNull();
    expect(f.connects).toHaveLength(1);
  });
});

describe('checkLinkStatus (the plan check-link step)', () => {
  const site = { 'site.test': ['93.184.216.34'], 'meta.test': ['169.254.169.254'] };

  it('fails on 404, 410 and 5xx with one GET each; passes 200, 401, 403, 429, 999', async () => {
    const responses: Record<string, RawResponse> = {};
    for (const s of [200, 401, 403, 404, 410, 429, 500, 503, 999]) responses[`http://site.test/${s}`] = ok('', s);
    const f = fake(site, responses);
    const get = makeCheckerFetch({ deps: f.deps, maxRedirects: 10, timeoutMs: 10_000 });
    for (const s of [200, 401, 403, 429, 999])
      await expect(checkLinkStatus(`http://site.test/${s}`, get)).resolves.toBeUndefined();
    for (const s of [404, 410, 500, 503])
      await expect(checkLinkStatus(`http://site.test/${s}`, get)).rejects.toThrow(`answered ${s}`);
    expect(f.connects).toHaveLength(9);
    expect(new Set(f.connects.map((c) => c.url.toString())).size).toBe(9);
  });

  it('follows redirects, re-checking each hop: a redirect to a private address does not open', async () => {
    guardOn();
    const f = fake(site, {
      'http://site.test/moved': redirect('http://site.test/gone'),
      'http://site.test/gone': ok('', 404),
      'http://site.test/meta': redirect('http://meta.test/latest'),
      'http://meta.test/latest': ok('SECRET'),
    });
    const get = makeCheckerFetch({ deps: f.deps, maxRedirects: 10 });
    await expect(checkLinkStatus('http://site.test/moved', get)).rejects.toThrow('answered 404');
    await expect(checkLinkStatus('http://site.test/meta', get)).rejects.toThrow('doesn’t open');
    expect(f.connects.map((c) => c.url.hostname)).not.toContain('meta.test');
  });

  it('nothing answering is a failure', async () => {
    const f = fake(site, {});
    await expect(checkLinkStatus('http://site.test/x', makeCheckerFetch({ deps: f.deps }))).rejects.toThrow(
      'doesn’t open'
    );
  });
});
