/**
 * The complete Plan (ADR 0009): every page, Navigation Check, journey and check a run does. The
 * crawler gathers the facts, the AI Planner writes the Plan Items, and the Plan is exactly what runs.
 * Terms are defined in CONTEXT.md.
 */
import type { AIStage, Breakpoint, FindingSeverity, TestCaseExpectations, TestCaseStep } from './index.js';

/** Who planned a Plan Item: the AI, the Fixed-Rule Fallback when the AI couldn't, or the person. */
export type PlanItemSource = 'ai' | 'fallback' | 'person';

/**
 * Why the Fixed-Rule Fallback planned an item: the AI Request Budget ran out, the model stopped
 * before it answered, the AI service didn't answer, its answer couldn't be used, or there's no AI.
 */
export type FallbackReason = 'budget' | 'truncated' | 'no-answer' | 'unusable' | 'no-ai' | 'stopped' | 'cap';

/** Kinds of Plan Item beyond the ordinary test: a Denial Plan Item asserts a control is hidden from a role. */
export type PlanItemKind = 'denial';

/** Where a Plan Item was planned: while the Spider was still crawling, or after the crawl finished. */
export type PlanItemOrigin = 'while-crawling' | 'after-crawl';

/**
 * The Source of a Plan Item (ADR 0020): the Product Context document, section and requirement it came from.
 * Named `DocSource` because `source` already says who planned an item (`PlanItemSource`).
 */
export interface DocSource {
  document: string;
  /** Heading path inside the document, e.g. "4 > 4.1". */
  section?: string;
  requirementId?: string;
}

/** A documented item with no matching page or control in the app: reported as "Not found in app", not a failure. */
export interface PlanNotFound {
  id: string;
  docSource: DocSource;
  /** Roles the document says should have it. */
  roles: string[];
  /** Plain words: what was searched for and not found. */
  reason: string;
  skipped?: boolean;
}

/** A cap the person set on a Check-up's AI work. Either or both. */
export interface RunCap {
  requests?: number;
  dollars?: number;
}

/** What the AI service reports about its own limits. Every field optional: absent means not reported. */
export interface ProviderLimits {
  remainingRequests?: number;
  limitRequests?: number;
  requestsPerInterval?: number;
  intervalMs?: number;
  creditRemainingUsd?: number;
  /** Price per million tokens of the model in use. */
  pricePerMTokUsd?: { prompt: number; completion: number };
}

/** A link or navigation button on a page, as the crawler saw it. */
export interface PageLink {
  /** What a person would call it: its text or label. */
  name: string;
  /** Selector the runner can click. */
  selector: string;
  /** Where it goes: a path on the site, or a full address when it leaves the site. */
  to: string;
  /** Where it really ends up, when the site redirects `to` somewhere else. */
  landsOn?: string;
  /**
   * Where it ends up for each explorer, when that isn't `to`: a signed-out visitor who clicks
   * "My account" lands on the sign-in page, while a signed-in role reaches the account page.
   */
  landsOnBy?: Record<string, string>;
  /** It goes to another host. */
  leavesSite?: boolean;
  /** A button or script link: the crawler clicked it to learn where it goes. */
  scripted?: boolean;
  /** The part of the page it sits in, when that's a header, menu or footer. */
  landmark?: 'header' | 'nav' | 'footer';
  /** Narrow screen sizes where it's hidden, usually behind a menu button. */
  hiddenAt?: Breakpoint[];
  /** Who saw it: 'visitor' and/or role names (signed-in menus differ). */
  seenBy?: string[];
}

/** A menu button that narrow screens hide links behind, found by looking at a page at that size. */
export interface NarrowMenu {
  breakpoint: Breakpoint;
  selector: string;
  name: string;
}

/**
 * How a page is covered: tested on its own, tested as one of its Layout Group's Sample Pages,
 * covered by those samples, or promoted by the person to be tested on its own.
 */
export type PageCoverage = 'tested' | 'sample' | 'covered' | 'promoted';

/** One test the AI planned on a page, besides the visit that runs the graded checks. */
export interface PlanPageTest {
  id: string;
  /** What it checks, in plain words. */
  name: string;
  /** Who it runs as: the explorer whose view of the page it was planned from. */
  role: string;
  steps: TestCaseStep[];
  expectations?: TestCaseExpectations;
  source: PlanItemSource;
  skipped?: boolean;
  /** Why it can't run as planned, e.g. a step aimed at something the crawler never found. */
  needsHelp?: string[];
  /** It sends a form or changes data: on a live site it stays in the Plan but isn't run. */
  needsTestCopy?: boolean;
  /** The document section this item came from. */
  docSource?: DocSource;
  /** 'denial': asserts the control is not visible to this role. */
  kind?: PlanItemKind;
  /** Roles the AI proposed for the Source; the person confirms them in Plan Review. */
  proposedRoles?: string[];
  rolesConfirmed?: boolean;
  /** Severity the person chose for a mismatch with the Source. */
  docSeverity?: FindingSeverity;
  /** The person said the document is out of date: a mismatch becomes "Could not verify". */
  docStale?: boolean;
  origin?: PlanItemOrigin;
}

/** A page in the Plan. Every page the crawler found is listed. */
export interface PlanPage {
  id: string;
  urlPath: string;
  title: string;
  layoutGroup?: string;
  coverage: PageCoverage;
  /** The Sample Pages that stand for a covered page. */
  coveredBy?: string[];
  /** Who reaches it: 'visitor' and/or role names. */
  reachedBy: string[];
  /** The links a person clicks from the start page to get here, e.g. ["Products", "VitalWeave"]. */
  clickPath?: string[];
  /** No link on the site leads here. */
  unlinked?: boolean;
  screenshotPath?: string;
  /** What the AI planned to try on the page. */
  tests: PlanPageTest[];
  /** Who planned the page's tests. */
  source: PlanItemSource;
  /** Why fixed rules planned them, when they did. */
  fallbackReason?: FallbackReason;
  skipped?: boolean;
  /** The person added it by its address. */
  added?: boolean;
  isNew?: boolean;
  docSource?: DocSource;
  origin?: PlanItemOrigin;
}

/** A Navigation Check: click one link as a person would and land on a working page. */
export interface NavigationCheck {
  id: string;
  /** Plain words, e.g. "Header menu: “About” opens the About page". */
  name: string;
  /** The page the check starts from: the link's page, or for a shared menu, a page that has it. */
  startPage: string;
  /** A header, menu or footer link found on many pages: checked once for the whole site. */
  shared?: 'header' | 'nav' | 'footer';
  linkName: string;
  selector: string;
  /** A path on the site, or a full address for a link that leaves it. */
  to: string;
  /** Where the link really ends up when the site redirects it: the check expects to land there. */
  landsOn?: string;
  /** Where it ends up for each role, when that differs (a sign-in page for signed-out visitors). */
  landsOnBy?: Record<string, string>;
  /** It goes to another host: only checked for being broken, with one request. */
  leavesSite?: boolean;
  /** What the destination should show, when the AI could say. */
  expectation?: string;
  /** Opening the menu first, at the screen sizes where the link hides behind a menu button (`onlyAt`). */
  menuSteps?: TestCaseStep[];
  /** Screen sizes where the link is hidden and no menu button shows it: the check doesn't run there. */
  notAt?: Breakpoint[];
  roles: string[];
  source: PlanItemSource;
  /** Why fixed rules planned it, when they did. */
  fallbackReason?: FallbackReason;
  skipped?: boolean;
  isNew?: boolean;
}

/** A graded aspect that every tested page gets at every screen size: fixed, not planned. */
export interface PlanGradedCheck {
  id: string;
  name: string;
  description: string;
  /** Why it won't be graded this time, when it can't run (no AI requests left, not a public site). */
  notGraded?: string;
}

export interface PlanLayoutGroup {
  id: string;
  /** Plain words, e.g. "Pages like /products/…". */
  name: string;
  pages: string[];
  samples: string[];
}

/** AI requests the Plan needs, against what the AI key has left today. */
export interface AIRequestBudget {
  /** Requests the Plan was expected to need before planning started. */
  needed: number;
  /** Requests actually made, repairs included. */
  used: number;
  /** Free requests the key has left today after planning, when the AI service says. */
  left?: number;
  /** The key's free requests per day, when the AI service says. */
  limit?: number;
  /** About how many the visual review after the run will use. */
  visualReview?: number;
  /** Plan Items planned by fixed rules because the budget ran out. */
  overBudget?: number;
  /** Tokens used per stage (planning, repair, journeys…), for the developer details. */
  tokens?: Partial<Record<AIStage, AIStageUsage>>;
  /** How each model did: a model that keeps stopping before it answers is avoided next time. */
  models?: Record<string, AIModelOutcome>;
  /** The person's cap for this Check-up. */
  cap?: RunCap;
  /** About what the Plan will cost in dollars, only when the AI service reports a price. */
  estimatedUsd?: number;
  /** Dollars spent so far, from tokens used times the reported price. */
  spentUsd?: number;
  /** Requests allowed in flight at once, from the AI service's reported limits. */
  concurrency?: number;
}

/** Tokens one stage of AI work used, added up over its requests. */
export interface AIStageUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Requests cut off by the output allowance. */
  truncated: number;
}

/** Answers a model gave: usable, cut off before it answered, or failed outright. */
export interface AIModelOutcome {
  ok: number;
  truncated: number;
  failed: number;
}

/** Something in the Plan that won't run, and why. */
export interface PlanWontRun {
  itemId?: string;
  what: string;
  reason: string;
}

/** The approval summary: what will run, and every default applied, each linked to its items. */
export interface PlanSummary {
  /** Tests: Plan Items × roles × screen sizes. */
  tests: number;
  /** Pages visited. */
  pages: number;
  /** Pages listed, covered ones included. */
  pagesListed: number;
  screenSizes: Breakpoint[];
  lines: Array<{ text: string; itemIds: string[] }>;
  /** About how many minutes the tests take. */
  minutes?: number;
}

/** Another host the site links to: listed, its links checked for being broken, crawled if ticked. */
export interface PlanOtherHost {
  host: string;
  links: number;
  included?: boolean;
}

/** The Plan Items discovery produced, kept with the draft. */
export interface DraftPlan {
  pages: PlanPage[];
  navigation: NavigationCheck[];
  layoutGroups: PlanLayoutGroup[];
  otherHosts: PlanOtherHost[];
  budget?: AIRequestBudget;
  /** Some Plan Items were planned while the scan was still running. */
  plannedWhileCrawling?: boolean;
  /** Documented items with no page or control in the app. */
  notFound?: PlanNotFound[];
  documentedItems?: { reached: number; total: number };
}
