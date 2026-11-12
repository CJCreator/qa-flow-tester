import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import type { Finding } from '@qa/types';
import {
  SecurityDepthChecker,
  findMissingSri,
  isLocalNetworkHost,
  parseSecurityTxt,
  sameOriginGet,
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
/** Security-depth findings feed the Protected aspect through checker 'security'. */
const aspectOfFinding = (f: Finding) => (f.checker === 'security' ? 'Protected' : 'other');

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
    expect(aspectOfFinding(findings[0])).toBe('Protected');
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

  it("treats a site's own subdomains as first party and flags look-alike hosts", () => {
    const exampleOrigin = 'https://www.example.com';
    const subTags = [
      { tag: 'script', url: 'https://cdn.example.com/a.js', hasIntegrity: false },
      { tag: 'link', url: 'https://static.example.com/b.css', hasIntegrity: false },
      { tag: 'script', url: 'https://cdn.other.com/lib.js', hasIntegrity: false },
      { tag: 'script', url: 'https://example.com.evil.net/x.js', hasIntegrity: false },
    ];
    // cdn.example.com and static.example.com are skipped; cdn.other.com and evil.net are flagged
    const missing = findMissingSri(subTags as never, exampleOrigin);
    expect(missing.map((t) => t.url)).toEqual(['https://cdn.other.com/lib.js', 'https://example.com.evil.net/x.js']);

    // From https://app.example.com, cdn.example.com is also first party (same registrable domain)
    expect(
      findMissingSri(
        [{ tag: 'script', url: 'https://cdn.example.com/a.js', hasIntegrity: false }] as never,
        'https://app.example.com'
      )
    ).toEqual([]);

    // Two-part TLD example (e.g. .co.uk)
    const ukOrigin = 'https://shop.example.co.uk';
    expect(
      findMissingSri([{ tag: 'script', url: 'https://cdn.example.co.uk/a.js', hasIntegrity: false }] as never, ukOrigin)
    ).toEqual([]);
    expect(
      findMissingSri([{ tag: 'script', url: 'https://cdn.other.co.uk/a.js', hasIntegrity: false }] as never, ukOrigin)
    ).toHaveLength(1);
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
    expect(aspectOfFinding(findings[0])).toBe('Protected');
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
    expect(aspectOfFinding(f[0])).toBe('Protected');
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
  it('says so when the page read for a check fails, with one finding per check and distinct ids', async () => {
    const fetchFn = spy(async (url) => (url.endsWith('security.txt') ? res(404, '') : res(200, 'var a;')));
    const throwing = {
      url: () => `${ORIGIN}/`,
      evaluate: vi.fn().mockRejectedValue(new Error('x')),
    } as unknown as Page;
    const f = await new SecurityDepthChecker().checkPage(throwing, ctx(), fetchFn);
    const unverified = f.filter((x) => x.title.startsWith('Could not verify: '));
    expect(unverified.map((x) => x.title)).toEqual([
      'Could not verify: whether scripts and stylesheets from other sites carry an integrity attribute',
      'Could not verify: whether the site’s own scripts expose source maps',
    ]);
    expect(new Set(unverified.map((x) => x.id)).size).toBe(2);
    for (const x of unverified) {
      expect(x.needsConfirmation).toBe(true);
      expect(x.checker).toBe('security');
    }
    expectClaimWording(f);
  });

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

  it('AC-5: with no FetchFn makes no request and reports security.txt and source maps as not checked, once per site', async () => {
    // A page whose Playwright request API would be used throws, so any request attempt fails the test.
    const page = {
      url: () => `${ORIGIN}/`,
      evaluate: vi.fn().mockResolvedValue([{ tag: 'script', url: `${ORIGIN}/app.js`, hasIntegrity: false }]),
      context: () => {
        throw new Error('Playwright request API used');
      },
      request: {
        get: () => {
          throw new Error('Playwright request API used');
        },
      },
    } as unknown as Page;
    const c = ctx();
    const f = await new SecurityDepthChecker().checkPage(page, c);
    expect(f.map((x) => x.title)).toEqual(['security.txt was not checked', 'Source maps were not checked']);
    for (const x of f) {
      expect(x.needsConfirmation).toBe(true);
      expect(x.severity).toBe('Suggestion');
    }
    expectClaimWording(f);
    // Once per site: a second page adds nothing.
    expect(await new SecurityDepthChecker().checkPage(page, c)).toEqual([]);
  });

  it('AC-5: defaultFetch no longer exists', async () => {
    const mod: Record<string, unknown> = await import('../src/security-depth.js');
    expect(mod.defaultFetch).toBeUndefined();
  });

  describe('isLocalNetworkHost and TLS check (T-163)', () => {
    it('isLocalNetworkHost correctly identifies local and private network addresses', () => {
      const trueHosts = [
        'localhost',
        'app.localhost',
        'printer.local',
        '127.0.0.1',
        '127.5.5.5',
        '0.0.0.0',
        '[::1]',
        '::1',
        '10.0.0.5',
        '172.16.0.1',
        '172.31.255.1',
        '192.168.1.20',
      ];
      for (const host of trueHosts) {
        expect(isLocalNetworkHost(host), `expected ${host} to be local`).toBe(true);
      }

      const falseHosts = [
        'example.com',
        '172.32.0.1',
        '172.15.0.1',
        '192.169.1.1',
        '11.0.0.1',
        'localhost.example.com',
      ];
      for (const host of falseHosts) {
        expect(isLocalNetworkHost(host), `expected ${host} not to be local`).toBe(false);
      }
    });

    it('checkTls skips local and private addresses but flags public plain HTTP', () => {
      const checker = new SecurityDepthChecker();
      expect(checker.checkTls('http://192.168.1.20:3000/', ctx())).toEqual([]);
      expect(checker.checkTls('http://[::1]:3000/', ctx())).toEqual([]);
      const findings = checker.checkTls('http://example.com/', ctx());
      expect(findings).toHaveLength(1);
      expect(findings[0].title).toContain('not encrypted with TLS');
      expect(checker.checkTls('https://example.com/', ctx())).toEqual([]);
    });
  });
});
