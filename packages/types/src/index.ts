/**
 * Pre-Release Readiness Checker - Core Types & Schemas
 */

export type FindingSeverity = 'Blocker' | 'Major' | 'Minor' | 'Suggestion';

export type CheckerType =
  | 'bug-detection'
  | 'spec-conformance'
  | 'design-standards'
  | 'ux-quality'
  | 'permission-matrix'
  | 'security'
  | 'performance'
  | 'seo'
  | 'ai-review';

export type TriageStatus = 'Pending' | 'Confirmed' | 'Intended' | 'False Positive' | 'Resolved';

export type Breakpoint = '375px' | '768px' | '1440px';

export type TestPointStatus = 'Passed' | 'Failed' | 'Blocked' | 'Skipped' | 'Could not verify';

export interface TestCaseStep {
  /** 'check-link' fetches `value` (a link's address) once and fails only if the link is broken; nothing is clicked. */
  action: 'click' | 'fill' | 'select' | 'check' | 'navigate' | 'wait' | 'check-link';
  selector?: string; // e.g. "[data-testid=new-invoice-btn]"
  value?: string;
  name: string;
  /**
   * A step that may not be possible, e.g. a button that only shows on wide screens. If it can't
   * be done it is recorded as skipped, not as a failure, and the next steps still run.
   */
  optional?: boolean;
  /** Only done at these screen sizes, e.g. opening the menu that narrow screens hide their links behind. */
  onlyAt?: Breakpoint[];
}

/**
 * Where an expectation or rule came from. Only 'observed' and 'user' ones can fail a site; an
 * 'ai-guess' that doesn't match is reported as "Could not verify" until someone confirms it.
 * Absent means 'user' (hand-written spec files).
 */
export type RuleOrigin = 'observed' | 'ai-guess' | 'user';

export interface TestCaseExpectations {
  origin?: RuleOrigin;
  /**
   * Behaviour check for a guessed validation rule: after the steps, an error message or an
   * invalid-field marker should appear. The exact wording isn't checked.
   */
  validationError?: {
    field: string;
    selector?: string;
    description?: string;
  };
  url?: {
    pattern: string;
    description?: string;
  };
  text?: {
    contains?: string;
    notContains?: string;
    description?: string;
  };
  apiCall?: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    status: number;
  };
  elementState?: {
    selector: string;
    visible?: boolean;
    disabled?: boolean;
    description?: string;
  };
  /** After the steps, the page is no longer `fromPath`, e.g. a form led to a confirmation page. */
  navigatesAway?: { fromPath: string; description?: string };
  /** After the steps, a success message shows on the page and no error does. */
  successMessage?: { description?: string };
  /** After the steps, the page opened and works: no error status, not blank, not a "not found" page. */
  pageWorks?: { description?: string };
}

export interface ValidationRule {
  field: string;
  selector?: string;
  min?: number;
  max?: number;
  pattern?: string;
  expectedError: string;
  origin?: RuleOrigin;
}

export interface TestCase {
  id: string; // e.g., "TC-001"
  requirementId?: string; // e.g., "REQ-INV-01"
  flowId: string; // e.g., "create-invoice"
  name?: string;
  role: string; // e.g., "manager", "admin", "viewer"
  startPage: string; // e.g., "/invoices"
  steps: TestCaseStep[];
  expectations: TestCaseExpectations;
  validationRules?: ValidationRule[];
  edgeCases?: {
    testBackButton?: boolean;
    testRefresh?: boolean;
    testEmptyInputs?: boolean;
  };
  /**
   * The kind of Plan Item this test runs. It decides which checkers run afterwards: a page visit or
   * a journey gets them all; a test on a page gets the ones about what it did (errors, what it
   * expected, accessibility of the state it left); a Navigation Check gets errors and whether it
   * landed; a link check only its own result. Absent means all of them, as for hand-written specs.
   */
  kind?: 'page' | 'page-test' | 'navigation' | 'link' | 'journey';
  /** Only run at these screen sizes. Absent means every size the run uses. */
  breakpoints?: Breakpoint[];
  /** The Plan Item this test runs, so a report can be matched back to the plan. */
  planItemId?: string;
}

export interface SpecFile {
  version?: string;
  product?: string;
  testCases: TestCase[];
}

export interface ConsoleEntry {
  type: 'error' | 'warning' | 'log' | 'info';
  text: string;
  /** Where the message came from: the script, or the file that failed to load. */
  url?: string;
  timestamp: number;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  durationMs?: number;
  timestamp: number;
}

export interface StepEvidence {
  stepIndex: number;
  stepName: string;
  action: string;
  urlBefore: string;
  urlAfter: string;
  screenshotPath?: string;
  domSnapshotPath?: string;
  consoleErrors: ConsoleEntry[];
  failedRequests: NetworkEntry[];
  durationMs: number;
  passed: boolean;
  error?: string;
}

export interface SourceLocation {
  file: string;
  line?: number;
  matchSnippet?: string;
}

export interface Finding {
  id: string; // e.g. "F-001"
  testCaseId?: string;
  flowId?: string;
  severity: FindingSeverity;
  checker: CheckerType;
  title: string;
  where: {
    urlPath: string;
    role: string;
    breakpoint: Breakpoint;
    dataTestId?: string;
    cssSelector?: string;
  };
  sourceLocation?: SourceLocation;
  expectedVsActual: {
    expected: string;
    actual: string;
  };
  stepsToReproduce: string[];
  reproScriptPath?: string;
  evidence: {
    screenshotPath?: string;
    domSnapshotPath?: string;
    videoPath?: string;
    networkLogs?: NetworkEntry[];
    consoleLogs?: ConsoleEntry[];
    /** Every element that broke the same rule on this page, when more than one did. */
    allTargets?: string[];
    /** Numbers behind a measured finding, such as per-run timings and their spread. */
    measurements?: Record<string, unknown>;
  };
  resolution: string;
  triageStatus?: TriageStatus;
  /** Why someone marked it intended or not a problem, when they said. */
  triageReason?: string;
  /** True when this finding originated from a request/resource on a different origin than the page under test (e.g. third-party analytics, fonts, CDNs) rather than a first-party defect. */
  thirdParty?: boolean;
  /**
   * An AI guess the site didn't match. Shown as "Could not verify" (never as a defect) until
   * someone confirms or rejects the rule behind it.
   */
  needsConfirmation?: boolean;
  /** Sub-category tag for fine-grained categorization, such as 'SEO', 'AEO', or 'GEO' under Findable. */
  categoryTag?: 'SEO' | 'AEO' | 'GEO' | 'MKT';
  /** The area it counts toward, when not its checker's: a missing viewport tag is about phones. */
  aspect?: AspectType;
  /** The same problem found by another check has the same key, so the report lists it once (see problems.ts). */
  issueKey?: string;
  /** How many times the same problem was seen in this run, when more than once. */
  occurrences?: number;
  /** Where else the same problem was seen: pages, widths, roles and test points. */
  seenAt?: { pages: string[]; breakpoints: Breakpoint[]; roles: string[]; testCaseIds: string[] };
}

export interface PermissionRule {
  target: string; // urlPath e.g. "/settings/billing" or action name
  roles: Record<string, 'allow' | 'deny'>;
}

export type PermissionMatrix = PermissionRule[];

export interface RoleCredential {
  role: string;
  username: string;
  password?: string;
  token?: string;
  loginPath?: string;
}

export interface ProductProfile {
  name: string;
  productId: string;
  owner?: string;
  defaultBaseUrl?: string;
  roles: RoleCredential[];
  forbiddenActions?: string[];
  houseStandards?: Record<string, unknown>;
  /** Path to design-tokens.json (exported from Figma) for Tier 1 token checks. */
  figmaTokensFile?: string;
  /** Directory of approved `<testCaseId>-<breakpoint>.png` baselines for Tier 2 visual diffs. */
  visualBaselineDir?: string;
  /** Fraction of pixels (0–1) allowed to differ from a baseline. Default 0.01. */
  visualDiffMaxPercent?: number;
  permissionMatrix?: PermissionMatrix;
  permissionMatrixFile?: string;
}

export interface PreFlightResult {
  ok: boolean;
  url: string;
  statusCode?: number;
  loginReachable?: boolean;
  roleAuthResults: Record<string, boolean>;
  roleStorageStates?: Record<string, string>;
  /** The page each role landed on after signing in; exploring as that role starts there. */
  roleLandingPaths?: Record<string, string>;
  error?: string;
}

export interface TestPointResult {
  testCaseId: string;
  flowId: string;
  role: string;
  status: TestPointStatus;
  durationMs: number;
  findings: Finding[];
  stepEvidence: StepEvidence[];
  error?: string;
  /** Session recording, kept only for failed test points. */
  videoPath?: string;
  /** What the site was seen doing, e.g. the error message it showed. Becomes an 'observed' rule. */
  observations?: string[];
  /** Why a Skipped test point wasn't run, in plain words, e.g. "Needs a test copy". */
  skipReason?: string;
  /** The screen width it ran at. */
  breakpoint?: Breakpoint;
  /** Every check that ran, and how it went, so a report can list the passed ones too. */
  checks?: Array<{ checker: CheckerType; name: string; outcome: 'passed' | 'failed' | 'could-not-verify' }>;
  /**
   * Set when the steps failed at first and the flow passed on a clean second attempt. It still
   * counts as passed, but is shown as unreliable.
   */
  retry?: RetryTelemetryEntry;
}

export interface RunCoverage {
  totalTestPoints: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  couldNotVerify: number;
  /** Test points that failed once, then passed on a clean retry. Already counted in `passed`. */
  flakyFlows?: number;
  completionRate: number; // percentage
}

export interface TraceabilityEntry {
  requirementId: string;
  testCaseId: string;
  flowId: string;
  name?: string;
  status: TestPointStatus;
  description?: string;
  evidencePath?: string;
}

export interface SuppressionRule {
  findingTitle: string;
  urlPath?: string;
  checker?: CheckerType;
  triageStatus: 'Intended' | 'False Positive';
  reason?: string;
  dateAdded: string;
  /** The site it's for, e.g. "localhost:3050". Rules without one apply to every site. */
  host?: string;
}

export interface RunDelta {
  newFindings: number;
  fixedFindings: number;
  openFindings: number;
  suppressedFindings: number;
}

export interface ReleaseReport {
  runId: string;
  productId: string;
  targetUrl: string;
  timestamp: string;
  durationMs: number;
  coverage: RunCoverage;
  results: TestPointResult[];
  findings: Finding[];
  traceability?: TraceabilityEntry[];
  suppressions?: SuppressionRule[];
  delta?: RunDelta;
  /** True when this run's test cases came from the generic template fallback, not real AI-driven discovery. */
  usedFallbackDiscovery?: boolean;
  /**
   * 'safe-public' when this report came from a read-only website scan (no sign-in, no form
   * submissions, no data changes), so it must not be read as full product coverage. 'read-only'
   * when a planned run was kept from sending forms because the site isn't a test copy.
   */
  scanMode?: 'full' | 'read-only' | 'safe-public';
  /** Plain sentences about what this run could and couldn't cover, e.g. pages behind a sign-in. */
  notes?: string[];
  /** Pages a website scan visited, in order, grouped by layout (pages built from one template share a group). */
  pages?: VisitedPage[];
  /** The AI models that planned the run (text) and would review screenshots (vision). */
  aiModels?: { text?: string; vision?: string };
  /** Testing was stopped early and the report made from what was done: a partial check-up. */
  partial?: { done: number; planned: number };
  /** The AI's visual review of one screen per layout: how far it got. `remaining` can be finished from the report. */
  visualReview?: { reviewed: number; total: number; remaining: number };
  /** AI tokens used per stage (planning, repair, journeys, visual review), for the developer details. */
  aiUsage?: Partial<Record<AIStage, AIStageUsage>>;
  grades?: SiteAspectGrades;
  /** The marketing basics checklist. Absent when no page was read for it (search checks off, or the home page not tested). */
  marketing?: MarketingReview;
  recommendations?: RankedRecommendation[];
  history?: SiteHistoryDiff;
  singleFileHtmlReportPath?: string;
  /** The site as the plan saw it, so the report can be drawn as a map. Absent for runs without a scan. */
  siteMap?: SiteMapSummary;
  /**
   * "Test again" found nothing new on the site, so this run skipped the review and used the plan
   * approved at this time (ISO-8601).
   */
  testedWithApprovedPlan?: string;
}

/** One finished check-up, as Past check-ups lists it. Written beside each run's report. */
export interface RunSummary {
  runId: string;
  targetUrl: string;
  /** The site as typed, e.g. "localhost:3050": check-ups are grouped by it. */
  host: string;
  /** When the run finished (ISO-8601). */
  timestamp: string;
  durationMs: number;
  ready: boolean;
  stamp: 'Ready to release' | 'Not ready yet';
  reason: string;
  counts: Record<FindingSeverity, number>;
  /** Nothing that could change data was sent. */
  readOnly?: boolean;
  testedWithApprovedPlan?: string;
}

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

// --- Phase 2: AI Discovery & Confirmation Types ---

export type AIProviderType = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'mock';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // base64 data URIs
}

/** What an AI request was for, so token use can be added up per stage. */
export type AIStage = 'planning' | 'repair' | 'journeys' | 'visual-review' | 'interpret' | 'other';

export interface AICompletionOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  responseFormat?: 'json' | 'text';
  /**
   * 'low' asks a reasoning model to think briefly and keep its reasoning out of the answer, so the
   * output allowance goes to the answer. Services that don't know the setting ignore it.
   */
  reasoning?: 'low';
  stage?: AIStage;
}

/** Tokens one AI request used, as the service reported them. */
export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  /** Part of `completionTokens` spent on hidden reasoning, when the service says. */
  reasoningTokens?: number;
}

/** One AI answer with what it cost and why it ended. */
export interface AICompletion {
  text: string;
  /** 'length' means the model hit its output allowance: the answer is cut off or empty. */
  finishReason?: string;
  /** The model that answered. */
  model?: string;
  usage?: AIUsage;
}

export interface SensitiveAction {
  type: 'deletion' | 'payment' | 'external_communication' | 'admin_setting';
  elementSelector: string;
  elementText: string;
  urlPath: string;
  reason: string;
}

export interface AmbiguityQuestion {
  id: string; // e.g. "Q-001"
  targetElement?: string;
  urlPath: string;
  question: string;
  options: string[]; // e.g. ["Allow action for tests", "Skip permanently", "Use safe mock input"]
  selectedAnswer?: string;
  category: 'sensitive_action' | 'untested_form' | 'missing_permission' | 'unlinked_page' | 'unverified_step';
  /** The same for the same question on every run, so a site's answers can be remembered. */
  key?: string;
  /** The answer that sends nothing and deletes nothing, used when nobody answers. */
  safeAnswer?: string;
  /** The journey the question is about, when it is about one. */
  flowId?: string;
  /** Not asked in this site's last reviewed run. */
  isNew?: boolean;
  /** Every page the question covers, when the same form is on several (a search box in the header). */
  urlPaths?: string[];
}

/** One interactive element the crawler saw on a page. Plans may only target elements listed here. */
export interface ElementInventoryItem {
  /** ARIA role, explicit or implied by the tag: button, link, textbox, combobox, checkbox, tab, … */
  role: string;
  /** What a person or a screen reader would call it: its label, aria-label, visible text or placeholder. */
  name: string;
  /** Selector the runner can use: data-testid, then id, then name attribute, then role and name. */
  selector: string;
  tagName: string;
  testId?: string;
  id?: string;
  /** The HTML name attribute, for form controls. */
  nameAttribute?: string;
  /** For inputs: text, email, number, password, submit, … */
  inputType?: string;
  /** For links: the raw href attribute; absent or "#" when a script does the navigation. */
  href?: string;
  /** True when the element sits inside a form (a button there may submit it). */
  insideForm?: boolean;
  visible: boolean;
  enabled: boolean;
  /** The part of the page it sits in, when that's a header, menu or footer. */
  landmark?: 'header' | 'nav' | 'footer';
  /** It opens or closes something (aria-expanded, aria-haspopup or aria-controls), like a menu button. */
  toggles?: boolean;
  /** True when the element is marked transient or sits inside a data-transient container. */
  transient?: boolean;
}

export interface PageInventoryItem {
  urlPath: string;
  title: string;
  interactiveElementsCount: number;
  formsCount: number;
  outOfScope?: boolean;
  /** The interactive elements found on the page (absent in drafts written before this was recorded). */
  elements?: ElementInventoryItem[];
  /** The page has a password field: a sign-in form. */
  hasSignInForm?: boolean;
  /** Who reached this page while exploring: 'visitor' (signed out) and/or role names. */
  reachedBy?: string[];
  /** Pages built from the same template share a group, e.g. "layout-2" for every product page. */
  layoutGroup?: string;
  /** A small screenshot of the page, relative to the report folder. */
  screenshotPath?: string;
  /** Not found in this site's last reviewed run. */
  isNew?: boolean;
  /** Where the page's links and navigation buttons go (absent in drafts written before this was recorded). */
  links?: PageLink[];
  /** Menu buttons that narrow screens hide this page's links behind. */
  narrowMenus?: NarrowMenu[];
  /** A fingerprint of the page's controls: the same on the next run when the page hasn't changed. */
  contentKey?: string;
}

export interface DiscoveredFlow {
  id: string;
  name: string;
  role: string;
  description: string;
  startPage: string;
  steps: TestCaseStep[];
  /** Rules the AI inferred. Always AI guesses: they never fail a site until someone confirms them. */
  inferredRules?: string[];
  candidateExpectations?: TestCaseExpectations;
  candidateValidationRules?: ValidationRule[];
  outOfScope?: boolean;
  /**
   * Why this flow can't run as planned, e.g. a step aimed at an element the crawler never found.
   * A flow needing help is not run until someone fixes it in the plan review.
   */
  needsHelp?: string[];
  /** It sends a form or presses something that changes data: on a live site it stays in the plan but isn't run. */
  needsTestCopy?: boolean;
  /** Who planned it: the AI, the fixed rules used when there's no AI, or the user. */
  source?: 'ai' | 'fallback' | 'user';
  /** Why fixed rules planned it, when they did. */
  fallbackReason?: FallbackReason;
  /**
   * Business rules the user added in plain words. A checkable rule becomes its own test: the
   * journey's steps with the rule's check. Others are listed in the report for a person to check.
   */
  userRules?: Array<{ text: string; origin: RuleOrigin; checkable: boolean; check?: TestCaseExpectations }>;
  /** Not in this site's last reviewed run, or its steps changed since. */
  isNew?: boolean;
}

export interface DiscoveryDraft {
  version: string;
  productId: string;
  targetUrl: string;
  timestamp: string;
  pages: PageInventoryItem[];
  flows: DiscoveredFlow[];
  sensitiveActions: SensitiveAction[];
  ambiguityQuestions: AmbiguityQuestion[];
  rawContextSummary?: string;
  /** True when AI-driven flow synthesis failed and flows were generated by the generic template fallback instead. */
  usedFallbackSynthesis?: boolean;
  /** Who explored the site, and what couldn't be reached. */
  exploration?: {
    /** Roles whose sign-in worked and that explored the site signed in. */
    signedInAs: string[];
    /** Roles whose sign-in didn't work. */
    signInFailed: string[];
    /** Pages with a sign-in form. */
    signInPages: string[];
    /** Pages that asked for a sign-in nobody could get past. */
    notReached: string[];
    /** Plain sentences for the report, e.g. "Pages behind the sign-in were not reached." */
    notes: string[];
  };
  /** Site category: 'shop' | 'SaaS' | 'content' | 'booking' | 'app' | 'other' */
  siteType?: 'shop' | 'SaaS' | 'content' | 'booking' | 'app' | 'other';
  /** Form fields and submit buttons the crawler found. Plan steps may use their selectors too. */
  forms?: Array<{
    urlPath: string;
    inputs: Array<{ selector: string }>;
    submitButtonSelector?: string;
    /** How the form is sent: GET only fetches a page (a search); anything else sends data. */
    method?: string;
  }>;
  /** True when this plan runs read-only because the site isn't a test copy. */
  readOnly?: boolean;
  /** The complete Plan's pages and Navigation Checks (ADR 0009). Journeys stay in `flows`. */
  plan?: DraftPlan;
}

// --- Phase 3: Hub, Consolidation, Design & UX Types ---

export * from './fingerprint.js';
export * from './site-map.js';
export * from './plan.js';
export * from './verdict.js';
export * from './problems.js';
import type {
  AIRequestBudget,
  AIStageUsage,
  FallbackReason,
  DraftPlan,
  NarrowMenu,
  NavigationCheck,
  PageLink,
  PlanGradedCheck,
  PlanLayoutGroup,
  PlanOtherHost,
  PlanPage,
  PlanSummary,
  PlanWontRun,
} from './plan.js';

export interface RetryTelemetryEntry {
  flowId: string;
  testCaseId: string;
  failedStepIndex: number;
  retryCount: number;
  status: 'FLAKY_PASSED' | 'FAILED';
  errorMessage?: string;
}

export interface DesignTokens {
  colors?: Record<string, string>;
  spacing?: Record<string, string>;
  fontSize?: Record<string, string>;
  borderRadius?: Record<string, string>;
  fontFamily?: Record<string, string>;
}

export interface DesignTokenBaseline {
  version: string;
  productId: string;
  updatedAt: string;
  tokens: DesignTokens;
}

export interface AccountPoolConfig {
  [role: string]: Array<{
    username: string;
    password?: string;
    token?: string;
  }>;
}

// --- Phase 4: Competitive & Reference Public Flow Analysis Types ---

export interface ReferenceFlowStep {
  stepIndex: number;
  action: string;
  url: string;
  title?: string;
  screenshotPath?: string;
  interactiveControlsFound: string[];
  fieldsCount: number;
  requiredFieldsCount: number;
}

export interface ReferenceFlow {
  id: string;
  targetDomain: string;
  entryUrl: string;
  name: string;
  steps: ReferenceFlowStep[];
  timestamp: string;
}

export interface FrictionScorecard {
  totalSteps: number;
  totalFields: number;
  requiredFieldsCount: number;
  clickDepth: number;
  frictionIndex: number;
}

export interface InteractivePattern {
  name: string;
  category: 'auth' | 'pricing' | 'form' | 'trust';
  present: boolean;
  description: string;
}

export interface UXRecommendation {
  id: string;
  category: 'Quick Win' | 'Strategic Investment' | 'UX Polish';
  title: string;
  effort: 'Low' | 'Medium' | 'High';
  impact: 'Low' | 'Medium' | 'High';
  rationale: string;
  suggestedAction: string;
}

export interface CompetitiveBenchmark {
  id: string;
  flowId: string;
  ourProduct: {
    url: string;
    name: string;
    scorecard: FrictionScorecard;
    screenshots: string[];
  };
  referenceProduct: {
    url: string;
    name: string;
    scorecard: FrictionScorecard;
    screenshots: string[];
  };
  delta: {
    stepDifference: number;
    fieldDifference: number;
    frictionRatio: number;
  };
  patterns: Array<{
    pattern: string;
    ourProduct: boolean;
    referenceProduct: boolean;
  }>;
  recommendations: UXRecommendation[];
  createdAt: string;
}

/** One comparison of two sites: running, or finished and kept. */
export interface BenchmarkJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  /** What it is doing now, in plain words. */
  stage: string;
  flowType: string;
  ourUrl: string;
  refUrl: string;
  startedAt: string;
  /** True when an AI wrote some of the improvement ideas; false when fixed rules did. */
  aiUsed?: boolean;
  error?: string;
  result?: CompetitiveBenchmark;
}

// --- Phase 1: Plan review types (Tasks 1.2 & 1.3) ---

/**
 * The four states a run moves through when plan review is enabled.
 * - scanning        : discovery + page sweep in progress
 * - awaiting-review : discovery done; plan is on disk; runner is waiting for approval
 * - testing         : plan approved; FlowTestOrchestrator is running
 * - done            : run finished (pass or fail)
 * - failed          : unrecoverable error from any state
 */
export type RunnerPhase = 'idle' | 'scanning' | 'awaiting-review' | 'testing' | 'done' | 'failed';

export interface PlanCheck {
  sentence: string;
  origin: RuleOrigin;
}

export interface PlanJourney {
  id: string;
  name: string;
  role: string;
  reason?: string;
  startPage: string;
  steps: string[];
  checks: PlanCheck[];
  needsHelp?: string[];
}

export interface PlanSiteWideCheck {
  name: string;
  description: string;
}

export interface PlanPageItem {
  urlPath: string;
  title: string;
  layoutGroup?: string;
  screenshotPath?: string;
}

export interface PlanPageGroup {
  section: string;
  layoutGroup: string;
  pages: PlanPageItem[];
}

/**
 * The plan stored on disk after discovery, served at GET /api/runner/plan.
 * This is what the wizard shows on the map screen before testing starts.
 */
export interface ReviewPlan {
  /** Matches the runId from the POST /api/runner/run response. */
  runId: string;
  targetUrl: string;
  siteType?: string;
  /** ISO-8601 timestamp when discovery finished. */
  discoveredAt: string;
  pages: PageInventoryItem[];
  flows: DiscoveredFlow[];
  /**
   * Questions the AI couldn't answer from the page alone — shown on the plan map
   * so the user can answer them before testing starts.
   */
  questions: AmbiguityQuestion[];
  /**
   * Test cases the planner derived from the flows; can be edited via PATCH before approving.
   * Absent until the user has approved once (then kept for re-runs).
   */
  testCases?: TestCase[];
  /** True if the generic template fallback was used because AI discovery failed. */
  usedFallbackDiscovery?: boolean;
  /** The site isn't a test copy: journeys that send a form stay in the plan but aren't run. */
  readOnly?: boolean;
  /** Why the run is read-only, in plain words. */
  readOnlyReason?: string;
  /** Sentences about what the scan could and couldn't reach, e.g. pages behind a sign-in. */
  notes?: string[];
  /** What changed since this site's last run. Absent on a site's first run. */
  sinceLastRun?: { newPages: number; newJourneys: number; newQuestions: number; rememberedAnswers: number };
  /** False when no AI key is set up: fixed rules chose the journeys, and describing a test is off. */
  aiAvailable?: boolean;
  /** Roles that signed in and explored the site. */
  signedInAs?: string[];
  /** Journeys translated to plain sentences with origins. */
  journeys?: PlanJourney[];
  /** Fixed site-wide checks that apply across all pages. */
  siteWideChecks?: PlanSiteWideCheck[];
  /** Scanned pages grouped by section and layout. */
  pageGroups?: PlanPageGroup[];
  /** Attached product specification, PRD, or user stories context. */
  productContext?: string;
  /** Attached design system tokens or styling guidelines. */
  designNotes?: string;

  // The complete Plan (ADR 0009). Absent on plans made before it.
  /** Every page found, and how each is covered. */
  planPages?: PlanPage[];
  /** Every Navigation Check. */
  navigation?: NavigationCheck[];
  /** The graded aspects every tested page gets. */
  gradedChecks?: PlanGradedCheck[];
  layoutGroups?: PlanLayoutGroup[];
  /** Screen sizes the run uses. */
  screenSizes?: Breakpoint[];
  /** Who the run tests as: 'visitor' and the roles that signed in. */
  roles?: string[];
  /** What won't run, and why. */
  wontRun?: PlanWontRun[];
  budget?: AIRequestBudget;
  /** What approving runs, and every default applied. */
  summary?: PlanSummary;
  /** Other hosts the site links to. */
  otherHosts?: PlanOtherHost[];
}
