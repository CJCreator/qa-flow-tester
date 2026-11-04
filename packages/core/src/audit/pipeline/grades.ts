/**
 * Deterministic area grades of a Website Audit (REQ-016): the A-F grade of each of the six AUDIT_AREAS, for a
 * Sample Page and for the whole site. The grade comes from the Check-up's scoring (`calculateSiteAspectGrades`),
 * never from the AI. An area nothing checked has no grade (null): never an A.
 *
 * Mapping (each area is scored on its own, so two areas never share deductions):
 *   search-ranking -> Findable, marketing -> Findable, usability -> Works, content -> Looks and reads well,
 *   accessibility -> Accessible, speed -> Fast and mobile.
 * Audit findings are turned into scoring Findings: the checker severity when there is one, else from impact
 * (high -> Major, medium -> Minor, low -> Suggestion); repeats of one rule count once with the spread multiplier.
 * Speed has no rule findings: its grade is the PageSpeed lab performance score through `scoreToGrade`
 * (the worse of that and any speed findings), null when no lab value was measured.
 */
import type {
  AspectGrade,
  AspectType,
  AuditArea,
  AuditFinding,
  AuditScale,
  Finding,
  FindingSeverity,
  PageSpeed,
} from '@qa/types';
import { ASPECT_CHECKERS, AUDIT_AREAS } from '@qa/types';
import { calculateSiteAspectGrades, scoreToGrade } from '../../scoring.js';
import type { AreaGrades } from '../ai/assessment.js';

/** The Check-up aspect whose scoring rules grade each audit area. */
export const AREA_ASPECT: Readonly<Record<AuditArea, AspectType>> = Object.freeze({
  'search-ranking': 'Findable',
  marketing: 'Findable',
  usability: 'Works',
  content: 'Looks and reads well',
  accessibility: 'Accessible',
  speed: 'Fast and mobile',
});

const SEVERITY_BY_IMPACT: Record<AuditScale, FindingSeverity> = {
  high: 'Major',
  medium: 'Minor',
  low: 'Suggestion',
};

const GRADE_RANK: Record<AspectGrade, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

/** Which areas were checked at all; an unchecked area is graded null. */
export type CheckedAreas = Readonly<Record<AuditArea, boolean>>;

function toScoringFinding(f: AuditFinding, aspect: AspectType): Finding {
  return {
    id: f.id,
    severity: f.severity ?? SEVERITY_BY_IMPACT[f.impact] ?? 'Minor',
    checker: ASPECT_CHECKERS[aspect][0],
    aspect,
    // One recurring rule is one problem, spread over its pages (as the Check-up groups by title).
    issueKey: f.rule,
    title: f.title,
    where: { urlPath: f.urlPath, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: f.detail },
    stepsToReproduce: [],
    evidence: {},
    resolution: f.suggestion,
    ...(f.advisory || f.source === 'ai' ? { advisory: true } : {}),
  };
}

/** The lab performance score (0-100) of a page, or null when not measured. */
export function labPerformanceScore(speed: PageSpeed | undefined): number | null {
  if (!speed || speed.lab.status !== 'measured') return null;
  const value = speed.lab.values.find((v) => v.metric === 'performance-score');
  return value && Number.isFinite(value.value) ? value.value : null;
}

function worse(a: AspectGrade | null, b: AspectGrade | null): AspectGrade | null {
  if (a === null) return b;
  if (b === null) return a;
  return GRADE_RANK[a] >= GRADE_RANK[b] ? a : b;
}

/**
 * The grade of every area from `findings` (already scored: impact and effort set). `speedScore` is the lab
 * performance score to grade speed by (the worst Sample Page's, site-wide); null leaves speed ungraded.
 */
export function areaGrades(
  findings: readonly AuditFinding[],
  checked: CheckedAreas,
  speedScore: number | null
): Required<AreaGrades> {
  const out = {} as Record<AuditArea, AspectGrade | null>;
  for (const area of AUDIT_AREAS) {
    const aspect = AREA_ASPECT[area];
    const own = findings.filter((f) => f.area === area);
    const isChecked = area === 'speed' ? speedScore !== null || (checked.speed && own.length > 0) : checked[area];
    if (!isChecked) {
      out[area] = null;
      continue;
    }
    const scored = calculateSiteAspectGrades(
      own.map((f) => toScoringFinding(f, aspect)),
      { checkersRun: ASPECT_CHECKERS[aspect] }
    );
    let grade = scored.aspects[aspect].grade;
    if (area === 'speed') {
      const fromScore = speedScore === null ? null : scoreToGrade(Math.max(0, Math.min(100, speedScore)));
      grade = own.length > 0 ? worse(grade, fromScore) : fromScore;
    }
    out[area] = grade;
  }
  return out;
}
