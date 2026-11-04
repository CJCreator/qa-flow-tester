/**
 * Ranking of Website Audit findings (REQ-017, Q-14). Pure functions; no AI, no request.
 *
 * - `scoreFindings` fills impact and effort where the producer left them unset, from the finding's rule
 *   (`IMPACT_EFFORT_BY_RULE`), else its checker severity (`IMPACT_EFFORT_BY_SEVERITY`), else
 *   `DEFAULT_IMPACT_EFFORT`. A value the producer set is never changed.
 * - `rankFindings` orders by impact (high first), then lower effort, then page path, Section order, rule,
 *   target and the previous id, and numbers the result AF-001… in ranked order. Same input, same output.
 * - `checkCitations` reports findings citing a page that was not audited or a Section that page does not have.
 */
import { AUDIT_SCALE } from '@qa/types';
import type { AuditFinding, AuditScale, FindingSeverity, MarketingSignalKey } from '@qa/types';
import { formatFindingId } from '../analysis/finding-ids.js';

export interface ImpactEffort {
  impact: AuditScale;
  effort: AuditScale;
}

/** A finding as a producer may hand it over: impact and effort still to be scored. */
export type UnscoredAuditFinding = Omit<AuditFinding, 'impact' | 'effort'> & {
  impact?: AuditScale | null;
  effort?: AuditScale | null;
};

/** Marketing signal findings use the signal key as their rule (REQ-015). */
const MARKETING_DEFAULTS: Record<MarketingSignalKey, ImpactEffort> = {
  'on-page-seo': { impact: 'medium', effort: 'medium' },
  schema: { impact: 'medium', effort: 'medium' },
  'internal-linking': { impact: 'medium', effort: 'medium' },
  'social-tags': { impact: 'low', effort: 'low' },
  analytics: { impact: 'medium', effort: 'low' },
  ctas: { impact: 'high', effort: 'medium' },
  'lead-forms': { impact: 'high', effort: 'medium' },
  'click-to-call': { impact: 'medium', effort: 'low' },
  'trust-signals': { impact: 'medium', effort: 'medium' },
  'local-signals': { impact: 'medium', effort: 'medium' },
};

/** Default impact and effort of every fixed rule the analysis emits (Q-14, Q-26). */
export const IMPACT_EFFORT_BY_RULE: Readonly<Record<string, ImpactEffort>> = Object.freeze({
  'missing-title': { impact: 'high', effort: 'low' },
  'duplicate-title': { impact: 'medium', effort: 'low' },
  'missing-description': { impact: 'medium', effort: 'low' },
  'duplicate-description': { impact: 'low', effort: 'low' },
  'duplicate-content': { impact: 'medium', effort: 'high' },
  'no-h1': { impact: 'medium', effort: 'low' },
  'multiple-h1': { impact: 'low', effort: 'low' },
  'skipped-heading-level': { impact: 'low', effort: 'low' },
  'missing-alt': { impact: 'medium', effort: 'low' },
  'broken-link': { impact: 'high', effort: 'low' },
  'unlinked-page': { impact: 'medium', effort: 'low' },
  ...MARKETING_DEFAULTS,
});

/**
 * Checker findings without a rule entry: by severity. Both the tool's severities and axe's impact names
 * (critical, serious, moderate, minor) are understood, case-insensitively.
 */
export const IMPACT_EFFORT_BY_SEVERITY: Readonly<Record<string, ImpactEffort>> = Object.freeze({
  blocker: { impact: 'high', effort: 'medium' },
  critical: { impact: 'high', effort: 'medium' },
  major: { impact: 'high', effort: 'medium' },
  serious: { impact: 'high', effort: 'medium' },
  minor: { impact: 'medium', effort: 'low' },
  moderate: { impact: 'medium', effort: 'low' },
  suggestion: { impact: 'low', effort: 'low' },
} satisfies Record<Lowercase<FindingSeverity> | 'critical' | 'serious' | 'moderate', ImpactEffort>);

/** Neither the rule nor a severity is known (an AI finding, a new checker rule). */
export const DEFAULT_IMPACT_EFFORT: Readonly<ImpactEffort> = Object.freeze({ impact: 'medium', effort: 'medium' });

/** Rules whose finding is about the whole page (its title, description or heading outline): sectionId may be null. */
export const WHOLE_PAGE_RULES: ReadonlySet<string> = new Set([
  'missing-title',
  'duplicate-title',
  'missing-description',
  'duplicate-description',
  'no-h1',
  'multiple-h1',
  'skipped-heading-level',
]);

function own<T>(table: Readonly<Record<string, T>>, key: string | undefined): T | undefined {
  return key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** The default impact and effort for a finding: its rule, else its severity, else the plain default. */
export function defaultImpactEffort(finding: Pick<AuditFinding, 'rule' | 'severity'>): ImpactEffort {
  const byRule = own(IMPACT_EFFORT_BY_RULE, finding.rule);
  if (byRule) return { ...byRule };
  const bySeverity =
    typeof finding.severity === 'string' ? own(IMPACT_EFFORT_BY_SEVERITY, finding.severity.toLowerCase()) : undefined;
  if (bySeverity) return { ...bySeverity };
  return { ...DEFAULT_IMPACT_EFFORT };
}

/** New findings with impact and effort filled where unset (undefined or null). Set values are kept as they are. */
export function scoreFindings(findings: ReadonlyArray<UnscoredAuditFinding | AuditFinding>): AuditFinding[] {
  return findings.map((f) => {
    const defaults = defaultImpactEffort(f);
    return {
      ...f,
      impact: f.impact ?? defaults.impact,
      effort: f.effort ?? defaults.effort,
    };
  });
}

const RANK: Record<AuditScale, number> = { high: 0, medium: 1, low: 2 };

function scaleRank(value: unknown, field: 'impact' | 'effort', id: string): number {
  if (typeof value !== 'string' || !(AUDIT_SCALE as readonly string[]).includes(value)) {
    throw new TypeError(`Finding ${id} has no valid ${field} (high, medium or low).`);
  }
  return RANK[value as AuditScale];
}

/** Plain code-unit comparison: the same in every locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Section ids are "s1", "s2"… in page order: compare by number, whole-page (null) first. */
function compareSection(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const na = /^s(\d+)$/.exec(a);
  const nb = /^s(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return compareText(a, b);
}

export interface RankOptions {
  /** The number of the first id (default 1): AF-001. */
  start?: number;
}

export interface RankedFindings {
  findings: AuditFinding[];
  /** Previous id to its new id, so lists that cite findings (SEO basics, roadmap…) can follow the renumbering. */
  idMap: Map<string, string>;
}

/** `rankFindings`, also returning how each previous id was renumbered. */
export function rankFindingsWithIdMap(
  findings: ReadonlyArray<UnscoredAuditFinding | AuditFinding>,
  options: RankOptions = {}
): RankedFindings {
  const start = options.start ?? 1;
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new RangeError(`Finding numbers start at a whole number of at least 1 (got ${start})`);
  }
  const keyed = scoreFindings(findings).map((f) => ({
    f,
    impact: scaleRank(f.impact, 'impact', f.id),
    effort: scaleRank(f.effort, 'effort', f.id),
  }));
  keyed.sort(
    (a, b) =>
      a.impact - b.impact ||
      b.effort - a.effort ||
      compareText(a.f.urlPath, b.f.urlPath) ||
      compareSection(a.f.sectionId, b.f.sectionId) ||
      compareText(a.f.rule, b.f.rule) ||
      compareText(a.f.target ?? '', b.f.target ?? '') ||
      compareText(a.f.id, b.f.id)
  );
  const idMap = new Map<string, string>();
  const ranked = keyed.map(({ f }, i) => {
    const id = formatFindingId(start + i);
    if (!idMap.has(f.id)) idMap.set(f.id, id);
    return { ...f, id };
  });
  return { findings: ranked, idMap };
}

/**
 * A new list ordered by impact (high first), then lower effort, then page path, Section order and rule,
 * numbered AF-001… in that order. Unset impact or effort is scored first; the input is not changed.
 */
export function rankFindings(
  findings: ReadonlyArray<UnscoredAuditFinding | AuditFinding>,
  options: RankOptions = {}
): AuditFinding[] {
  return rankFindingsWithIdMap(findings, options).findings;
}

export type CitationProblemKind = 'unknown-page' | 'unknown-section' | 'missing-section';

export interface CitationProblem {
  findingId: string;
  kind: CitationProblemKind;
  /** The page cited. */
  urlPath: string;
  /** The Section cited (null for 'missing-section'). */
  sectionId: string | null;
}

/** A page as it is cited: its path and the ids of its Sections (AuditPage or PageContent). */
export interface CitablePage {
  urlPath: string;
  sections: ReadonlyArray<{ id: string }>;
}

/**
 * Findings whose citation does not hold (REQ-017 AC-2): the page (or any page in `pages`) was not audited,
 * the Section is not one of that page's, or the Section is missing (null) on a finding that is not about
 * the whole page (`WHOLE_PAGE_RULES`).
 */
export function checkCitations(
  findings: ReadonlyArray<Pick<AuditFinding, 'id' | 'rule' | 'urlPath' | 'sectionId' | 'pages'>>,
  pages: ReadonlyArray<CitablePage>
): CitationProblem[] {
  const sectionsByPath = new Map<string, Set<string>>();
  for (const page of pages) sectionsByPath.set(page.urlPath, new Set(page.sections.map((s) => s.id)));

  const problems: CitationProblem[] = [];
  for (const f of findings) {
    const sections = sectionsByPath.get(f.urlPath);
    if (!sections) {
      problems.push({ findingId: f.id, kind: 'unknown-page', urlPath: f.urlPath, sectionId: f.sectionId });
    } else if (f.sectionId === null || f.sectionId === undefined) {
      if (!WHOLE_PAGE_RULES.has(f.rule)) {
        problems.push({ findingId: f.id, kind: 'missing-section', urlPath: f.urlPath, sectionId: null });
      }
    } else if (!sections.has(f.sectionId)) {
      problems.push({ findingId: f.id, kind: 'unknown-section', urlPath: f.urlPath, sectionId: f.sectionId });
    }
    for (const other of f.pages ?? []) {
      if (other !== f.urlPath && !sectionsByPath.has(other)) {
        problems.push({ findingId: f.id, kind: 'unknown-page', urlPath: other, sectionId: null });
      }
    }
  }
  return problems;
}
