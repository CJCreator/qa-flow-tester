/**
 * The check-up API: what the runner accepts and answers, and what the wizard sends.
 *
 * Pure, browser-safe module, and types only on purpose: the wizard bundles @qa/types from source, so a value
 * or an import of a Node built-in here would enter the wizard's bundle. Both ends of the check-up API import
 * these shapes instead of carrying a copy, so a field cannot disappear on one side unnoticed.
 *
 * The wire names come from the runner's handlers (it is what answers): `RunStartBody` is the body
 * `packages/runner/src/server.ts` declares as `TriggerRunBody`, and `RunnerStatusReply` is exactly what its
 * status branch writes.
 */

import type { AIProviderType } from './ai.js';
import type { DiscoveredFlow } from './discovery.js';
import type { RoleCredential, StorageStateData } from './evidence-finding.js';
import type { PlanIntent, RunCap } from './plan.js';
import type { RunnerPhase } from './review-plan.js';
import type { Breakpoint, FindingSeverity, TestCase } from './test-case.js';

/**
 * `POST /api/runner/run` body. Moved from `packages/runner/src/server.ts` (`TriggerRunBody`), names, types
 * and comments unchanged.
 */
export interface RunStartBody {
  targetUrl: string;
  productId?: string;
  useAI?: boolean;
  aiProvider?: AIProviderType;
  apiKey?: string;
  aiModel?: string;
  releaseTarget?: string;
  breakpoints?: string[];
  headless?: boolean;
  /** Record videos and keep those of failed test points. Omitted: the orchestrator default (on). */
  recordVideo?: boolean;
  /** Login credentials per role, used for pre-flight auth against the target site. */
  roles?: RoleCredential[];
  /** Remember the sign-ins for the site: names and usernames in its memory, passwords in the OS keychain. */
  rememberSignIns?: boolean;
  /** No sign-ins given: sign in with the ones saved for the site. */
  useSavedSignIns?: boolean;
  /** Explicit test cases to run instead of AI discovery / the default sanity check. */
  specTestCases?: TestCase[];
  /** Raw reference material (PRDs, user flows) handed to AI discovery as Product Context. */
  productContext?: string;
  /**
   * 'safe-public' runs a read-only website scan (Safe Interaction Mode) instead of discovery +
   * test execution: no sign-in, no form submissions, no mutating requests.
   */
  mode?: 'product' | 'safe-public';
  /**
   * When true (default when omitted), skips pausing for plan review and tests immediately.
   * When false, pauses in 'awaiting-review' after discovery and writes the plan to disk.
   */
  skipReview?: boolean;
  /**
   * The URL-first wizard's "I own this site or it's a test copy" box. Full testing needs it and a
   * test host; anything else runs read-only. Omitted by older callers, which count as owners (but
   * a live host still stays read-only). Sending it also turns on planning without an AI key.
   */
  owner?: boolean;
  /**
   * The person gave test sign-in details and accepts that this run may act on the site (ADR 0022).
   * Per run only, never remembered. Ignored on a shared machine (beta). Needs a role with both
   * username and password; a failed sign-in ends the run before the crawl.
   */
  signInConsent?: boolean;
  /** 'smoke': Smoke Check-up. Reads a few known paths of a deployed App (GET only), health first. */
  preset?: 'smoke';
  /** Smoke Check-up: health path to read first. Default tries /healthz, /health, /api/health, /status. */
  healthPath?: string;
  /** Smoke Check-up: version the deployed App should report; compared only when given. */
  expectedVersion?: string;
  /** The owner says this host is a test copy (staging). Remembered for the site. */
  stagingHost?: boolean;
  /** Attached design system tokens or styling guidelines. */
  designNotes?: string;
  /** Plan everything afresh with the AI instead of reusing the site's last approved Plan. */
  replanAll?: boolean;
  /** Pages the crawl explores at most (default 200; 1 to 1000). */
  maxPages?: number;
  /**
   * Check how search engines and AI assistants see the site. Remembered for the site; when never
   * said, on for a live site and off for a test copy.
   */
  searchChecks?: boolean;
  visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
  /**
   * Plan with fixed rules now, spending no AI requests; the AI is still set up for the review, so
   * items can be re-planned with it later.
   */
  planWithoutAI?: boolean;
  /**
   * A plan is waiting for review: starting another run throws it away, so the caller has to say
   * so. Without it the run is refused with 409 ERR_PLAN_WAITING.
   */
  replacePlan?: boolean;
  /**
   * "Test again": scan, compare with the site's last approved plan, and test straight away when
   * nothing is new. Anything new pauses for review, with only the new items flagged.
   */
  testAgain?: boolean;
  /**
   * Product Context as several .md/.txt documents (at most 10, 500 KB each). Each requirement keeps
   * its document and section as its Source. Used with or instead of `productContext`.
   */
  contextDocuments?: Array<{ name: string; text: string }>;
  /** A docs page to read for Product Context: it and the same-site pages it links to (at most 20). */
  contextUrl?: string;
  /**
   * Saved sessions by role (Playwright storage state). Kept in the runner's memory for this Check-up
   * only: never written to disk, never sent back, never logged. Cookies must belong to the target host.
   */
  savedSessions?: Record<string, StorageStateData>;
  /** The person's cap on this Check-up's AI use: requests, and dollars when the model has a price. */
  aiCap?: RunCap;
  /** Most Tests the Plan runs before Rejects and Limits are trimmed (1 to 100000); the default when absent. */
  testCap?: number;
  /** Crawl concurrency (workers count, 1 to 5; default 2 per FR-1.7). */
  crawlConcurrency?: number;
  /** Delay pacing between page requests in ms (default 100ms per FR-1.7). */
  crawlDelayMs?: number;
  /** Custom HTTP headers sent with every crawler and test request (e.g. bypass headers). */
  customHeaders?: Record<string, string> | string;
  /** Custom user-agent string. */
  userAgent?: string;
  /** Tunnel authentication secret. */
  tunnelAuth?: string;
  /** Extra hosts that may receive secret headers (Domain Allowlist). */
  headerHosts?: string[];
}

/**
 * `POST /api/runner/run` reply (202). The run's progress and completion travel over the SSE stream, so
 * the id is the whole answer.
 */
export interface RunStartReply {
  runId: string;
}

/**
 * `PATCH /api/runner/plan` body, moved from the wizard's copy (its comments describe each field). The
 * runner validates the values and refuses unknown ones.
 */
export interface PlanPatchBody {
  flows?: DiscoveredFlow[];
  questions?: Array<{ id: string; selectedAnswer: string }>;
  answers?: Record<string, string>;
  testCases?: TestCase[];
  productContext?: string;
  designNotes?: string;
  /** Plan Items switched on or off: pages, tests, Navigation Checks, journeys ("journey:<id>"). */
  items?: Array<{ id: string; skipped: boolean }>;
  /** The screen sizes the run uses. */
  screenSizes?: Breakpoint[];
  /** Confirms the AI's guess of what should happen (no text), or replaces it with the person's words. */
  expectations?: Array<{ id: string; text?: string }>;
  /** 'quick': desktop only, and only the shared menus' links. */
  preset?: 'quick';
  /** Plan Review edits on a Source: confirm or correct roles, set severity, mark the document out of date. */
  sourceEdits?: Array<{
    itemId: string;
    roles?: string[];
    severity?: FindingSeverity;
    stale?: boolean;
    confirm?: boolean;
  }>;
  /** "Not found in app" entries: remove one from the list. */
  notFoundEdits?: Array<{ id: string; remove?: boolean }>;
  /** The Intents switched off (Works, Rejects, Limits, Denied); an empty list switches all on. */
  intentsOff?: PlanIntent[];
}

/**
 * `GET /api/runner/status` reply: exactly the fields the status branch writes. A copy shared with other
 * people adds its own fields on top of this (the wizard's `busy`).
 */
export interface RunnerStatusReply {
  isRunning: boolean;
  hasReport: boolean;
  lastRunError: string | null;
  lastErrorCode: string | null;
  phase: RunnerPhase;
  hasPlan: boolean;
  runId: string | null;
  targetUrl: string | null;
  reportRunId: string | null;
  beta: boolean;
}

/**
 * `POST /api/runner/plan/approve` reply on success: the Plan is approved and its run has started. Approval
 * refusals carry an error and a `code` instead (409 ERR_DUPLICATE_APPROVAL / ERR_PLAN_UPDATING, 404).
 */
export interface ApprovalReply {
  status: 'approved';
  runId: string;
}
