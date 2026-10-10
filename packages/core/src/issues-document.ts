import type { DocSource, FindingSeverity, IssueType, ReleaseReport, RoleNotTested } from '@qa/types';
import { ISSUE_TYPES, issueTypeOf } from '@qa/types';
import { codeSpan, sanitizeInline } from './findings-contract.js';
import { describeSource } from './source-wording.js';

/** One issue in the issues document. Text comes from the page and is sanitized when rendered. */
export interface Issue {
  id: string;
  title: string;
  severity: FindingSeverity;
  page: string;
  steps: string[];
  /** Evidence file paths, relative to the report folder. */
  evidence: string[];
  fix: string;
  docSource?: DocSource;
  type: IssueType;
}

export interface AccessTable {
  page: string;
  rows: Array<{ role: string; result: 'Can reach it' | 'Denied' }>;
}

export interface IssuesModel {
  rolesNotTested: RoleNotTested[];
  roles: Array<{ role: string; byType: Partial<Record<IssueType, Issue[]>> }>;
  /** Held out of the verdict until the person accepts them, per role. */
  judgement: Record<string, Issue[]>;
  /** Allowed versus denied roles for pages with an access issue. */
  accessTables: AccessTable[];
  documentedItems?: ReleaseReport['documentedItems'];
  pageCoverage?: ReleaseReport['pageCoverage'];
}

const SEVERITY_ORDER: FindingSeverity[] = ['Blocker', 'Major', 'Minor', 'Suggestion'];

function toIssue(f: ReleaseReport['findings'][number]): Issue {
  const evidence = [f.evidence?.screenshotPath, f.evidence?.baselineScreenshotPath, f.evidence?.currentScreenshotPath]
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/\\/g, '/'));
  return {
    id: f.id,
    title: f.title,
    severity: f.severity,
    page: f.where.urlPath,
    steps: f.stepsToReproduce ?? [],
    evidence: [...new Set(evidence)],
    fix: f.resolution,
    ...(f.docSource ? { docSource: f.docSource } : {}),
    type: issueTypeOf(f),
  };
}

const bySeverityThenPage = (a: Issue, b: Issue) =>
  SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
  a.page.localeCompare(b.page) ||
  a.id.localeCompare(b.id);

/**
 * The issues document's content, from the (already redacted) report. Order: role, then issue type
 * (`ISSUE_TYPES`), then severity, then page. Findings held out of the verdict are kept apart.
 */
export function buildIssuesModel(report: ReleaseReport): IssuesModel {
  const active = report.findings.filter((f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive');
  const counting = active.filter((f) => !f.needsConfirmation);
  const held = active.filter((f) => f.needsConfirmation && !f.judgementAccepted);

  const roleNames = [...new Set(counting.map((f) => f.where.role))].sort((a, b) => a.localeCompare(b));
  const roles = roleNames.map((role) => {
    const mine = counting.filter((f) => f.where.role === role).map(toIssue);
    const byType: Partial<Record<IssueType, Issue[]>> = {};
    for (const type of ISSUE_TYPES) {
      const group = mine.filter((i) => i.type === type).sort(bySeverityThenPage);
      if (group.length > 0) byType[type] = group;
    }
    return { role, byType };
  });

  const judgement: Record<string, Issue[]> = {};
  for (const f of held) {
    (judgement[f.where.role] ??= []).push(toIssue(f));
  }
  for (const list of Object.values(judgement)) list.sort(bySeverityThenPage);

  // Who can reach a page that some role should not: one row per tested role.
  const testedRoles = [...new Set([...report.results.map((r) => r.role), ...roleNames])]
    .filter((r) => !(report.rolesNotTested ?? []).some((n) => n.role === r))
    .sort((a, b) => a.localeCompare(b));
  const accessTables: AccessTable[] = [];
  if (testedRoles.length >= 2) {
    const accessIssues = counting.filter((f) => issueTypeOf(f) === 'Access');
    for (const page of [...new Set(accessIssues.map((f) => f.where.urlPath))].sort()) {
      const reached = new Set(accessIssues.filter((f) => f.where.urlPath === page).map((f) => f.where.role));
      accessTables.push({
        page,
        rows: testedRoles.map((role) => ({ role, result: reached.has(role) ? 'Can reach it' : 'Denied' })),
      });
    }
  }

  return {
    rolesNotTested: report.rolesNotTested ?? [],
    roles,
    judgement,
    accessTables,
    ...(report.documentedItems ? { documentedItems: report.documentedItems } : {}),
    ...(report.pageCoverage ? { pageCoverage: report.pageCoverage } : {}),
  };
}

const cell = (s: string) => sanitizeInline(s, 200).replace(/\|/g, '\\|');

/** The documented-items line, or nothing when the run had no document. */
export function documentedItemsLine(d: ReleaseReport['documentedItems']): string | null {
  if (!d) return null;
  const notFound = d.notFound.length;
  return `${d.reached} of ${d.total} documented items reached${notFound > 0 ? `; ${notFound} not found in the app` : ''}.`;
}

/** The "Roles not tested and why" block, shared by report.md and issues.md. */
export function rolesNotTestedLines(roles: RoleNotTested[]): string[] {
  if (roles.length === 0) return ['All roles were tested.', ''];
  return [...roles.map((r) => `- ${codeSpan(r.role)}: ${sanitizeInline(r.text, 300)}`), ''];
}

const SKIP_WHY: Record<NonNullable<ReleaseReport['pageCoverage']>['skipped'][number]['why'], string> = {
  'page-limit': 'stopped at the page limit',
  'did-not-load': 'did not load',
  robots: 'blocked by robots rules',
  'sign-in': 'behind a sign-in',
};

/** Plain-text coverage: the summary line, then one entry per skipped page. Empty when the run has no coverage. */
export function pageCoverageEntries(
  c: ReleaseReport['pageCoverage']
): { summary: string; skipped: Array<{ urlPath: string; why: string }> } | null {
  if (!c) return null;
  return {
    summary: `Pages found ${c.found}, reached ${c.reached}, skipped ${c.skipped.length}`,
    skipped: c.skipped.map((s) => ({ urlPath: s.urlPath, why: SKIP_WHY[s.why] ?? 'was not reached' })),
  };
}

/** The "Page coverage" block for issues.md; no lines when the run has no coverage. */
export function pageCoverageLines(c: ReleaseReport['pageCoverage']): string[] {
  const e = pageCoverageEntries(c);
  if (!e) return [];
  return [
    '## Page coverage',
    '',
    `${e.summary}.`,
    '',
    ...e.skipped.map((s) => `- ${codeSpan(s.urlPath)}: ${s.why}`),
    ...(e.skipped.length > 0 ? [''] : []),
  ];
}

function renderIssue(i: Issue, lines: string[]): void {
  lines.push(`#### ${sanitizeInline(i.title, 200)} (${i.severity})`);
  lines.push(`- **Page:** ${codeSpan(i.page)}`);
  if (i.docSource) lines.push(`- **Source:** ${sanitizeInline(describeSource(i.docSource), 200)}`);
  if (i.steps.length > 0) {
    lines.push('- **Steps:**');
    i.steps.forEach((s, n) => lines.push(`  ${n + 1}. ${sanitizeInline(s, 300)}`));
  }
  if (i.evidence.length > 0) lines.push(`- **Evidence:** ${i.evidence.map((p) => codeSpan(p)).join(', ')}`);
  lines.push(`- **Fix:** ${sanitizeInline(i.fix, 400)}`);
  lines.push('');
}

export function renderIssuesMarkdown(model: IssuesModel): string {
  const lines: string[] = ['# Issues', ''];
  lines.push('## Roles not tested and why', '');
  lines.push(...rolesNotTestedLines(model.rolesNotTested));
  const documented = documentedItemsLine(model.documentedItems);
  if (documented) lines.push(documented, '');
  lines.push(...pageCoverageLines(model.pageCoverage));

  for (const { role, byType } of model.roles) {
    lines.push(`## Role: ${codeSpan(role)}`, '');
    for (const type of ISSUE_TYPES) {
      const group = byType[type];
      if (!group) continue;
      lines.push(`### ${type}`, '');
      if (type === 'Access') {
        for (const t of model.accessTables) {
          lines.push(`Who can reach ${codeSpan(t.page)}:`, '', '| Role | Result |', '| :--- | :--- |');
          for (const row of t.rows) lines.push(`| ${cell(row.role)} | ${row.result} |`);
          lines.push('');
        }
      }
      for (const i of group) renderIssue(i, lines);
    }
  }
  if (model.roles.length === 0) lines.push('No issues were found.', '');

  const judgementRoles = Object.keys(model.judgement).sort((a, b) => a.localeCompare(b));
  if (judgementRoles.length > 0) {
    lines.push('## Needs your judgement', '');
    lines.push('These are not counted in the release verdict until you accept them.', '');
    for (const role of judgementRoles) {
      lines.push(`### Role: ${codeSpan(role)}`, '');
      for (const i of model.judgement[role]) renderIssue(i, lines);
    }
  }
  return lines.join('\n');
}
