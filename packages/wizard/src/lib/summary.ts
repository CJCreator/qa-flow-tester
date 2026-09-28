import type { Finding, FindingSeverity, ReleaseReport } from '@qa/types';

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

function category(f: Finding): string {
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
    case 'ux-quality':
      return f.id.includes('A11Y') ? 'Hard for some people to use' : 'Awkward to use';
    default:
      return 'Issue';
  }
}

/** Rewrites the report's technical finding titles as sentences; unknown shapes are only tidied. */
export function plainTitle(f: Finding): string {
  const t = f.title;
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
  return t.replace(/^WCAG Violation:\s*/, '').replace(/\s*\([a-z0-9-]+\)$/i, '');
}

export function summarizeReport(report: ReleaseReport): ReportSummary {
  const untriaged = report.findings.filter((f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive');
  const active = untriaged.filter((f) => !f.needsConfirmation);
  const bySeverity = (s: FindingSeverity) => active.filter((f) => f.severity === s).length;
  const blockers = bySeverity('Blocker');
  const majors = bySeverity('Major');
  // Same rule as report.md: ready means nothing that blocks release and nothing serious.
  const ready = blockers === 0 && majors === 0;
  const total = active.length;

  const counts = SEVERITY_ORDER.map((severity) => ({ severity, count: bySeverity(severity) }))
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, sentence: SEVERITY_WORDS[c.severity](c.count) }));

  const top = [...active]
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .slice(0, 3)
    .map((f) => ({ title: plainTitle(f), category: category(f), severity: f.severity }));

  return {
    ready,
    stamp: ready ? 'Ready to release' : 'Not ready yet',
    headline:
      total === 0
        ? 'No issues found — looks ready!'
        : ready
          ? `${total} small ${total === 1 ? 'issue' : 'issues'} found`
          : `${total} ${total === 1 ? 'issue' : 'issues'} found`,
    total,
    counts,
    top,
    readOnly: report.scanMode === 'safe-public',
    toConfirm: untriaged.length - active.length,
  };
}
