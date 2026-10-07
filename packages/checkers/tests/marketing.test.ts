import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { MarketingChecker } from '../src/marketing.js';

const page = (details: unknown) => ({ evaluate: async () => details }) as unknown as Page;
const ctx = (urlPath: string, siteWide = new Set<string>()) => ({
  role: 'visitor',
  breakpoint: '1440px' as const,
  urlPath,
  siteWide,
});

const COMPLETE = {
  hasTwitterCard: true,
  hasOgTitle: true,
  hasOgImage: true,
  hasCallToAction: true,
  hasContactRoute: true,
  hasPrivacyLink: true,
  hasAnalytics: true,
  hasSocialLinks: true,
};

describe('MarketingChecker', () => {
  const checker = new MarketingChecker();

  it('reports nothing for a site with the basics', async () => {
    expect(await checker.checkPage(page(COMPLETE), ctx('/'))).toEqual([]);
  });

  it('reports every missing basic on the home page, tagged as marketing', async () => {
    const empty = {
      hasTwitterCard: false,
      hasOgTitle: true,
      hasOgImage: false,
      hasCallToAction: false,
      hasContactRoute: false,
      hasPrivacyLink: false,
      hasAnalytics: false,
      hasSocialLinks: false,
    };
    const findings = await checker.checkPage(page(empty), ctx('/'));
    expect(findings).toHaveLength(7);
    expect(findings.every((f) => f.categoryTag === 'MKT' && f.checker === 'seo')).toBe(true);
  });

  it('leaves site-level facts to the home page, but still checks share previews elsewhere', async () => {
    const empty = {
      hasTwitterCard: false,
      hasOgTitle: false,
      hasCallToAction: false,
      hasContactRoute: false,
      hasPrivacyLink: false,
      hasAnalytics: false,
      hasSocialLinks: false,
    };
    const findings = await checker.checkPage(page(empty), ctx('/pricing'));
    expect(findings.map((f) => f.id)).toEqual([expect.stringContaining('TWITTER-CARD')]);
  });

  it('reports each site-wide fact once per run', async () => {
    const siteWide = new Set<string>();
    const noCard = { ...COMPLETE, hasTwitterCard: false };
    expect(await checker.checkPage(page(noCard), ctx('/', siteWide))).toHaveLength(1);
    expect(await checker.checkPage(page(noCard), ctx('/about', siteWide))).toHaveLength(0);
  });

  it('ignores a page read that has no marketing facts', async () => {
    expect(await checker.checkPage(page({ title: 'x' }), ctx('/'))).toEqual([]);
    expect(await checker.checkPage(page(null), ctx('/'))).toEqual([]);
  });
});
