import type {
  TestCase,
  ProductProfile,
  ReleaseReport,
  SiteMapSummary,
  Breakpoint,
  StorageStateData,
  DocSource,
  TimingEntry,
} from '@qa/types';
import type { BrowserEngine } from '../browser.js';
import type { PreFlightResult } from '../preflight.js';
import type { OrchestratorEvent } from './events.js';

export interface RunOptions {
  targetUrl: string;
  productId: string;
  specTestCases: TestCase[];
  profile?: ProductProfile;
  /** Multi-browser engine to run tests against: 'chromium' (default), 'webkit', or 'firefox' (FR-1.4). */
  browserEngine?: BrowserEngine;
  /** Custom HTTP headers sent with every request (e.g. bypass headers). */
  customHeaders?: Record<string, string>;
  /** Custom user-agent string. */
  userAgent?: string;
  /** Pre-flight sign-in result from discovery (T-113); never persisted */
  preflight?: PreFlightResult;
  /** Hostnames to which customHeaders should be scoped (T-103) */
  headerHosts?: string[];
  headless?: boolean;
  tunnelAuth?: string;
  outputDir?: string;
  breakpoints?: Breakpoint[];
  repoRoot?: string;
  enableA11y?: boolean;
  enableSeo?: boolean;
  /**
   * Check how search engines and AI assistants see the site (default true). Off for a site that
   * isn't public, such as a test copy: then only link health is checked.
   */
  searchChecks?: boolean;
  visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
  enablePerformance?: boolean;
  enableSecurity?: boolean;
  /** Record a video per test point; kept only when the point fails. Default true. Never for a run that signs in. */
  recordVideo?: boolean;
  /** Reruns of a failing test, each in a clean context, stopping at the first pass. Default 3. Link tests never rerun. */
  flakyReruns?: number;
  /** Overwrite visual baselines with this run's screenshots instead of comparing against them. */
  updateBaselines?: boolean;
  onEvent?: (event: OrchestratorEvent) => void;
  /** Override the generated runId (e.g. so a caller can respond with an id before the run starts and have RUN_STARTED/RUN_COMPLETED carry the same id). Defaults to an internally generated `run-<timestamp>`. */
  runId?: string;
  /** Sentences to show in the report about coverage, e.g. from discovery ("pages behind the sign-in were not reached"). */
  reportNotes?: string[];
  /** Documented items the Plan could not match to anything in the app (shown as "Not found in app", never a failure). */
  documentedNotFound?: Array<{ docSource: DocSource; reason: string }>;
  /** The AI models that planned this run, named in the report. */
  aiModels?: { text?: string; vision?: string };
  /**
   * The site isn't a test copy: every request that could change data is blocked, and a journey that
   * tries to send data is reported as needing a test copy rather than as broken.
   */
  readOnly?: boolean;
  /** Planned tests that won't run, and why, e.g. a journey that needs a test copy on a live site. */
  notRun?: Array<{ id: string; flowId: string; name: string; role: string; reason: string }>;
  /** The site as the plan saw it, kept in the report so it can be drawn as a map. */
  siteMap?: SiteMapSummary;
  /** Pages found while exploring and why the rest were skipped; shown in the issues document on its first write. */
  pageCoverage?: ReleaseReport['pageCoverage'];
  /**
   * Full testing was agreed to with sign-in details: any role that can't sign in throws a
   * SignInFailedError before testing, instead of being listed as not tested.
   */
  requireSignIn?: boolean;
  /** Stops the run between steps and test points: the browser closes and run() throws an AbortError. */
  signal?: AbortSignal;
  /** Finishes early: no more tests start, and the report is made from what's done, marked as partial. */
  finishSignal?: AbortSignal;
  /** Where sign-in sessions are saved. Default `<outputDir>/auth`. Keep it out of any folder that's served. */
  authDir?: string;
  /** Sessions the person saved, by role. Memory only: used instead of signing in, never written or logged. */
  suppliedSessions?: Record<string, StorageStateData>;
  /** Where suppressions and the previous run's findings (for the delta) live. Default outputDir. */
  stateDir?: string;
  /** How screenshots are addressed in STEP_COMPLETED: this prefix plus the path inside outputDir. Default `/api/evidence/`. */
  evidenceUrlPrefix?: string;
  /** The data folder that holds each site's grade history (`<dataDir>/sites`). Default `.qa-data` in the working folder. */
  dataDir?: string;
  /** Recorded in the report when "Test again" skipped the review: when the plan it used was approved. */
  testedWithApprovedPlan?: string;
  /** Most time one test step may spend finding and acting on its element, in ms, across retries. Default 10000. */
  stepTimeoutMs?: number;
  /** Record where the run's time went, in the report's `timing` (also on when QA_DEBUG is set). */
  timing?: boolean;
  /** Crawl and planning times from discovery, merged into the report's `timing`. */
  discoveryTiming?: TimingEntry[];
  /**
   * How many roles' test points run side by side on a read-only run (1 to 5, default 2). A role's own points
   * always run in plan order. A test-copy run writes data, so it always runs in plan order, one at a time.
   */
  testPointWorkers?: number;
}
