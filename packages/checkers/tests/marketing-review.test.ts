import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { MarketingChecker, isHomePath, marketingReview, newMarketingLog } from '../src/marketing.js';

const page = (details: unknown) => ({ evaluate: async () => details }) as unknown as Page;

const COMPLETE = {
  hasTwitterCard: true,
  hasOgTitle: true,
  hasOgImage: true,
  hasCallToAction: true,
  hasContactRoute: true,
  hasPrivacyLink: true,
  hasAnalytics: true,
  hasSocialLinks: true,
  hasPricing: true,
  hasTrustSignals: true,
  hasLeadCapture: true,
  hasCookieNotice: true,
};

const at = (urlPath: string, log = newMarketingLog(), extra: Record<string, unknown> = {}) => ({
  role: 'visitor',
  breakpoint: '1440px' as const,
  urlPath,
  siteWide: new Set<string>(),
  log,
  ...extra,
});

describe('What counts as the home page', () => {
  it('is the root, an index page, a language home, or the page the run started from', () => {
    for (const path of ['/', '/index.html', '/home', '/en', '/en/', '/pt-br'])
      expect(isHomePath(path), path).toBe(true);
    expect(isHomePath('/pricing')).toBe(false);
    expect(isHomePath('/shop/page')).toBe(false);
    expect(isHomePath('/start/here', 'https://example.com/start/here')).toBe(true);
    expect(isHomePath('/start/other', 'https://example.com/start/here')).toBe(false);
  });
});

describe('The marketing checklist', () => {
  const checker = new MarketingChecker();

  it('lists every basic as found when the site has them all', async () => {
    const log = newMarketingLog();
    expect(await checker.checkPage(page(COMPLETE), at('/', log))).toEqual([]);
    const review = marketingReview(log)!;
    expect(review.readPages).toEqual(['/']);
    expect(review.checks).toHaveLength(11);
    expect(review.checks.every((c) => c.status === 'ok')).toBe(true);
    expect(log.homeRead).toBe(true);
  });

  it('says "not checked" for the home-page basics when only another page was read, and never a pass', async () => {
    const log = newMarketingLog();
    await checker.checkPage(page(COMPLETE), at('/pricing', log));
    const review = marketingReview(log)!;
    expect(log.homeRead).toBe(false);
    const byKey = Object.fromEntries(review.checks.map((c) => [c.key, c]));
    expect(byKey['TWITTER-CARD'].status).toBe('ok');
    for (const key of ['CTA', 'CONTACT', 'PRIVACY', 'ANALYTICS', 'SOCIAL', 'PRICING', 'TRUST', 'LEAD', 'COOKIE']) {
      expect(byKey[key].status, key).toBe('not-checked');
      expect(byKey[key].detail).toContain('home page');
    }
  });

  it('has no checklist at all when no page was read', () => {
    expect(marketingReview(newMarketingLog())).toBeUndefined();
  });

  it('keeps a gap found on one page even when another page has it', async () => {
    const log = newMarketingLog();
    const siteWide = new Set<string>();
    await checker.checkPage(page({ ...COMPLETE, hasTwitterCard: false }), at('/about', log, { siteWide }));
    await checker.checkPage(page(COMPLETE), at('/', log, { siteWide }));
    expect(marketingReview(log)!.checks.find((c) => c.key === 'TWITTER-CARD')).toMatchObject({
      status: 'gap',
      findingId: expect.stringContaining('TWITTER-CARD'),
    });
  });

  it('checks a site whose home page is a language folder, not "/"', async () => {
    const log = newMarketingLog();
    const findings = await checker.checkPage(page({ ...COMPLETE, hasCallToAction: false }), at('/en/', log));
    expect(findings.map((f) => f.id)).toEqual([expect.stringContaining('CTA')]);
    expect(log.homeRead).toBe(true);
  });
});

describe('The suggestions that depend on what the site is for', () => {
  const checker = new MarketingChecker();
  const missing = {
    ...COMPLETE,
    hasPricing: false,
    hasTrustSignals: false,
    hasLeadCapture: false,
    hasCookieNotice: false,
  };

  it('reports each as a suggestion, worded as one', async () => {
    const log = newMarketingLog();
    const findings = await checker.checkPage(page(missing), at('/', log));
    expect(findings.map((f) => f.id.split('-').slice(-2)[0]).sort()).toEqual(['COOKIE', 'LEAD', 'PRICING', 'TRUST']);
    for (const f of findings) {
      expect(f.severity).toBe('Suggestion');
      expect(f.categoryTag).toBe('MKT');
      expect(f.resolution.startsWith('A suggestion, not a fault:')).toBe(true);
    }
    const review = marketingReview(log)!;
    expect(review.checks.filter((c) => c.kind === 'opinion').map((c) => c.status)).toEqual([
      'gap',
      'gap',
      'gap',
      'gap',
    ]);
  });

  it('expects a cookie notice only where analytics run', async () => {
    const log = newMarketingLog();
    const findings = await checker.checkPage(
      page({ ...COMPLETE, hasAnalytics: false, hasCookieNotice: false }),
      at('/', log)
    );
    expect(findings.map((f) => f.id).join()).not.toContain('COOKIE');
    expect(marketingReview(log)!.checks.find((c) => c.key === 'COOKIE')!.status).toBe('ok');
  });
});

describe('What the checklist says about where', () => {
  const checker = new MarketingChecker();

  it('names the first page that lacked something, the one its finding is about', async () => {
    const log = newMarketingLog();
    const siteWide = new Set<string>();
    await checker.checkPage(page({ ...COMPLETE, hasTwitterCard: false }), at('/', log, { siteWide }));
    await checker.checkPage(page({ ...COMPLETE, hasTwitterCard: false }), at('/deadend', log, { siteWide }));
    expect(marketingReview(log)!.checks.find((c) => c.key === 'TWITTER-CARD')).toMatchObject({
      status: 'gap',
      detail: 'Not found on /.',
    });
  });

  it('explains a cookie notice that is not needed instead of claiming it was found', async () => {
    const log = newMarketingLog();
    await checker.checkPage(page({ ...COMPLETE, hasAnalytics: false, hasCookieNotice: false }), at('/', log));
    expect(marketingReview(log)!.checks.find((c) => c.key === 'COOKIE')!.detail).toMatch(/^Not needed/);
  });
});
