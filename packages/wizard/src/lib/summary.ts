import type { AspectType, CheckerType, Finding, FindingSeverity, ReleaseReport } from '@qa/types';
// The verdict and problem modules only: the package index also exports Node-only code (fingerprints).
import { countsTowardVerdict, releaseVerdict } from '@qa/types/src/verdict.js';
import {
  ASPECT_CHECKERS,
  ASPECTS,
  aspectOfChecker,
  groupIntoProblems,
  plainTitleText,
  SEVERITY_ORDER,
} from '@qa/types/src/problems.js';

export interface SeverityCount {
  severity: FindingSeverity;
  count: number;
  /** e.g. "2 block release" */
  sentence: string;
}

export interface TopIssue {
  title: string;
  category: string;
  severity: FindingSeverity;
}

export interface ReportSummary {
  ready: boolean;
  /** The words on the stamp. */
  stamp: string;
  /** Why, in one sentence: "2 problems must be fixed first." */
  reason: string;
  headline: string;
  total: number;
  counts: SeverityCount[];
  top: TopIssue[];
  readOnly: boolean;
  /** Checks based on an AI guess the site didn't match: not issues until someone confirms them. */
  toConfirm: number;
  /** The findings behind the problems, for the developer details. */
  findings: number;
}

const SEVERITY_WORDS: Record<FindingSeverity, (n: number) => string> = {
  Blocker: (n) => `${n} ${n === 1 ? 'blocks' : 'block'} release`,
  Major: (n) => `${n} should be fixed before release`,
  Minor: (n) => `${n} minor`,
  Suggestion: (n) => `${n} ${n === 1 ? 'suggestion' : 'suggestions'}`,
};

export function category(f: Pick<Finding, 'checker' | 'id'> & { categoryTag?: string }): string {
  switch (f.checker) {
    case 'bug-detection':
      return 'Something broke';
    case 'spec-conformance':
      return 'Didn’t do what was expected';
    case 'design-standards':
      return 'Looks different from the design';
    case 'permission-matrix':
      return 'Who can see what';
    case 'security':
      return 'Keeping people’s data safe';
    case 'performance':
      return 'Speed and phones';
    case 'seo':
      if (f.categoryTag === 'MKT') return 'Marketing';
      if (f.categoryTag === 'GEO' || f.id.includes('GEO')) return 'AI search';
      if (f.categoryTag === 'AEO' || f.id.includes('AEO')) return 'AI answers';
      return 'Search';
    case 'ai-review':
      return 'How it looks and reads';
    case 'ux-quality':
      return f.id.includes('A11Y') ? 'Hard for some people to use' : 'Awkward to use';
    default:
      return 'Problem';
  }
}

export { ASPECT_CHECKERS, ASPECTS, plainTitleText };

export function aspectOf(checker: CheckerType): AspectType {
  return aspectOfChecker(checker);
}

/** Rewrites the report's technical finding titles as sentences; unknown shapes are only tidied. */
export function plainTitle(f: Pick<Finding, 'title'>): string {
  return plainTitleText(f.title);
}

export function summarizeReport(report: ReleaseReport): ReportSummary {
  const verdict = releaseVerdict(report.findings);
  const problems = groupIntoProblems(report.findings).filter((p) => !p.toConfirm);
  const total = verdict.total;

  const counts = SEVERITY_ORDER.map((severity) => ({ severity, count: verdict.counts[severity] }))
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, sentence: SEVERITY_WORDS[c.severity](c.count) }));

  const top = [...problems]
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.pages.length - a.pages.length
    )
    .slice(0, 3)
    .map((p) => ({ title: p.title, category: category(p.findings[0]), severity: p.severity }));

  return {
    ready: verdict.ready,
    stamp: verdict.stamp,
    reason: verdict.reason,
    headline:
      total === 0
        ? 'No problems found — looks ready!'
        : verdict.ready
          ? `${total} small ${total === 1 ? 'problem' : 'problems'} found`
          : `${total} ${total === 1 ? 'problem' : 'problems'} found`,
    total,
    counts,
    top,
    readOnly: report.scanMode === 'safe-public' || report.scanMode === 'read-only',
    toConfirm: verdict.toConfirm,
    findings: verdict.findings,
  };
}

/** Where a problem goes in the report: what to fix first. */
export type Bucket = 'must-fix' | 'should-fix' | 'suggestion' | 'to-confirm';

export const BUCKETS: Array<{ id: Bucket; title: string; intro: string }> = [
  {
    id: 'must-fix',
    title: 'Must fix before release',
    intro: 'These stop the site working for people, or put them at risk.',
  },
  { id: 'should-fix', title: 'Should fix', intro: 'Smaller problems people will notice.' },
  { id: 'suggestion', title: 'Suggestions', intro: 'Worth doing when you can.' },
  {
    id: 'to-confirm',
    title: 'To confirm',
    intro: 'The AI expected something the site didn’t do. They aren’t counted as problems until someone confirms them.',
  },
];

export function bucketOf(f: Pick<Finding, 'severity' | 'needsConfirmation'>): Bucket {
  if (f.needsConfirmation) return 'to-confirm';
  if (f.severity === 'Blocker' || f.severity === 'Major') return 'must-fix';
  return f.severity === 'Minor' ? 'should-fix' : 'suggestion';
}

/** One problem, and every place it was found. */
export interface ProblemGroup {
  key: string;
  title: string;
  category: string;
  /** The area it counts toward. */
  aspect: AspectType;
  /** Every area it touches, when more than one check found it (a missing title is also a search problem). */
  aspects: AspectType[];
  bucket: Bucket;
  severity: FindingSeverity;
  findings: Finding[];
  /** The pages it was found on, in the order first seen. */
  pages: string[];
}

/**
 * The report's problems, grouped by what to fix first, then by problem: the same problem on
 * several pages, or found by several checks, is one entry that lists them. It's the grouping the
 * verdict counts (see @qa/types problems.ts), so the numbers and the list always agree. Findings
 * marked as intended or false positives are left out.
 */
export function groupProblems(findings: Finding[]): Record<Bucket, ProblemGroup[]> {
  const result: Record<Bucket, ProblemGroup[]> = { 'must-fix': [], 'should-fix': [], suggestion: [], 'to-confirm': [] };
  for (const p of groupIntoProblems(findings)) {
    const bucket = bucketOf({ severity: p.severity, needsConfirmation: p.toConfirm });
    result[bucket].push({
      key: p.key,
      title: p.title,
      category: [...new Set(p.findings.map((f) => category(f)))].join(' · '),
      aspect: p.aspects[0],
      aspects: p.aspects,
      bucket,
      severity: p.severity,
      findings: p.findings,
      pages: p.pages,
    });
  }
  for (const list of Object.values(result)) {
    list.sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.pages.length - a.pages.length
    );
  }
  return result;
}

/** The path of an address ("/cart" from "http://localhost:3050/cart?x=1"), or null when it isn't one. */
function pathOf(address: string | undefined): string | null {
  if (!address) return null;
  try {
    return new URL(address, 'http://placeholder').pathname;
  } catch {
    return null;
  }
}

export interface PageResults {
  /** Every page to draw: the scan's pages, then any other page a test reached. */
  pages: Array<{ urlPath: string; title?: string }>;
  /** Every tested page: green with no problems, amber with minor ones, red with serious ones. */
  statuses: Record<string, { status: 'pass' | 'warn' | 'fail'; issuesCount: number }>;
}

/**
 * How each page did. A page counts as tested when a test that ran opened it or a problem was found
 * on it; pages never reached stay uncoloured, so a clean page and an untested one never look alike.
 */
export function pageResults(report: Pick<ReleaseReport, 'results' | 'findings' | 'siteMap'>): PageResults {
  const statuses: PageResults['statuses'] = {};
  for (const result of report.results || []) {
    if (result.status === 'Skipped') continue;
    for (const step of result.stepEvidence || []) {
      for (const address of [step.urlBefore, step.urlAfter]) {
        const page = pathOf(address);
        if (page && !statuses[page]) statuses[page] = { status: 'pass', issuesCount: 0 };
      }
    }
  }
  for (const f of report.findings) {
    if (!countsTowardVerdict(f)) continue;
    const page = f.where.urlPath || '/';
    const before = statuses[page] ?? { status: 'pass', issuesCount: 0 };
    const serious = f.severity === 'Blocker' || f.severity === 'Major';
    statuses[page] = {
      status: serious || before.status === 'fail' ? 'fail' : 'warn',
      issuesCount: before.issuesCount + 1,
    };
  }
  const pages: PageResults['pages'] = (report.siteMap?.pages || []).map((p) => ({
    urlPath: p.urlPath,
    title: p.title,
  }));
  for (const page of Object.keys(statuses)) if (!pages.some((p) => p.urlPath === page)) pages.push({ urlPath: page });
  return { pages, statuses };
}

/**
 * A finding as a Markdown bug report, for pasting into a tracker: what happened, where, how to
 * see it again, and what the console said.
 */
export function bugReportMarkdown(f: Finding, targetUrl: string): string {
  const lines = [
    `### ${plainTitle(f)}`,
    ``,
    `- **Site:** ${targetUrl}`,
    `- **Page:** \`${f.where.urlPath}\` at ${f.where.breakpoint}, as ${f.where.role}`,
    `- **How serious:** ${f.severity}`,
    f.where.cssSelector || f.where.dataTestId ? `- **Element:** \`${f.where.cssSelector || f.where.dataTestId}\`` : '',
    `- **Check:** ${f.checker} (${f.id})`,
    ``,
    `**Expected:** ${f.expectedVsActual.expected}`,
    ``,
    `**Actual:** ${f.expectedVsActual.actual}`,
  ];
  if (f.stepsToReproduce?.length) {
    lines.push('', '**Steps to reproduce**', '', ...f.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`));
  }
  const consoleLines = (f.evidence.consoleLogs || []).map((c) => c.text).filter(Boolean);
  if (consoleLines.length) lines.push('', '**Console errors**', '', '```', ...consoleLines, '```');
  if (f.resolution) lines.push('', `**Suggested fix:** ${f.resolution}`);
  lines.push('', 'After the fix, run the check-up again on the same address. This finding should no longer appear.');
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n');
}

/** A Playwright test that walks the finding's steps, for when the core wrote no repro script. */
export function playwrightFromSteps(f: Finding, targetUrl: string): string {
  const steps = (f.stepsToReproduce || []).map((s) => `  // ${s.replace(/\*\//g, '* /')}`).join('\n');
  const escaped = plainTitle(f).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `import { test, expect } from '@playwright/test';

test('${f.id}: ${escaped}', async ({ page }) => {
  await page.goto(new URL('${f.where.urlPath.replace(/'/g, "\\'")}', '${targetUrl.replace(/'/g, "\\'")}').toString());
${steps || '  // Open the page and look for the problem.'}
  // Expected: ${f.expectedVsActual.expected.replace(/\n/g, ' ')}
  // Actual:   ${f.expectedVsActual.actual.replace(/\n/g, ' ')}
});
`;
}

/** Why a problem in each area matters to the people using the site, in one plain sentence. */
const WHY_BY_ASPECT: Record<AspectType, string> = {
  Works: 'People hit an error, or can’t finish what they came to do.',
  Accessible:
    'Some people, such as those using a screen reader, a keyboard or large text, can’t use this part of the site.',
  'Fast and mobile': 'People on phones get a slow, cramped or broken page, and many leave.',
  Findable: 'Fewer people find the site through search engines and AI assistants.',
  Secure: 'People’s data or accounts could be put at risk.',
  'Looks and reads well': 'The page looks unfinished or is hard to read, which costs trust.',
};

/** Sharper reasons for problems people see often. */
const WHY_BY_TITLE: Array<[RegExp, string]> = [
  [/too small to tap/i, 'Small buttons are easy to miss on a phone, so people tap the wrong thing or give up.'],
  [/contrast/i, 'Text that blends into its background is hard to read, especially outdoors or with poor eyesight.'],
  [
    /password|sign-in details/i,
    'Passwords in page addresses end up in browser history and server logs, where others can find them.',
  ],
  [
    /request to your site failed|crashed|error behind the scenes/i,
    'Something on the page broke, so people may see missing content or be unable to continue.',
  ],
  [/no way back or menu/i, 'People who land here get stuck, with no way to reach the rest of the site.'],
  [/wider than the screen/i, 'On a phone, people have to scroll sideways to read, which most won’t do.'],
  [/fit phone screens/i, 'Without it, phones show a tiny desktop page that people have to zoom to read.'],
  [
    /missing a title/i,
    'The browser tab, bookmarks, screen readers and search results all use the title to say what the page is.',
  ],
];

/** Why a problem matters, in one plain sentence. */
export function whyItMatters(group: Pick<ProblemGroup, 'title' | 'aspect'>): string {
  return WHY_BY_TITLE.find(([pattern]) => pattern.test(group.title))?.[1] ?? WHY_BY_ASPECT[group.aspect];
}

/**
 * How to fix a problem, in one plain sentence: the check's own advice when it reads as words, else
 * a pointer to the developer details below it.
 */
export function howToFix(group: Pick<ProblemGroup, 'findings'>, looksTechnical: (text: string) => boolean): string {
  const advice = group.findings
    .map((f) => f.resolution?.trim())
    .find((r): r is string => !!r && !looksTechnical(r) && r.length <= 240);
  return (
    advice ?? 'Ask a developer to look at “Details for developers” below: it says exactly where and what to change.'
  );
}

/** The kind of search problem, in words people know: search engines, AI answers, or AI search. */
export function searchKind(
  f: Pick<Finding, 'checker' | 'id'> & { categoryTag?: string }
): { label: string; hint: string } | null {
  const tag =
    f.categoryTag ||
    (f.id.includes('MKT')
      ? 'MKT'
      : f.id.includes('GEO')
        ? 'GEO'
        : f.id.includes('AEO')
          ? 'AEO'
          : f.checker === 'seo'
            ? 'SEO'
            : undefined);
  if (tag === 'MKT')
    return {
      label: 'Marketing',
      hint: 'The basics that bring visitors in and turn them into customers: share previews, a clear next step, contact details and analytics.',
    };
  if (tag === 'GEO')
    return {
      label: 'AI search',
      hint: 'How AI search tools, such as ChatGPT search or Perplexity, read and quote the site (GEO).',
    };
  if (tag === 'AEO')
    return { label: 'AI answers', hint: 'How answer engines and AI assistants pick answers from the site (AEO).' };
  if (tag === 'SEO')
    return { label: 'Search', hint: 'How search engines, such as Google, find and list the site (SEO).' };
  return null;
}
