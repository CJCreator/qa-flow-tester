import type { AspectType, CheckerType, Finding, FindingSeverity } from './index.js';

/**
 * What a person reads as "a problem": findings grouped by what's wrong, whichever checker found it
 * and on however many pages. The verdict, the report's counts and its list all count these, so no
 * two numbers on a report disagree. Browser-safe: the wizard imports this file directly.
 */

export const SEVERITY_ORDER: FindingSeverity[] = ['Blocker', 'Major', 'Minor', 'Suggestion'];

/** The report's six areas, and the checks behind each (the same mapping as the grades). */
export const ASPECT_CHECKERS: Record<AspectType, CheckerType[]> = {
  Works: ['bug-detection', 'spec-conformance'],
  Accessible: ['ux-quality'],
  'Fast and mobile': ['performance'],
  Findable: ['seo'],
  Secure: ['security', 'permission-matrix'],
  'Looks and reads well': ['design-standards', 'ai-review'],
};

export const ASPECTS: AspectType[] = [
  'Works',
  'Accessible',
  'Fast and mobile',
  'Findable',
  'Secure',
  'Looks and reads well',
];

export function aspectOfChecker(checker: CheckerType): AspectType {
  return ASPECTS.find((a) => ASPECT_CHECKERS[a].includes(checker)) ?? 'Works';
}

/** The area a finding counts toward: its own when it says (a missing viewport tag is about phones), else its checker's. */
export function aspectOfFinding(f: Pick<Finding, 'checker'> & { aspect?: AspectType }): AspectType {
  return f.aspect ?? aspectOfChecker(f.checker);
}

/** Rewrites a technical finding title as a sentence; unknown shapes are only tidied. */
export function plainTitleText(t: string): string {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^Third-party request failed/))) return 'A service your site relies on didn’t respond';
  if ((m = t.match(/^HTTP (\d{3})/))) return `A request to your site failed (error ${m[1]})`;
  if (/^HTTP Failed/.test(t)) return 'A request to your site didn’t go through';
  if (/^Uncaught Exception/.test(t)) return 'The page crashed while it was running';
  if (/^Console Error/.test(t)) return 'The page reported an error behind the scenes';
  if ((m = t.match(/^Step failed: "(.+)"$/))) return `Couldn’t complete “${m[1]}”`;
  if ((m = t.match(/^Touch target too small: (.+?) \(\d+x\d+px\)$/)))
    return `“${m[1].replace(/^["“]|["”]$/g, '')}” is too small to tap easily on a phone`;
  if (/^Touch target too small/.test(t)) return 'A button is too small to tap easily on a phone';
  if (/^Dead End Page/.test(t)) return 'A page has no way back or menu to leave it';
  if (/^Horizontal page overflow/.test(t)) return 'The page is wider than the screen and scrolls sideways';
  if (/^Visual regression/.test(t)) return 'A screen looks different from its approved version';
  if (/^Design Token Mismatch/.test(t)) return 'A colour or shape doesn’t match the design';
  if ((m = t.match(/^\[AI Review\]\s*(.+)$/))) return m[1];
  if ((m = t.match(/^URL did not match expected pattern:?\s*["']?(?:\^)?(.*?)(?:\$)?["']?$/i))) {
    const raw = m[1]
      .replace(/\\\//g, '/')
      .replace(/\/\.\*$/, '')
      .replace(/\\[a-zA-Z0-9+*.]+/g, '')
      .replace(/\/+$/, '');
    const target = raw || 'the expected page';
    return `Didn’t reach “${target}” as expected`;
  }
  if (/^URL did not match/i.test(t)) return 'Didn’t reach the expected page';

  if (/Elements must meet minimum color contrast ratio thresholds/i.test(t) || /color-contrast/i.test(t)) {
    return 'Text doesn’t have enough contrast with its background';
  }
  if (/Images must have alternate text/i.test(t) || /image-alt/i.test(t)) {
    return 'An image is missing a text description for screen readers';
  }
  if (/Buttons must have discernible text/i.test(t) || /button-name/i.test(t)) {
    return 'A button is missing a visible or spoken label';
  }
  if (/Links must have discernible text/i.test(t) || /link-name/i.test(t)) {
    return 'A link has no text explaining where it goes';
  }
  if (/Document should have one main landmark/i.test(t) || /landmark-one-main/i.test(t)) {
    return 'The page is missing a main landmark';
  }
  if (/All page content should be contained by landmarks/i.test(t) || /\(region\)$/i.test(t)) {
    return 'Some page content is outside layout landmarks';
  }
  if (/Page should have title element/i.test(t) || /document-title/i.test(t)) {
    return 'The page is missing a title';
  }
  if (/Heading order should be sequential/i.test(t) || /heading-order/i.test(t)) {
    return 'Headings are out of order';
  }
  if (/Form elements must have labels/i.test(t) || /\(label\)$/i.test(t)) {
    return 'A form field is missing a label';
  }

  // Search, AI-answer and AI-search titles
  if (/Page is missing a title tag/i.test(t)) return 'The page is missing a title';
  if (/Page is missing a meta description/i.test(t)) return 'The page is missing a summary for search results';
  if (/Page has no primary <h1> heading/i.test(t)) return 'The page has no main heading';
  if (/Page has multiple <h1> headings/i.test(t)) return 'The page has more than one main heading';
  if (/Heading levels skipped/i.test(t)) return 'Headings skip a level';
  if (/<html> element is missing a lang attribute/i.test(t)) return 'The page doesn’t say what language it’s in';
  if (/Page is missing a canonical URL tag/i.test(t))
    return 'The page doesn’t name its main address for search engines';
  if (/Page contains multiple canonical URL tags/i.test(t))
    return 'The page names more than one main address for search engines';
  if (/Page has a noindex directive preventing search engine indexing/i.test(t))
    return 'Search engines are told not to list this page';
  if (/Page is missing a mobile viewport meta tag/i.test(t)) return 'The site isn’t set up to fit phone screens';
  if (/Page is missing a favicon link tag/i.test(t)) return 'The site has no icon for browser tabs and search results';
  if (/Images missing alt text descriptions/i.test(t))
    return 'An image is missing a text description for screen readers';
  if (/Page is missing OpenGraph social preview tags/i.test(t))
    return 'Links to the site don’t show a preview when shared';
  if (/Site is missing a robots\.txt file/i.test(t))
    return 'The site has no guide for search engine crawlers (robots.txt)';
  if (/Site is missing a sitemap\.xml file/i.test(t))
    return 'The site has no list of its pages for search engines (sitemap)';
  if (/AI search crawlers are disallowed in robots\.txt/i.test(t))
    return 'AI search tools are blocked from reading the site';
  if (/Site is missing an \/llms\.txt file/i.test(t)) return 'The site has no guide for AI assistants (llms.txt)';
  if (/\/llms\.txt file is missing standard/i.test(t))
    return 'The site’s guide for AI assistants isn’t in the usual format';
  if (/Page contains malformed JSON-LD structured data/i.test(t))
    return 'The page’s description for search engines has a mistake in it';
  if (/Homepage is missing Organization or WebSite structured data/i.test(t))
    return 'Search engines aren’t told who runs the site';
  if (/Inner page is missing breadcrumb navigation/i.test(t)) return 'The page doesn’t show where it sits in the site';
  if (/Question heading .* lacks a concise direct answer/i.test(t))
    return 'A question on the page has no short answer under it';
  if (/Substantial content page lacks structured lists or comparison tables/i.test(t))
    return 'Long text has no lists or tables to pick answers from';
  if (/Page lacks a semantic <main> or <article> container/i.test(t))
    return 'The page’s main content isn’t marked as such';
  if (/Low text-to-code ratio/i.test(t)) return 'The page has very little readable text';
  if (/Long-form content page lacks outbound source citations/i.test(t))
    return 'The article doesn’t link to its sources';
  if (/Content page lacks author byline and publication timestamp/i.test(t))
    return 'The article doesn’t say who wrote it or when';

  return t.replace(/^WCAG Violation:\s*/i, '').replace(/\s*\([a-z0-9-]+\)$/i, '');
}

/**
 * The same problem, found by more than one check or on more than one page, has one key: the
 * checker's own `issueKey` when it gives one (a missing page title is both an accessibility and a
 * search problem), else its plain title.
 */
export function problemKey(f: Pick<Finding, 'title'> & { issueKey?: string }): string {
  return f.issueKey ?? plainTitleText(f.title).toLowerCase();
}

/** One problem, and every place it was found. */
export interface Problem {
  key: string;
  /** The plain title. */
  title: string;
  /** The most serious severity it was found at. */
  severity: FindingSeverity;
  /** Every area it touches, first the one it counts toward. */
  aspects: AspectType[];
  findings: Finding[];
  /** The pages it was found on, in the order first seen. */
  pages: string[];
  /** An AI guess the site didn't match: not a problem until someone confirms it. */
  toConfirm: boolean;
}

/** A finding someone marked as intended, or as not a problem, doesn't count. */
export function isDismissed(f: Pick<Finding, 'triageStatus'>): boolean {
  return f.triageStatus === 'Intended' || f.triageStatus === 'False Positive';
}

/**
 * Findings as problems: the same problem on several pages, or from several checks, is one problem
 * that lists them. Dismissed findings are left out; unconfirmed AI guesses are kept apart.
 */
export function groupIntoProblems(findings: Finding[]): Problem[] {
  const problems = new Map<string, Problem>();
  for (const f of findings) {
    if (isDismissed(f)) continue;
    const toConfirm = !!f.needsConfirmation;
    const key = `${toConfirm ? 'confirm|' : ''}${problemKey(f)}`;
    let problem = problems.get(key);
    if (!problem) {
      problem = {
        key,
        title: plainTitleText(f.title),
        severity: f.severity,
        aspects: [],
        findings: [],
        pages: [],
        toConfirm,
      };
      problems.set(key, problem);
    }
    problem.findings.push(f);
    if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(problem.severity)) problem.severity = f.severity;
    const aspect = aspectOfFinding(f);
    if (!problem.aspects.includes(aspect)) problem.aspects.push(aspect);
    for (const page of [f.where.urlPath, ...(f.seenAt?.pages || [])])
      if (page && !problem.pages.includes(page)) problem.pages.push(page);
  }
  return [...problems.values()];
}
