import { describe, it, expect } from 'vitest';
import { SeoChecker } from '../src/seo.js';
import { SiteRootAuditor } from '../src/site-root.js';
import { AeoChecker } from '../src/aeo.js';
import { GeoChecker } from '../src/geo.js';
import type { Page } from 'playwright';
import type { FetchFn } from '../src/security-depth.js';

describe('SeoChecker and Search/AI Suite', () => {
  const checker = new SeoChecker();

  // ADR 0031: the checker never uses Playwright's request API, so the mock page has none (using it throws).
  function createMockPage(details: any): Page {
    return {
      evaluate: async () => details,
      context: () => {
        throw new Error('Playwright request API used');
      },
    } as unknown as Page;
  }
  function createMockPageAt(url: string, details: any): Page {
    return { ...(createMockPage(details) as any), url: () => url } as unknown as Page;
  }
  /** A recording FetchFn: every call is kept with its URL. */
  function recordingFetch(statusFor: (url: string) => number = () => 200) {
    const calls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      calls.push(url);
      return { status: statusFor(url), headers: {}, text: async () => '' };
    };
    return { fetchFn, calls };
  }
  const linkPageDetails = (links: string[]) => ({
    title: 'Home',
    metaDescription: 'Home page',
    h1Count: 1,
    headings: [{ level: 1, text: 'Home' }],
    htmlLang: 'en',
    sameSiteLinks: links,
    canonicalUrl: 'http://localhost/',
    canonicalCount: 1,
    hasViewportMeta: true,
    hasFavicon: true,
    imagesWithoutAltCount: 0,
  });

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

  it('flags noindex on customer settings route', async () => {
    const pageSettingsNoindex = createMockPage({
      title: 'Settings',
      metaDescription: 'User settings',
      h1Count: 1,
      headings: [{ level: 1, text: 'Settings' }],
      htmlLang: 'en',
      sameSiteLinks: [],
      canonicalUrl: 'http://localhost/settings',
      canonicalCount: 1,
      metaRobots: 'noindex',
      hasViewportMeta: true,
      hasFavicon: true,
      imagesWithoutAltCount: 0,
    });

    const findings = await checker.checkPage(pageSettingsNoindex, {
      testCaseId: 'TC-SETTINGS',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/settings',
    });

    // In T-340 /settings is an exempt path, so no noindex defect is raised
    expect(findings.some((f) => f.title.includes('noindex directive preventing search engine indexing'))).toBe(false);
  });

  it('detects broken internal link returning HTTP 404', async () => {
    const pageWithLinks = createMockPage(linkPageDetails(['/dead-link']));
    const { fetchFn } = recordingFetch((url) => (url.includes('/dead-link') ? 404 : 200));

    const findings = await checker.checkPage(
      pageWithLinks,
      {
        testCaseId: 'TC-LINKS',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/',
        baseUrl: 'http://localhost:3050',
      },
      fetchFn
    );

    const brokenLinkFinding = findings.find((f) => f.title.includes('Broken link found'));
    expect(brokenLinkFinding).toBeDefined();
    expect(brokenLinkFinding?.severity).toBe('Major');
    expect(brokenLinkFinding?.expectedVsActual.actual).toContain('404');
    // A broken link is something broken on any site, public or not: it counts under Works.
    expect(brokenLinkFinding?.aspect).toBe('Works');
  });

  it('AC-7: the broken-link check sends exactly one GET per link (no HEAD), up to 5 links', async () => {
    const links = ['/a', '/b', '/c', '/d', '/e', '/f'];
    const { fetchFn, calls } = recordingFetch((url) => (url.endsWith('/c') ? 410 : 200));
    const findings = await checker.checkPage(
      createMockPage(linkPageDetails(links)),
      {
        testCaseId: 'TC-ONEGET',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/about',
        baseUrl: 'http://localhost:3050',
        visibility: { search: false, answers: false, aiSearch: false, marketing: false },
      },
      fetchFn
    );
    // A FetchFn is GET only by contract; each link is asked once.
    expect(calls).toEqual(['/a', '/b', '/c', '/d', '/e'].map((p) => `http://localhost:3050${p}`));
    expect(findings.map((f) => f.title)).toEqual(['Broken link found: /c returned HTTP 410']);
  });

  it('AC-5: site files go through the same FetchFn at the site root', async () => {
    const { fetchFn, calls } = recordingFetch(() => 404);
    await checker.checkPage(
      createMockPage(linkPageDetails([])),
      { testCaseId: 'TC-ROOT', role: 'visitor', breakpoint: '1440px', urlPath: '/', baseUrl: 'https://example.com' },
      fetchFn
    );
    expect(calls).toEqual(expect.arrayContaining(['https://example.com/robots.txt']));
    for (const url of calls) expect(new URL(url).origin).toBe('https://example.com');
  });

  it('site files follow the loaded address', async () => {
    const { fetchFn, calls } = recordingFetch(() => 404);
    await checker.checkPage(
      createMockPageAt('https://www.example.com/', linkPageDetails([])),
      { testCaseId: 'TC-WWW', role: 'visitor', breakpoint: '1440px', urlPath: '/', baseUrl: 'https://example.com' },
      fetchFn
    );
    expect(calls).toContain('https://www.example.com/robots.txt');
    for (const url of calls) expect(new URL(url).origin).toBe('https://www.example.com');
  });

  it('links follow the loaded address', async () => {
    const { fetchFn, calls } = recordingFetch();
    await checker.checkPage(
      createMockPageAt('https://www.example.com/', linkPageDetails(['/a'])),
      {
        testCaseId: 'TC-WWW',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/',
        baseUrl: 'https://example.com',
        searchChecks: false,
        visibility: { search: false, answers: false, aiSearch: false, marketing: false },
      },
      fetchFn
    );
    expect(calls).toEqual(['https://www.example.com/a']);
  });

  it('a link is requested once per run across multiple pages sharing siteWide', async () => {
    const siteWide = new Set<string>();
    const { fetchFn, calls } = recordingFetch();
    await checker.checkPage(
      createMockPage(linkPageDetails(['/a', '/b'])),
      {
        testCaseId: 'TC-LINK1',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/',
        baseUrl: 'http://localhost:3050',
        searchChecks: false,
        visibility: { search: false, answers: false, aiSearch: false, marketing: false },
        siteWide,
      },
      fetchFn
    );
    await checker.checkPage(
      createMockPage(linkPageDetails(['/a', '/b', '/c'])),
      {
        testCaseId: 'TC-LINK2',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/next',
        baseUrl: 'http://localhost:3050',
        searchChecks: false,
        visibility: { search: false, answers: false, aiSearch: false, marketing: false },
        siteWide,
      },
      fetchFn
    );
    expect(calls).toEqual(['http://localhost:3050/a', 'http://localhost:3050/b', 'http://localhost:3050/c']);
  });

  it('a link with a query string is requested with it', async () => {
    const { fetchFn, calls } = recordingFetch();
    await checker.checkPage(
      createMockPage(linkPageDetails(['/product?id=4'])),
      {
        testCaseId: 'TC-QUERY',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/',
        baseUrl: 'http://localhost:3050',
        searchChecks: false,
        visibility: { search: false, answers: false, aiSearch: false, marketing: false },
      },
      fetchFn
    );
    expect(calls).toEqual(['http://localhost:3050/product?id=4']);
  });

  it('AC-5: with no FetchFn, broken links and site files make no request and are reported as not checked', async () => {
    const siteWide = new Set<string>();
    const findings = await checker.checkPage(createMockPage(linkPageDetails(['/dead-link'])), {
      testCaseId: 'TC-NOFETCH',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
      baseUrl: 'http://localhost:3050',
      siteWide,
    });
    const notChecked = findings.filter((f) => f.title.endsWith('not checked'));
    expect(notChecked.map((f) => f.title)).toEqual(['Links were not checked', 'Site files were not checked']);
    for (const f of notChecked) {
      expect(f.needsConfirmation).toBe(true);
      expect(f.severity).toBe('Suggestion');
    }
    expect(findings.some((f) => f.title.includes('Broken link found'))).toBe(false);
    expect(findings.some((f) => /robots\.txt|sitemap/i.test(f.title))).toBe(false);
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

  it('groups with no blank line between them are parsed separately', async () => {
    const rootAuditor = new SiteRootAuditor();
    const mockRobots = 'User-agent: *\nDisallow: /admin\nUser-agent: GPTBot\nDisallow: /\n';
    const result = await rootAuditor.audit(
      async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          return { status: () => 200, text: async () => mockRobots };
        }
        return { status: () => 404, text: async () => '' };
      },
      { baseUrl: 'https://example.com' }
    );
    expect(result.blockedAiBots).toEqual(['GPTBot']);
  });

  it('a crawler with its own Allow group is not blocked by wildcard', async () => {
    const rootAuditor = new SiteRootAuditor();
    const mockRobots = 'User-agent: GPTBot\nAllow: /\n\nUser-agent: *\nDisallow: /\n';
    const result = await rootAuditor.audit(
      async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          return { status: () => 200, text: async () => mockRobots };
        }
        return { status: () => 404, text: async () => '' };
      },
      { baseUrl: 'https://example.com' }
    );
    expect(result.blockedAiBots).not.toContain('GPTBot');
    expect(result.blockedAiBots).toEqual(expect.arrayContaining(['ClaudeBot', 'PerplexityBot', 'Google-Extended']));
  });

  it('two User-agent lines sharing one rule still share it', async () => {
    const rootAuditor = new SiteRootAuditor();
    const mockRobots = 'User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n';
    const result = await rootAuditor.audit(
      async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          return { status: () => 200, text: async () => mockRobots };
        }
        return { status: () => 404, text: async () => '' };
      },
      { baseUrl: 'https://example.com' }
    );
    expect(result.blockedAiBots).toEqual(['GPTBot', 'ClaudeBot']);
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

  it('accepts a list answer of any length for question headings', async () => {
    const aeoChecker = new AeoChecker();
    const mockPage = {
      evaluate: async () => ({
        jsonLdScripts: [],
        hasBreadcrumbsNav: true,
        questionHeadings: [
          {
            text: 'How do I reset my password?',
            nextParagraphWordCount: 150,
            hasAnswerParagraph: true,
            answerIsStructured: true,
          },
        ],
        wordCount: 400,
        listCount: 1,
        tableCount: 0,
      }),
    } as unknown as Page;

    const findings = await aeoChecker.checkPage(mockPage, {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/faq',
      testCaseId: 'TC-FAQ',
    });

    expect(findings.some((f) => f.title.includes('lacks a concise direct answer'))).toBe(false);
  });

  it('flags a paragraph answer over 100 words with actual message', async () => {
    const aeoChecker = new AeoChecker();
    const mockPage = {
      evaluate: async () => ({
        jsonLdScripts: [],
        hasBreadcrumbsNav: true,
        questionHeadings: [
          { text: 'How do I reset my password?', nextParagraphWordCount: 150, hasAnswerParagraph: true },
        ],
        wordCount: 400,
        listCount: 1,
        tableCount: 0,
      }),
    } as unknown as Page;

    const findings = await aeoChecker.checkPage(mockPage, {
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/faq',
      testCaseId: 'TC-FAQ',
    });

    const direct = findings.find((f) => f.title.includes('lacks a concise direct answer'));
    expect(direct).toBeDefined();
    expect(direct?.expectedVsActual.actual).toContain('10–100 words');
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
    const lowDensity = findings.find((f) => f.title.includes('Low text-to-code ratio'));
    expect(lowDensity).toBeDefined();
    expect(lowDensity?.expectedVsActual.expected).toContain('> 5%');
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
