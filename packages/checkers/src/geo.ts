import type { Page } from 'playwright';
import type { Finding, Breakpoint } from '@qa/types';

export interface GeoContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
  urlPath: string;
  baseUrl?: string;
}

export interface GeoPageDetails {
  totalHtmlLength: number;
  textLength: number;
  wordCount: number;
  hasMainOrArticle: boolean;
  externalLinkCount: number;
  hasAuthorByline: boolean;
  hasDatePublished: boolean;
}

export class GeoChecker {
  async checkPage(page: Page, context: GeoContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const details = await this.collectDetails(page);
    if (!details) return findings;

    const tcId = context.testCaseId || 'GEO';
    const isSpecialPath =
      context.urlPath === '/login' ||
      context.urlPath.includes('/auth') ||
      context.urlPath.includes('/signup') ||
      context.urlPath.includes('/cart') ||
      /^\/(settings|reports\/run-|check\/scan|check\/testing|baselines)/i.test(context.urlPath);

    // 1. Machine Readability: Presence of <main> or <article> for unambiguous LLM extraction
    if (!details.hasMainOrArticle && !isSpecialPath && details.wordCount > 100) {
      findings.push({
        id: `F-GEO-${tcId}-MAIN-MISSING-${findings.length + 1}`,
        testCaseId: context.testCaseId,
        flowId: context.flowId,
        severity: 'Suggestion',
        checker: 'seo',
        categoryTag: 'GEO',
        title: 'Page lacks a semantic <main> or <article> container for clean AI content extraction',
        where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
        expectedVsActual: {
          expected: 'Content should be enclosed in a <main> or <article> landmark to allow LLM crawlers to isolate the primary text from navigation chrome',
          actual: 'No <main> or <article> element found in document',
        },
        stepsToReproduce: [`Visit ${context.urlPath}`, 'Check DOM structure for <main> or <article> tag'],
        evidence: {},
        resolution: 'Wrap the primary page content in a semantic <main> or <article> landmark.',
      });
    }

    // 2. Text Density / Content-to-Code Ratio
    if (details.totalHtmlLength > 2000 && !isSpecialPath) {
      const textRatio = details.textLength / details.totalHtmlLength;
      if (textRatio < 0.05 && details.wordCount < 100) {
        findings.push({
          id: `F-GEO-${tcId}-LOW-DENSITY-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'GEO',
          title: 'Low text-to-code ratio: page content may be sparse or locked in client scripts',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'Pages should maintain a healthy text-to-HTML ratio (> 8%) to ensure generative AI parsers can index meaningful content',
            actual: `Visible text ratio is ${(textRatio * 100).toFixed(1)}% (${details.wordCount} words across ${Math.round(details.totalHtmlLength / 1024)} KB of HTML)`,
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Compare innerText volume with outerHTML volume'],
          evidence: {},
          resolution: 'Ensure primary textual content is server-rendered or hydrated cleanly without excessive HTML wrapper bloat.',
        });
      }
    }

    // 3. Citations and Outbound Authority References
    if (details.wordCount >= 400 && details.externalLinkCount === 0 && !isSpecialPath) {
      findings.push({
        id: `F-GEO-${tcId}-WEAK-CITATIONS-${findings.length + 1}`,
        testCaseId: context.testCaseId,
        flowId: context.flowId,
        severity: 'Suggestion',
        checker: 'seo',
        categoryTag: 'GEO',
        title: 'Long-form content page lacks outbound source citations for LLM verifiability',
        where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
        expectedVsActual: {
          expected: 'Informational pages (>400 words) should cite external sources or documentation to boost generative AI citation probability (E-E-A-T)',
          actual: `Page has ${details.wordCount} words but 0 outbound reference links`,
        },
        stepsToReproduce: [`Visit ${context.urlPath}`, 'Inspect links pointing to external domains'],
        evidence: {},
        resolution: 'Add citations, reference links, or outbound authority links corroborating claims on the page.',
      });
    }

    // 4. Author Attribution & Timestamps for Content Credibility (E-E-A-T)
    if (details.wordCount >= 300 && !details.hasAuthorByline && !details.hasDatePublished && !isSpecialPath) {
      findings.push({
        id: `F-GEO-${tcId}-AUTHOR-BYLINE-${findings.length + 1}`,
        testCaseId: context.testCaseId,
        flowId: context.flowId,
        severity: 'Minor',
        checker: 'seo',
        categoryTag: 'GEO',
        title: 'Content page lacks author byline and publication timestamp for AI credibility',
        where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
        expectedVsActual: {
          expected: 'Content should declare author attribution and publication/modified timestamps for generative search engines to evaluate source recency and trust',
          actual: 'Neither an author byline nor a datetime stamp was detected',
        },
        stepsToReproduce: [`Visit ${context.urlPath}`, 'Inspect document for author metadata and <time> tags'],
        evidence: {},
        resolution: 'Add an author byline with bio/profile links and a semantic <time datetime="..."> publication date.',
      });
    }

    return findings;
  }

  private async collectDetails(page: Page): Promise<GeoPageDetails | null> {
    try {
      return await page.evaluate(() => {
        const outerHtml = document.documentElement.outerHTML || '';
        const bodyText = (document.body.innerText || '').trim();
        const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

        const mainOrArticle = document.querySelector('main, article, [role="main"]');
        const hasMainOrArticle = !!mainOrArticle;

        // External links
        const currentOrigin = window.location.origin;
        const links = Array.from(document.querySelectorAll('a[href]'));
        let externalLinkCount = 0;
        for (const a of links) {
          const href = a.getAttribute('href');
          if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            try {
              const url = new URL(href);
              if (url.origin !== currentOrigin) {
                externalLinkCount++;
              }
            } catch {
              // Ignore
            }
          }
        }

        // Author attribution
        const authorEl = document.querySelector('[rel="author"], [class*="author" i], [itemprop="author"], meta[name="author"]');
        const hasAuthorByline = !!authorEl;

        // Date published
        const dateEl = document.querySelector(
          'time[datetime], [itemprop="datePublished"], meta[property="article:published_time"]'
        );
        const hasDatePublished = !!dateEl;

        return {
          totalHtmlLength: outerHtml.length,
          textLength: bodyText.length,
          wordCount,
          hasMainOrArticle,
          externalLinkCount,
          hasAuthorByline,
          hasDatePublished,
        };
      });
    } catch {
      return null;
    }
  }
}
