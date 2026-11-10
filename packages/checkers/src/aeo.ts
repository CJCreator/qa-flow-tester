import type { Page } from 'playwright';
import type { Finding, Breakpoint } from '@qa/types';
import { couldNotVerifyFinding } from './could-not-verify.js';

export interface AeoContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
  urlPath: string;
  baseUrl?: string;
  /** Site-wide facts already reported this run: who runs the site is reported once. */
  siteWide?: Set<string>;
}

export interface AeoPageDetails {
  jsonLdScripts: string[];
  hasBreadcrumbsNav: boolean;
  questionHeadings: Array<{
    text: string;
    nextParagraphWordCount: number;
    hasAnswerParagraph: boolean;
    /** True when the answer is a list or a table: its length is not judged. */
    answerIsStructured?: boolean;
  }>;
  wordCount: number;
  listCount: number;
  tableCount: number;
}

export class AeoChecker {
  async checkPage(page: Page, context: AeoContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    const details = await this.collectDetails(page);
    if (!details) return [couldNotVerifyFinding('seo', 'answer engine readiness', context, 'AEO')];

    const tcId = context.testCaseId || 'AEO';
    const isRootOrAbout = context.urlPath === '/' || context.urlPath === '' || context.urlPath.includes('/about');

    // 1. JSON-LD Structured Data Audits
    const parsedSchemas: Array<Record<string, unknown>> = [];
    let hasMalformedJsonLd = false;

    for (let i = 0; i < details.jsonLdScripts.length; i++) {
      const scriptContent = details.jsonLdScripts[i].trim();
      if (!scriptContent) continue;
      try {
        const parsed = JSON.parse(scriptContent);
        if (Array.isArray(parsed)) {
          parsedSchemas.push(...parsed);
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as Record<string, unknown>)['@graph'])
        ) {
          parsedSchemas.push(...((parsed as Record<string, unknown>)['@graph'] as Array<Record<string, unknown>>));
        } else if (parsed && typeof parsed === 'object') {
          parsedSchemas.push(parsed as Record<string, unknown>);
        }
      } catch (err) {
        hasMalformedJsonLd = true;
        const errMsg = err instanceof Error ? err.message : 'SyntaxError';
        findings.push({
          id: `F-AEO-${tcId}-JSONLD-INVALID-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Major',
          checker: 'seo',
          categoryTag: 'AEO',
          title: 'Page contains malformed JSON-LD structured data',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected: 'All <script type="application/ld+json"> tags must contain syntactically valid JSON',
            actual: `JSON parse error: ${errMsg} in script block #${i + 1}`,
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, 'Inspect <script type="application/ld+json">'],
          evidence: {},
          resolution: 'Correct syntax errors in the JSON-LD payload to ensure search and answer engines can parse it.',
        });
      }
    }

    const schemaTypes = new Set<string>();
    for (const schema of parsedSchemas) {
      if (schema && schema['@type']) {
        const typeVal = schema['@type'];
        if (Array.isArray(typeVal)) {
          typeVal.forEach((t: unknown) => {
            if (typeof t === 'string') schemaTypes.add(t);
          });
        } else if (typeof typeVal === 'string') {
          schemaTypes.add(typeVal);
        }
      }
    }

    // 2. Organization / WebSite Schema on Root/About
    if (isRootOrAbout && !hasMalformedJsonLd) {
      const hasOrgOrSite =
        schemaTypes.has('Organization') ||
        schemaTypes.has('Corporation') ||
        schemaTypes.has('LocalBusiness') ||
        schemaTypes.has('WebSite');
      const first = !context.siteWide?.has('org-schema');
      context.siteWide?.add('org-schema');
      if (!hasOrgOrSite && first) {
        findings.push({
          id: `F-AEO-${tcId}-ORG-SCHEMA-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'AEO',
          title: 'Homepage is missing Organization or WebSite structured data',
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected:
              'The root/home page should define schema.org/Organization or WebSite schema with name, logo, and social profiles',
            actual: `Found schema types: ${schemaTypes.size > 0 ? Array.from(schemaTypes).join(', ') : 'None'}`,
          },
          stepsToReproduce: [
            `Visit ${context.urlPath}`,
            'Check for JSON-LD schema with @type "Organization" or "WebSite"',
          ],
          evidence: {},
          resolution:
            'Add a JSON-LD Organization schema on the homepage establishing your brand entity, logo, and authority links.',
        });
      }
    }

    // 3. Breadcrumb navigation check on inner pages
    if (!isRootOrAbout && !schemaTypes.has('BreadcrumbList') && !details.hasBreadcrumbsNav) {
      findings.push({
        id: `F-AEO-${tcId}-BREADCRUMB-${findings.length + 1}`,
        testCaseId: context.testCaseId,
        flowId: context.flowId,
        severity: 'Minor',
        checker: 'seo',
        categoryTag: 'AEO',
        title: 'Inner page is missing breadcrumb navigation or BreadcrumbList schema',
        where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
        expectedVsActual: {
          expected:
            'Inner pages should provide breadcrumbs or schema.org/BreadcrumbList to clarify site hierarchy for answer engines',
          actual: 'No breadcrumb nav element or BreadcrumbList JSON-LD schema found',
        },
        stepsToReproduce: [
          `Visit ${context.urlPath}`,
          'Inspect navigation elements and structured data for breadcrumbs',
        ],
        evidence: {},
        resolution: 'Add breadcrumb navigation with schema.org/BreadcrumbList JSON-LD markup.',
      });
    }

    // 4. Question Headings and Direct Answer Paragraphs
    for (const qh of details.questionHeadings) {
      const wrongLength =
        !qh.answerIsStructured && (qh.nextParagraphWordCount < 10 || qh.nextParagraphWordCount > 100);
      if (!qh.hasAnswerParagraph || wrongLength) {
        findings.push({
          id: `F-AEO-${tcId}-DIRECT-ANSWER-${findings.length + 1}`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Suggestion',
          checker: 'seo',
          categoryTag: 'AEO',
          title: `Question heading "${qh.text.slice(0, 36)}..." lacks a concise direct answer`,
          where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
          expectedVsActual: {
            expected:
              'Question headings should be followed immediately by a concise direct answer (a paragraph of 10–100 words, or a list or table) for answer snippet eligibility',
            actual: qh.hasAnswerParagraph
              ? `Answer paragraph is ${qh.nextParagraphWordCount} words (the check accepts 10–100 words)`
              : 'Heading is not followed by an immediate answer',
          },
          stepsToReproduce: [`Visit ${context.urlPath}`, `Inspect element following heading "${qh.text}"`],
          evidence: {},
          resolution:
            'Provide a direct, self-contained 1–2 sentence answer paragraph directly beneath question headings.',
        });
        break; // Flag once per page to avoid cluttering report
      }
    }

    // 5. Structured Lists & Tables on Content Pages
    if (details.wordCount >= 350 && details.listCount === 0 && details.tableCount === 0) {
      findings.push({
        id: `F-AEO-${tcId}-LIST-TABLE-MISSING-${findings.length + 1}`,
        testCaseId: context.testCaseId,
        flowId: context.flowId,
        severity: 'Suggestion',
        checker: 'seo',
        categoryTag: 'AEO',
        title: 'Substantial content page lacks structured lists or comparison tables',
        where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
        expectedVsActual: {
          expected:
            'Content-rich pages (>350 words) should utilize bulleted/numbered lists or tables to qualify for featured snippets',
          actual: `Found ${details.wordCount} words of text with 0 lists and 0 tables`,
        },
        stepsToReproduce: [`Visit ${context.urlPath}`, 'Count <ul>, <ol>, and <table> elements'],
        evidence: {},
        resolution: 'Break key takeaways, steps, or feature comparisons into <ul>/<ol> lists or <table> elements.',
      });
    }

    return findings;
  }

  private async collectDetails(page: Page): Promise<AeoPageDetails | null> {
    try {
      return await page.evaluate(() => {
        // Collect JSON-LD scripts
        const scriptEls = document.querySelectorAll('script[type="application/ld+json"]');
        const jsonLdScripts = Array.from(scriptEls).map((s) => s.textContent || '');

        // Check for breadcrumb nav
        const breadcrumbsEl = document.querySelector(
          'nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i]'
        );
        const hasBreadcrumbsNav = !!breadcrumbsEl;

        // Check question headings
        const headings = document.querySelectorAll('h2, h3, h4');
        const questionHeadings: Array<{
          text: string;
          nextParagraphWordCount: number;
          hasAnswerParagraph: boolean;
          answerIsStructured?: boolean;
        }> = [];
        headings.forEach((h) => {
          const text = (h.textContent || '').trim();
          const isQuestion = text.endsWith('?') || /^(what|how|why|when|where|who)\b/i.test(text);
          if (isQuestion && text.length > 8) {
            // The answer is the first content block after the heading. Another heading ends the search:
            // what follows it answers that heading, not this one.
            const BLOCKS = ['P', 'DIV', 'UL', 'OL', 'TABLE', 'DL'];
            let nextEl = h.nextElementSibling;
            while (nextEl && !BLOCKS.includes(nextEl.tagName) && !/^H[1-6]$/.test(nextEl.tagName)) {
              nextEl = nextEl.nextElementSibling;
            }
            const tag = nextEl ? nextEl.tagName : '';
            const answerText = nextEl && tag !== 'DIV' && !/^H[1-6]$/.test(tag) ? (nextEl.textContent || '').trim() : '';
            const words = answerText ? answerText.split(/\s+/).length : 0;
            questionHeadings.push({
              text,
              nextParagraphWordCount: words,
              hasAnswerParagraph: words > 0,
              answerIsStructured: words > 0 && tag !== 'P',
            });
          }
        });

        // Content volume and structure
        const bodyText = (document.body.innerText || '').trim();
        const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
        const listCount = document.querySelectorAll('ul, ol').length;
        const tableCount = document.querySelectorAll('table').length;

        return {
          jsonLdScripts,
          hasBreadcrumbsNav,
          questionHeadings: questionHeadings.slice(0, 5),
          wordCount,
          listCount,
          tableCount,
        };
      });
    } catch {
      return null;
    }
  }
}
