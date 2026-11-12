import type { Page } from 'playwright';
import type { Breakpoint, Finding } from '@qa/types';
import { couldNotVerifyFinding } from './could-not-verify.js';
import { SiteRootAuditor } from './site-root.js';
import { AeoChecker } from './aeo.js';
import { GeoChecker } from './geo.js';
import { MarketingChecker, type MarketingLog } from './marketing.js';
import type { FetchFn } from './security-depth.js';

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

/**
 * The address requests are built from: the page as it loaded (after any redirect), else the address
 * the Check-up was given. The checker's fetch follows no redirects, so the typed address can answer 301.
 */
function requestBaseOf(page: Page, context: SeoContext): string | undefined {
  try {
    const loaded = typeof page.url === 'function' ? page.url() : '';
    if (/^https?:\/\//i.test(loaded)) return loaded;
  } catch {
    // A page that cannot say its address: use the given one.
  }
  return context.baseUrl;
}

const ACTION_SEGMENTS = new Set([
  'logout',
  'signout',
  'sign-out',
  'log-out',
  'unsubscribe',
  'delete',
  'remove',
  'cancel',
  'confirm',
  'verify',
  'activate',
  'approve',
  'checkout',
  'pay',
]);

const ACTION_QUERY_KEYS = new Set(['token', 'key', 'code', 'otp', 'signature', 'sig', 'action']);

/**
 * Returns true when path segment (case-insensitive) matches any action verb:
 * logout, signout, sign-out, log-out, unsubscribe, delete, remove, cancel, confirm, verify, activate, approve, checkout, pay;
 * OR query has a key named token, key, code, otp, signature, sig, or action.
 * Segment matching must be exact segment equality (e.g. /blog/cancel-culture is false).
 */
export function isActionLink(pathAndQuery: string): boolean {
  if (!pathAndQuery) return false;
  try {
    const url = new URL(pathAndQuery, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    for (const seg of segments) {
      if (ACTION_SEGMENTS.has(seg.toLowerCase())) {
        return true;
      }
    }
    for (const key of url.searchParams.keys()) {
      if (ACTION_QUERY_KEYS.has(key.toLowerCase())) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

const NOINDEX_EXEMPT_SEGMENTS = new Set([
  'login',
  'auth',
  'signup',
  'cart',
  'account',
  'checkout',
  'admin',
  'dashboard',
  'settings',
]);

/**
 * Returns true for /login, /auth, /signup, /cart, /account, /checkout, /admin, /dashboard, /settings
 * (exact or leading path segment).
 */
export function isNoindexExempt(urlPath: string): boolean {
  if (!urlPath) return false;
  try {
    const url = new URL(urlPath, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return false;
    const leading = segments[0].toLowerCase();
    return NOINDEX_EXEMPT_SEGMENTS.has(leading);
  } catch {
    const segments = urlPath.split('?')[0].split('#')[0].split('/').filter(Boolean);
    if (segments.length === 0) return false;
    const leading = segments[0].toLowerCase();
    return NOINDEX_EXEMPT_SEGMENTS.has(leading);
  }
}

export class SeoChecker {
  private siteRootAuditor = new SiteRootAuditor();
  private aeoChecker = new AeoChecker();
  private geoChecker = new GeoChecker();
  private marketingChecker = new MarketingChecker();

  /**
   * Check SEO fundamentals, AEO answer patterns, GEO signals, and link health for a page.
   * Link and site-root requests go only through `fetchFn` (ADR 0031: core builds it on the pinned,
   * redirect-checked path). With no `fetchFn` they make no request and are reported as not checked.
   */
  async checkPage(page: Page, givenContext: SeoContext, fetchFn?: FetchFn): Promise<Finding[]> {
    const context: SeoContext = { ...givenContext, baseUrl: requestBaseOf(page, givenContext) };
    const findings: Finding[] = [];
    const details = await this.collectDetails(page);
    if (!details) return [couldNotVerifyFinding('seo', 'search basics', context)];

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
      return details.sameSiteLinks?.length ? this.checkBrokenLinks(details.sameSiteLinks, context, fetchFn) : findings;
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
      } else {
        const titleTrimmed = details.title.trim();
        const len = titleTrimmed.length;
        if (len < 10 || len > 60) {
          findings.push({
            id: `F-SEO-${tcId}-TITLE-LENGTH-${findings.length + 1}`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Suggestion',
            checker: 'seo',
            categoryTag: 'SEO',
            title: `Page title is ${len < 10 ? 'too short' : 'too long'} (${len} characters)`,
            where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
            expectedVsActual: {
              expected: 'A title of 10 to 60 characters',
              actual: `Title has ${len} characters ("${titleTrimmed}")`,
            },
            stepsToReproduce: [`Visit ${context.urlPath}`, 'Inspect the <title> tag in <head>'],
            evidence: {},
            resolution: 'Adjust the <title> tag length to be between 10 and 60 characters for optimal search display.',
          });
        }
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
      } else {
        const descTrimmed = details.metaDescription.trim();
        const len = descTrimmed.length;
        if (len < 50 || len > 160) {
          findings.push({
            id: `F-SEO-${tcId}-DESC-LENGTH-${findings.length + 1}`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Suggestion',
            checker: 'seo',
            categoryTag: 'SEO',
            title: `Page description is ${len < 50 ? 'too short' : 'too long'} (${len} characters)`,
            where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
            expectedVsActual: {
              expected: 'A meta description of 50 to 160 characters',
              actual: `Description has ${len} characters ("${descTrimmed}")`,
            },
            stepsToReproduce: [`Visit ${context.urlPath}`, 'Search for <meta name="description"> in <head>'],
            evidence: {},
            resolution: 'Adjust the meta description to be between 50 and 160 characters.',
          });
        }
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
          ruleCode: 'seo-multiple-h1',
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
            ruleCode: 'seo-multiple-canonical',
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

      // 6. Meta Robots Noindex Warning & X-Robots-Tag Header
      if (isPublicVisitor && !isNoindexExempt(context.urlPath)) {
        if (details.metaRobots && details.metaRobots.toLowerCase().includes('noindex')) {
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

        if (fetchFn && firstTime('xrobots:' + context.urlPath)) {
          try {
            let targetUrl = '';
            try {
              if (typeof page.url === 'function') {
                targetUrl = page.url();
              }
            } catch {
              // Page may throw or lack url
            }
            if (!targetUrl) {
              targetUrl = context.baseUrl ? new URL(context.urlPath, context.baseUrl).href : context.urlPath;
            }
            if (targetUrl) {
              const res = await fetchFn(targetUrl);
              const headers = res?.headers || {};
              const val = headers['x-robots-tag'] || headers['X-Robots-Tag'];
              if (typeof val === 'string' && val.toLowerCase().includes('noindex')) {
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
                    actual: 'X-Robots-Tag header is "' + val + '"',
                  },
                  stepsToReproduce: [`Visit ${context.urlPath}`, 'Check HTTP response headers for X-Robots-Tag'],
                  evidence: {},
                  resolution:
                    'Remove "noindex" from the X-Robots-Tag response header if this page should appear in search results.',
                });
              }
            }
          } catch {
            // Skip on network or fetch failure
          }
        }
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
          ruleCode: 'seo-images-missing-alt',
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
      const linkFindings = await this.checkBrokenLinks(details.sameSiteLinks, context, fetchFn);
      findings.push(...linkFindings);
    }

    // 12. Site Root Auditor (robots.txt, sitemap.xml, llms.txt, AI crawlers)
    if (vis.search && context.baseUrl) {
      const isRootPath = context.urlPath === '/' || context.urlPath === '' || context.urlPath === '/index.html';
      if (isRootPath && !fetchFn) {
        if (firstTime('seo-not-checked:site-root')) {
          findings.push(
            this.notCheckedFinding(
              context,
              'SITEROOT',
              'Site files were not checked',
              'robots.txt, sitemap.xml and llms.txt are read',
              [`Open ${context.baseUrl}`]
            )
          );
        }
      } else if (isRootPath && fetchFn) {
        try {
          const rootResult = await this.siteRootAuditor.audit(
            async (url: string) => {
              try {
                const r = await fetchFn(url);
                return r ? { status: () => r.status, text: () => r.text() } : null;
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
            const target = urlObj.pathname + urlObj.search;
            if (urlObj.origin === currentOrigin && !seen.has(target)) {
              seen.add(target);
              sameSiteLinks.push(target);
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
          sameSiteLinks: sameSiteLinks.slice(0, 30), // Candidates only: at most 5 are requested per page
        };
      });
    } catch {
      return null;
    }
  }

  /** A network check that had no `fetchFn`: no request was made, so it says so (never a pass, never a defect). */
  private notCheckedFinding(
    context: SeoContext,
    kind: string,
    title: string,
    expected: string,
    steps: string[]
  ): Finding {
    return {
      id: `F-SEO-${context.testCaseId || 'GEN'}-${kind}-NOTCHECKED`,
      testCaseId: context.testCaseId,
      flowId: context.flowId,
      severity: 'Suggestion',
      checker: 'seo',
      title,
      where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
      expectedVsActual: {
        expected,
        actual: 'The check was given no way to make requests here, so none was made (automatic check only)',
      },
      stepsToReproduce: steps,
      evidence: {},
      resolution: 'Run a Check-up, which makes these requests through its checked request path.',
      needsConfirmation: true,
    };
  }

  /** One GET per link (no HEAD first), up to 5 links a page that this run has not asked for yet, only through `fetchFn`. */
  private async checkBrokenLinks(paths: string[], context: SeoContext, fetchFn?: FetchFn): Promise<Finding[]> {
    const findings: Finding[] = [];
    // A link already requested this run (the shared menu, on every page) is not asked for again.
    const asked = (p: string) => context.siteWide?.has(`link:${p}`) === true;
    const toCheck = paths.filter((p) => !asked(p) && !isActionLink(p)).slice(0, 5);
    if (!fetchFn) {
      if (toCheck.length === 0) return findings;
      return [
        this.notCheckedFinding(
          context,
          'BROKENLINK',
          'Links were not checked',
          'Links on this page are opened to see if they work',
          [`Visit ${context.urlPath}`]
        ),
      ];
    }

    for (const linkPath of toCheck) {
      try {
        const fullUrl = context.baseUrl ? new URL(linkPath, context.baseUrl).href : linkPath;
        const res = await fetchFn(fullUrl);
        context.siteWide?.add(`link:${linkPath}`);
        const response = res ? { status: () => res.status } : null;

        // Broken means gone or failing (404, 410, 5xx), the same rule as core's checker-fetch.
        // 429, 400 or 405 say the server refused this request, not that the link is dead.
        const status = response?.status();
        if (status !== undefined && (status === 404 || status === 410 || (status >= 500 && status <= 599))) {
          findings.push({
            id: `F-SEO-${context.testCaseId || 'GEN'}-BROKENLINK-${findings.length + 1}`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Major',
            checker: 'seo',
            // A broken link is something broken, whoever the site is for.
            aspect: 'Works',
            ruleCode: 'seo-broken-link',
            title: `Broken link found: ${linkPath} returned HTTP ${status}`,
            where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
            expectedVsActual: {
              expected: `All internal links should resolve to valid pages (HTTP 200/300)`,
              actual: `Link to ${linkPath} responded with HTTP ${status}`,
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
