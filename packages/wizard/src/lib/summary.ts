import type { AspectType, CheckerType, Finding, FindingSeverity, ReleaseReport } from '@qa/types';
// From its source: @qa/types' index pulls in node:crypto, which has no place in a browser bundle.
import { releaseVerdict } from '@qa/types/src/verdict.js';

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
}

const SEVERITY_ORDER: FindingSeverity[] = ['Blocker', 'Major', 'Minor', 'Suggestion'];

const SEVERITY_WORDS: Record<FindingSeverity, (n: number) => string> = {
  Blocker: (n) => `${n} ${n === 1 ? 'blocks' : 'block'} release`,
  Major: (n) => `${n} should be fixed before release`,
  Minor: (n) => `${n} minor`,
  Suggestion: (n) => `${n} ${n === 1 ? 'suggestion' : 'suggestions'}`,
};

export function category(f: Pick<Finding, 'checker' | 'id'>): string {
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
      return 'Being found in search';
    case 'ai-review':
      return 'How it looks and reads';
    case 'ux-quality':
      return f.id.includes('A11Y') ? 'Hard for some people to use' : 'Awkward to use';
    default:
      return 'Problem';
  }
}

/** The report's six areas, and the checks behind each (the same mapping as the grades). */
export const ASPECT_CHECKERS: Record<AspectType, CheckerType[]> = {
  Works: ['bug-detection', 'spec-conformance'],
  Accessible: ['ux-quality'],
  'Fast and mobile': ['performance'],
  Findable: ['seo'],
  Secure: ['security', 'permission-matrix'],
  'Looks and reads well': ['design-standards', 'ai-review'],
};

export const ASPECTS: AspectType[] = ['Works', 'Accessible', 'Fast and mobile', 'Findable', 'Secure', 'Looks and reads well'];

export function aspectOf(checker: CheckerType): AspectType {
  return ASPECTS.find((a) => ASPECT_CHECKERS[a].includes(checker)) ?? 'Works';
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
  if (/^Touch target too small/.test(t)) return 'A button is too small to tap easily on a phone';
  if (/^Dead End Page/.test(t)) return 'A page has no way back or menu to leave it';
  if (/^Horizontal page overflow/.test(t)) return 'The page is wider than the screen and scrolls sideways';
  if (/^Visual regression/.test(t)) return 'A screen looks different from its approved version';
  if (/^Design Token Mismatch/.test(t)) return 'A colour or shape doesn’t match the design';
  if ((m = t.match(/^URL did not match expected pattern:?\s*["']?(?:\^)?(.*?)(?:\$)?["']?$/i))) {
    const raw = m[1].replace(/\\\//g, '/').replace(/\/\.\*$/, '').replace(/\\[a-zA-Z0-9+*.]+/g, '').replace(/\/+$/, '');
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
  if (/All page content should be contained by landmarks/i.test(t) || /region/i.test(t)) {
    return 'Some page content is outside layout landmarks';
  }
  if (/Page should have title element/i.test(t) || /document-title/i.test(t)) {
    return 'The page is missing a title';
  }
  if (/Heading order should be sequential/i.test(t) || /heading-order/i.test(t)) {
    return 'Headings are out of order';
  }
  if (/Form elements must have labels/i.test(t) || /label/i.test(t)) {
    return 'A form field is missing a label';
  }
  return t.replace(/^WCAG Violation:\s*/i, '').replace(/\s*\([a-z0-9-]+\)$/i, '');
}

/** Rewrites the report's technical finding titles as sentences; unknown shapes are only tidied. */
export function plainTitle(f: Pick<Finding, 'title'>): string {
  return plainTitleText(f.title);
}

export function summarizeReport(report: ReleaseReport): ReportSummary {
  const verdict = releaseVerdict(report.findings);
  const active = report.findings.filter(
    (f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive' && !f.needsConfirmation
  );
  const total = verdict.total;

  const counts = SEVERITY_ORDER.map((severity) => ({ severity, count: verdict.counts[severity] }))
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, sentence: SEVERITY_WORDS[c.severity](c.count) }));

  const top = [...active]
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .slice(0, 3)
    .map((f) => ({ title: plainTitle(f), category: category(f), severity: f.severity }));

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
  };
}

/** Where a problem goes in the report: what to fix first. */
export type Bucket = 'must-fix' | 'should-fix' | 'suggestion' | 'to-confirm';

export const BUCKETS: Array<{ id: Bucket; title: string; intro: string }> = [
  { id: 'must-fix', title: 'Must fix before release', intro: 'These stop the site working for people, or put them at risk.' },
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
  aspect: AspectType;
  bucket: Bucket;
  severity: FindingSeverity;
  findings: Finding[];
  /** The pages it was found on, in the order first seen. */
  pages: string[];
}

/**
 * The report's problems, grouped by what to fix first, then by problem: the same problem on
 * several pages is one entry that lists the pages. Findings marked as intended or false positives
 * are left out.
 */
export function groupProblems(findings: Finding[]): Record<Bucket, ProblemGroup[]> {
  const groups = new Map<string, ProblemGroup>();
  for (const f of findings) {
    if (f.triageStatus === 'Intended' || f.triageStatus === 'False Positive') continue;
    const bucket = bucketOf(f);
    const title = plainTitle(f);
    const key = `${bucket}|${f.checker}|${title}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, title, category: category(f), aspect: aspectOf(f.checker), bucket, severity: f.severity, findings: [], pages: [] };
      groups.set(key, group);
    }
    group.findings.push(f);
    if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(group.severity)) group.severity = f.severity;
    for (const page of [f.where.urlPath, ...(f.seenAt?.pages || [])]) if (page && !group.pages.includes(page)) group.pages.push(page);
  }
  const result: Record<Bucket, ProblemGroup[]> = { 'must-fix': [], 'should-fix': [], suggestion: [], 'to-confirm': [] };
  for (const group of groups.values()) result[group.bucket].push(group);
  for (const list of Object.values(result)) {
    list.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.pages.length - a.pages.length);
  }
  return result;
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
  if (f.verifyCommand) lines.push('', `Check the fix with \`${f.verifyCommand}\`.`);
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
