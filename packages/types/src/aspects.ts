import type { FindingSeverity, Breakpoint } from './test-case.js';

export type AspectType = 'Works' | 'Accessible' | 'Fast and mobile' | 'Findable' | 'Secure' | 'Looks and reads well';

export type AspectGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface AspectSubBreakdown {
  score: number;
  issueCount: number;
  status: 'Clean' | 'Warning' | 'Failing';
  /** False when nothing was looked at, so the score is not a pass. Absent in older reports: read it as checked. */
  checked?: boolean;
}

/** One marketing basic and what the run found. */
export interface MarketingCheckResult {
  key: string;
  label: string;
  /** 'fact': it is there or it isn't. 'opinion': a suggestion that depends on what kind of site this is. */
  kind: 'fact' | 'opinion';
  status: 'ok' | 'gap' | 'not-checked';
  /** Where it was found or missed, or why it wasn't looked for. */
  detail: string;
  findingId?: string;
}

/** The marketing basics, one line each, so a score is never all there is to read. */
export interface MarketingReview {
  /** The pages the basics were read from. */
  readPages: string[];
  checks: MarketingCheckResult[];
}

export interface AspectScore {
  grade: AspectGrade;
  score: number;
  findings: string[];
  /**
   * False when none of the aspect's checks ran: it's shown as "Not checked" and left out of the
   * overall score. Absent on reports made before this was recorded.
   */
  checked?: boolean;
  /** Sub-category breakdown (e.g. SEO, AEO, GEO under Findable). */
  subBreakdown?: {
    seo?: AspectSubBreakdown;
    aeo?: AspectSubBreakdown;
    geo?: AspectSubBreakdown;
    marketing?: AspectSubBreakdown;
    [key: string]: AspectSubBreakdown | undefined;
  };
}

export interface SiteAspectGrades {
  aspects: Record<AspectType, AspectScore>;
  overallGrade: AspectGrade;
  overallScore: number;
}

export interface RankedRecommendation {
  id: string;
  category: 'quick-win' | 'bigger-change';
  title: string;
  aspect: AspectType;
  severity: FindingSeverity;
  effort: 'Low' | 'Medium' | 'High';
  impact: 'Low' | 'Medium' | 'High';
  affectedPages: string[];
  findingIds: string[];
  screenshotPath?: string;
  summary: string;
  suggestedFix: string;
  isAiGenerated?: boolean;
}

export interface AspectGradeDelta {
  previousGrade?: AspectGrade;
  currentGrade: AspectGrade;
  previousScore?: number;
  currentScore: number;
}

export interface SiteHistoryDiff {
  previousRunId?: string;
  previousTimestamp?: string;
  aspectDeltas: Record<AspectType, AspectGradeDelta>;
  newFindingFingerprints: string[];
  fixedFindingFingerprints: string[];
  openFindingFingerprints: string[];
}

/** One page's speed number from the throttled repeat-load measurement, kept in site history. */
export interface PageSpeedSample {
  metric: 'lcp' | 'domReady';
  /** Rounded to whole milliseconds. */
  ms: number;
  loads: number;
  throttled: boolean;
  /** Id of the simulated phone/network profile, so only like is compared with like. */
  profile: string;
}

/** Keyed by `role|breakpoint|urlPath`. */
export type PageSpeedMap = Record<string, PageSpeedSample>;

/**
 * A page that got slower than the last check-up by both 20% and 300 ms. A note beside the
 * findings, not a finding: it never changes grades, the verdict or the CI gate.
 */
export interface SlowerThanLastTime {
  urlPath: string;
  role: string;
  breakpoint: Breakpoint;
  aspect: 'Fast and mobile';
  checker: 'performance';
  metric: 'lcp' | 'domReady';
  previousMs: number;
  currentMs: number;
  increaseMs: number;
  increasePercent: number;
  previousRunId?: string;
  previousTimestamp?: string;
  loads: number;
  throttled: boolean;
  summary: string;
}

/** Pages and journeys of a planned run, for drawing the site map in a report. */
export interface SiteMapSummary {
  siteType?: string;
  pages: Array<{
    urlPath: string;
    title: string;
    layoutGroup?: string;
    screenshotPath?: string;
    isNew?: boolean;
    reachedBy?: string[];
  }>;
  journeys: Array<{
    id: string;
    name: string;
    reason?: string;
    /** The pages the journey passes through, in order. */
    pages: string[];
    needsTestCopy?: boolean;
    skipped?: boolean;
    source?: 'ai' | 'fallback' | 'user';
  }>;
}

export interface VisitedPage {
  urlPath: string;
  title: string;
  /** Pages built from the same template share a group, e.g. "layout-2" for every product page. */
  layoutGroup: string;
  screenshotPath?: string;
}
