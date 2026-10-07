import { describe, it, expect } from 'vitest';
import { SeoChecker } from '../src/seo.js';
import { SiteRootAuditor } from '../src/site-root.js';
import { AeoChecker } from '../src/aeo.js';
import { GeoChecker } from '../src/geo.js';
import type { Page } from 'playwright';

describe('SeoChecker and Search/AI Suite', () => {
  const checker = new SeoChecker();

  function createMockPage(details: any, fetchHandler?: (url: string) => Promise<any>): Page {
    return {
      evaluate: async () => details,
      context: () => ({
        request: {
          fetch: fetchHandler || (async () => ({ status: () => 200, text: async () => '' })),
        },
      }),
    } as unknown as Page;
  }

  it('flags missing page title as Major (fixture planted defect)', async () => {
    const pageNoTitle = createMockPage({
      title: '',
      metaDescription: 'Some description',
      h1Count: 1,
      headings: [{ level: 1, text: 'About Fixture' }],
      htmlLang: 'en',
      sameSiteLinks: [],
      hasViewportMeta: true,
      hasFavicon: true,
      canonicalUrl: 'http://localhost/about',
      canonicalCount: 1,
      imagesWithoutAltCount: 0,
    });

    const findings = await checker.checkPage(pageNoTitle, {
      testCaseId: 'TC-ABOUT',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/about',
    });

    const titleFinding = findings.find((f) => f.title.includes('missing a title tag'));
    expect(titleFinding).toBeDefined();
    expect(titleFinding?.severity).toBe('Major');
    expect(titleFinding?.categoryTag).toBe('SEO');
  });

  it('flags missing meta description as Minor', async () => {
    const pageNoDesc = createMockPage({
      title: 'About Fixture',
      metaDescription: '',
      h1Count: 1,
      headings: [{ level: 1, text: 'About Fixture' }],
      htmlLang: 'en',
      sameSiteLinks: [],
      hasViewportMeta: true,
      hasFavicon: true,
      canonicalUrl: 'http://localhost/about',
      canonicalCount: 1,
      imagesWithoutAltCount: 0,
    });

    const findings = await checker.checkPage(pageNoDesc, {
      testCaseId: 'TC-ABOUT',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/about',
    });

    const descFinding = findings.find((f) => f.title.includes('missing a meta description'));
    expect(descFinding).toBeDefined();
    expect(descFinding?.severity).toBe('Minor');
    expect(descFinding?.categoryTag).toBe('SEO');
  });

  it('flags missing H1 and heading level skips', async () => {
    const pageBadHeadings = createMockPage({
      title: 'Docs',
      metaDescription: 'Documentation',
      h1Count: 0,
      headings: [
        { level: 2, text: 'Subheading' },
        { level: 4, text: 'Deeply nested heading' },
      ],
      htmlLang: 'en',
      sameSiteLinks: [],
      hasViewportMeta: true,
      hasFavicon: true,
      canonicalUrl: 'http://localhost/docs',
      canonicalCount: 1,
      imagesWithoutAltCount: 0,
    });

    const findings = await checker.checkPage(pageBadHeadings, {
      testCaseId: 'TC-HEADINGS',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/docs',
    });

    expect(findings.some((f) => f.title.includes('no primary <h1>'))).toBe(true);
    expect(findings.some((f) => f.title.includes('Heading levels skipped'))).toBe(true);
  });

  it('flags missing html lang attribute', async () => {
    const pageNoLang = createMockPage({
      title: 'Home',
      metaDescription: 'Home description',
      h1Count: 1,
      headings: [{ level: 1, text: 'Home' }],
      htmlLang: '',
      sameSiteLinks: [],
      hasViewportMeta: true,
      hasFavicon: true,
      canonicalUrl: 'http://localhost/',
      canonicalCount: 1,
      imagesWithoutAltCount: 0,
    });

    const findings = await checker.checkPage(pageNoLang, {
      testCaseId: 'TC-LANG',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
    });

    const langFinding = findings.find((f) => f.title.includes('missing a lang attribute'));
    expect(langFinding).toBeDefined();
    expect(langFinding?.severity).toBe('Minor');
    expect(langFinding?.categoryTag).toBe('SEO');
  });

  it('flags canonical tag issues and noindex directives', async () => {
    const pageWithSeoIssues = createMockPage({
      title: 'Pricing',
      metaDescription: 'Pricing plans',
      h1Count: 1,
      headings: [{ level: 1, text: 'Pricing' }],
      htmlLang: 'en',
      sameSiteLinks: [],
      canonicalUrl: '',
      canonicalCount: 0,
      metaRobots: 'noindex, follow',
      hasViewportMeta: false,
      hasFavicon: false,
      imagesWithoutAltCount: 2,
    });

    const findings = await checker.checkPage(pageWithSeoIssues, {
      testCaseId: 'TC-PRICING',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/pricing',
    });

    expect(findings.some((f) => f.title.includes('missing a canonical URL tag'))).toBe(true);
    expect(findings.some((f) => f.title.includes('noindex directive preventing search engine indexing'))).toBe(true);
    expect(findings.some((f) => f.title.includes('missing a mobile viewport meta tag'))).toBe(true);
    expect(findings.some((f) => f.title.includes('missing a favicon link tag'))).toBe(true);
    expect(findings.some((f) => f.title.includes('Images missing alt text descriptions'))).toBe(true);
  });

  it('detects broken internal link returning HTTP 404', async () => {
    const pageWithLinks = createMockPage(
      {
        title: 'Home',
        metaDescription: 'Home page',
        h1Count: 1,
        headings: [{ level: 1, text: 'Home' }],
        htmlLang: 'en',
        sameSiteLinks: ['/dead-link'],
        canonicalUrl: 'http://localhost/',
        canonicalCount: 1,
        hasViewportMeta: true,
        hasFavicon: true,
        imagesWithoutAltCount: 0,
      },
      async (url: string) => {
        if (url.includes('/dead-link')) {
          return { status: () => 404 };
        }
        return { status: () => 200, text: async () => '' };
      }
    );

    const findings = await checker.checkPage(pageWithLinks, {
      testCaseId: 'TC-LINKS',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: 'http://localhost:3050',
    });

    const brokenLinkFinding = findings.find((f) => f.title.includes('Broken link found'));
    expect(brokenLinkFinding).toBeDefined();
    expect(brokenLinkFinding?.severity).toBe('Major');
    expect(brokenLinkFinding?.expectedVsActual.actual).toContain('404');
    // A broken link is something broken on any site, public or not: it counts under Works.
    expect(brokenLinkFinding?.aspect).toBe('Works');
  });

  it('audits root assets and detects AI crawler blocks in robots.txt', async () => {
    const rootAuditor = new SiteRootAuditor();
    const mockRobots = `
User-agent: *
Disallow: /admin

User-agent: GPTBot
Disallow: /

User-agent: PerplexityBot
Disallow: /
`;

    const result = await rootAuditor.audit(
      async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          return { status: () => 200, text: async () => mockRobots };
        }
        if (url.endsWith('/sitemap.xml')) {
          return { status: () => 200, text: async () => '<xml></xml>' };
        }
        if (url.endsWith('/llms.txt')) {
          return { status: () => 404, text: async () => '' };
        }
        return { status: () => 200, text: async () => '' };
      },
      { baseUrl: 'https://example.com' }
    );

    expect(result.hasRobotsTxt).toBe(true);
    expect(result.blockedAiBots).toContain('GPTBot');
    expect(result.blockedAiBots).toContain('PerplexityBot');
    expect(
      result.findings.some((f) => f.categoryTag === 'GEO' && f.title.includes('AI search crawlers are disallowed'))
    ).toBe(true);
    expect(result.findings.some((f) => f.categoryTag === 'GEO' && f.title.includes('missing an /llms.txt file'))).toBe(
      true
    );
  });

  it('evaluates AEO features (JSON-LD syntax, entity schema, Q&A patterns)', async () => {
    const aeoChecker = new AeoChecker();
    const mockPage = {
      evaluate: async () => ({
        jsonLdScripts: ['{ malformed json ld'],
        hasBreadcrumbsNav: false,
        questionHeadings: [
          { text: 'How do I reset my password?', nextParagraphWordCount: 5, hasAnswerParagraph: true },
        ],
        wordCount: 400,
        listCount: 0,
        tableCount: 0,
        hasAuthorByline: false,
        hasDatePublished: false,
      }),
    } as unknown as Page;

    const findings = await aeoChecker.checkPage(mockPage, {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/faq',
      testCaseId: 'TC-FAQ',
    });

    expect(findings.some((f) => f.title.includes('malformed JSON-LD'))).toBe(true);
    expect(findings.some((f) => f.title.includes('missing breadcrumb navigation'))).toBe(true);
    expect(findings.some((f) => f.title.includes('lacks a concise direct answer'))).toBe(true);
    expect(findings.some((f) => f.title.includes('lacks structured lists or comparison tables'))).toBe(true);
    expect(findings.every((f) => f.categoryTag === 'AEO')).toBe(true);
  });

  it('evaluates GEO features (text density, citations, author bylines)', async () => {
    const geoChecker = new GeoChecker();
    const mockPage = {
      evaluate: async () => ({
        totalHtmlLength: 10000,
        textLength: 150, // very low text density (< 2%)
        wordCount: 25,
        hasMainOrArticle: false,
        externalLinkCount: 0,
        hasAuthorByline: false,
        hasDatePublished: false,
      }),
    } as unknown as Page;

    const findings = await geoChecker.checkPage(mockPage, {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/features',
      testCaseId: 'TC-GEO',
    });

    expect(findings.some((f) => f.title.includes('Low text-to-code ratio'))).toBe(true);
    expect(findings.every((f) => f.categoryTag === 'GEO')).toBe(true);
  });

  it('respects granular visibility flags for SEO, AEO, GEO, and Marketing', async () => {
    const pageWithDefects = createMockPage({
      title: '',
      metaDescription: '',
      h1Count: 0,
      headings: [],
      htmlLang: 'en',
      sameSiteLinks: [],
      hasViewportMeta: true,
      hasFavicon: true,
      canonicalUrl: 'http://localhost/test',
      canonicalCount: 1,
      imagesWithoutAltCount: 0,
    });

    // 1. Only search enabled
    const findingsSearchOnly = await checker.checkPage(pageWithDefects, {
      testCaseId: 'TC-VIS-1',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/test',
      visibility: { search: true, answers: false, aiSearch: false, marketing: false },
    });
    expect(findingsSearchOnly.some((f) => f.categoryTag === 'SEO')).toBe(true);
    expect(findingsSearchOnly.some((f) => f.categoryTag === 'AEO')).toBe(false);
    expect(findingsSearchOnly.some((f) => f.categoryTag === 'GEO')).toBe(false);
    expect(findingsSearchOnly.some((f) => f.categoryTag === 'MKT')).toBe(false);

    // 2. All visibility turned off
    const findingsAllOff = await checker.checkPage(pageWithDefects, {
      testCaseId: 'TC-VIS-2',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/test',
      visibility: { search: false, answers: false, aiSearch: false, marketing: false },
    });
    expect(findingsAllOff.length).toBe(0);
  });
});
