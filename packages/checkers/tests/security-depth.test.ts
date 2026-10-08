import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import type { Finding } from '@qa/types';
import {
  SecurityDepthChecker,
  findMissingSri,
  parseSecurityTxt,
  sameOriginGet,
  defaultFetch,
  type FetchFn,
  type SecurityDepthContext,
} from '../src/security-depth.js';

const ORIGIN = 'https://shop.example';
const ctx = (extra: Partial<SecurityDepthContext> = {}): SecurityDepthContext => ({
  testCaseId: 'TC1',
  role: 'guest',
  breakpoint: '1440px',
  urlPath: '/',
  baseUrl: ORIGIN,
  siteWide: new Set<string>(),
  ...extra,
});

/** ADR 0018: no field of any finding claims the site is safe, secure, compliant or accessible. */
function expectClaimWording(findings: Finding[]) {
  const banned = /\b(compliant|compliance|certified|secure|safe|hack-proof|accessible|passes WCAG)\b/i;
  for (const f of findings) expect(JSON.stringify(f)).not.toMatch(banned);
}
/** Security-depth findings feed the Secure aspect through checker 'security'. */
const aspectOfFinding = (f: Finding) => (f.checker === 'security' ? 'Secure' : 'other');

function mockPage(tags: unknown, url = `${ORIGIN}/`): Page {
  return { url: () => url, evaluate: vi.fn().mockResolvedValue(tags) } as unknown as Page;
}
const spy = (impl: FetchFn) => vi.fn(impl);
const res = (status: number, body: string, headers: Record<string, string> = {}) => ({
  status,
  headers,
  text: async () => body,
});

describe('SRI', () => {
  it('flags a cross-origin script and stylesheet with no integrity attribute', async () => {
    const tags = [
      { tag: 'script', url: 'https://cdn.other.com/lib.js?v=3', hasIntegrity: false },
      { tag: 'link', url: 'https://fonts.other.com/app.css', hasIntegrity: false },
    ];
    expect(findMissingSri(tags as never, ORIGIN)).toHaveLength(2);
    const findings = await new SecurityDepthChecker().checkSri(mockPage(tags), ctx());
    expect(findings).toHaveLength(2);
    expect(findings[0].title).toBe('Script from cdn.other.com loads without an integrity attribute');
    expect(findings[0].severity).toBe('Minor');
    expect(findings[1].severity).toBe('Suggestion');
    expect(JSON.stringify(findings)).not.toContain('v=3');
    expect(aspectOfFinding(findings[0])).toBe('Secure');
    expectClaimWording(findings);
  });

  it('leaves same-origin resources and ones with integrity alone', async () => {
    const tags = [
      { tag: 'script', url: `${ORIGIN}/app.js`, hasIntegrity: false },
      { tag: 'script', url: 'https://cdn.other.com/lib.js', hasIntegrity: true },
      { tag: 'link', url: 'data:text/css,body{}', hasIntegrity: false },
    ];
    expect(findMissingSri(tags as never, ORIGIN)).toEqual([]);
    expect(await new SecurityDepthChecker().checkSri(mockPage(tags), ctx())).toEqual([]);
  });

  it('ignores about:blank pages and tolerates odd evaluate results', async () => {
    const checker = new SecurityDepthChecker();
    expect(await checker.checkSri(mockPage([], 'about:blank'), ctx())).toEqual([]);
    expect(await checker.checkSri(mockPage('not an array'), ctx())).toEqual([]);
    expect(await checker.checkSri(mockPage([null, 5, { tag: 'x' }]), ctx())).toEqual([]);
  });
});

describe('source maps', () => {
  const scripts = [{ tag: 'script', url: `${ORIGIN}/static/app.js?v=9`, hasIntegrity: false }];
  const mapBody = '{"version":3,"sources":["secret/file.ts"],"mappings":"AAAA"}';

  it('reports a reachable source map once, by path, without its contents', async () => {
    const fetchFn: FetchFn = vi.fn(async (url: string) =>
      url.includes('.map') ? res(200, mapBody) : res(200, 'var a=1;\n//# sourceMappingURL=app.js.map')
    );
    const c = ctx();
    const checker = new SecurityDepthChecker();
    const findings = await checker.checkSourceMaps(mockPage(scripts), c, fetchFn);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('Source map is publicly reachable');
    const all = JSON.stringify(findings);
    expect(all).toContain('/static/app.js.map');
    expect(all).not.toContain('secret/file.ts');
    expect(all).not.toContain('v=9');
    expect(aspectOfFinding(findings[0])).toBe('Secure');
    expectClaimWording(findings);
    // Second time on the same run: already reported.
    expect(await checker.checkSourceMaps(mockPage(scripts), c, fetchFn)).toEqual([]);
  });

  it('reports an inline data: source map without fetching', async () => {
    const fetchFn: FetchFn = vi.fn(async () =>
      res(200, 'x\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==')
    );
    const findings = await new SecurityDepthChecker().checkSourceMaps(mockPage(scripts), ctx(), fetchFn);
    expect(findings).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(findings)).not.toContain('eyJ2');
    expectClaimWording(findings);
  });

  it('reports nothing when the map URL 404s or is not JSON', async () => {
    const notFound: FetchFn = async (url) =>
      url.includes('.map') ? res(404, 'nope') : res(200, '//# sourceMappingURL=app.js.map');
    const html: FetchFn = async (url) =>
      url.includes('.map') ? res(200, '<!doctype html><html>') : res(200, '//# sourceMappingURL=app.js.map');
    const checker = new SecurityDepthChecker();
    expect(await checker.checkSourceMaps(mockPage(scripts), ctx(), notFound)).toEqual([]);
    expect(await checker.checkSourceMaps(mockPage(scripts), ctx(), html)).toEqual([]);
  });

  it('never fetches an off-origin script or map', async () => {
    const fetchFn = spy(async () => res(200, '//# sourceMappingURL=https://evil.example/app.js.map'));
    const cross = [{ tag: 'script', url: 'https://cdn.other.com/lib.js', hasIntegrity: false }];
    const checker = new SecurityDepthChecker();
    expect(await checker.checkSourceMaps(mockPage(cross), ctx(), fetchFn)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    // Same-origin script pointing at a cross-origin map: script fetched, map refused.
    expect(await checker.checkSourceMaps(mockPage(scripts), ctx(), fetchFn)).toEqual([]);
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([`${ORIGIN}/static/app.js?v=9`]);
  });

  it('refuses a different origin in sameOriginGet', async () => {
    const fetchFn = spy(async () => res(200, ''));
    expect(await sameOriginGet(fetchFn, 'https://other.example/x', ORIGIN)).toBeNull();
    expect(await sameOriginGet(fetchFn, 'not a url', ORIGIN)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not follow redirects and uses a 3 s timeout', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: () => 200, headers: () => ({}), text: async () => '' });
    const page = { context: () => ({ request: { fetch } }) } as unknown as Page;
    await defaultFetch(page)(`${ORIGIN}/a.js`);
    expect(fetch).toHaveBeenCalledWith(`${ORIGIN}/a.js`, { method: 'GET', timeout: 3000, maxRedirects: 0 });
    // A page with no request API gives null instead of throwing.
    expect(await defaultFetch({ context: () => ({}) } as unknown as Page)(`${ORIGIN}/a.js`)).toBeNull();
  });
});

describe('security.txt', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const good = 'Contact: mailto:sec@shop.example\nExpires: 2027-01-01T00:00:00Z\n';

  it('flags a missing security.txt (404 and SPA HTML fallback)', async () => {
    const checker = new SecurityDepthChecker();
    const a = await checker.checkSecurityTxt(async () => res(404, 'x'), ctx(), ORIGIN, now);
    const b = await checker.checkSecurityTxt(async () => res(200, '<!DOCTYPE html><html></html>'), ctx(), ORIGIN, now);
    expect(a[0].title).toBe('No security.txt file');
    expect(a[0].severity).toBe('Suggestion');
    expect(b[0].title).toBe('No security.txt file');
    expectClaimWording([...a, ...b]);
  });

  it('flags missing Contact, missing Expires, expired Expires', () => {
    expect(parseSecurityTxt('Expires: 2027-01-01T00:00:00Z', now)).toEqual({ missing: ['Contact'], expired: false });
    expect(parseSecurityTxt('Contact: mailto:a@b.c', now)).toEqual({ missing: ['Expires'], expired: false });
    expect(parseSecurityTxt('Contact: mailto:a@b.c\nExpires: 2020-01-01T00:00:00Z', now)).toEqual({
      missing: [],
      expired: true,
    });
    expect(parseSecurityTxt('Contact: x\nExpires: soon', now).missing).toEqual(['Expires (a valid date)']);
  });

  it('reports a missing field and an expired date as findings without echoing the contact', async () => {
    const checker = new SecurityDepthChecker();
    const missing = await checker.checkSecurityTxt(
      async () => res(200, 'Expires: 2027-01-01T00:00:00Z'),
      ctx(),
      ORIGIN,
      now
    );
    expect(missing[0].title).toBe('security.txt is missing a required field');
    const expired = await checker.checkSecurityTxt(
      async () => res(200, 'Contact: mailto:private@shop.example\nExpires: 2020-01-01T00:00:00Z'),
      ctx(),
      ORIGIN,
      now
    );
    expect(expired[0].title).toBe('security.txt has expired');
    expect(JSON.stringify(expired)).not.toContain('private@shop.example');
    expectClaimWording([...missing, ...expired]);
  });

  it('accepts a file with Contact and a future Expires', async () => {
    const f = await new SecurityDepthChecker().checkSecurityTxt(async () => res(200, good), ctx(), ORIGIN, now);
    expect(f).toEqual([]);
  });

  it('asks once per origin per run', async () => {
    const fetchFn = spy(async () => res(200, good));
    const c = ctx();
    const checker = new SecurityDepthChecker();
    await checker.checkSecurityTxt(fetchFn, c, ORIGIN, now);
    await checker.checkSecurityTxt(fetchFn, c, ORIGIN, now);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(`${ORIGIN}/.well-known/security.txt`);
  });

  it('network failure is "could not be checked", needsConfirmation', async () => {
    const f = await new SecurityDepthChecker().checkSecurityTxt(async () => null, ctx(), ORIGIN, now);
    expect(f).toHaveLength(1);
    expect(f[0].title).toBe('security.txt could not be checked');
    expect(f[0].needsConfirmation).toBe(true);
    expect(f[0].severity).toBe('Suggestion');
  });

  it('skips non-http origins', async () => {
    const fetchFn = spy(async () => res(200, good));
    expect(await new SecurityDepthChecker().checkSecurityTxt(fetchFn, ctx(), 'file://', now)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('Content-Security-Policy', () => {
  const checker = new SecurityDepthChecker();
  const titles = (csp: string | undefined) => checker.checkCsp(csp, ctx()).map((f) => f.title);

  it('flags unsafe-inline and unsafe-eval in script-src', () => {
    const f = checker.checkCsp(
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      ctx()
    );
    expect(f.map((x) => x.title)).toEqual([
      'Content-Security-Policy allows unsafe-inline scripts',
      'Content-Security-Policy allows unsafe-eval',
    ]);
    expect(f.every((x) => x.severity === 'Minor')).toBe(true);
    expect(aspectOfFinding(f[0])).toBe('Secure');
    expectClaimWording(f);
  });

  it('falls back to default-src when there is no script-src', () => {
    expect(titles("default-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'self'")).toEqual([
      'Content-Security-Policy allows unsafe-inline scripts',
    ]);
  });

  it('flags wildcard, http:, data: sources', () => {
    const f = checker.checkCsp("script-src * http: ; object-src data:; base-uri 'self'; frame-ancestors 'self'", ctx());
    const broad = f.find((x) => x.title === 'Content-Security-Policy allows broad sources');
    expect(broad?.expectedVsActual.actual).toContain('script-src *');
    expect(broad?.expectedVsActual.actual).toContain('script-src http:');
    expect(broad?.expectedVsActual.actual).toContain('object-src data:');
    expectClaimWording(f);
  });

  it('lists missing object-src, base-uri, frame-ancestors', () => {
    const f = checker.checkCsp("script-src 'self'", ctx());
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('Suggestion');
    expect(f[0].expectedVsActual.actual).toContain('object-src, base-uri, frame-ancestors');
  });

  it('ignores unsafe-inline when a nonce is present', () => {
    expect(
      titles(
        "script-src 'self' 'nonce-abc123' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
      )
    ).toEqual([]);
  });

  it('returns nothing for no CSP header', () => {
    expect(titles(undefined)).toEqual([]);
    expect(titles('')).toEqual([]);
  });

  it('a strict policy gives no findings', () => {
    expect(
      titles("default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
    ).toEqual([]);
  });

  it('findings never contain nonces, hashes, report URIs or the full header', () => {
    const csp =
      "script-src 'nonce-SECRETNONCE' 'sha256-SECRETHASH' 'unsafe-eval' *; report-uri https://r.example/collect?k=1";
    const f = checker.checkCsp(csp, ctx());
    expect(f.length).toBeGreaterThan(0);
    const all = JSON.stringify(f);
    expect(all).not.toContain('SECRETNONCE');
    expect(all).not.toContain('SECRETHASH');
    expect(all).not.toContain('r.example');
    expect(all).not.toContain(csp);
    expectClaimWording(f);
  });
});

describe('checkPage', () => {
  it('runs every check, tolerates a throwing one, and stays on the target origin', async () => {
    const fetchFn = spy(async (url) => (url.endsWith('security.txt') ? res(404, '') : res(200, 'var a;')));
    const page = mockPage([{ tag: 'script', url: 'https://cdn.other.com/a.js', hasIntegrity: false }]);
    const f = await new SecurityDepthChecker().checkPage(page, ctx({ cspHeader: "script-src 'self'" }), fetchFn);
    expect(f.map((x) => x.id.split('-')[3])).toEqual(expect.arrayContaining(['SRI', 'CSP', 'TXT']));
    for (const call of fetchFn.mock.calls) expect(new URL(call[0]).origin).toBe(ORIGIN);
    expectClaimWording(f);

    const throwing = {
      url: () => `${ORIGIN}/`,
      evaluate: vi.fn().mockRejectedValue(new Error('x')),
    } as unknown as Page;
    const g = await new SecurityDepthChecker().checkPage(throwing, ctx(), fetchFn);
    expect(g.some((x) => x.title === 'No security.txt file')).toBe(true);
  });

  it('does no network checks on a page that left the target site', async () => {
    const fetchFn = spy(async () => res(200, ''));
    const page = mockPage([], 'https://elsewhere.example/');
    expect(await new SecurityDepthChecker().checkPage(page, ctx(), fetchFn)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
