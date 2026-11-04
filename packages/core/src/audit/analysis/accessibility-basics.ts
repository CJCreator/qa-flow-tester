import type { Page } from 'playwright';
import type { AccessibilityBasics, AuditFinding, AuditScale, Breakpoint, Finding, FindingSeverity } from '@qa/types';
import { UXQualityChecker } from '@qa/checkers';
import { findClaimWords } from '../documents/wording.js';
import type { FindingIdAllocator } from './finding-ids.js';

/**
 * Accessibility basics of a Sample Page (REQ-038). Runs the existing UX checker's axe scan (WCAG 2.0/2.1/2.2
 * A and AA tags) on the page the audit already loaded: no click, no fill, no navigation. Only the axe
 * violations become AuditFindings; tap targets and overflow belong to the phone layout (REQ-037).
 * Never says a page is accessible: it names the standard, the level and that the checks are automatic.
 */

/** Axe violations; not "needs review" items (F-A11Y-REVIEW-) and not the scan failure (F-A11Y-SCAN-FAILED-). */
const isAxeViolation = (f: Finding) =>
  f.id.startsWith('F-A11Y-') && !f.id.startsWith('F-A11Y-REVIEW-') && !f.id.startsWith('F-A11Y-SCAN-FAILED-');

/** Desktop width: the checker's tap-target rule runs only at 375px. */
const BREAKPOINT: Breakpoint = '1440px';

const IMPACT: Record<FindingSeverity, AuditScale> = {
  Blocker: 'high',
  Major: 'high',
  Minor: 'medium',
  Suggestion: 'low',
};

export interface AccessibilityBasicsOptions {
  /** The page's path on the audited site. */
  urlPath: string;
  /** The version's finding id series (AF-NNN). */
  ids: FindingIdAllocator;
  /** Makes the checker's finding ids unique per page. */
  testCaseId?: string;
  role?: string;
}

export interface AccessibilityBasicsResult {
  /** Null when the checks did not run: never a zero-violation result. */
  basics: AccessibilityBasics | null;
  findings: AuditFinding[];
  /** Why there are no basics, in plain words. */
  note?: string;
}

/** The axe rule id: the checker's title ends in "(<rule id>)". */
function axeRuleId(title: string): string {
  return /\(([a-z0-9-]+)\)\s*$/i.exec(title)?.[1] ?? 'axe';
}

/**
 * ADR 0018: axe's own wording can carry a claim word ("Safe clickable space..."). Drops each line or sentence
 * that does; `fallback` when nothing is left.
 */
function withoutClaimWords(text: string, fallback: string): string {
  if (!findClaimWords(text).length) return text;
  const kept = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((part) => part.trim() && !findClaimWords(part).length)
    .join(' ')
    .trim();
  return kept || fallback;
}

function notRun(urlPath: string): AccessibilityBasicsResult {
  return {
    basics: null,
    findings: [],
    note: `The accessibility checks did not run on ${urlPath}, so this page has not been checked.`,
  };
}

export async function accessibilityBasics(
  page: Page,
  opts: AccessibilityBasicsOptions
): Promise<AccessibilityBasicsResult> {
  let all: Finding[];
  try {
    all = await new UXQualityChecker().check(page, {
      testCaseId: opts.testCaseId,
      role: opts.role ?? 'visitor',
      breakpoint: BREAKPOINT,
      urlPath: opts.urlPath,
      enableAxe: true,
    });
  } catch {
    return notRun(opts.urlPath);
  }
  if (all.some((f) => f.id.startsWith('F-A11Y-SCAN-FAILED-'))) return notRun(opts.urlPath);

  const findings: AuditFinding[] = all.filter(isAxeViolation).map((f) => {
    const rule = axeRuleId(f.title);
    const finding: AuditFinding = {
      id: opts.ids.next(),
      rule,
      group: 'technical',
      area: 'accessibility',
      title: withoutClaimWords(f.title, `Automatic check "${rule}" found a problem`),
      detail: `On ${opts.urlPath}: ${withoutClaimWords(f.expectedVsActual.actual, `elements break the automatic check "${rule}".`)}`,
      suggestion: withoutClaimWords(f.resolution ?? '', 'Fix the elements named in this finding.'),
      impact: IMPACT[f.severity] ?? 'medium',
      // Most automatic findings are markup fixes: a text alternative, a label, a contrast value.
      effort: 'low',
      urlPath: opts.urlPath,
      sectionId: null,
      source: 'checker',
      severity: f.severity,
      findingId: f.id,
    };
    if (f.where.cssSelector) finding.target = f.where.cssSelector;
    return finding;
  });

  return {
    basics: {
      standard: 'WCAG 2.2',
      level: 'AA',
      method: 'automatic checks only',
      violations: findings.length,
      findingIds: findings.map((f) => f.id),
    },
    findings,
  };
}
