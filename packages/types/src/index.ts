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
  | 'security';

export type TriageStatus = 'Pending' | 'Confirmed' | 'Intended' | 'False Positive' | 'Resolved';

export type Breakpoint = '375px' | '768px' | '1440px';

export type TestPointStatus =
  | 'Passed'
  | 'Failed'
  | 'Blocked'
  | 'Skipped'
  | 'Could not verify';

export interface TestCaseStep {
  action: 'click' | 'fill' | 'select' | 'check' | 'navigate' | 'wait';
  selector?: string; // e.g. "[data-testid=new-invoice-btn]"
  value?: string;
  name: string;
  /**
   * A step that may not be possible, e.g. a button that only shows on wide screens. If it can't
   * be done it is recorded as skipped, not as a failure, and the next steps still run.
   */
  optional?: boolean;
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
  };
  resolution: string;
  verifyCommand: string;
  triageStatus?: TriageStatus;
  /** True when this finding originated from a request/resource on a different origin than the page under test (e.g. third-party analytics, fonts, CDNs) rather than a first-party defect. */
  thirdParty?: boolean;
  /**
   * An AI guess the site didn't match. Shown as "Could not verify" (never as a defect) until
   * someone confirms or rejects the rule behind it.
   */
  needsConfirmation?: boolean;
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
  /** Path to design-tokens.json (written by `qa-test figma sync`) for Tier 1 token checks. */
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
}

export interface RunCoverage {
  totalTestPoints: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  couldNotVerify: number;
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
   * submissions, no data changes), so it must not be read as full product coverage.
   */
  scanMode?: 'full' | 'safe-public';
  /** Plain sentences about what this run could and couldn't cover, e.g. pages behind a sign-in. */
  notes?: string[];
  /** Pages a website scan visited, in order, grouped by layout (pages built from one template share a group). */
  pages?: VisitedPage[];
  /** The AI models that planned the run (text) and would review screenshots (vision). */
  aiModels?: { text?: string; vision?: string };
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

export interface AICompletionOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  responseFormat?: 'json' | 'text';
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
}

export interface DiscoveredFlow {
  id: string;
  name: string;
  role: string;
  description: string;
  startPage: string;
  steps: TestCaseStep[];
  inferredRules?: string[];
  candidateExpectations?: TestCaseExpectations;
  candidateValidationRules?: ValidationRule[];
  outOfScope?: boolean;
  /**
   * Why this flow can't run as planned, e.g. a step aimed at an element the crawler never found.
   * A flow needing help is not run until someone fixes it in the plan review.
   */
  needsHelp?: string[];
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
}

// --- Phase 3: Hub, Consolidation, Design & UX Types ---

export * from './fingerprint.js';

export type FindingLifecycleStatus = 'OPEN' | 'VERIFIED_FIXED' | 'REGRESSED' | 'ACCEPTED_RISK';

export interface EvidenceItemManifest {
  clientKey: string;
  fileType: 'screenshot' | 'video' | 'trace' | 'dom' | 'har' | 'log';
  mimeType: string;
  fileSize: number;
}

export interface RunManifestInitInput {
  productId: string;
  releaseTarget: string;
  commitHash?: string;
  developerId?: string;
  machineId?: string;
  branch?: string;
  evidenceItems: EvidenceItemManifest[];
}

export interface RunManifestInitResponse {
  runId: string;
  uploadUrls: Record<string, { uploadUrl: string; storageKey: string }>;
}

export interface RetryTelemetryEntry {
  flowId: string;
  testCaseId: string;
  failedStepIndex: number;
  retryCount: number;
  status: 'FLAKY_PASSED' | 'FAILED';
  errorMessage?: string;
}

export interface RunFinalizeInput {
  runId: string;
  durationMs: number;
  coverage: RunCoverage;
  testPoints: TestPointResult[];
  findings: Finding[];
  evidenceUploaded: string[];
  retryTelemetry?: RetryTelemetryEntry[];
}

export interface CanonicalFinding {
  id: string;
  fingerprint: string;
  productId: string;
  releaseTarget: string;
  checker: CheckerType;
  ruleCode: string;
  title: string;
  severity: FindingSeverity;
  route: string;
  selector?: string;
  status: FindingLifecycleStatus;
  firstSeenRunId: string;
  lastSeenRunId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  runFindings: Array<{
    runId: string;
    testCaseId?: string;
    flowId?: string;
    stepIndex?: number;
    evidenceUrls?: string[];
    timestamp: string;
  }>;
}

export interface ConsolidatedReleaseReport {
  productId: string;
  releaseTarget: string;
  lastConsolidatedAt: string;
  totalRuns: number;
  summary: {
    totalFindings: number;
    open: number;
    verifiedFixed: number;
    regressed: number;
    acceptedRisk: number;
    flakyFlowsCount: number;
  };
  canonicalFindings: CanonicalFinding[];
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

export interface OutboxQueueEntry {
  id: string;
  runId: string;
  initPayload: RunManifestInitInput;
  finalizePayload: RunFinalizeInput;
  evidenceFiles: Array<{ localFilePath: string; clientKey: string }>;
  createdAt: string;
  retryAttempts: number;
  lastAttemptAt?: string;
  error?: string;
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
  avgPageLoadMs: number;
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
    a11yScore: number;
    screenshots: string[];
  };
  referenceProduct: {
    url: string;
    name: string;
    scorecard: FrictionScorecard;
    a11yScore: number;
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


