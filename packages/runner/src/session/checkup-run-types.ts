import type {
  ReleaseReport,
  DiscoveryDraft,
  Breakpoint,
  RoleCredential,
  TestCase,
  AIProviderType,
  RunStartBody,
  ProviderLimits,
  RunCap,
  TimingEntry,
} from '@qa/types';
import type {
  NetDeps,
  AIProvider,
  RunOptions,
  SiteMemory,
  VisualReviewItemInput,
  ModelRecord,
  OrchestratorEvent,
} from '@qa/core';
import type { CheckupSession, StoredPlanRecord } from './checkup-session.js';

/** What a run is allowed to do, decided by the caller (transport or CLI). */
export interface RunAuthorization {
  readOnly: boolean;
  readOnlyReason: string;
  /** The address is a Test Copy: full testing is allowed (ADRs 0014, 0022). */
  testCopy: boolean;
  owner: boolean;
  signInConsent: boolean;
}

export interface CheckupRun {
  /** Today's handleTriggerRun + executeRun, as one call. Resolves when the run has been claimed and started. */
  start(input: {
    body: RunStartBody;
    authorization: RunAuthorization;
  }): Promise<{ runId: string; awaitingReview: boolean }>;
  /** Today's handleAbortRun. `finish: true` stops after the current stage. */
  stop(input?: {
    finish?: boolean;
    /** Throw away a plan that is waiting for review. Without it, stopping keeps the plan. */
    discard?: boolean;
  }): Promise<{ aborted: boolean; planKept?: boolean; finishing?: boolean }>;
  /** Resolves when the current run is over, or when the deadline passes (today's CLI poll loop). */
  waitFor(deadlineMs: number): Promise<void>;
  /** Executes testing for an approved plan or explicit spec. */
  executeTesting(
    record: StoredPlanRecord,
    specTestCases: TestCase[],
    notRun: RunOptions['notRun'],
    generation: number,
    extra?: { testedWithApprovedPlan?: string }
  ): Promise<void>;
}

export interface RunDeps {
  prepareAI?: (body: RunStartBody) => Promise<{
    provider?: AIProvider;
    models?: { text?: string; vision?: string };
    settings?: StoredPlanRecord['context']['ai'];
    key?: string;
    fallbacks?: string[];
  }>;
  aiBudgetFor?: (
    settings: StoredPlanRecord['context']['ai'],
    key?: string,
    cap?: RunCap
  ) => Promise<
    | {
        left?: number;
        limit?: number;
        visualReview: number;
        pacing: { gapMs: number; concurrency: number; cap?: RunCap; price?: { prompt: number; completion: number } };
        limits: ProviderLimits | null;
      }
    | undefined
  >;
  signInsFor?: (
    body: RunStartBody,
    memory: SiteMemory | null,
    host: string
  ) => Promise<{ roles?: RoleCredential[]; memory: SiteMemory | null; note?: string }>;
  readDefaults?: () => Promise<{ screenSizes?: Breakpoint[] }>;
  siteDir?: () => string;
  hostAliases?: Record<string, string>;
  localhostAlias?: string;
  beta?: boolean;
  hostChecks?: NetDeps;
  stepTimeoutMs?: number;
  onEvent?: (event: OrchestratorEvent | Record<string, unknown>) => void;
  afterKeep?: (runId: string) => void;
  screensForReview?: (report: ReleaseReport, draft?: DiscoveryDraft) => VisualReviewItemInput[];
  visualReview?: (
    report: ReleaseReport,
    screens: VisualReviewItemInput[],
    options: { provider: AIProviderType; apiKey?: string; vision?: string }
  ) => Promise<{ reviewed: number; remaining: number; added: number; note?: string; outOfRequests?: boolean } | null>;
  saveReviewedReport?: (report: ReleaseReport) => Promise<void>;
  recordModelOutcomes?: (models?: ModelRecord) => Promise<void>;
  claimOwner?: (runId: string) => void;
  isMine?: (runId: string | null | undefined) => boolean;
}

/** What the run pieces share: the session, the deps, and the event fan-out. */
export interface RunContext {
  session: CheckupSession;
  deps: RunDeps;
  broadcast: (event: OrchestratorEvent | Record<string, unknown>) => void;
  forwardRunEvent: (event: OrchestratorEvent) => void;
  getSiteDir: () => string;
  /** Discovery's crawl and planning times, kept per run until testing starts (a plan can wait for review). */
  discoveryTimings: Map<string, TimingEntry[]>;
}
