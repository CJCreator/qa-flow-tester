import type { FindingSeverity, CheckerType, TriageStatus, Breakpoint } from './test-case.js';
import type { AspectType } from './aspects.js';
import type { DocSource } from './plan.js';
import type { SignInFailureReason } from './signin.js';

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
  /** Cancelled because the page went away (a form submit that navigates), not a failure of the site. */
  aborted?: boolean;
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
    /** Approved baseline image copied next to the evidence, for a Perceptual Visual Diff finding. */
    baselineScreenshotPath?: string;
    /** Image captured in this Check-up, for a Perceptual Visual Diff finding. */
    currentScreenshotPath?: string;
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
  /** True when the finding is a request that answered with an HTTP 5xx status. Set by the checker, so scoring never reads the title. */
  is5xx?: boolean;
  /**
   * An AI guess the site didn't match. Shown as "Could not verify" (never as a defect) until
   * someone confirms or rejects the rule behind it.
   */
  needsConfirmation?: boolean;
  /** An AI-written opinion. Shown in the report, but never changes the verdict or the grades (ADR 0009). */
  advisory?: boolean;
  /** Sub-category tag for fine-grained categorization, such as 'SEO', 'AEO', or 'GEO' under Findable. */
  categoryTag?: 'SEO' | 'AEO' | 'GEO' | 'MKT';
  /** Stable id of the rule that found it, for fingerprints. Set it when the title carries counts, paths or quoted values. */
  ruleCode?: string;
  /** The area it counts toward, when not its checker's: a missing viewport tag is about phones. */
  aspect?: AspectType;
  /** The same problem found by another check has the same key, so the report lists it once (see problems.ts). */
  issueKey?: string;
  /** Structural Fingerprint (ADR 0017). Stamped when findings.json is written; not unique per finding. */
  fingerprint?: string;
  /** How many times the same problem was seen in this run, when more than once. */
  occurrences?: number;
  /** Where else the same problem was seen: pages, widths, roles and test points. */
  seenAt?: { pages: string[]; breakpoints: Breakpoint[]; roles: string[]; testCaseIds: string[] };
  /** The document section the expectation came from, when the Plan Item had a Source. */
  docSource?: DocSource;
  /** An AI-judged logical-flow call: held out of the verdict until the person accepts it. Set with `needsConfirmation`. */
  needsJudgement?: boolean;
  /** The person accepted a judgement item: it now counts (`needsConfirmation` is cleared). */
  judgementAccepted?: boolean;
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
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  /** A selector that exists only when signed in */
  postLoginSelector?: string;
  /** A path the page should land on after sign-in (relative to the target) */
  postLoginUrl?: string;
  /** Custom per-role HTTP headers (e.g. Authorization: Bearer <token>) */
  headers?: Record<string, string>;
  /** Key-value entries injected into localStorage for this role */
  localStorageEntries?: Record<string, string>;
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
  /** Extra CSS selectors masked in newly recorded visual baselines (stored beside the baseline). */
  visualMaskSelectors?: string[];
  permissionMatrix?: PermissionMatrix;
  permissionMatrixFile?: string;
}

/** A Playwright storage state held as an object, so it never has to touch disk. */
export interface StorageStateData {
  cookies: unknown[];
  origins: unknown[];
}

/** A role the Check-up could not sign in as, and why. `text` is fixed plain words. */
export interface RoleNotTested {
  role: string;
  reason: SignInFailureReason;
  text: string;
}

export interface PreFlightResult {
  ok: boolean;
  url: string;
  statusCode?: number;
  /** Whether the sign-in page answered. True only after that page was actually asked for (LC-006). */
  loginReachable?: boolean;
  /**
   * Role → signed in. A Role is `true` here **only after a sign-in that ran and succeeded**: a Role that
   * was never attempted (no browser to sign in with) is `false`, and `ok` is `false` too (LC-005).
   */
  roleAuthResults: Record<string, boolean>;
  roleStorageStates?: Record<string, string | StorageStateData>;
  /** Why a role could not sign in; that role is not tested. */
  roleFailures?: Record<string, SignInFailureReason>;
  /** The page each role landed on after signing in; exploring as that role starts there. */
  roleLandingPaths?: Record<string, string>;
  /** The start address answered with a 4xx: reachable, but not the page the person expected (LC-007). */
  startWarning?: 'start-4xx';
  error?: string;
}
