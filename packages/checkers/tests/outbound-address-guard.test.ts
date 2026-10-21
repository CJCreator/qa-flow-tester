import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import { SecurityDepthChecker } from '../src/security-depth.js';
import { SeoChecker } from '../src/seo.js';

/** A page whose own request API must never be used for outbound checks (ADR 0031). */
function pageWith(details: unknown, fetch = vi.fn()) {
  const page = {
    url: () => 'https://shop.test/',
    evaluate: async () => details,
    context: () => ({ request: { fetch } }),
  } as unknown as Page;
  return { page, fetch };
}

const depthCtx = { role: 'visitor', breakpoint: '1440px' as const, urlPath: '/', baseUrl: 'https://shop.test' };

const seoDetails = {
  title: 'Shop',
  metaDescription: 'A shop',
  h1Count: 1,
  headings: [{ level: 1, text: 'Shop' }],
  canonicalUrl: 'https://shop.test/',
  canonicalCount: 1,
  hasViewportMeta: true,
  hasFavicon: true,
  imagesWithoutAltCount: 0,
  ogTitle: 'Shop',
  ogDescription: 'A shop',
  ogImage: 'https://shop.test/og.png',
  htmlLang: 'en',
  metaRobots: '',
  sameSiteLinks: ['/dead-link'],
};

describe('security-depth without an injected fetch (ADR 0031)', () => {
  it('makes no request through the page context when no fetch is passed', async () => {
    const { page, fetch } = pageWith({ scripts: [] });
    const findings = await new SecurityDepthChecker().checkPage(page, depthCtx);
    expect(fetch).not.toHaveBeenCalled();
    expect(findings.some((f) => f.title.includes('security.txt'))).toBe(false);
  });

  it('runs the network checks through the injected fetch only', async () => {
    const { page, fetch } = pageWith({ scripts: [] });
    const injected = vi.fn(async () => null);
    await new SecurityDepthChecker().checkPage(page, depthCtx, injected);
    expect(fetch).not.toHaveBeenCalled();
    expect(injected).toHaveBeenCalledWith('https://shop.test/.well-known/security.txt');
  });
});

describe('seo link and root checks without an injected fetch (ADR 0031)', () => {
  it('does not check links through the page context', async () => {
    const { page, fetch } = pageWith(seoDetails);
    const findings = await new SeoChecker().checkPage(page, {
      testCaseId: 'TC-LINKS',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: 'https://shop.test',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(findings.some((f) => f.title.includes('Broken link found'))).toBe(false);
  });

  it('reports a broken link through the injected fetch', async () => {
    const { page, fetch } = pageWith(seoDetails);
    const injected = vi.fn(async (url: string) => ({
      status: url.endsWith('/dead-link') ? 404 : 200,
      headers: {},
      text: async () => '',
    }));
    const findings = await new SeoChecker().checkPage(page, {
      testCaseId: 'TC-LINKS',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: 'https://shop.test',
      fetchFn: injected,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(injected).toHaveBeenCalledWith('https://shop.test/dead-link');
    const broken = findings.find((f) => f.title.includes('Broken link found'));
    expect(broken?.title).toContain('HTTP 404');
  });

  it('a link the helper refuses (null) is not reported as broken', async () => {
    const { page } = pageWith(seoDetails);
    const findings = await new SeoChecker().checkPage(page, {
      testCaseId: 'TC-LINKS',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: 'https://shop.test',
      fetchFn: async () => null,
    });
    expect(findings.some((f) => f.title.includes('Broken link found'))).toBe(false);
  });
});
