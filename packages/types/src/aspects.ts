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

/**
 * The ten marketing signals of a Website Audit (REQ-015, FR-15), in report order. Trust signals are reviews
 * or ratings, testimonials and certifications; local signals are NAP, a map embed and LocalBusiness schema (Q-27).
 */
export const MARKETING_SIGNALS = [
  { key: 'on-page-seo', label: 'On-page SEO' },
  { key: 'schema', label: 'Schema (structured data)' },
  { key: 'internal-linking', label: 'Internal linking' },
  { key: 'social-tags', label: 'Social tags' },
  { key: 'analytics', label: 'Analytics and tags' },
  { key: 'ctas', label: 'Calls to action' },
  { key: 'lead-forms', label: 'Lead forms' },
  { key: 'click-to-call', label: 'Click-to-call' },
  { key: 'trust-signals', label: 'Trust signals' },
  { key: 'local-signals', label: 'Local signals (NAP and map)' },
] as const;

export type MarketingSignalKey = (typeof MARKETING_SIGNALS)[number]['key'];

/** The business name, address and phone a page shows, with the page it was read from (REQ-015 AC-4). */
export interface NapDetails {
  urlPath: string;
  name?: string;
  address?: string;
  phone?: string;
}

/**
 * One marketing signal and what the audit found: 'found' or 'not-found' on the pages read, or
 * 'not-checked' when no page could say. "Found" says it is there, never that it is good (ADR 0018).
 */
export interface MarketingSignal {
  key: MarketingSignalKey;
  label: string;
  status: 'found' | 'not-found' | 'not-checked';
  /** The pages it was found on (a tel: link's page for click-to-call); empty when not found. */
  pages: string[];
  /** What was found or missed, or why it was not looked for, in fixed wording. */
  detail: string;
  /** Local signals only: each NAP found, with its page. */
  nap?: NapDetails[];
  /** The audit findings behind it, when there are any. */
  findingIds?: string[];
}

/** The marketing basics, one line each, so a score is never all there is to read. */
export interface MarketingReview {
  /** The pages the basics were read from. */
  readPages: string[];
  checks: MarketingCheckResult[];
  /**
   * Website Audit: one entry per signal in `MARKETING_SIGNALS`, in that order. Absent in Check-up reports,
   * which list only `checks`.
   */
  signals?: MarketingSignal[];
}

export interface AspectScore {
  /** Null when none of the area's checks ran: it is "Not checked", never an A. */
  grade: AspectGrade | null;
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
  /** Capped at the worst area grade. Null when no area was checked. */
  overallGrade: AspectGrade | null;
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
  previousGrade?: AspectGrade | null;
  currentGrade: AspectGrade | null;
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
