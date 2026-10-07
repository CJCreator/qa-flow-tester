import type { Page } from 'playwright';
import type { Breakpoint, Finding } from '@qa/types';
import { SiteRootAuditor } from './site-root.js';
import { AeoChecker } from './aeo.js';
import { GeoChecker } from './geo.js';
import { MarketingChecker, type MarketingLog } from './marketing.js';

export interface SeoContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
  urlPath: string;
  baseUrl?: string;
  /**
   * Check how search engines and AI assistants see the page. False on a site that isn't public (a
   * test copy): then only its links are checked.
   */
  searchChecks?: boolean;
  /** Granular 4-lens visibility flags: search, answers, aiSearch, marketing. */
  visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
  /**
   * Facts about the whole site already reported this run (its icon, its phone set-up, who runs it):
   * each is reported once, on the first page it's seen on, not on every page.
   */
  siteWide?: Set<string>;
  /** What the marketing basics found over the run, for the report's checklist. */
  marketingLog?: MarketingLog;
}

export interface SeoPageDetails {
  title?: string;
  metaDescription?: string;
  h1Count: number;
  headings: Array<{ level: number; text: string }>;
  canonicalUrl?: string;
  canonicalCount: number;
  hasViewportMeta: boolean;
  hasFavicon: boolean;
  imagesWithoutAltCount: number;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  htmlLang?: string;
  metaRobots?: string;
  sameSiteLinks: string[];
}

export class SeoChecker {
  private siteRootAuditor = new SiteRootAuditor();
  private aeoChecker = new AeoChecker();
  private geoChecker = new GeoChecker();
  private marketingChecker = new MarketingChecker();

  /**
   * Check SEO fundamentals, AEO answer patterns, GEO signals, and link health for a page.
   */
  async checkPage(page: Page, context: SeoContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const details = await this.collectDetails(page);
    if (!details) return findings;

    const tcId = context.testCaseId || 'GEN';
    const isPublicVisitor = !context.role || context.role === 'visitor' || context.role === 'anonymous';
    /** True the first time a site-wide fact is reported this run. */
    const firstTime = (key: string) => {
      if (!context.siteWide) return true;
      if (context.siteWide.has(key)) return false;
      context.siteWide.add(key);
      return true;
    };

    const vis = context.visibility ?? {
      search: context.searchChecks !== false,
      answers: context.searchChecks !== false,
      aiSearch: context.searchChecks !== false,
      marketing: context.searchChecks !== false,
    };

    // If all visibility checks are turned off: only check broken links.
    if (!vis.search && !vis.answers && !vis.aiSearch && !vis.marketing) {
      return details.sameSiteLinks?.length ? this.checkBrokenLinks(page, details.sameSiteLinks, context) : findings;
    }

    if (vis.search) {
      // 1. Page Title
      if (!details.title || details.title.trim().length === 0) {
        findings.push({
          id: `F-SEO-${tcId}-TITLE-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Major',
          checker: 'seo',
          categoryTag: 'SEO',
          title: 'Page is missing a title tag',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'Page should have a descriptive <title> tag between 10 and 60 characters',
            actual: 'The <title> tag is missing or empty',
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Inspect the <head> element for a <title> tag'],
          evidence: {},
          resolution: 'Add a distinct, descriptive <title> in the <head> of the HTML document.',
        });
      }

      // 2. Meta Description
      if (!details.metaDescription || details.metaDescription.trim().length === 0) {
        findings.push({
          id: `F-SEO-${tcId}-DESC-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'SEO',
          title: 'Page is missing a meta description',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'Page should have a <meta name="description"> tag summarizing the page for search engines',
            actual: 'No meta description tag was found',
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Search for <meta name="description"> in <head>'],
          evidence: {},
          resolution: 'Add a <meta name="description" content="..."> tag with a 50–160 character summary.',
        });
      }

      // 3. Heading Structure: Exactly one H1 and sequential order
      if (details.h1Count === 0) {
        findings.push({
          id: `F-SEO-${tcId}-H1-MISSING-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Major',
          checker: 'seo',
          categoryTag: 'SEO',
          title: 'Page has no primary <h1> heading',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'Every page should have exactly one primary <h1> heading',
            actual: 'Found 0 <h1> headings on the page',
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Check the document headings'],
          evidence: {},
          resolution: 'Add a single top-level <h1> heading identifying the page content.',
        });
      } else if (details.h1Count > 1) {
        findings.push({
          id: `F-SEO-${tcId}-H1-MULTIPLE-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'SEO',
          title: `Page has multiple <h1> headings (${details.h1Count} found)`,
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'Page should have a single <h1> heading representing the main topic',
            actual: `Found ${details.h1Count} <h1> headings`,
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Query document.querySelectorAll("h1")'],
          evidence: {},
          resolution: 'Demote secondary <h1> tags to <h2> or <h3> to maintain a single page heading.',
        });
      }

      // Heading hierarchy skip (e.g. h1 followed directly by h3 or h4)
      if (details.headings.length > 1) {
        for (let i = 0; i < details.headings.length - 1; i++) {
          const curr = details.headings[i].level;
          const next = details.headings[i + 1].level;
          if (next > curr + 1) {
            findings.push({
              id: `F-SEO-${tcId}-HEADING-SKIP-${findings.length + 1}`,
              testCaseId: context.testCaseId,
              flowId: context.flowId,
              severity: 'Minor',
              checker: 'seo',
              categoryTag: 'SEO',
              title: `Heading levels skipped: <h${curr}> followed directly by <h${next}>`,
              where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
              expectedVsActual: {
                expected: `Headings should follow hierarchical order without skipping levels (e.g. h${curr} -> h${curr + 1})`,
                actual: `Heading hierarchy jumped from <h${curr}> to <h${next}> ("${details.headings[i + 1].text.slice(0, 30)}")`,
              },
              stepsToReproduce: [`Visit ${context.urlPath}`, `Inspect heading flow between h${curr} and h${next}`],
              evidence: {},
              resolution: `Ensure heading tags don't skip levels. Use CSS classes if styling needs to differ from semantic rank.`,
            });
            break; // Only flag once per page
          }
        }
      }

      // 4. HTML Language Attribute
      if (!details.htmlLang || details.htmlLang.trim().length === 0) {
        findings.push({
          id: `F-SEO-${tcId}-LANG-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'SEO',
          title: '<html> element is missing a lang attribute',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'The <html> tag must specify the document language (e.g. <html lang="en">)',
            actual: 'The <html> tag has no lang attribute',
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'View source and inspect <html lang="...">'],
          evidence: {},
          resolution: 'Add a valid lang attribute to the <html> root element, such as lang="en".',
        });
      }

      // 5. Canonical Tag Check (for public search-indexed pages)
      if (isPublicVisitor) {
        if (!details.canonicalUrl || details.canonicalUrl.trim().length === 0) {
          findings.push({
            id: `F-SEO-${tcId}-CANONICAL-MISSING-${findings.length + 1}`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Minor',
            checker: 'seo',
            categoryTag: 'SEO',
            title: 'Page is missing a canonical URL tag',
            where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
            expectedVsActual: {
              expected:
                'Every page should specify a canonical URL via <link rel="canonical" href="..."> to prevent duplicate content indexing',
              actual: 'No <link rel="canonical"> tag was found in <head>',
            },
            stepsToReproduce: [`Visit ${context.urlPath}`, 'Inspect <head> for link[rel="canonical"]'],
            evidence: {},
            resolution:
              'Add a <link rel="canonical" href="https://example.com/page"> pointing to the definitive address of this page.',
          });
        } else if (details.canonicalCount > 1) {
          findings.push({
            id: `F-SEO-${tcId}-CANONICAL-MULTIPLE-${findings.length + 1}`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Minor',
            checker: 'seo',
            categoryTag: 'SEO',
            title: `Page contains multiple canonical URL tags (${details.canonicalCount} found)`,
            where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
            expectedVsActual: {
              expected: 'A page must have exactly one canonical URL tag',
              actual: `Found ${details.canonicalCount} conflicting <link rel="canonical"> tags`,
            },
            stepsToReproduce: [
              `Visit ${context.urlPath}`,
              'Query document.querySelectorAll("link[rel=\'canonical\']")]',
            ],
            evidence: {},
            resolution: 'Remove duplicate <link rel="canonical"> declarations.',
          });
        }
      }

      // 6. Meta Robots Noindex Warning (only on public routes, not intentionally private/app screens)
      const isPrivateOrAppRoute = /^\/(settings|check\/scan|check\/testing|reports\/run-)/i.test(context.urlPath);
      if (!isPrivateOrAppRoute && details.metaRobots && details.metaRobots.toLowerCase().includes('noindex')) {
        findings.push({
          id: `F-SEO-${tcId}-NOINDEX-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Major',
          checker: 'seo',
          categoryTag: 'SEO',
          title: 'Page has a noindex directive preventing search engine indexing',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'Public production pages should not block search crawlers unless intentionally hidden',
            actual: `meta robots directive is "${details.metaRobots}"`,
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Check <meta name="robots"> in <head>'],
          evidence: {},
          resolution: 'Remove "noindex" from the meta robots tag if this page should appear in search results.',
        });
      }

      // 7. Mobile Viewport Meta Tag (for public pages)
      if (isPublicVisitor && !details.hasViewportMeta && firstTime('viewport')) {
        findings.push({
          id: `F-SEO-${tcId}-VIEWPORT-MISSING-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Major',
          checker: 'seo',
          // Found by the search checks, but it's about how the site works on phones.
          aspect: 'Fast and mobile',
          title: 'Page is missing a mobile viewport meta tag',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected:
              'Page should declare <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile search ranking',
            actual: 'No viewport meta tag was found',
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Search for <meta name="viewport"> in <head>'],
          evidence: {},
          resolution: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.',
        });
      }

      // 8. Favicon Link Tag (for public pages)
      if (isPublicVisitor && !details.hasFavicon && firstTime('favicon')) {
        findings.push({
          id: `F-SEO-${tcId}-FAVICON-MISSING-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'SEO',
          title: 'Page is missing a favicon link tag',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'Search results display brand icons; site should provide <link rel="icon" href="...">',
            actual: 'No favicon link tag found in <head>',
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Inspect <head> for link[rel="icon"]'],
          evidence: {},
          resolution: 'Add a <link rel="icon" href="/favicon.ico"> tag in <head>.',
        });
      }

      // 9. Content Image Alt Descriptions
      if (details.imagesWithoutAltCount > 0) {
        findings.push({
          id: `F-SEO-${tcId}-IMG-ALT-MISSING-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'SEO',
          title: `Images missing alt text descriptions (${details.imagesWithoutAltCount} found)`,
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected:
              'All content images must have descriptive alt attributes for Google Image Search and screen readers',
            actual: `Found ${details.imagesWithoutAltCount} images without alt attributes`,
          },
          stepsToReproduce: [
            `Visit ${context.urlPath}`,
            'Query images missing alt attribute: document.querySelectorAll("img:not([alt])")',
          ],
          evidence: {},
          resolution: 'Add descriptive alt text to all informative images, or alt="" for purely decorative graphics.',
        });
      }

      // 10. OpenGraph Tags (Social preview)
      const missingOg: string[] = [];
      if (!details.ogTitle) missingOg.push('og:title');
      if (!details.ogDescription) missingOg.push('og:description');
      if (!details.ogImage) missingOg.push('og:image');
      if (missingOg.length === 3 && firstTime('opengraph')) {
        findings.push({
          id: `F-SEO-${tcId}-OG-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Suggestion',
          checker: 'seo',
          categoryTag: 'SEO',
          title: 'Page is missing OpenGraph social preview tags',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected:
              'Pages should define OpenGraph tags (og:title, og:description, og:image) for rich link previews on social platforms',
            actual: `Missing OpenGraph tags: ${missingOg.join(', ')}`,
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Inspect meta tags for property="og:*"'],
          evidence: {},
          resolution:
            'Add <meta property="og:title">, <meta property="og:description">, and <meta property="og:image"> tags.',
        });
      }
    } // end if (vis.search)

    // 11. Check for broken links on page (limited rate, same-site only)
    if (details.sameSiteLinks && details.sameSiteLinks.length > 0) {
      const linkFindings = await this.checkBrokenLinks(page, details.sameSiteLinks, context);
      findings.push(...linkFindings);
    }

    // 12. Site Root Auditor (robots.txt, sitemap.xml, llms.txt, AI crawlers)
    if (vis.search && context.baseUrl) {
      const isRootPath = context.urlPath === '/' || context.urlPath === '' || context.urlPath === '/index.html';
      if (isRootPath) {
        try {
          const requestContext = page.context().request;
          const rootResult = await this.siteRootAuditor.audit(
            async (url: string) => {
              try {
                const r = await requestContext.fetch(url, { timeout: 3000 });
                return {
                  status: () => r.status(),
                  text: () => r.text(),
                };
              } catch {
                return null;
              }
            },
            {
              baseUrl: context.baseUrl,
              testCaseId: context.testCaseId,
              flowId: context.flowId,
              role: context.role,
              breakpoint: context.breakpoint,
            }
          );
          findings.push(...rootResult.findings);
        } catch {
          // Skip on network failure
        }
      }
    }

    // 13. AEO Audits (Answer Engine Optimization: JSON-LD, Q&A patterns, breadcrumbs)
    if (isPublicVisitor && vis.answers) {
      try {
        const aeoFindings = await this.aeoChecker.checkPage(page, context);
        findings.push(...aeoFindings);
      } catch {
        // Non-blocking
      }
    }

    // 14. GEO Audits (Generative Engine Optimization: density, citations, author bylines)
    if (isPublicVisitor && vis.aiSearch) {
      try {
        const geoFindings = await this.geoChecker.checkPage(page, context);
        findings.push(...geoFindings);
      } catch {
        // Non-blocking
      }
    }

    // 15. Marketing basics (share previews, call to action, contact, analytics), once per site
    if (isPublicVisitor && vis.marketing) {
      try {
        findings.push(...(await this.marketingChecker.checkPage(page, { ...context, log: context.marketingLog })));
      } catch {
        // Non-blocking
      }
    }

    return findings;
  }

  private async collectDetails(page: Page): Promise<SeoPageDetails | null> {
    try {
      return await page.evaluate(() => {
        const title = document.title;
        const metaDescEl = document.querySelector('meta[name="description"]');
        const metaDescription = metaDescEl ? metaDescEl.getAttribute('content') || '' : undefined;

        const h1s = document.querySelectorAll('h1');
        const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const headings: Array<{ level: number; text: string }> = [];
        headingEls.forEach((h) => {
          const level = parseInt(h.tagName.substring(1), 10);
          headings.push({ level, text: (h.textContent || '').trim() });
        });

        const canonicalEls = document.querySelectorAll('link[rel="canonical"]');
        const canonicalUrl = canonicalEls.length > 0 ? canonicalEls[0].getAttribute('href') || '' : undefined;

        const hasViewportMeta = !!document.querySelector('meta[name="viewport"]');
        const hasFavicon = !!document.querySelector(
          'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
        );

        const images = Array.from(document.querySelectorAll('img'));
        let imagesWithoutAltCount = 0;
        for (const img of images) {
          if (!img.hasAttribute('alt')) {
            const role = img.getAttribute('role');
            const ariaHidden = img.getAttribute('aria-hidden');
            if (role !== 'presentation' && role !== 'none' && ariaHidden !== 'true') {
              imagesWithoutAltCount++;
            }
          }
        }

        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || undefined;
        const ogDescription =
          document.querySelector('meta[property="og:description"]')?.getAttribute('content') || undefined;
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || undefined;

        const htmlLang = document.documentElement.getAttribute('lang') || undefined;
        const metaRobots = document.querySelector('meta[name="robots"]')?.getAttribute('content') || undefined;

        // Collect same-site links
        const currentOrigin = window.location.origin;
        const rawLinks = Array.from(document.querySelectorAll('a[href]'));
        const sameSiteLinks: string[] = [];
        const seen = new Set<string>();

        for (const a of rawLinks) {
          const href = a.getAttribute('href');
          if (
            !href ||
            href.startsWith('#') ||
            href.startsWith('javascript:') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:')
          ) {
            continue;
          }
          try {
            const urlObj = new URL(href, window.location.href);
            if (urlObj.origin === currentOrigin && !seen.has(urlObj.pathname)) {
              seen.add(urlObj.pathname);
              sameSiteLinks.push(urlObj.pathname);
            }
          } catch {
            // invalid URL
          }
        }

        return {
          title,
          metaDescription,
          h1Count: h1s.length,
          headings,
          canonicalUrl,
          canonicalCount: canonicalEls.length,
          hasViewportMeta,
          hasFavicon,
          imagesWithoutAltCount,
          ogTitle,
          ogDescription,
          ogImage,
          htmlLang,
          metaRobots,
          sameSiteLinks: sameSiteLinks.slice(0, 10), // Limit to 10 links to avoid flooding
        };
      });
    } catch {
      return null;
    }
  }

  private async checkBrokenLinks(page: Page, paths: string[], context: SeoContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const request = page.context().request;

    // Check up to 5 links asynchronously with a strict timeout
    const toCheck = paths.slice(0, 5);
    for (const linkPath of toCheck) {
      try {
        const fullUrl = context.baseUrl ? new URL(linkPath, context.baseUrl).href : linkPath;
        const response = await request.fetch(fullUrl, { method: 'HEAD', timeout: 3000 }).catch(async () => {
          return await request.fetch(fullUrl, { method: 'GET', timeout: 3000 }).catch(() => null);
        });

        if (response && response.status() >= 400 && response.status() !== 403 && response.status() !== 401) {
          findings.push({
            id: `F-SEO-${context.testCaseId || 'GEN'}-BROKENLINK-${findings.length + 1}`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Major',
            checker: 'seo',
            // A broken link is something broken, whoever the site is for.
            aspect: 'Works',
            title: `Broken link found: ${linkPath} returned HTTP ${response.status()}`,
            where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
            expectedVsActual: {
              expected: `All internal links should resolve to valid pages (HTTP 200/300)`,
              actual: `Link to ${linkPath} responded with HTTP ${response.status()}`,
            },
            stepsToReproduce: [`Visit ${context.urlPath}`, `Click or request link to ${linkPath}`],
            evidence: {},
            resolution: `Fix the broken link target or set up a 301 redirect if the page moved.`,
          });
        }
      } catch {
        // Skip link on network error
      }
    }
    return findings;
  }
}
