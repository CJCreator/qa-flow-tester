import http from 'http';
import { timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { journeyPages, releaseVerdict } from '@qa/types';
import { serveUi, type UiApp } from './ui-static.js';
import type {
  RunSummary,
  SiteMapSummary,
  ProductProfile,
  ReleaseReport,
  RoleCredential,
  TestCase,
  AIProviderType,
  RunnerPhase,
  ReviewPlan,
  Breakpoint,
  AmbiguityQuestion,
  DiscoveredFlow,
  DiscoveryDraft,
  PageInventoryItem,
  PageLink,
  AIRequestBudget,
  BenchmarkJob,
} from '@qa/types';
import {
  FlowTestOrchestrator,
  DiscoveryAgent,
  TestPlanner,
  buildPageSweep,
  createAIProvider,
  runSafeWebsiteScan,
  KeyResolver,
  OpenRouterClient,
  OpenRouterAuthError,
  pickRecommendedModel,
  pickVisionModel,
  keepOrPickModels,
  fallbackModels,
  byTrackRecord,
  unreliable,
  completeWith,
  DEFAULT_MODELS,
  type ModelRecord,
  PreFlightChecker,
  PlanValidator,
  Redactor,
  replaceCredentialsWithPlaceholders,
  applySafeAnswers,
  isTestHost,
  markJourneysNeedingTestCopy,
  needsTestCopy,
  NEEDS_TEST_COPY,
  loadSiteMemory,
  saveSiteMemory,
  listSiteMemories,
  emptySiteMemory,
  applySiteMemory,
  rememberRun,
  rememberObservations,
  interpretTest,
  interpretRule,
  VisualReviewer,
  calculateSiteAspectGrades,
  generateRankedRecommendations,
  generateSingleFileHtmlReport,
  expandPlan,
  GRADED_CHECKS,
  planToMarkdown,
  PacedAI,
  BudgetSpentError,
  estimateScanRequests,
  SuppressionsManager,
  replanPage,
  replanMenus,
  replanJourneys,
  replanAll,
  addPagesToPlan,
  onOtherHost,
  pathOf,
  isSameSite,
  isPrivateHost,
  RobotsPolicy,
  BrowserManager,
  DeterministicSpider,
  blockChanges,
  isAbortError,
  type ReplanOptions,
  type VisualReviewItemInput,
  type MemorySummary,
  type SiteMemory,
  type RunOptions,
  type AIProvider,
  type OrchestratorEvent,
} from '@qa/core';
import { BenchmarkStore, cleanFlowType, compareSites, siteName } from './benchmarks.js';
import { SchedulerManager, type CheckupSchedule } from './scheduler.js';
import { SessionKeyResolver, currentSessionId, enterSession, refusedTarget, sessionFor } from './beta.js';

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Saved sign-in sessions (auth/<role>.json) hold live session cookies: no folder called "auth" is
 * served, at any depth. Any case: Windows and macOS read "AUTH" as "auth".
 */
function isSavedSession(dir: string, file: string): boolean {
  return path
    .relative(dir, file)
    .split(path.sep)
    .some((part) => part.toLowerCase() === 'auth');
}

/** Run ids are made here ("run-<time>"); anything else in an address is refused, so it can't leave the runs folder. */
function isRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) && !value.includes('..');
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false
  );
}

/** The largest JSON request accepted (characters). Plans are the biggest, and stay far below this. */
const MAX_BODY_CHARS = 5_000_000;

/** Check-ups kept per site; older ones are deleted after each run. Their grade history is kept. */
const RUNS_KEPT_PER_SITE = 10;

/** "30 September 2026", for sentences in the report. */
function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** The Host header names this computer. A page that points a name it controls at this port (DNS rebinding) doesn't. */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOOPBACK_HOSTS.includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** The cookie that carries the access key once a shared link has been opened. */
const ACCESS_COOKIE = 'qa_access';

/** One cookie's value from a Cookie header. */
function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const at = part.indexOf('=');
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Compared in constant time, so how long a refusal takes says nothing about the key. */
function matchesSecret(given: string | null | undefined, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const MAX_RUN_EVENTS = 5000;

/** Every screen size a check-up can test at. */
const ALL_SCREEN_SIZES: Breakpoint[] = ['375px', '768px', '1440px'];

/** Token use per stage, added together. */
function addTokens(a: AIRequestBudget['tokens'], b: AIRequestBudget['tokens']): AIRequestBudget['tokens'] {
  if (!b || Object.keys(b).length === 0) return a;
  const sum: NonNullable<AIRequestBudget['tokens']> = JSON.parse(JSON.stringify(a ?? {}));
  for (const [stage, u] of Object.entries(b) as Array<
    [keyof typeof sum, NonNullable<(typeof sum)[keyof typeof sum]>]
  >) {
    const s = (sum[stage] ??= { requests: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, truncated: 0 });
    s.requests += u.requests;
    s.promptTokens += u.promptTokens;
    s.completionTokens += u.completionTokens;
    s.reasoningTokens += u.reasoningTokens;
    s.truncated += u.truncated;
  }
  return sum;
}

/** The AI settings kept beside the key (not secret), so every browser gets the same setup. */
interface AiSettings {
  provider?: AIProviderType;
  text?: string | null;
  vision?: string | null;
  /** The person picked the models in Settings: they're kept while available, even when they struggle. */
  chosenBy?: 'person';
  chosenAt?: string;
}

/** The AI services a key can be added for. OpenRouter's free models cost nothing; the others are paid. */
const AI_PROVIDERS: Array<{ id: AIProviderType; name: string; free: boolean }> = [
  { id: 'openrouter', name: 'OpenRouter (free models)', free: true },
  { id: 'anthropic', name: 'Anthropic (Claude)', free: false },
  { id: 'openai', name: 'OpenAI', free: false },
  { id: 'gemini', name: 'Google Gemini', free: false },
];
/** AI requests the visual review of a finished run may use: part of the AI Request Budget estimate. */
const VISUAL_REVIEW_CALLS = 20;
/** Pages explored on another host the person includes from the review. */
const INCLUDED_HOST_PAGES = 30;
/** Pages explored for a sign-in added from the review. */
const SIGNED_IN_PAGES = 60;
const DOWNLOADABLE_REPORT_FILES: Record<string, string> = {
  'report.html': 'text/html; charset=utf-8',
  'report.md': 'text/markdown; charset=utf-8',
  'findings.json': 'application/json; charset=utf-8',
};

export interface RunnerServerOptions {
  port?: number;
  host?: string;
  outputDir?: string;
  /**
   * Where saved settings, site memory and history live: `.qa-data` in the working folder by default
   * (git-ignored). Must not be inside outputDir, which is served.
   */
  dataDir?: string;
  /**
   * When the runner runs in a container, `localhost` in a target URL means the user's machine,
   * not the container. Set this (e.g. "host.docker.internal") to rewrite such hosts.
   */
  localhostAlias?: string;
  /**
   * Reach a host at another address, as a hosts file would: { "shop.example.com": "localhost" }.
   * Everything decided about the site (live or test copy, what is remembered) still uses the host
   * as typed. Mainly for tests that need a "live" site on this machine.
   */
  hostAliases?: Record<string, string>;
  keyResolver?: KeyResolver;
  openRouter?: OpenRouterClient;
  /** Test seam: replaces the real AI provider construction. */
  createAIProvider?: (provider: AIProviderType, apiKey: string, model?: string) => AIProvider;
  /** Built UIs served beside the API: the Wizard at "/". None by default. */
  ui?: UiApp[];
  /**
   * Extra origins (full URL origins, e.g. "https://abc.trycloudflare.com") that are allowed to make
   * cross-origin requests in addition to localhost. Set via RUNNER_ALLOWED_ORIGINS (comma-separated).
   * Use only when deliberately sharing this runner over a tunnel or reverse proxy.
   */
  allowedOrigins?: string[];
  /**
   * A key every request must carry (RUNNER_ACCESS_TOKEN): opening any page with ?access=<key> keeps
   * it in a cookie, and scripts send it as an X-QA-Access header. `pnpm tunnel` sets one, because a
   * tunnel reaches this server with a localhost Host header, so the loopback check can't tell this
   * computer's pages from anyone else's.
   */
  accessToken?: string;
  /**
   * Beta mode (RUNNER_BETA=1), for a runner shared with a few outside testers: each tester's AI key and
   * sign-ins live in memory for their session only, only public sites can be checked, and the routes that
   * change what other testers see (deleting check-ups, schedules, comparisons) are closed.
   */
  beta?: boolean;
}

export interface TriggerRunBody {
  targetUrl: string;
  productId?: string;
  useAI?: boolean;
  aiProvider?: AIProviderType;
  apiKey?: string;
  aiModel?: string;
  releaseTarget?: string;
  breakpoints?: string[];
  headless?: boolean;
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
}

interface StoredPlanRecord {
  plan: ReviewPlan;
  context: {
    targetUrl: string;
    productId: string;
    runId: string;
    profile?: ProductProfile;
    reportNotes?: string[];
    aiModels?: { text?: string; vision?: string };
    breakpoints?: Breakpoint[];
    headless?: boolean;
    releaseTarget?: string;
    draft: DiscoveryDraft;
    /**
     * Roles whose sign-in details were left out of the saved file. Set only on a plan read back
     * from disk: the details have to be sent again with the approval.
     */
    signInNotSaved?: string[];
    /** Nothing that could change data is sent: the site isn't a test copy. */
    readOnly?: boolean;
    /** The site as the person typed it, e.g. "localhost:3050": the key for what is remembered about it. */
    siteHost?: string;
    /** How to reach the text model again, e.g. to turn a sentence into a test. A key given in the request stays in memory only. */
    ai?: { provider: AIProviderType; model?: string; apiKey?: string };
    /** The review sent its own test cases, which run as they are. */
    customTestCases?: boolean;
    /** Product context / spec documents provided for discovery. */
    productContext?: string;
    /** Check how search engines and AI assistants see the site: off for a test copy unless asked. */
    searchChecks?: boolean;
    visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
    /** Design tokens / design notes. */
    designNotes?: string;
    /** Path to product context file on disk if written. */
    contextFilePath?: string;
  };
}

/**
 * The plan as the review screen needs it: without each page's raw inventory of controls, and with
 * its links cut down to where they go (the map's lines). The full plan stays on the server.
 */
function planForClient(plan: ReviewPlan): ReviewPlan {
  const { testCases: _testCases, ...rest } = plan;
  return {
    ...rest,
    pages: plan.pages.map(({ elements: _elements, links, ...page }) => ({
      ...page,
      links: links?.filter((l) => !l.leavesSite).map((l) => ({ to: l.to, landsOn: l.landsOn }) as PageLink),
    })),
  };
}

/**
 * What a PATCH that only switched items, answered questions or changed sizes changed: the summary,
 * what won't run, the answers, the sizes, and the items touched (a page whole when one of its tests was).
 */
function planDelta(plan: ReviewPlan, touched: Set<string>) {
  const pageTouched = (p: NonNullable<ReviewPlan['planPages']>[number]) =>
    touched.has(p.id) || p.tests.some((t) => touched.has(t.id));
  return {
    delta: true as const,
    summary: plan.summary,
    wontRun: plan.wontRun,
    screenSizes: plan.screenSizes,
    questions: plan.questions,
    planPages: (plan.planPages || []).filter(pageTouched),
    navigation: (plan.navigation || []).filter((n) => touched.has(n.id)),
    flows: plan.flows.filter((f) => touched.has(`journey:${f.id}`)),
  };
}

/** An address's host as typed ("localhost:3050"), or the address itself when it isn't one. */
function hostOfAddress(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

/** Why a run is read-only, in plain words. */
function readOnlyReason(owner: boolean, testHost: boolean): string {
  if (!owner) {
    return 'You didn’t say you own this site, so it’s only looked at: nothing is sent or changed. If it’s yours, start a new check-up and tick “I own this site”.';
  }
  if (!testHost) {
    return 'This looks like a live site, so it’s only looked at: nothing is sent or changed. If it’s a test copy of your site, start a new check-up and choose “This is a test copy”.';
  }
  return '';
}

/** A test case in the shape the plan check reads. */
function asFlow(testCase: TestCase): DiscoveredFlow {
  return {
    id: testCase.id,
    name: testCase.name || testCase.id,
    role: testCase.role,
    description: '',
    startPage: testCase.startPage,
    steps: testCase.steps || [],
  };
}

/**
 * RunnerServer is the only component that actually invokes FlowTestOrchestrator /
 * DiscoveryAgent on behalf of the Wizard. It is the live, single-flight execution engine
 * for UI-triggered runs.
 */
export class RunnerServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private outputDir: string;
  private dataDir: string;
  private planFile: string;
  private streamClients = new Set<http.ServerResponse>();
  /** Beta: which visitor each open stream belongs to, so a run's events reach only the visitor who started it. */
  private streamSessions = new Map<http.ServerResponse, string | undefined>();
  /** Beta: which visitor started each run. A visitor sees only their own runs, plans and reports. */
  private runOwners = new Map<string, string>();
  /** Comparisons of two sites, running or just finished; the finished ones are also kept on disk. */
  private benchmarkJobs = new Map<string, { job: BenchmarkJob; owner?: string }>();
  private benchmarkBusy = false;

  private localhostAlias?: string;
  private hostAliases: Record<string, string>;
  private keyResolver: KeyResolver;
  /** Shared with outside testers: see RunnerServerOptions.beta. */
  private beta: boolean;
  private openRouter: OpenRouterClient;
  private makeAIProvider: (provider: AIProviderType, apiKey: string, model?: string) => AIProvider;
  private uiApps: UiApp[];
  private allowedOrigins: Set<string>;
  private accessToken?: string;

  private isRunning = false;
  private phase: RunnerPhase = 'idle';
  private lastReport: ReleaseReport | null = null;
  private lastRunError: string | null = null;
  private lastErrorCode: string | null = null;
  private activeAbortController: AbortController | null = null;
  /** Finishes the scan or test run early: the scan plans what it found, testing reports what it did. */
  private finishController: AbortController | null = null;
  /** Plans kept aside for other sites while one is reviewed or tested, by site. Also on disk. */
  private parkedPlans = new Map<string, StoredPlanRecord>();
  private currentPlanRecord: StoredPlanRecord | null = null;
  /** The run in progress or paused, so a reopened page can pick it up again. */
  private currentRunId: string | null = null;
  /** The site the run in progress or paused is for, as typed: the Resume card names it. */
  private currentTargetUrl: string | null = null;
  /**
   * Goes up whenever a scan or test run starts or is stopped. A run remembers the value it started
   * with; once it differs, the run was stopped or replaced, so its events and results are dropped.
   */
  private runGeneration = 0;
  /** Where sign-in sessions are saved: beside the runs, never inside one, and never served. */
  private authDir: string;
  /** The working folder that held the data before `.qa-data` existed, when the default data folder is used. */
  private legacyDataDir?: string;
  /** A plan update running in the background (re-planning, adding pages): one at a time. */
  private planUpdate: Promise<void> | null = null;
  /** This run's events, so a page that reopens or reconnects can replay them and show where the run is. */
  private runEvents: Array<Record<string, unknown>> = [];
  /** The chosen free models (not secret), kept beside the key so every browser gets the same setup. */
  private aiModelsFile: string;
  /** How each AI model has done on this machine. */
  private modelRecordFile: string;
  /** The defaults a check-up starts with (screen sizes). */
  private defaultsFile: string;
  /** Recent plan approval requests with their idempotency keys, cached for 1 hour to prevent duplicate runs. */
  private recentApprovals = new Map<string, { timestamp: number; runId: string }>();
  private baselineDir: string;
  private scheduler: SchedulerManager;

  constructor(options: RunnerServerOptions = {}) {
    this.port = options.port || 3001;
    this.host = options.host || 'localhost';
    this.outputDir = path.resolve(options.outputDir || path.join(process.cwd(), '.qa-runner-report'));
    this.baselineDir = path.resolve(process.cwd(), '.qa-baselines');
    this.localhostAlias = options.localhostAlias;
    this.hostAliases = Object.fromEntries(
      Object.entries(options.hostAliases || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), '.qa-data'));
    if (!options.dataDir) this.legacyDataDir = process.cwd();
    this.scheduler = new SchedulerManager(this.dataDir);
    this.authDir = path.join(this.outputDir, 'auth');
    this.planFile = path.join(this.dataDir, '.qa-plan.json');
    this.aiModelsFile = path.join(this.dataDir, '.qa-ai-models.json');
    this.modelRecordFile = path.join(this.dataDir, '.qa-ai-model-record.json');
    this.defaultsFile = path.join(this.dataDir, '.qa-settings.json');
    this.beta = !!options.beta;
    this.keyResolver = options.keyResolver || (this.beta ? new SessionKeyResolver() : new KeyResolver(this.dataDir));
    this.openRouter = options.openRouter || new OpenRouterClient();
    this.makeAIProvider =
      options.createAIProvider || ((provider, apiKey, model) => createAIProvider(provider, apiKey, undefined, model));
    this.uiApps = options.ui || [];
    this.allowedOrigins = new Set(
      (options.allowedOrigins || []).map((o) => {
        const clean = o
          .replace(/\u001b\[[0-9;]*[a-zA-Z]|\u001b\].*?\u0007/g, '')
          .trim()
          .replace(/\/+$/, '');
        try {
          return new URL(clean).origin;
        } catch {
          return clean;
        }
      })
    );
    this.accessToken = options.accessToken || undefined;
  }

  /** Beta: whether a run belongs to the visitor making this request. Outside beta every run is everyone's. */
  private isMine(runId: string | null | undefined): boolean {
    if (!this.beta) return true;
    const me = currentSessionId();
    return !!me && !!runId && this.runOwners.get(runId) === me;
  }

  /** Where this visitor's remembered sites live: shared outside beta, one folder per visitor in beta. */
  private siteDir(): string {
    if (!this.beta) return this.dataDir;
    return path.join(this.dataDir, 'sessions', (currentSessionId() ?? 'none').replace(/[^\w-]/g, '_'));
  }

  /** Answers 404 and returns true when the run is another visitor's. */
  private refuseNotMine(res: http.ServerResponse, runId: string | null | undefined): boolean {
    if (this.isMine(runId)) return false;
    this.sendJson(res, 404, { error: 'There’s nothing of yours at that address.', code: 'ERR_NOT_YOURS' });
    return true;
  }

  public broadcastRunnerEvent(event: OrchestratorEvent | Record<string, unknown>): void {
    this.recordRunEvent(event as Record<string, unknown>);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const eventRun =
      typeof (event as Record<string, unknown>).runId === 'string'
        ? ((event as Record<string, unknown>).runId as string)
        : this.currentRunId;
    const owner = this.beta && eventRun ? this.runOwners.get(eventRun) : undefined;
    for (const client of this.streamClients) {
      // Beta: a run's events go only to the visitor who started it.
      if (this.beta && (!owner || this.streamSessions.get(client) !== owner)) continue;
      try {
        client.write(payload);
      } catch {
        this.streamClients.delete(client);
      }
    }
  }

  /**
   * Keeps the event for replay. The finished report is left out (it is fetched on its own), and on a
   * very long run the oldest step events go first: only the latest step matters to someone catching up.
   */
  private recordRunEvent(event: Record<string, unknown>): void {
    if (!this.currentRunId) return;
    if (typeof event.runId === 'string' && event.runId !== this.currentRunId) return;
    this.runEvents.push(event.type === 'RUN_COMPLETED' ? { type: event.type, runId: event.runId } : event);
    if (this.runEvents.length > MAX_RUN_EVENTS) {
      const half = this.runEvents.length / 2;
      this.runEvents = this.runEvents.filter(
        (e, i) => i >= half || (e.type !== 'STEP_STARTED' && e.type !== 'STEP_COMPLETED')
      );
    }
  }

  /** Stores the report before announcing completion, so a client reacting to RUN_COMPLETED gets this run's report. */
  private forwardRunEvent(event: OrchestratorEvent): void {
    if (event.type === 'RUN_COMPLETED') this.lastReport = event.report;
    this.broadcastRunnerEvent(event);
  }

  /**
   * With an access key set, a request gets in only with the key. A link's ?access=<key> is moved into
   * a cookie and the page reloaded without it, so the key doesn't stay in the address bar or history.
   * False once the request has been answered here.
   */
  private grantAccess(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
    const key = this.accessToken;
    if (!key) return true;
    if (matchesSecret(cookieValue(req.headers.cookie, ACCESS_COOKIE), key)) return true;
    const header = req.headers['x-qa-access'];
    if (matchesSecret(Array.isArray(header) ? header[0] : header, key)) return true;

    if (req.method === 'GET' && matchesSecret(url.searchParams.get('access'), key)) {
      url.searchParams.delete('access');
      // Secure only when the visit was https (a tunnel says so): plain-http localhost would drop the cookie.
      const proto = req.headers['x-forwarded-proto'];
      const isHttps =
        (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ||
        (typeof req.headers['cf-visitor'] === 'string' && req.headers['cf-visitor'].includes('https')) ||
        Array.from(this.allowedOrigins).some((o) => o.startsWith('https://'));
      const secure = isHttps ? '; Secure' : '';
      res.writeHead(303, {
        'Set-Cookie': `${ACCESS_COOKIE}=${encodeURIComponent(key)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
        Location: `${url.pathname}${url.search}`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return false;
    }

    if (url.pathname.startsWith('/api/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'This QA Tool is shared privately: send its access key.' }));
    } else {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        'This Release check-up is shared privately. Open it with the full link you were given: it includes the access key.'
      );
    }
    return false;
  }

  public async start(): Promise<string> {
    await this.moveLegacyData();
    await this.ensurePlanLoaded();
    await this.loadLatestReport();
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
          const pathname = url.pathname;

          // A host's health check asks this and nothing else: it says the server is up and shows no data.
          if (pathname === '/healthz') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('ok');
            return;
          }

          // Only this computer's own names (or explicitly allowed tunnel origins) are answered,
          // so a page can't point a name it controls at this port (DNS rebinding) and read reports.
          const hostHeader = req.headers.host;
          const isAllowedHost =
            isLoopbackHost(hostHeader) ||
            (hostHeader &&
              Array.from(this.allowedOrigins).some((o) => {
                try {
                  return new URL(o).hostname.toLowerCase() === hostHeader.split(':')[0].toLowerCase();
                } catch {
                  return false;
                }
              }));

          if (!isAllowedHost) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(
              `Release check-up only answers on this computer or allowed tunnel hosts. Open http://localhost:${this.port}/ instead.`
            );
            return;
          }

          // Only localhost pages (or explicitly allowed origins) may drive the runner; a wildcard
          // would let any website trigger runs. Extra origins are set via RUNNER_ALLOWED_ORIGINS.
          const origin = req.headers.origin;
          const originNorm = origin ? origin.replace(/\/+$/, '') : undefined;
          if (origin && (isLoopbackOrigin(origin) || (originNorm && this.allowedOrigins.has(originNorm)))) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-QA-Access');
          } else if (origin && req.method !== 'GET') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Cross-origin requests are only accepted from localhost' }));
            return;
          }

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          if (!this.grantAccess(req, res, url)) return;

          if (this.beta) {
            const proto = req.headers['x-forwarded-proto'];
            enterSession(sessionFor(req, res, (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ?? false));
            if (this.closedInBeta(req.method, pathname)) {
              this.sendJson(res, 403, {
                error: 'This is closed on the shared beta copy, so testers don’t change each other’s check-ups.',
                code: 'ERR_BETA',
              });
              return;
            }
            if (await this.betaScope(req, res, pathname)) return;
          }

          // QA Flow Studio is retired (ADR 0010): its old addresses lead to Past check-ups.
          if (pathname === '/studio' || pathname.startsWith('/studio/')) {
            res.writeHead(308, { Location: '/reports' });
            res.end();
            return;
          }

          // Past check-ups: GET /api/runs, GET /api/runs/<runId>, GET /api/runs/<runId>/download/<file>,
          // DELETE /api/runs/<runId>
          if (pathname === '/api/runs' || pathname.startsWith('/api/runs/')) {
            await this.handleRuns(pathname.slice('/api/runs'.length), req, res);
            return;
          }

          // GET /api/runner/stream (Server-Sent Events)
          if (pathname === '/api/runner/stream' && req.method === 'GET') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            });
            res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
            // A page that opens or reconnects mid-run catches up: this run's events so far, in order (beta: only the visitor's own run).
            if (this.isMine(this.currentRunId))
              for (const event of this.runEvents)
                res.write(`data: ${JSON.stringify({ ...event, replayed: true })}\n\n`);
            this.streamClients.add(res);
            if (this.beta) this.streamSessions.set(res, currentSessionId());
            req.on('close', () => {
              this.streamClients.delete(res);
              this.streamSessions.delete(res);
            });
            return;
          }

          // POST /api/runner/run
          if (pathname === '/api/runner/run' && req.method === 'POST') {
            await this.handleTriggerRun(req, res);
            return;
          }

          // POST /api/runner/abort or /api/runner/stop
          if ((pathname === '/api/runner/abort' || pathname === '/api/runner/stop') && req.method === 'POST') {
            await this.handleAbortRun(req, res);
            return;
          }

          // GET /api/report — last completed run's ReleaseReport
          if (pathname === '/api/report' && req.method === 'GET') {
            if (!this.lastReport) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No completed run yet' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.lastReport));
            return;
          }

          // GET /api/runner/status
          if (pathname === '/api/runner/status' && req.method === 'GET') {
            await this.ensurePlanLoaded();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                isRunning: this.isRunning,
                hasReport: !!this.lastReport,
                lastRunError: this.lastRunError,
                lastErrorCode: this.lastErrorCode,
                phase: this.phase,
                hasPlan: !!this.currentPlanRecord,
                runId: this.currentRunId,
                // The site the run in progress or paused is for, as typed, for the Resume card.
                targetUrl: this.currentPlanRecord?.plan.targetUrl ?? this.currentTargetUrl,
                // The finished report, when the last run finished.
                reportRunId: this.lastReport?.runId ?? null,
                // A copy shared with other people: their check-ups and reports are visible to each other.
                beta: this.beta,
              })
            );
            return;
          }

          // GET /api/runner/plan
          if (pathname === '/api/runner/plan' && req.method === 'GET') {
            await this.handleGetPlan(req, res);
            return;
          }

          // PATCH /api/runner/plan
          if (pathname === '/api/runner/plan' && req.method === 'PATCH') {
            await this.handlePatchPlan(req, res);
            return;
          }

          // POST /api/runner/plan/approve
          if (pathname === '/api/runner/plan/approve' && req.method === 'POST') {
            await this.handleApprovePlan(req, res);
            return;
          }

          // POST /api/runner/plan/interpret — a sentence becomes a test or a rule, shown back before it's added
          if (pathname === '/api/runner/plan/interpret' && req.method === 'POST') {
            await this.handleInterpret(req, res);
            return;
          }

          // GET /api/runner/plan/markdown — the whole plan as a Markdown document, for sign-off
          if (pathname === '/api/runner/plan/markdown' && req.method === 'GET') {
            await this.handlePlanMarkdown(res);
            return;
          }

          // Changes that need the AI or the crawler run in the background (202, then PLAN_UPDATE_* events):
          // POST /api/runner/plan/replan — plan an item, a promoted page, or everything again
          if (pathname === '/api/runner/plan/replan' && req.method === 'POST') {
            await this.handleReplan(req, res);
            return;
          }
          // POST /api/runner/plan/add-page — add a page by its address
          if (pathname === '/api/runner/plan/add-page' && req.method === 'POST') {
            await this.handleAddPage(req, res);
            return;
          }
          // GET/POST /api/runner/waiting-plans — plans kept aside for other sites, and bringing one back
          if (pathname === '/api/runner/waiting-plans') {
            await this.handleWaitingPlans(req, res);
            return;
          }
          // POST /api/runner/plan/add-sign-in — sign in as a role, explore what it sees, and plan it
          if (pathname === '/api/runner/plan/add-sign-in' && req.method === 'POST') {
            await this.handleAddSignIn(req, res);
            return;
          }
          // POST /api/runner/plan/include-host — explore another host the site links to, and plan its pages
          if (pathname === '/api/runner/plan/include-host' && req.method === 'POST') {
            await this.handleIncludeHost(req, res);
            return;
          }

          // GET /api/sites, POST /api/sites/<host> — what's remembered per site: its choices and saved sign-ins
          if (pathname === '/api/sites' || pathname.startsWith('/api/sites/')) {
            await this.handleSites(
              decodeURIComponent(pathname.slice('/api/sites'.length).replace(/^\//, '')),
              req,
              res
            );
            return;
          }

          // GET/POST /api/settings/defaults — the screen sizes a check-up starts with
          if (pathname === '/api/settings/defaults') {
            await this.handleDefaults(req, res);
            return;
          }

          // POST /api/runner/ai-estimate — about how many AI requests a scan needs, against what's left today
          if (pathname === '/api/runner/ai-estimate' && req.method === 'POST') {
            await this.handleAiEstimate(req, res);
            return;
          }

          // POST /api/runner/preflight — is the target URL reachable? (no browser, no run)
          if (pathname === '/api/runner/preflight' && req.method === 'POST') {
            await this.handlePreflight(req, res);
            return;
          }

          // GET /api/report/download/<report.md|findings.json> — the run's files, byte-for-byte
          if (pathname.startsWith('/api/report/download/') && req.method === 'GET') {
            await this.handleReportDownload(pathname.replace('/api/report/download/', ''), res);
            return;
          }

          // POST /api/runner/ai/finish (Task 2.4: finish visual review on remaining screens)
          if (pathname === '/api/runner/ai/finish' && req.method === 'POST') {
            await this.handleAiFinish(req, res);
            return;
          }

          if (pathname.startsWith('/api/ai/') && !pathname.startsWith('/api/ai/openrouter/')) {
            if (await this.handleAiSettings(pathname.slice('/api/ai/'.length), req, res)) return;
          }
          if (pathname.startsWith('/api/ai/openrouter/')) {
            await this.handleOpenRouter(pathname.replace('/api/ai/openrouter/', ''), req, res);
            return;
          }

          // GET /api/baselines/* — static visual baseline image serving
          if (pathname.startsWith('/api/baselines/') && req.method === 'GET') {
            await this.handleServeBaseline(decodeURIComponent(pathname.replace('/api/baselines/', '')), res);
            return;
          }

          // Visual Baseline API
          if (pathname === '/api/runner/baselines' && req.method === 'GET') {
            await this.handleListBaselines(res);
            return;
          }
          if (pathname === '/api/runner/baselines/accept' && req.method === 'POST') {
            await this.handleAcceptBaseline(req, res);
            return;
          }
          if (pathname.startsWith('/api/runner/baselines/') && req.method === 'DELETE') {
            await this.handleDeleteBaseline(decodeURIComponent(pathname.replace('/api/runner/baselines/', '')), res);
            return;
          }

          // Benchmarking: compare your site with another one.
          if (pathname === '/api/runner/benchmark' && req.method === 'POST') {
            await this.handleStartBenchmark(req, res);
            return;
          }
          if (pathname === '/api/runner/benchmarks' && req.method === 'GET') {
            await this.handleListBenchmarks(res);
            return;
          }
          if (pathname.startsWith('/api/runner/benchmark/') && (req.method === 'GET' || req.method === 'DELETE')) {
            await this.handleBenchmarkById(
              decodeURIComponent(pathname.slice('/api/runner/benchmark/'.length)),
              req.method,
              res
            );
            return;
          }

          // Schedules API
          if (pathname === '/api/runner/schedules' && req.method === 'GET') {
            const list = await this.scheduler.loadSchedules();
            this.sendJson(res, 200, list);
            return;
          }
          if (pathname === '/api/runner/schedules' && req.method === 'POST') {
            await this.handleAddSchedule(req, res);
            return;
          }
          if (pathname.startsWith('/api/runner/schedules/') && pathname.endsWith('/toggle') && req.method === 'POST') {
            const id = pathname.replace('/api/runner/schedules/', '').replace('/toggle', '');
            const body = await this.readJsonBody<{ enabled: boolean }>(req).catch(() => ({ enabled: true }));
            const updated = await this.scheduler.toggleSchedule(id, body.enabled);
            this.sendJson(res, updated ? 200 : 404, updated || { error: 'Schedule not found' });
            return;
          }
          if (pathname.startsWith('/api/runner/schedules/') && req.method === 'DELETE') {
            const id = pathname.replace('/api/runner/schedules/', '');
            const ok = await this.scheduler.deleteSchedule(id);
            this.sendJson(res, ok ? 200 : 404, { ok });
            return;
          }

          // GET /api/evidence/* — static evidence file serving, rooted at this runner's own output
          // dir. A run's files are under runs/<runId>/ (evidence, page thumbnails, its reports).
          if (pathname.startsWith('/api/evidence/') && req.method === 'GET') {
            const relPath = decodeURIComponent(pathname.replace('/api/evidence/', ''));
            const targetFile = path.resolve(this.outputDir, relPath);
            // Checked again on the path the file system really opens, so neither a link nor another
            // spelling of the same folder can reach a saved session.
            const realTarget = await fs.realpath(targetFile).catch(() => null);
            const realRoot = realTarget
              ? await fs.realpath(this.outputDir).catch(() => this.outputDir)
              : this.outputDir;
            const forbidden =
              !isInside(this.outputDir, targetFile) ||
              isSavedSession(this.outputDir, targetFile) ||
              (realTarget !== null && (!isInside(realRoot, realTarget) || isSavedSession(realRoot, realTarget)));
            if (forbidden) {
              res.writeHead(403, { 'Content-Type': 'text/plain' });
              res.end('Forbidden');
              return;
            }
            try {
              const stat = await fs.stat(targetFile);
              if (!stat.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not a file');
                return;
              }
              const ext = path.extname(targetFile).toLowerCase();
              let mime = 'application/octet-stream';
              if (ext === '.png') mime = 'image/png';
              else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
              else if (ext === '.html') mime = 'text/html; charset=utf-8';
              else if (ext === '.json') mime = 'application/json';
              else if (ext === '.webm') mime = 'video/webm';
              const content = await fs.readFile(targetFile);
              res.writeHead(200, { 'Content-Type': mime });
              res.end(content);
            } catch {
              if (relPath.endsWith('product-context.md')) {
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('');
                return;
              }
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end(`Evidence file not found: ${relPath}`);
            }
            return;
          }

          // Everything that isn't the API is one of the built UIs.
          if (!pathname.startsWith('/api/') && (await serveUi(this.uiApps, req, res, pathname))) return;

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: msg }));
        }
      });

      this.server.listen(this.port, this.host, () => {
        resolve(`http://${this.host}:${this.port}`);
      });
      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    // Open event streams would otherwise keep the server from ever finishing its close.
    for (const client of this.streamClients) client.end();
    this.streamClients.clear();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY_CHARS) throw new Error('Request body too large');
    }
    return JSON.parse(body) as T;
  }

  /**
   * Beta only: each visitor sees their own check-up and nothing of anyone else's. The runner holds one
   * run at a time, so what is "current" belongs to whoever started it; to everyone else it doesn't
   * exist. True once the request has been answered here.
   */
  private async betaScope(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<boolean> {
    const method = req.method;
    if (pathname === '/api/runner/status' && method === 'GET') {
      if (this.isMine(this.currentRunId)) return false;
      const busy = this.phase === 'scanning' || this.phase === 'testing' || this.benchmarkBusy;
      this.sendJson(res, 200, {
        isRunning: false,
        hasReport: false,
        lastRunError: null,
        lastErrorCode: null,
        phase: 'idle',
        hasPlan: false,
        runId: null,
        targetUrl: null,
        reportRunId: null,
        beta: true,
        busy,
      });
      return true;
    }
    // What the current run offers: its plan, its changes, finishing its review.
    const ofCurrentRun =
      (pathname.startsWith('/api/runner/plan') && pathname !== '/api/runner/waiting-plans') ||
      pathname === '/api/runner/ai/finish';
    if (ofCurrentRun) return this.refuseNotMine(res, this.currentRunId);
    if ((pathname === '/api/runner/abort' || pathname === '/api/runner/stop') && method === 'POST') {
      if (this.isMine(this.currentRunId)) return false;
      this.sendJson(res, 200, { aborted: false, message: 'No run currently active' });
      return true;
    }
    if ((pathname === '/api/report' || pathname.startsWith('/api/report/download/')) && method === 'GET') {
      return this.refuseNotMine(res, this.lastReport?.runId);
    }
    if (pathname.startsWith('/api/evidence/')) {
      let rel = '';
      try {
        rel = decodeURIComponent(pathname.slice('/api/evidence/'.length));
      } catch {
        // not a path
      }
      return this.refuseNotMine(res, rel.match(/^runs\/(run-\d+)\//)?.[1]);
    }
    // Visual baselines are kept per site for the whole copy: not offered here.
    if (pathname.startsWith('/api/baselines/') || pathname.startsWith('/api/runner/baselines')) {
      if (pathname === '/api/runner/baselines' && method === 'GET') {
        this.sendJson(res, 200, []);
        return true;
      }
      this.sendJson(res, 403, {
        error: 'This is closed on the shared beta copy, so testers don’t change each other’s check-ups.',
        code: 'ERR_BETA',
      });
      return true;
    }
    return false;
  }

  /** Routes that change what every tester sees; shut on a beta copy. */
  private closedInBeta(method: string | undefined, pathname: string): boolean {
    if (pathname.startsWith('/api/runner/schedules') && method !== 'GET') return true;
    return method === 'DELETE' && (pathname.startsWith('/api/runs/') || pathname.startsWith('/api/runner/baselines/'));
  }

  /** Beta only: answers 400 and returns true when a tester asked for an address that isn't on the public internet. */
  private async refuseTarget(res: http.ServerResponse, address: string | undefined): Promise<boolean> {
    if (!this.beta || !address) return false;
    const reason = await refusedTarget(address);
    if (!reason) return false;
    this.sendJson(res, 400, {
      reachable: false,
      reason: 'private-address',
      code: 'ERR_PRIVATE_TARGET',
      error: reason,
      suggestion: reason,
    });
    return true;
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  /**
   * The address to connect to: a host alias, or localhost mapped to the host machine when the
   * runner itself runs in a container. Everything else is used as typed.
   */
  private resolveTargetUrl(targetUrl: string): string {
    try {
      const u = new URL(targetUrl);
      const alias = this.hostAliases[u.hostname.toLowerCase()];
      if (alias) u.hostname = alias;
      else if (this.localhostAlias && LOOPBACK_HOSTS.includes(u.hostname)) u.hostname = this.localhostAlias;
      else return targetUrl;
      return u.toString();
    } catch {
      // Invalid URLs are reported by the caller.
      return targetUrl;
    }
  }

  private async handlePreflight(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let targetUrl: string | undefined;
    try {
      ({ targetUrl } = await this.readJsonBody<{ targetUrl?: string }>(req));
      if (!targetUrl || !/^https?:$/.test(new URL(targetUrl).protocol)) throw new Error();
    } catch {
      this.sendJson(res, 400, {
        reachable: false,
        reason: 'invalid-url',
        code: 'ERR_INVALID_URL',
        suggestion: 'Please enter a valid HTTP or HTTPS address (e.g. http://localhost:3050 or https://example.com).',
      });
      return;
    }

    if (await this.refuseTarget(res, targetUrl)) return;

    // Said before the scan: whether this address can be tested fully (a Test Copy), and what was
    // chosen for the site last time, so the screen can start from it.
    const typed = new URL(targetUrl);
    const memory = await loadSiteMemory(this.siteDir(), typed.host).catch(() => null);
    const about = {
      host: typed.host,
      testCopy: isTestHost(typed.hostname, memory?.staging ? [typed.hostname] : []),
      remembered: memory
        ? {
            owner: memory.owner,
            markedTestCopy: memory.staging || undefined,
            searchChecks: memory.searchChecks,
            signIns: memory.signIns?.length
              ? memory.signIns.map((s) => ({ role: s.role, username: s.username }))
              : undefined,
          }
        : undefined,
    };

    const check = await new PreFlightChecker().checkUrlReachable(this.resolveTargetUrl(targetUrl));
    if (check.ok) {
      if (check.testCopyHeader) {
        about.testCopy = true;
      }
      this.sendJson(res, 200, { reachable: true, statusCode: check.status, ...about });
    } else {
      const code = check.status ? 'ERR_SERVER_ERROR' : 'ERR_TARGET_UNREACHABLE';
      const suggestion = check.status
        ? `The site answered with an error (${check.status}). Check it's working, then try again.`
        : 'Make sure the site is running and the address is right, then try again.';
      this.sendJson(res, 200, {
        reachable: false,
        reason: check.status ? 'server-error' : 'unreachable',
        code,
        statusCode: check.status,
        suggestion,
        ...about,
      });
    }
  }

  /** The keychain account a site's saved sign-in password is kept under. */
  private signInAccount(host: string, role: string): string {
    return `signin:${host.toLowerCase()}:${role}`;
  }

  /**
   * GET "" lists every remembered site: whether it's a test copy, whether search is checked, and its
   * saved sign-ins (never their passwords). POST "<host>" { searchChecks?, forgetSignIn? } changes one.
   */
  private async handleSites(host: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!host && req.method === 'GET') {
      const sites = await listSiteMemories(this.siteDir());
      this.sendJson(res, 200, {
        sites: sites.map((m) => ({
          host: m.host,
          owner: m.owner,
          markedTestCopy: m.staging || undefined,
          searchChecks: m.searchChecks,
          signIns: m.signIns ?? [],
          updatedAt: m.updatedAt,
        })),
      });
      return;
    }
    if (host && req.method === 'POST') {
      let body: {
        searchChecks?: boolean | null;
        forgetSignIn?: string;
        addSignIn?: { role?: string; username?: string; password?: string; loginPath?: string };
        testSignIn?: string;
      } = {};
      try {
        body = await this.readJsonBody(req);
      } catch {
        this.sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      if (body.addSignIn || body.testSignIn) {
        await this.handleSignInChange(host, body, res);
        return;
      }
      const memory = await loadSiteMemory(this.siteDir(), host);
      if (!memory) {
        this.sendJson(res, 404, { error: 'That site isn’t remembered.' });
        return;
      }
      if (body.searchChecks !== undefined) memory.searchChecks = body.searchChecks ?? undefined;
      if (body.forgetSignIn) {
        memory.signIns = (memory.signIns ?? []).filter((s) => s.role !== body.forgetSignIn);
        await this.keyResolver.forgetSecret(this.signInAccount(memory.host, body.forgetSignIn));
      }
      await saveSiteMemory(this.siteDir(), memory);
      this.sendJson(res, 200, { saved: true });
      return;
    }
    this.sendJson(res, 404, { error: 'Not found' });
  }

  /**
   * Adds a sign-in to a site, or tests a saved one: it signs in on the site's sign-in page and says
   * whether that worked. A new sign-in is kept (password in the keychain) only when it worked.
   */
  private async handleSignInChange(
    host: string,
    body: {
      addSignIn?: { role?: string; username?: string; password?: string; loginPath?: string };
      testSignIn?: string;
    },
    res: http.ServerResponse
  ): Promise<void> {
    const memory = (await loadSiteMemory(this.siteDir(), host)) ?? emptySiteMemory(host);
    let credential: RoleCredential;
    if (body.addSignIn) {
      const role =
        (body.addSignIn.role || 'member')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9 _-]/g, '')
          .slice(0, 40) || 'member';
      if (!body.addSignIn.username?.trim() || !body.addSignIn.password) {
        this.sendJson(res, 400, { error: 'Enter the username and password to sign in with.' });
        return;
      }
      credential = {
        role,
        username: body.addSignIn.username.trim(),
        password: body.addSignIn.password,
        loginPath: body.addSignIn.loginPath?.trim() || undefined,
      };
    } else {
      const saved = memory.signIns?.find((s) => s.role === body.testSignIn);
      const password = saved
        ? await this.keyResolver.readSecret(this.signInAccount(memory.host, saved.role))
        : undefined;
      if (!saved || !password) {
        this.sendJson(res, 404, { error: 'That sign-in isn’t saved here.' });
        return;
      }
      credential = { role: saved.role, username: saved.username, password, loginPath: saved.loginPath };
    }

    let target: string;
    try {
      const typed = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`);
      const scheme = /^https?:\/\//i.test(host) ? typed.protocol : isTestHost(typed.hostname) ? 'http:' : 'https:';
      target = this.resolveTargetUrl(`${scheme}//${typed.host}`);
    } catch {
      this.sendJson(res, 400, { error: 'That isn’t a site address.' });
      return;
    }
    const browser = new BrowserManager();
    let result: { ok: boolean; landingPath?: string };
    try {
      const context = await browser.createContext({ baseUrl: target });
      result = await new PreFlightChecker().signIn(context, target, credential);
    } catch {
      result = { ok: false };
    } finally {
      await browser.close();
    }

    if (!result.ok) {
      this.sendJson(res, body.addSignIn ? 422 : 200, {
        verified: false,
        error: 'Signing in didn’t work. Check the username, password and sign-in page, and that the site is reachable.',
      });
      return;
    }
    if (body.addSignIn) {
      if (
        !(await this.keyResolver.saveSecret(this.signInAccount(memory.host, credential.role), credential.password!))
      ) {
        this.sendJson(res, 200, {
          verified: true,
          saved: false,
          landingPath: result.landingPath,
          error: 'Signing in worked, but this computer has no keychain to keep the password in.',
        });
        return;
      }
      memory.signIns = [
        ...(memory.signIns ?? []).filter((s) => s.role !== credential.role),
        { role: credential.role, username: credential.username, loginPath: credential.loginPath },
      ];
      await saveSiteMemory(this.siteDir(), memory);
    }
    this.sendJson(res, 200, { verified: true, saved: !!body.addSignIn, landingPath: result.landingPath });
  }

  private async readDefaults(): Promise<{ screenSizes?: Breakpoint[] }> {
    try {
      return JSON.parse(await fs.readFile(this.defaultsFile, 'utf8'));
    } catch {
      return {};
    }
  }

  /** GET: the defaults a check-up starts with. POST { screenSizes }: changes them. */
  private async handleDefaults(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      const defaults = await this.readDefaults();
      this.sendJson(res, 200, { screenSizes: defaults.screenSizes ?? ALL_SCREEN_SIZES });
      return;
    }
    if (req.method === 'POST') {
      let body: { screenSizes?: string[] } = {};
      try {
        body = await this.readJsonBody(req);
      } catch {
        // checked below
      }
      const sizes = ALL_SCREEN_SIZES.filter((s) => body.screenSizes?.includes(s));
      if (sizes.length === 0) {
        this.sendJson(res, 400, { error: 'Choose at least one screen size.' });
        return;
      }
      await fs.mkdir(path.dirname(this.defaultsFile), { recursive: true });
      await fs.writeFile(
        this.defaultsFile,
        JSON.stringify({ ...(await this.readDefaults()), screenSizes: sizes }, null, 2),
        'utf8'
      );
      this.sendJson(res, 200, { screenSizes: sizes });
      return;
    }
    this.sendJson(res, 404, { error: 'Not found' });
  }

  /**
   * The sign-ins a check-up uses: the ones given, remembered for the site when asked (passwords in
   * the OS keychain only); or, when none are given and the person asked for them, the saved ones.
   */
  private async signInsFor(
    body: TriggerRunBody,
    memory: SiteMemory | null,
    host: string
  ): Promise<{ roles?: RoleCredential[]; memory: SiteMemory | null; note?: string }> {
    if (body.roles?.length) {
      if (!body.rememberSignIns) return { roles: body.roles, memory };
      const saved: NonNullable<SiteMemory['signIns']> = [];
      let unsaved = 0;
      for (const role of body.roles) {
        if (role.password && !(await this.keyResolver.saveSecret(this.signInAccount(host, role.role), role.password))) {
          unsaved++;
          continue;
        }
        saved.push({ role: role.role, username: role.username, loginPath: role.loginPath });
      }
      const next = { ...(memory ?? emptySiteMemory(host)), signIns: saved };
      return {
        roles: body.roles,
        memory: next,
        note:
          unsaved > 0
            ? 'This computer has no keychain to keep passwords in, so the sign-ins weren’t remembered.'
            : undefined,
      };
    }
    if (!body.useSavedSignIns || !memory?.signIns?.length) return { memory };
    const roles: RoleCredential[] = [];
    for (const s of memory.signIns) {
      const password = await this.keyResolver.readSecret(this.signInAccount(host, s.role));
      if (password) roles.push({ role: s.role, username: s.username, password, loginPath: s.loginPath });
    }
    return { roles: roles.length > 0 ? roles : undefined, memory };
  }

  /**
   * { targetUrl, maxPages } → about how many AI requests the scan needs (planning, repairs, and the
   * visual review after the run), and how many the key has left today, before anything starts.
   */
  private async handleAiEstimate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: { targetUrl?: string; maxPages?: number } = {};
    try {
      body = await this.readJsonBody(req);
    } catch {
      // estimated for a typical site
    }
    let host: string | undefined;
    try {
      host = body.targetUrl ? new URL(body.targetUrl).host : undefined;
    } catch {
      // estimated for a typical site
    }
    const memory = host ? await loadSiteMemory(this.siteDir(), host).catch(() => null) : null;
    const maxPages =
      typeof body.maxPages === 'number' && body.maxPages > 0 ? Math.min(Math.floor(body.maxPages), 1000) : 200;
    // Pages whose approved plan is reused aren't asked about again.
    const planned = memory?.plan ? Object.keys(memory.plan.pages).length : undefined;
    const estimate = estimateScanRequests({
      maxPages,
      pagesSeenBefore: planned ?? memory?.pages.length,
      visualReviewCalls: VISUAL_REVIEW_CALLS,
    });
    const setup = await this.aiSetup();
    const today =
      setup.provider === 'openrouter' && setup.key
        ? await this.openRouter.freeRequestsToday(setup.key).catch(() => null)
        : null;
    this.sendJson(res, 200, {
      ...estimate,
      seenBefore: !!memory,
      provider: setup.provider,
      free: setup.provider === 'openrouter',
      left: today?.remaining ?? null,
      limit: today?.limit ?? null,
    });
  }

  /** The folder that holds one run's files: its scan, evidence and reports. */
  private runDir(runId: string): string {
    return path.join(this.outputDir, 'runs', runId);
  }

  /** A path inside a run's folder, as the Wizard addresses it: /api/evidence/runs/<runId>/<path>. */
  private relativeToRun(runId: string, file?: string): string | undefined {
    if (!file) return undefined;
    const rel = path.relative(this.runDir(runId), file);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : undefined;
  }

  /** Every finished check-up, newest first. A folder without a summary is a run that never finished. */
  private async listRuns(): Promise<RunSummary[]> {
    const root = path.join(this.outputDir, 'runs');
    const names = await fs.readdir(root).catch(() => [] as string[]);
    const runs: RunSummary[] = [];
    for (const name of names) {
      if (!isRunId(name)) continue;
      try {
        runs.push(JSON.parse(await fs.readFile(path.join(root, name, 'summary.json'), 'utf8')) as RunSummary);
      } catch {
        // not finished
      }
    }
    return runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Keeps a finished run: its full report and a short summary beside the files the run wrote. The
   * newest findings also stay at the top of the report folder, where the next run's delta reads them.
   * Then only the newest RUNS_KEPT_PER_SITE runs of the site are kept.
   */
  private async keepRun(report: ReleaseReport, typedTargetUrl: string, siteHost: string | undefined): Promise<void> {
    const dir = this.runDir(report.runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report), 'utf8');
    const verdict = releaseVerdict(report.findings);
    let host = siteHost;
    try {
      host ??= new URL(typedTargetUrl).host;
    } catch {
      host ??= typedTargetUrl;
    }
    const summary: RunSummary = {
      runId: report.runId,
      targetUrl: typedTargetUrl,
      host,
      timestamp: report.timestamp,
      durationMs: report.durationMs,
      ready: verdict.ready,
      stamp: verdict.stamp,
      reason: verdict.reason,
      counts: verdict.counts,
      readOnly: report.scanMode === 'read-only' || report.scanMode === 'safe-public' || undefined,
      testedWithApprovedPlan: report.testedWithApprovedPlan,
    };
    await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    await fs.copyFile(path.join(dir, 'findings.json'), path.join(this.outputDir, 'findings.json')).catch(() => {});
    await this.pruneRuns(host);
  }

  /** Deletes a site's runs past the newest RUNS_KEPT_PER_SITE, and folders of runs that never finished. */
  private async pruneRuns(host: string): Promise<void> {
    const runs = await this.listRuns();
    const old = runs.filter((r) => r.host === host).slice(RUNS_KEPT_PER_SITE);
    for (const run of old) await fs.rm(this.runDir(run.runId), { recursive: true, force: true }).catch(() => {});
    const finished = new Set(runs.map((r) => r.runId));
    const root = path.join(this.outputDir, 'runs');
    for (const name of await fs.readdir(root).catch(() => [] as string[])) {
      if (
        !isRunId(name) ||
        finished.has(name) ||
        name === this.currentRunId ||
        [...this.parkedPlans.values()].some((r) => r.plan.runId === name)
      )
        continue;
      await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
    }
  }

  /** The newest finished run's report, so a restart still has it. */
  private async loadLatestReport(): Promise<void> {
    if (this.lastReport) return;
    const [latest] = await this.listRuns();
    if (!latest) return;
    try {
      this.lastReport = JSON.parse(await fs.readFile(path.join(this.runDir(latest.runId), 'report.json'), 'utf8'));
    } catch {
      // unreadable: the list still shows it
    }
  }

  /** A run's report: the one just finished is in memory (its file may not be written yet), older ones on disk. */
  private async readRunReport(runId: string): Promise<ReleaseReport | null> {
    if (this.lastReport?.runId === runId) return this.lastReport;
    try {
      return JSON.parse(await fs.readFile(path.join(this.runDir(runId), 'report.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  private async handleRuns(rest: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if ((rest === '' || rest === '/') && req.method === 'GET') {
      this.sendJson(res, 200, { runs: (await this.listRuns()).filter((r) => this.isMine(r.runId)) });
      return;
    }
    const [, runId, action, file] = rest.split('/');
    if (!runId || !isRunId(runId)) {
      this.sendJson(res, 404, { error: 'No such check-up' });
      return;
    }
    if (this.refuseNotMine(res, runId)) return;

    if (!action && req.method === 'GET') {
      const report = await this.readRunReport(runId);
      if (!report) this.sendJson(res, 404, { error: 'That check-up’s report isn’t there any more.' });
      else this.sendJson(res, 200, report);
      return;
    }

    // POST triage { titles, status: 'Intended' | 'False Positive' | null, reason? }: the person says a
    // problem is intended, or not a problem (null undoes it). The report is updated, and the site's
    // next check-ups remember it.
    if (action === 'triage' && req.method === 'POST') {
      let body: { titles?: string[]; status?: 'Intended' | 'False Positive' | null; reason?: string };
      try {
        body = await this.readJsonBody(req);
      } catch {
        this.sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      const report = await this.readRunReport(runId);
      const titles = Array.isArray(body.titles) ? body.titles.filter((t) => typeof t === 'string') : [];
      if (!report || titles.length === 0) {
        this.sendJson(res, report ? 400 : 404, {
          error: report ? 'Say which problem.' : 'That check-up’s report isn’t there any more.',
        });
        return;
      }
      let host: string | undefined;
      try {
        host = new URL(report.targetUrl).host;
      } catch {
        // rules for every site
      }
      const status = body.status === 'Intended' || body.status === 'False Positive' ? body.status : null;
      for (const f of report.findings) {
        if (!titles.includes(f.title)) continue;
        f.triageStatus = status ?? 'Pending';
        f.triageReason = status ? body.reason?.trim() || undefined : undefined;
      }
      const suppressions = new SuppressionsManager(this.outputDir);
      if (status) {
        for (const title of titles) {
          await suppressions.saveSuppression({
            findingTitle: title,
            triageStatus: status,
            reason: body.reason?.trim() || undefined,
            dateAdded: new Date().toISOString(),
            host,
          });
        }
      } else {
        await suppressions.removeSuppressions(titles, host);
      }
      // The grades, what to improve and the verdict follow.
      const ran = report.results.flatMap((r) => (r.checks || []).map((c) => c.checker));
      report.grades = calculateSiteAspectGrades(report.findings, { checkersRun: ran });
      report.recommendations = generateRankedRecommendations(report.findings);
      await this.saveReviewedReport(report);
      if (this.lastReport?.runId === runId) this.lastReport = report;
      this.sendJson(res, 200, report);
      return;
    }

    if (action === 'download' && req.method === 'GET') {
      const contentType = file ? DOWNLOADABLE_REPORT_FILES[file] : undefined;
      if (!file || !contentType) {
        this.sendJson(res, 404, { error: 'Unknown report file' });
        return;
      }
      try {
        const content = await fs.readFile(path.join(this.runDir(runId), file));
        let host = 'site';
        try {
          host =
            new URL((await this.readRunReport(runId))?.targetUrl || '').host.replace(/[^a-z0-9.-]/gi, '_') || 'site';
        } catch {
          // keep "site"
        }
        const [base, ext] = file.split('.');
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${base}-${host}-${runId}.${ext}"`,
        });
        res.end(content);
      } catch {
        this.sendJson(res, 404, { error: `${file} isn’t there for that check-up.` });
      }
      return;
    }

    if (!action && req.method === 'DELETE') {
      if (
        runId === this.currentRunId &&
        (this.phase === 'scanning' || this.phase === 'testing' || this.phase === 'awaiting-review')
      ) {
        this.sendJson(res, 409, { error: 'That check-up is still in progress. Stop it first.' });
        return;
      }
      await fs.rm(this.runDir(runId), { recursive: true, force: true });
      if (this.lastReport?.runId === runId) {
        this.lastReport = null;
        await this.loadLatestReport();
      }
      this.sendJson(res, 200, { deleted: true });
      return;
    }

    this.sendJson(res, 404, { error: 'Not found' });
  }

  /**
   * Before `.qa-data` existed, site memory, history, the saved key and a waiting plan lived in the
   * working folder, where git could pick them up. They move once, copied first, then removed.
   */
  private async moveLegacyData(): Promise<void> {
    if (!this.legacyDataDir) return;
    for (const name of ['sites', '.qa-keys.json', '.qa-ai-models.json', '.qa-plan.json']) {
      const from = path.join(this.legacyDataDir, name);
      const to = path.join(this.dataDir, name);
      if (!(await exists(from)) || (await exists(to))) continue;
      try {
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.cp(from, to, { recursive: true });
        await fs.rm(from, { recursive: true, force: true });
        console.log(
          `[Release check-up] Moved ${name} into ${path.relative(process.cwd(), this.dataDir) || this.dataDir}`
        );
      } catch (err) {
        console.warn(
          `[Release check-up] Couldn’t move ${name} into the data folder:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  private async handleReportDownload(fileName: string, res: http.ServerResponse): Promise<void> {
    const contentType = DOWNLOADABLE_REPORT_FILES[fileName];
    if (!contentType) {
      this.sendJson(res, 404, { error: 'Unknown report file' });
      return;
    }
    if (!this.lastReport) {
      this.sendJson(res, 404, { error: 'No completed run yet' });
      return;
    }
    try {
      // The latest run's own copy; runs from before per-run folders wrote to the top of the folder.
      const own = path.join(this.runDir(this.lastReport.runId), fileName);
      const content = await fs.readFile((await exists(own)) ? own : path.join(this.outputDir, fileName));
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      });
      res.end(content);
    } catch {
      this.sendJson(res, 404, { error: `${fileName} was not written for the last run` });
    }
  }

  /** Screens of the latest run the visual review hasn't looked at yet: "Finish the visual review" does them. */
  private pendingAiScreens: { runId: string; screens: VisualReviewItemInput[] } | null = null;

  /**
   * Finishes the visual review of the latest run: the screens it didn't get to, with the vision
   * model, within what's left of the AI Request Budget.
   */
  private async handleAiFinish(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const report = this.lastReport;
    if (!report) {
      this.sendJson(res, 404, { error: 'No report available to finish AI review' });
      return;
    }
    const pending = this.pendingAiScreens?.runId === report.runId ? this.pendingAiScreens.screens : [];
    if (pending.length === 0) {
      this.sendJson(res, 200, {
        completed: true,
        message: 'No remaining screens to review',
        reviewedCount: 0,
        remainingCount: 0,
        addedFindingsCount: 0,
        grades: report.grades,
      });
      return;
    }
    const reviewed = await this.visualReview(report, pending);
    if (!reviewed) {
      this.sendJson(res, 409, {
        error: 'No AI model that reads screenshots is set up. Choose one in Settings.',
        code: 'ERR_NO_VISION_MODEL',
      });
      return;
    }
    await this.saveReviewedReport(report);
    this.sendJson(res, 200, {
      completed: reviewed.remaining === 0,
      reviewedCount: reviewed.reviewed,
      remainingCount: reviewed.remaining,
      addedFindingsCount: reviewed.added,
      grades: report.grades,
      note: reviewed.note,
    });
  }

  /**
   * One screen per Layout Group (its first page visited), with its screenshot at each size: what the
   * AI's visual review looks at.
   */
  private screensForReview(report: ReleaseReport, draft?: DiscoveryDraft): VisualReviewItemInput[] {
    const groupOf = new Map((draft?.plan?.pages ?? []).map((p) => [p.urlPath, p.layoutGroup || p.urlPath]));
    const byGroup = new Map<string, VisualReviewItemInput>();
    for (const result of report.results) {
      if (result.flowId !== 'page-visit' || !result.breakpoint) continue;
      const shot = [...result.stepEvidence].reverse().find((s) => s.screenshotPath);
      if (!shot?.screenshotPath) continue;
      let urlPath: string;
      try {
        urlPath = new URL(shot.urlAfter || shot.urlBefore).pathname;
      } catch {
        continue;
      }
      const group = groupOf.get(urlPath) ?? urlPath;
      const screen = byGroup.get(group) ?? { layoutGroup: group, urlPath, screenshots: [] };
      byGroup.set(group, screen);
      if (screen.urlPath === urlPath && !screen.screenshots.some((s) => s.breakpoint === result.breakpoint)) {
        // The report keeps evidence paths relative to the run's folder.
        screen.screenshots.push({
          breakpoint: result.breakpoint,
          imagePath: path.resolve(this.runDir(report.runId), shot.screenshotPath),
        });
      }
    }
    return [...byGroup.values()];
  }

  /**
   * The AI's visual review of `screens`, added to the report: its findings, the grades again, and
   * what's left for later. Null when no model that reads screenshots is set up.
   */
  private async visualReview(
    report: ReleaseReport,
    screens: VisualReviewItemInput[],
    /** The run's own AI, when it was started with a key and models of its own. */
    runAi?: { provider: AIProviderType; apiKey?: string; vision?: string }
  ): Promise<{ reviewed: number; remaining: number; added: number; note?: string; outOfRequests?: boolean } | null> {
    const saved = await this.aiSetup();
    // A key given with the run is the one to use; otherwise the one saved on this computer.
    const setup = runAi?.apiKey ? { provider: runAi.provider, key: runAi.apiKey, vision: runAi.vision } : saved;
    if (!setup.key || !setup.vision) return null;
    const budget = await this.aiBudgetFor({ provider: setup.provider }, setup.key);
    const paced = new PacedAI(
      this.makeAIProvider(setup.provider, setup.key, setup.vision),
      Math.min(budget.left ?? Infinity, VISUAL_REVIEW_CALLS),
      {
        model: setup.vision,
      }
    );
    const result = await new VisualReviewer().reviewScreens(screens, paced, { maxCalls: VISUAL_REVIEW_CALLS });
    report.aiUsage = addTokens(report.aiUsage, paced.tokens);
    await this.recordModelOutcomes(paced.models);
    this.pendingAiScreens =
      result.remainingScreens.length > 0 ? { runId: report.runId, screens: result.remainingScreens } : null;
    if (result.findings.length > 0) report.findings.push(...result.findings);
    if (result.reviewedCount > 0) {
      const ran = report.results.flatMap((r) => (r.checks || []).map((c) => c.checker));
      report.grades = calculateSiteAspectGrades(report.findings, { checkersRun: [...ran, 'ai-review'] });
      report.recommendations = generateRankedRecommendations(report.findings);
    }
    report.visualReview = {
      reviewed: (report.visualReview?.reviewed ?? 0) + result.reviewedCount,
      total: report.visualReview?.total ?? screens.length,
      remaining: result.remainingScreens.length,
    };
    return {
      reviewed: result.reviewedCount,
      remaining: result.remainingScreens.length,
      added: result.findings.length,
      note: result.note,
      outOfRequests: !result.stoppedBy || result.stoppedBy instanceof BudgetSpentError,
    };
  }

  /**
   * Writes a report changed after the run (the visual review finished, a problem marked as intended)
   * back to its files, and its verdict to the summary Past check-ups lists.
   */
  private async saveReviewedReport(report: ReleaseReport): Promise<void> {
    const dir = this.runDir(report.runId);
    await generateSingleFileHtmlReport(report, { outputDir: dir }).catch(() => {});
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report), 'utf8').catch(() => {});
    const summaryFile = path.join(dir, 'summary.json');
    const summary = JSON.parse(await fs.readFile(summaryFile, 'utf8').catch(() => 'null')) as RunSummary | null;
    if (!summary) return;
    const verdict = releaseVerdict(report.findings);
    await fs
      .writeFile(
        summaryFile,
        JSON.stringify(
          { ...summary, ready: verdict.ready, stamp: verdict.stamp, reason: verdict.reason, counts: verdict.counts },
          null,
          2
        ),
        'utf8'
      )
      .catch(() => {});
  }

  /** The key saved on this machine for a provider, if any. Never returned to clients. */
  private async storedKey(provider: AIProviderType): Promise<string | undefined> {
    if (provider === 'mock') return 'mock-key';
    const resolved = await this.keyResolver.resolveKey(provider);
    return resolved?.provider === provider ? resolved.apiKey : undefined;
  }

  /** The OpenRouter key saved on this machine, if any. Never returned to clients. */
  private async storedOpenRouterKey(): Promise<string | undefined> {
    return this.storedKey('openrouter');
  }

  /** The AI settings (not secret): the provider, the chosen models, and who chose them. */
  private async readAiModels(): Promise<AiSettings> {
    try {
      return JSON.parse(await fs.readFile(this.aiModelsFile, 'utf8'));
    } catch {
      return {};
    }
  }

  private async writeAiModels(settings: AiSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.aiModelsFile), { recursive: true });
    await fs.writeFile(
      this.aiModelsFile,
      JSON.stringify({ ...settings, chosenAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  }

  /** How each model has done on this machine: a model that keeps stopping before it answers is avoided. */
  private async readModelRecord(): Promise<ModelRecord> {
    try {
      return JSON.parse(await fs.readFile(this.modelRecordFile, 'utf8'));
    } catch {
      return {};
    }
  }

  /** Adds a scan's per-model outcomes to the record. */
  private async recordModelOutcomes(outcomes: ModelRecord | undefined): Promise<void> {
    if (!outcomes || Object.keys(outcomes).length === 0) return;
    const record = await this.readModelRecord();
    for (const [model, o] of Object.entries(outcomes)) {
      const r = (record[model] ??= { ok: 0, truncated: 0, failed: 0 });
      r.ok += o.ok;
      r.truncated += o.truncated;
      r.failed += o.failed;
    }
    await fs.mkdir(path.dirname(this.modelRecordFile), { recursive: true });
    await fs.writeFile(this.modelRecordFile, JSON.stringify(record, null, 2), 'utf8').catch(() => {});
  }

  /**
   * Keeps the chosen free models while they're still free (and, when chosen automatically, still
   * answering), replacing any that has gone. Returns the next best models too, to switch to when
   * the chosen one stops before answering.
   */
  private async refreshAiModels(
    apiKey: string
  ): Promise<{ text: string | null; vision: string | null; fallbacks: string[] }> {
    const [free, current, record] = await Promise.all([
      this.openRouter.listFreeModels(apiKey),
      this.readAiModels(),
      this.readModelRecord(),
    ]);
    const models = keepOrPickModels(free, current, record);
    const chosenBy = current.chosenBy === 'person' && current.text === models.text ? 'person' : undefined;
    await this.writeAiModels({
      ...current,
      provider: 'openrouter',
      text: models.text,
      vision: models.vision,
      chosenBy,
    });
    return { ...models, fallbacks: fallbackModels(free, models.text, record) };
  }

  /** The provider, key and models the AI uses, as saved in Settings. */
  private async aiSetup(): Promise<{
    provider: AIProviderType;
    key?: string;
    text?: string;
    vision?: string;
    chosenBy?: 'person';
  }> {
    const settings = await this.readAiModels();
    const provider = settings.provider ?? 'openrouter';
    const key = await this.storedKey(provider);
    // Paid providers' models all read screenshots: the text model does the visual review too.
    const text =
      settings.text ??
      (provider === 'openrouter' ? undefined : DEFAULT_MODELS[provider as Exclude<AIProviderType, 'mock'>]);
    const vision = settings.vision ?? (provider === 'openrouter' ? undefined : text);
    return { provider, key, text: text ?? undefined, vision: vision ?? undefined, chosenBy: settings.chosenBy };
  }

  private async handleAiSettings(route: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    // GET settings: answered from this machine alone, so Settings shows at once.
    if (route === 'settings' && req.method === 'GET') {
      const setup = await this.aiSetup();
      this.sendJson(res, 200, {
        provider: setup.provider,
        configured: !!setup.key,
        model: setup.text ?? null,
        visionModel: setup.vision ?? null,
        chosenBy: setup.chosenBy ?? 'auto',
        providers: AI_PROVIDERS,
      });
      return true;
    }

    // GET usage: today's free requests, one call to OpenRouter (slow): loaded after the settings.
    if (route === 'usage' && req.method === 'GET') {
      const setup = await this.aiSetup();
      const today =
        setup.provider === 'openrouter' && setup.key
          ? await this.openRouter.freeRequestsToday(setup.key).catch(() => null)
          : null;
      this.sendJson(res, 200, {
        requestsLeft: today?.remaining ?? null,
        requestsLimit: today?.limit ?? null,
        used: today?.used ?? null,
      });
      return true;
    }

    // POST settings: { provider, apiKey?, model?, visionModel? }. A key is checked before it's saved;
    // a model named here was chosen by the person and is kept while it's available.
    if (route === 'settings' && req.method === 'POST') {
      let body: { provider?: AIProviderType; apiKey?: string; model?: string | null; visionModel?: string | null };
      try {
        body = await this.readJsonBody(req);
      } catch {
        this.sendJson(res, 400, { error: 'Invalid JSON body' });
        return true;
      }
      const provider = body.provider ?? (await this.readAiModels()).provider ?? 'openrouter';
      if (!AI_PROVIDERS.some((p) => p.id === provider)) {
        this.sendJson(res, 400, { error: `Unknown AI provider “${provider}”.` });
        return true;
      }
      const apiKey = body.apiKey?.trim();
      if (apiKey) {
        if (provider === 'openrouter') {
          const validation = await this.openRouter.validateKey(apiKey);
          if (!validation.valid) {
            this.sendJson(res, 400, { saved: false, reason: validation.reason });
            return true;
          }
        }
        await this.keyResolver.saveByokKey(provider, apiKey);
      }
      const current = await this.readAiModels();
      const sameProvider = (current.provider ?? 'openrouter') === provider;
      const chosen = body.model !== undefined || body.visionModel !== undefined;
      await this.writeAiModels({
        provider,
        text: body.model !== undefined ? body.model : sameProvider ? current.text : null,
        vision: body.visionModel !== undefined ? body.visionModel : sameProvider ? current.vision : null,
        chosenBy: chosen ? 'person' : sameProvider ? current.chosenBy : undefined,
      });
      // Without a chosen model, OpenRouter's free models are picked automatically.
      const key = await this.storedKey(provider);
      if (provider === 'openrouter' && key && !chosen) await this.refreshAiModels(key).catch(() => null);
      const setup = await this.aiSetup();
      this.sendJson(res, 200, {
        saved: true,
        provider,
        configured: !!setup.key,
        model: setup.text ?? null,
        visionModel: setup.vision ?? null,
      });
      return true;
    }

    // POST test-model: { model? } — one small request to the model, to see that it answers.
    if (route === 'test-model' && req.method === 'POST') {
      let body: { model?: string } = {};
      try {
        body = await this.readJsonBody(req);
      } catch {
        // tests the saved model
      }
      const setup = await this.aiSetup();
      const model = body.model || setup.text;
      if (!setup.key) {
        this.sendJson(res, 400, { ok: false, reason: 'Add a key first.' });
        return true;
      }
      const started = Date.now();
      try {
        const answer = await completeWith(
          this.makeAIProvider(setup.provider, setup.key, model),
          [
            { role: 'system', content: 'Answer with strictly valid JSON only.' },
            { role: 'user', content: 'Reply with {"ok": true} and nothing else.' },
          ],
          { responseFormat: 'json', reasoning: 'low', maxTokens: 512, temperature: 0 }
        );
        const ms = Date.now() - started;
        const ok = /"ok"\s*:\s*true/.test(answer.text);
        const reason = ok
          ? undefined
          : answer.finishReason === 'length' && !answer.text.trim()
            ? 'The model spent its whole answer allowance thinking and answered nothing. Choose another model.'
            : 'The model answered, but not with what was asked. Plans from it may fall back to fixed rules.';
        if (model)
          await this.recordModelOutcomes({
            [model]: {
              ok: ok ? 1 : 0,
              truncated: answer.finishReason === 'length' ? 1 : 0,
              failed: ok || answer.finishReason === 'length' ? 0 : 1,
            },
          });
        this.sendJson(res, 200, { ok, ms, model: answer.model ?? model, reason, usage: answer.usage });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.sendJson(res, 200, {
          ok: false,
          ms: Date.now() - started,
          model,
          reason: /\b429\b|rate.?limit/i.test(message)
            ? 'The AI service is busy or today’s free requests are used up. Try again later.'
            : `The AI service said: ${message.slice(0, 200)}`,
        });
      }
      return true;
    }
    return false;
  }

  private async handleOpenRouter(route: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // POST validate: check a key without keeping it anywhere.
    if (route === 'validate' && req.method === 'POST') {
      let apiKey: string | undefined;
      try {
        ({ apiKey } = await this.readJsonBody<{ apiKey?: string }>(req));
      } catch {
        // Treated as a missing key below.
      }
      this.sendJson(res, 200, await this.openRouter.validateKey(apiKey));
      return;
    }

    // GET key: whether a key is saved on this machine (the key itself is never sent back), and the
    // free models chosen for it, so any browser can skip the setup screen. With ?usage=1, also the
    // free requests the key has left today (one call to OpenRouter).
    if (route === 'key' && req.method === 'GET') {
      const key = await this.storedOpenRouterKey();
      const configured = !!key;
      const models = configured ? await this.readAiModels() : {};
      const wantsUsage = new URL(req.url || '/', 'http://localhost').searchParams.get('usage') === '1';
      const today = configured && wantsUsage ? await this.openRouter.freeRequestsToday(key).catch(() => null) : null;
      this.sendJson(res, 200, {
        configured,
        model: models.text ?? null,
        visionModel: models.vision ?? null,
        requestsLeft: today?.remaining,
        requestsLimit: today?.limit,
      });
      return;
    }

    // POST key: validate, then save to the OS keychain for future runs.
    if (route === 'key' && req.method === 'POST') {
      let apiKey: string | undefined;
      try {
        ({ apiKey } = await this.readJsonBody<{ apiKey?: string }>(req));
      } catch {
        // Treated as a missing key below.
      }
      const validation = await this.openRouter.validateKey(apiKey);
      if (!validation.valid) {
        this.sendJson(res, 400, { saved: false, reason: validation.reason });
        return;
      }
      await this.keyResolver.saveByokKey('openrouter', apiKey!.trim());
      // Choose the free models now; a null model means none is free right now.
      const current = await this.readAiModels();
      if ((current.provider ?? 'openrouter') !== 'openrouter') await this.writeAiModels({ provider: 'openrouter' });
      const models = await this.refreshAiModels(apiKey!.trim()).catch(() => ({ text: null, vision: null }));
      this.sendJson(res, 200, { saved: true, model: models.text, visionModel: models.vision });
      return;
    }

    // GET free-models: key from the Authorization header, else the saved key. Best first, with
    // models that keep stopping before they answer at the end.
    if (route === 'free-models' && req.method === 'GET') {
      const header = req.headers.authorization;
      const apiKey = header?.startsWith('Bearer ') ? header.slice(7) : await this.storedOpenRouterKey();
      try {
        const record = await this.readModelRecord();
        const models = byTrackRecord(await this.openRouter.listFreeModels(apiKey), record);
        this.sendJson(res, 200, {
          models: models.map((m) => ({ ...m, unreliable: unreliable(m.id, record) || undefined })),
          recommendedModel: pickRecommendedModel(models, record),
          recommendedVisionModel: pickVisionModel(models, record),
        });
      } catch (err) {
        if (err instanceof OpenRouterAuthError) {
          if (header?.startsWith('Bearer ') || !apiKey) {
            this.sendJson(res, 401, { error: err.message });
          } else {
            this.sendJson(res, 200, {
              models: [],
              authError: true,
              error: err.message,
              recommendedModel: null,
              recommendedVisionModel: null,
            });
          }
        } else {
          this.sendJson(res, 502, { error: 'Couldn’t get the model list from OpenRouter. Try again in a minute.' });
        }
      }
      return;
    }

    this.sendJson(res, 404, { error: 'Not found' });
  }

  private async handleTriggerRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.phase === 'scanning' || this.phase === 'testing' || this.benchmarkBusy) {
      this.sendJson(res, 409, {
        error: this.beta
          ? 'Someone else is running a check-up on this shared copy. Try again in a few minutes.'
          : 'Another check-up is running. Wait for it to finish, or stop it first.',
        code: 'ERR_RUN_IN_PROGRESS',
        suggestion: this.beta
          ? 'Only one check-up runs at a time here. Try again in a few minutes.'
          : 'Wait for the check-up in progress to finish, or stop it, then start this one.',
      });
      return;
    }

    let body: TriggerRunBody;
    try {
      body = await this.readJsonBody<TriggerRunBody>(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Invalid JSON body',
          code: 'ERR_INVALID_REQUEST',
          suggestion: 'Check the request format and try again.',
        })
      );
      return;
    }

    if (!body.targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'targetUrl is required',
          code: 'ERR_MISSING_TARGET_URL',
          suggestion: 'Please provide a valid website address to check.',
        })
      );
      return;
    }

    if (await this.refuseTarget(res, body.targetUrl)) return;
    if (this.beta && body.useAI && body.aiProvider === 'mock') {
      this.sendJson(res, 400, {
        error: 'The test AI is not available here.',
        code: 'ERR_NO_AI_KEY',
        suggestion: 'Add an OpenRouter key in Settings (the free tier works), then start the check-up again.',
      });
      return;
    }

    // A plan waiting for review is kept aside when another site is checked (one waiting plan per
    // site). Only a new check-up of the same site throws it away, so the caller has to say so.
    await this.ensurePlanLoaded();
    const waiting = this.phase === 'awaiting-review' ? this.currentPlanRecord : null;
    // Beta: a plan another visitor left waiting is kept aside for them, whatever the site, and is never named here.
    const othersPlan = this.beta && !!waiting && !this.isMine(waiting.plan.runId);
    const parkWaiting = !!waiting && (othersPlan || this.hostOfPlan(waiting) !== hostOfAddress(body.targetUrl));
    if (waiting && !parkWaiting && !body.replacePlan) {
      let waitingFor = waiting.plan.targetUrl;
      try {
        waitingFor = new URL(waitingFor).host;
      } catch {
        // keep it as typed
      }
      this.sendJson(res, 409, {
        error: `The plan for ${waitingFor} is waiting for your review. Starting a new check-up of it throws that plan away.`,
        code: 'ERR_PLAN_WAITING',
        suggestion: 'Open the plan to finish reviewing it, or start again to replace it.',
        targetUrl: waiting.plan.targetUrl,
      });
      return;
    }

    // The wizard's plan is written by the AI (ADR 0009), so its scans need a working AI key.
    const wizardScan = body.owner !== undefined && body.mode !== 'safe-public' && !body.specTestCases?.length;
    const wantedProvider = body.aiProvider ?? 'openrouter';
    if (
      wizardScan &&
      body.useAI &&
      wantedProvider !== 'mock' &&
      !body.apiKey &&
      !(await this.storedKey(wantedProvider))
    ) {
      this.sendJson(res, 400, {
        error: 'An AI key is needed: the AI writes the plan.',
        code: 'ERR_NO_AI_KEY',
        suggestion: 'Add an OpenRouter key in Settings (the free tier works), then start the check-up again.',
      });
      return;
    }

    if (parkWaiting && waiting) await this.parkPlan(waiting);
    // A plan kept aside for this same site is replaced by the new check-up.
    await this.unparkPlan(hostOfAddress(body.targetUrl));
    await this.clearPlan();

    const productId = body.productId || 'default-product';
    // Generated here (not by the orchestrator) so the id we hand back in the 202 response
    // is the SAME id the orchestrator will use for RUN_STARTED/RUN_COMPLETED — otherwise a
    // UI that trusts this response id would never see it appear in the SSE stream.
    const runId = `run-${Date.now()}`;
    if (this.beta) {
      const me = currentSessionId();
      if (me) this.runOwners.set(runId, me);
    }
    this.currentRunId = runId;
    this.currentTargetUrl = body.targetUrl;
    this.runEvents = [];
    const generation = ++this.runGeneration;

    this.isRunning = true;
    this.phase = 'scanning';
    this.lastRunError = null;
    this.lastErrorCode = null;
    this.activeAbortController = new AbortController();
    this.finishController = new AbortController();

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runId }));

    // Fire the actual run asynchronously — the HTTP response has already been sent;
    // progress and completion are delivered exclusively over the SSE stream.
    this.executeRun(body, productId, runId, generation).catch((err: unknown) => {
      // Stopped or replaced: whatever stopped it has already said so.
      if (generation !== this.runGeneration || isAbortError(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string } | undefined)?.code || 'ERR_DISCOVERY_FAILED';
      this.lastRunError = msg;
      this.lastErrorCode = code;
      this.phase = 'failed';
      this.isRunning = false;
      this.broadcastRunnerEvent({ type: 'RUN_FAILED', runId, error: msg, code, timestamp: Date.now() });
    });
  }

  private async handleAbortRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const runId = this.currentRunId;
    // { finish: true }: stop early but keep the work: the scan plans what it found, testing makes a
    // partial report. Answered at once; the usual events follow.
    const body = await this.readJsonBody<{ finish?: boolean }>(req).catch(() => ({}) as { finish?: boolean });
    if (body.finish && (this.phase === 'scanning' || this.phase === 'testing') && this.finishController) {
      this.finishController.abort();
      this.broadcastRunnerEvent({ type: 'RUN_FINISHING', runId, phase: this.phase, timestamp: Date.now() });
      this.sendJson(res, 200, { aborted: false, finishing: true });
      return;
    }
    if (!this.isRunning && this.phase === 'idle') {
      this.sendJson(res, 200, { aborted: false, message: 'No run currently active' });
      return;
    }

    // Whatever is running is stale from here on: its events and results are dropped, and the
    // signal makes the crawler, the planner and the orchestrator give up and close their browsers.
    this.runGeneration++;
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {}
      this.activeAbortController = null;
    }

    // Stopping a test run keeps the approved plan, so it can be changed and approved again.
    const record = this.currentPlanRecord;
    const planKept = this.phase === 'testing' && !!record && record.plan.runId === runId;
    if (planKept) {
      this.phase = 'awaiting-review';
      this.isRunning = true;
      await this.savePlan(record!).catch(() => {});
    } else {
      this.isRunning = false;
      this.phase = 'idle';
      this.currentTargetUrl = null;
      await this.clearPlan(runId ?? undefined);
    }
    this.lastErrorCode = 'ERR_RUN_ABORTED';
    this.lastRunError = 'Run was manually stopped by user.';

    this.broadcastRunnerEvent({
      type: 'RUN_ABORTED',
      runId,
      planKept,
      code: 'ERR_RUN_ABORTED',
      message: 'Run was stopped by the user.',
      timestamp: Date.now(),
    });

    this.sendJson(res, 200, { aborted: true, planKept, code: 'ERR_RUN_ABORTED', message: 'Run aborted successfully' });
  }

  /**
   * "Test again" may skip the review only when the scan found nothing the approved plan doesn't
   * already cover: no new page, link, journey or question, and every page as it was when planned.
   */
  private nothingNew(draft: DiscoveryDraft, since: MemorySummary, memory: SiteMemory): boolean {
    if (!since.seenBefore || since.newPages > 0 || since.newJourneys > 0 || since.newQuestions > 0) return false;
    if (draft.plan?.navigation.some((n) => n.isNew)) return false;
    const planned = memory.plan?.pages || {};
    return draft.pages.every((p) => planned[p.urlPath] !== undefined && planned[p.urlPath].contentKey === p.contentKey);
  }

  private async executeRun(body: TriggerRunBody, productId: string, runId: string, generation: number): Promise<void> {
    const targetUrl = this.resolveTargetUrl(body.targetUrl);
    const signal = this.activeAbortController?.signal;
    const runDir = this.runDir(runId);
    /** False once this run was stopped or replaced. */
    const current = () => generation === this.runGeneration;

    if (body.mode === 'safe-public') {
      // Read-only path: never touches DiscoveryAgent or FlowTestOrchestrator.
      try {
        this.phase = 'scanning';
        const report = await runSafeWebsiteScan({
          targetUrl,
          productId: body.productId,
          outputDir: runDir,
          runId,
          headless: body.headless ?? true,
          onEvent: (event) => {
            if (current()) this.forwardRunEvent(event);
          },
        });
        if (!current()) return;
        this.lastReport = report;
        await this.keepRun(report, body.targetUrl, undefined).catch(() => {});
        this.phase = 'done';
      } catch (err) {
        if (current()) this.phase = 'failed';
        throw err;
      } finally {
        if (current()) this.isRunning = false;
      }
      return;
    }

    try {
      // Full testing needs the owner's say-so and a test host. Decided here, not by the screen.
      const typed = new URL(body.targetUrl);
      const siteHost = typed.host;
      let memory = await loadSiteMemory(this.siteDir(), siteHost);
      // What the person chose for the site is remembered, so the next check-up starts from it.
      if (body.stagingHost !== undefined || body.owner !== undefined || body.searchChecks !== undefined) {
        memory = {
          ...(memory ?? emptySiteMemory(siteHost)),
          ...(body.stagingHost !== undefined ? { staging: body.stagingHost || undefined } : {}),
          ...(body.owner !== undefined ? { owner: body.owner } : {}),
          ...(body.searchChecks !== undefined ? { searchChecks: body.searchChecks } : {}),
        };
        await saveSiteMemory(this.siteDir(), memory);
      }
      // Sign-ins: the ones given (remembered when asked), or the ones saved for the site.
      const signIns = await this.signInsFor(body, memory, siteHost);
      if (signIns.memory && signIns.memory !== memory) {
        memory = signIns.memory;
        await saveSiteMemory(this.siteDir(), memory);
      }
      const profile: ProductProfile | undefined = signIns.roles?.length
        ? { name: productId, productId, roles: signIns.roles }
        : undefined;
      // Test again tests at the screen sizes the plan was approved with, unless told otherwise; a
      // new check-up at the sizes chosen in Settings.
      const breakpoints: Breakpoint[] =
        (body.breakpoints as Breakpoint[] | undefined) ||
        (body.testAgain && memory?.plan?.screenSizes?.length ? memory.plan.screenSizes : undefined) ||
        (await this.readDefaults()).screenSizes ||
        ALL_SCREEN_SIZES;
      const urlFirst = body.owner !== undefined;
      const owner = body.owner ?? true;
      const testHost = isTestHost(typed.hostname, memory?.staging ? [typed.hostname] : []);
      const readOnly = !(owner && testHost);
      // How search engines see a site matters on the public site, not on a test copy, unless asked.
      const searchChecks = body.searchChecks ?? memory?.searchChecks ?? (urlFirst ? !testHost : true);
      const visibility =
        (body.visibility as { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean } | undefined) ??
        (searchChecks
          ? { search: true, answers: true, aiSearch: true, marketing: true }
          : { search: false, answers: false, aiSearch: false, marketing: false });

      const context: StoredPlanRecord['context'] = {
        targetUrl,
        productId,
        runId,
        profile,
        breakpoints,
        headless: body.headless ?? true,
        releaseTarget: body.releaseTarget,
        draft: undefined as unknown as DiscoveryDraft,
        readOnly,
        siteHost,
        productContext: body.productContext,
        designNotes: body.designNotes,
        searchChecks,
        visibility,
      };

      if (body.specTestCases && body.specTestCases.length > 0) {
        // Caller supplied an explicit spec — takes priority over AI discovery.
        await this.executeTesting(
          { plan: this.emptyPlan(runId, body.targetUrl), context },
          body.specTestCases,
          [],
          generation
        );
        return;
      }
      if (!body.useAI && !urlFirst) {
        await this.executeTesting(
          { plan: this.emptyPlan(runId, body.targetUrl), context },
          [this.defaultTestCase()],
          [],
          generation
        );
        return;
      }

      // "Plan with fixed rules now": the AI is still set up, so items can be re-planned with it later.
      const ai = await this.prepareAI(body.planWithoutAI ? { ...body, useAI: true } : body);
      context.aiModels = ai.models;
      context.ai = ai.settings;
      if (body.planWithoutAI) ai.provider = undefined;
      const aiBudget = ai.provider ? await this.aiBudgetFor(ai.settings, ai.key) : undefined;
      if (!current()) return;

      // Everything this run writes lives in its own folder.
      await fs.mkdir(runDir, { recursive: true });
      let contextFilePath: string | undefined;
      if (body.productContext?.trim()) {
        contextFilePath = path.join(runDir, 'product-context.md');
        await fs.writeFile(contextFilePath, body.productContext, 'utf8');
        context.contextFilePath = contextFilePath;
      }

      this.phase = 'scanning';
      this.broadcastRunnerEvent({ type: 'DISCOVERY_STARTED', runId, timestamp: Date.now() });
      const draft = await new DiscoveryAgent().discover({
        targetUrl,
        productId,
        profile,
        contextFilePath,
        outputDir: runDir,
        authDir: this.authDir,
        signal,
        finishSignal: this.finishController?.signal,
        aiProvider: ai.provider,
        readOnly,
        maxPages:
          typeof body.maxPages === 'number' && body.maxPages > 0
            ? Math.min(Math.floor(body.maxPages), 1000)
            : undefined,
        aiBudget,
        aiModels: { model: ai.models?.text, fallbacks: ai.fallbacks },
        onProgress: (progress) => {
          if (current())
            this.broadcastRunnerEvent({ type: 'DISCOVERY_PROGRESS', runId, ...progress, timestamp: Date.now() });
        },
        // The last approved Plan is reused where the site hasn't changed, unless asked to start afresh.
        remembered: body.replanAll ? undefined : memory?.plan,
      });
      if (!current()) return;
      await this.recordModelOutcomes(draft.plan?.budget?.models);
      const sinceLastRun = applySiteMemory(draft, memory);
      context.draft = draft;
      if (body.planWithoutAI && draft.exploration) {
        draft.exploration.notes = [
          'Planned with fixed rules, as you chose, so no AI requests were used. Re-plan any item with the AI when you have requests to spare.',
          ...draft.exploration.notes.filter((n) => !n.startsWith('No AI key is set up')),
        ];
      }
      context.reportNotes = [...(draft.exploration?.notes || []), ...(signIns.note ? [signIns.note] : [])];
      this.broadcastRunnerEvent({
        type: 'DISCOVERY_COMPLETED',
        runId,
        flowsFound: draft.flows.length,
        timestamp: Date.now(),
      });

      const record: StoredPlanRecord = { plan: this.emptyPlan(runId, body.targetUrl), context };
      record.plan = this.buildPlan(record, sinceLastRun, !!ai.provider, readOnlyReason(owner, testHost));

      // Test again: nothing new since the plan was approved, so it's tested as approved. The plan is
      // still kept, so stopping or a failure can go back to it.
      const approvedAt = memory?.planApprovedAt;
      if (body.testAgain && approvedAt && memory && this.nothingNew(draft, sinceLastRun, memory)) {
        applySafeAnswers(record.plan.questions);
        applySafeAnswers(draft.ambiguityQuestions);
        await saveSiteMemory(this.siteDir(), rememberRun(memory, siteHost, draft, { reviewed: false }));
        const { specTestCases, notRun } = this.testsFor(record.context);
        record.plan.testCases = specTestCases;
        await this.savePlan(record);
        context.reportNotes.push(...this.handCheckNotes(draft));
        context.reportNotes.push(
          `Nothing on the site had changed since the plan was approved on ${formatDay(approvedAt)}, so it was tested as approved, without a new review.`
        );
        await this.executeTesting(record, specTestCases, notRun, generation, { testedWithApprovedPlan: approvedAt });
        return;
      }

      if (body.skipReview === false || body.testAgain) {
        // Pause for review: the plan is written to disk and waits for the owner. After "Test again",
        // only what's new since the approved plan is flagged.
        await this.savePlan(record);
        this.phase = 'awaiting-review';
        this.broadcastRunnerEvent({
          type: 'PLAN_READY',
          runId,
          pageCount: draft.pages.length,
          flowCount: draft.flows.length,
          questionCount: draft.ambiguityQuestions.length,
          changedSinceApproval: body.testAgain ? true : undefined,
          timestamp: Date.now(),
        });
        return;
      }

      // No review: every question gets its safe answer, and only what was there is remembered.
      applySafeAnswers(draft.ambiguityQuestions);
      await saveSiteMemory(this.siteDir(), rememberRun(memory, siteHost, draft, { reviewed: false }));
      const { specTestCases, notRun } = this.testsFor(record.context);
      context.reportNotes.push(...this.handCheckNotes(draft));
      await this.executeTesting(record, specTestCases, notRun, generation);
    } catch (err) {
      // A stopped run's state was set by the stop.
      if (current() && !isAbortError(err)) {
        this.phase = 'failed';
        this.isRunning = false;
      }
      throw err;
    }
  }

  /**
   * The text model for a run. Without a key or a free model there's no run: the plan is written by
   * the AI (ADR 0009). `key` is the key used, for reading its AI Request Budget; it isn't saved.
   */
  private async prepareAI(body: TriggerRunBody): Promise<{
    provider?: AIProvider;
    models?: { text?: string; vision?: string };
    settings?: StoredPlanRecord['context']['ai'];
    key?: string;
    fallbacks?: string[];
  }> {
    if (!body.useAI) return {};
    const saved = await this.aiSetup();
    // The wizard names the provider saved in Settings; a caller that names none gets OpenRouter, the
    // one the key check before a run assumes. The mock AI writes made-up journeys, so it is only
    // for tests and a computer of your own: never on a shared copy, where it would reach other people.
    const providerType: AIProviderType = body.aiProvider || 'openrouter';
    if (providerType === 'mock' && this.beta) {
      throw Object.assign(new Error('The test AI is not available here. Add a real AI key in Settings.'), {
        code: 'ERR_NO_AI_KEY',
      });
    }
    let apiKey = body.apiKey;
    if (!apiKey && providerType !== 'mock') {
      apiKey = await this.storedKey(providerType);
      if (!apiKey) {
        const name = AI_PROVIDERS.find((p) => p.id === providerType)?.name ?? providerType;
        throw Object.assign(new Error(`No ${name} key is saved. Add one in Settings, then start the check-up again.`), {
          code: 'ERR_NO_AI_KEY',
        });
      }
    }
    // One fixed model per role (text, vision), so every run of a site is planned by the same model
    // and the report can say which. OpenRouter's free ones are chosen by the runner unless the
    // person chose them in Settings.
    let model = body.aiModel;
    let visionModel: string | null | undefined;
    let fallbacks: string[] | undefined;
    if (providerType === 'openrouter') {
      const chosen = await this.refreshAiModels(apiKey!).catch(async () => ({
        ...(await this.readAiModels()),
        fallbacks: [] as string[],
      }));
      model ??= chosen.text ?? undefined;
      visionModel = chosen.vision;
      fallbacks = chosen.fallbacks;
      if (!model) {
        throw Object.assign(new Error('No free AI models are available right now — please try again later.'), {
          code: 'ERR_NO_FREE_MODELS',
        });
      }
    } else if (providerType !== 'mock' && saved.provider === providerType) {
      model ??= saved.text;
      visionModel = saved.vision;
    }
    return {
      provider: this.makeAIProvider(providerType, apiKey || 'mock-key', model),
      models: model ? { text: model, vision: visionModel ?? undefined } : undefined,
      settings: { provider: providerType, model, apiKey: body.apiKey },
      key: apiKey,
      fallbacks,
    };
  }

  /** What the key has left of today's free AI requests, when OpenRouter says (ADR 0009's AI Request Budget). */
  private async aiBudgetFor(
    settings: StoredPlanRecord['context']['ai'],
    key?: string
  ): Promise<{ left?: number; limit?: number; visualReview: number }> {
    const today =
      settings?.provider === 'openrouter'
        ? await this.openRouter.freeRequestsToday(key ?? (await this.storedOpenRouterKey()))
        : null;
    return { left: today?.remaining, limit: today?.limit, visualReview: VISUAL_REVIEW_CALLS };
  }

  /** The text model again, for turning a sentence into a test during the review. */
  private async aiFor(context: StoredPlanRecord['context']): Promise<AIProvider | undefined> {
    const settings = context.ai;
    if (!settings) return undefined;
    const apiKey = settings.apiKey || (await this.storedKey(settings.provider));
    if (!apiKey) return undefined;
    return this.makeAIProvider(settings.provider, apiKey, settings.model);
  }

  private emptyPlan(runId: string, targetUrl: string): ReviewPlan {
    return { runId, targetUrl, discoveredAt: new Date().toISOString(), pages: [], flows: [], questions: [] };
  }

  /** The plan the review shows, from the run's draft. Thumbnails are addressed relative to the report folder. */
  private buildPlan(
    record: StoredPlanRecord,
    sinceLastRun: MemorySummary | undefined,
    aiAvailable: boolean,
    reason: string
  ): ReviewPlan {
    const { draft, readOnly } = record.context;
    // Thumbnails are addressed inside the run's folder: /api/evidence/runs/<runId>/<path>.
    const relative = (file?: string) => this.relativeToRun(record.context.runId, file);
    const { specTestCases, wontRun, summary } = this.testsFor(record.context);
    return {
      runId: record.context.runId,
      targetUrl: record.plan.targetUrl,
      discoveredAt: record.plan.discoveredAt || new Date().toISOString(),
      siteType: draft.siteType,
      pages: draft.pages.map((p) => ({ ...p, screenshotPath: relative(p.screenshotPath) })),
      flows: draft.flows,
      questions: draft.ambiguityQuestions,
      testCases: specTestCases,
      usedFallbackDiscovery: draft.usedFallbackSynthesis,
      readOnly: readOnly || undefined,
      readOnlyReason: reason || undefined,
      notes: draft.exploration?.notes?.length ? draft.exploration.notes : undefined,
      sinceLastRun: sinceLastRun?.seenBefore
        ? {
            newPages: sinceLastRun.newPages,
            newJourneys: sinceLastRun.newJourneys,
            newQuestions: sinceLastRun.newQuestions,
            rememberedAnswers: sinceLastRun.rememberedAnswers,
          }
        : undefined,
      aiAvailable,
      signedInAs: draft.exploration?.signedInAs,
      productContext: record.context.productContext,
      designNotes: record.context.designNotes,
      // The complete Plan (ADR 0009): every Plan Item, what won't run, and what approving runs.
      planPages: draft.plan?.pages.map((p) => ({
        ...p,
        screenshotPath: relative(p.screenshotPath) ?? p.screenshotPath,
      })),
      navigation: draft.plan?.navigation,
      gradedChecks: draft.plan ? this.gradedChecksFor(record) : undefined,
      layoutGroups: draft.plan?.layoutGroups,
      screenSizes: this.screenSizesOf(record.context),
      roles: draft.plan
        ? [...new Set(draft.pages.flatMap((p) => (p.reachedBy?.length ? p.reachedBy : ['visitor'])))]
        : undefined,
      wontRun,
      budget: draft.plan?.budget,
      summary,
      otherHosts: draft.plan?.otherHosts,
    };
  }

  /** The graded checks, each saying up front when it can't be graded this time. */
  private gradedChecksFor(record: StoredPlanRecord): ReviewPlan['gradedChecks'] {
    const { context } = record;
    const budget = context.draft.plan?.budget;
    const noVision = !context.aiModels?.vision && context.ai?.provider === 'openrouter';
    const noRequests = budget?.left !== undefined && budget.left <= 0;
    const hasDesign = !!context.designNotes?.trim();
    return GRADED_CHECKS.map((check) => {
      if (check.id === 'check:looks' && !hasDesign && (!context.ai || noVision || noRequests)) {
        return {
          ...check,
          notGraded: !context.ai
            ? 'Needs the AI to look over the screens, and no AI is set up.'
            : noVision
              ? 'Needs an AI model that reads screenshots, and none is free right now. Choose one in Settings.'
              : 'Needs AI requests to look over the screens, and none are left today. Finish it from the report later.',
        };
      }
      if (check.id === 'check:findable' && context.searchChecks === false) {
        return {
          ...check,
          notGraded: 'Not checked: this isn’t the public site. Broken links are still checked, under Works.',
        };
      }
      return check;
    });
  }

  /** The screen sizes a run uses. */
  private screenSizesOf(context: StoredPlanRecord['context']): Breakpoint[] {
    return context.breakpoints?.length ? context.breakpoints : ['375px', '768px', '1440px'];
  }

  /**
   * The tests a plan runs, and the planned tests a live site leaves out (they need a test copy).
   * A complete Plan is expanded by expandPlan, the one expansion the approval summary shares; a
   * draft from before it runs its journeys and the page sweep.
   */
  private testsFor(context: StoredPlanRecord['context']): {
    specTestCases: TestCase[];
    notRun: RunOptions['notRun'];
    wontRun?: ReviewPlan['wontRun'];
    summary?: ReviewPlan['summary'];
  } {
    const { draft } = context;
    const readOnly = !!context.readOnly;
    if (draft.plan) {
      const expanded = expandPlan(draft, {
        readOnly,
        screenSizes: this.screenSizesOf(context),
        questions: draft.ambiguityQuestions,
      });
      return {
        specTestCases: expanded.testCases.length > 0 ? expanded.testCases : [this.defaultTestCase()],
        notRun: expanded.notRun,
        wontRun: expanded.wontRun,
        summary: expanded.summary,
      };
    }
    const specTestCases = [...new TestPlanner().plan(draft, { readOnly }).testCases, ...buildPageSweep(draft)];
    const notRun = readOnly
      ? draft.flows
          .filter((f) => f.needsTestCopy && !f.outOfScope && !f.needsHelp?.length)
          .map((f) => ({ id: `TC-${f.id}`, flowId: f.id, name: f.name, role: f.role, reason: NEEDS_TEST_COPY }))
      : [];
    return { specTestCases: specTestCases.length > 0 ? specTestCases : [this.defaultTestCase()], notRun };
  }

  /** The site as the plan saw it, kept in the report so the report can be drawn as a map. */
  private siteMapOf(draft: DiscoveryDraft, runId: string): SiteMapSummary {
    return {
      siteType: draft.siteType,
      pages: draft.pages.map((p) => ({
        urlPath: p.urlPath,
        title: p.title,
        layoutGroup: p.layoutGroup,
        screenshotPath: this.relativeToRun(runId, p.screenshotPath) ?? p.screenshotPath,
        isNew: p.isNew,
        reachedBy: p.reachedBy,
      })),
      journeys: draft.flows.map((f) => ({
        id: f.id,
        name: f.name,
        reason: f.description,
        pages: journeyPages(f),
        needsTestCopy: f.needsTestCopy,
        skipped: f.outOfScope || (f.needsHelp?.length ?? 0) > 0 || undefined,
        source: f.source,
      })),
    };
  }

  /** Rules the owner added that no test can check: listed in the report for a person to check. */
  private handCheckNotes(draft: DiscoveryDraft): string[] {
    return draft.flows
      .filter((f) => !f.outOfScope)
      .flatMap((f) =>
        (f.userRules || []).filter((r) => !r.checkable).map((r) => `Check by hand (“${f.name}”): ${r.text}`)
      );
  }

  private async executeTesting(
    record: StoredPlanRecord,
    specTestCases: TestCase[],
    notRun: RunOptions['notRun'],
    generation: number,
    extra: { testedWithApprovedPlan?: string } = {}
  ): Promise<void> {
    const { context } = record;
    /** False once this run was stopped or replaced. */
    const current = () => generation === this.runGeneration;
    this.phase = 'testing';
    this.isRunning = true;
    this.currentTargetUrl = record.plan.targetUrl || this.currentTargetUrl;
    this.broadcastRunnerEvent({
      type: 'TESTING_STARTED',
      runId: context.runId,
      testCaseCount: specTestCases.length,
      timestamp: Date.now(),
    });

    const runDir = this.runDir(context.runId);
    await fs.mkdir(runDir, { recursive: true });
    const orchestrator = new FlowTestOrchestrator();
    let report: ReleaseReport;
    try {
      report = await orchestrator.run({
        targetUrl: context.targetUrl,
        productId: context.productId,
        specTestCases,
        profile: context.profile,
        headless: context.headless ?? true,
        // The run's own folder; sign-in sessions and the suppressions stay beside the runs.
        outputDir: runDir,
        authDir: this.authDir,
        stateDir: this.outputDir,
        evidenceUrlPrefix: `/api/evidence/runs/${context.runId}/`,
        dataDir: this.dataDir,
        signal: this.activeAbortController?.signal,
        finishSignal: this.finishController?.signal,
        breakpoints: context.breakpoints || ['375px', '768px', '1440px'],
        repoRoot: process.cwd(),
        runId: context.runId,
        reportNotes: context.reportNotes,
        aiModels: context.aiModels,
        readOnly: context.readOnly,
        notRun,
        siteMap: context.draft ? this.siteMapOf(context.draft, context.runId) : undefined,
        testedWithApprovedPlan: extra.testedWithApprovedPlan,
        searchChecks: context.searchChecks,
        visibility: context.visibility,
        onEvent: (event) => {
          if (current()) this.forwardRunEvent(event);
        },
      });
    } catch (err) {
      // Stopped: the stop has already put the plan back for review.
      if (!current() || isAbortError(err)) return;
      // Without a plan to go back to (a run that skipped the review), the caller reports the failure.
      if (!context.draft || this.currentPlanRecord !== record) {
        await this.clearPlan(context.runId);
        throw err;
      }
      // Failed part-way: the plan stays, so it can be approved again once the site is working.
      const msg = err instanceof Error ? err.message : String(err);
      await this.savePlan(record).catch(() => {});
      this.phase = 'awaiting-review';
      this.isRunning = true;
      this.lastRunError = msg;
      this.lastErrorCode = 'ERR_TEST_EXECUTION_FAILED';
      this.broadcastRunnerEvent({
        type: 'RUN_FAILED',
        runId: context.runId,
        error: msg,
        code: 'ERR_TEST_EXECUTION_FAILED',
        planKept: true,
        timestamp: Date.now(),
      });
      return;
    }
    if (!current()) return;
    // Tested: the plan no longer awaits review, so a restart mustn't bring it back. (If the runner
    // dies mid-test the file stays, and the plan can be approved again.)
    await this.clearPlan(context.runId);

    // What the site was seen doing (the error it shows for an empty field) confirms a guessed rule next time.
    if (context.siteHost && context.draft) {
      const memory = await loadSiteMemory(this.siteDir(), context.siteHost);
      if (memory) {
        rememberObservations(memory, context.draft, report);
        await saveSiteMemory(this.siteDir(), memory).catch(() => {});
      }
    }

    report.aiUsage = context.draft?.plan?.budget?.tokens;

    // The AI's visual review of one screen per layout, within what's left of today's AI requests.
    // What it doesn't get to can be finished from the report.
    if (context.draft && context.ai && context.ai.provider !== 'mock') {
      const screens = this.screensForReview(report, context.draft);
      if (screens.length > 0) {
        this.broadcastRunnerEvent({
          type: 'VISUAL_REVIEW_STARTED',
          runId: context.runId,
          screens: screens.length,
          timestamp: Date.now(),
        });
        const reviewed = await this.visualReview(report, screens, {
          provider: context.ai.provider,
          apiKey: context.ai.apiKey,
          vision: context.aiModels?.vision,
        }).catch(() => null);
        if (!current()) return;
        if (!reviewed) {
          report.notes = [
            ...(report.notes || []),
            'Looks and reads well wasn’t fully checked: no AI model that reads screenshots is set up. Choose one in Settings.',
          ];
        } else if (reviewed.remaining > 0) {
          report.notes = [
            ...(report.notes || []),
            reviewed.outOfRequests
              ? `The AI’s visual review looked at ${reviewed.reviewed} of ${screens.length} screens before today’s AI requests ran out. Finish it from the report when requests are available again.`
              : `The AI’s visual review stopped after ${reviewed.reviewed} of ${screens.length} screens because the AI service didn’t answer. Finish it from the report later.`,
          ];
        }
        if (reviewed) await this.saveReviewedReport(report);
      }
    }

    // Kept for Past check-ups, with its files, before the run is reported as done.
    await this.keepRun(report, record.plan.targetUrl || context.targetUrl, context.siteHost).catch((err) =>
      console.warn('[Release check-up] Couldn’t keep the run’s report:', err instanceof Error ? err.message : err)
    );
    this.lastReport = report;
    this.phase = 'done';
    this.isRunning = false;
    this.currentTargetUrl = null;
  }

  private async ensurePlanLoaded(): Promise<StoredPlanRecord | null> {
    if (this.currentPlanRecord) return this.currentPlanRecord;
    try {
      const raw = await fs.readFile(this.planFile, 'utf8');
      const record = JSON.parse(raw) as StoredPlanRecord;
      if (record?.plan && record?.context) {
        this.currentPlanRecord = record;
        if (this.phase === 'idle') {
          this.phase = 'awaiting-review';
          this.isRunning = true;
          this.currentRunId = record.plan.runId;
        }
        return this.currentPlanRecord;
      }
    } catch {
      // file missing or invalid
    }
    return null;
  }

  /** The site a plan is for, as typed ("localhost:3050"). */
  private hostOfPlan(record: StoredPlanRecord): string {
    return record.context.siteHost ?? hostOfAddress(record.plan.targetUrl);
  }

  private parkedFile(host: string): string {
    return path.join(this.dataDir, 'waiting-plans', `${host.toLowerCase().replace(/[^a-z0-9.-]+/g, '_')}.json`);
  }

  /** Keeps a waiting plan aside while another site is checked: in memory (with its sign-ins) and on disk (without). */
  private async parkPlan(record: StoredPlanRecord): Promise<void> {
    const host = this.hostOfPlan(record);
    this.parkedPlans.set(host, record);
    const file = this.parkedFile(host);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(this.planForDisk(record), null, 2), 'utf8');
  }

  /** Takes a site's kept-aside plan back out, or null when there's none. */
  private async unparkPlan(host: string): Promise<StoredPlanRecord | null> {
    let record = this.parkedPlans.get(host) ?? null;
    if (!record) {
      try {
        record = JSON.parse(await fs.readFile(this.parkedFile(host), 'utf8')) as StoredPlanRecord;
      } catch {
        record = null;
      }
    }
    this.parkedPlans.delete(host);
    await fs.rm(this.parkedFile(host), { force: true }).catch(() => {});
    return record?.plan && record.context ? record : null;
  }

  /** Every plan kept aside, for the new check-up screen. */
  private async listParkedPlans(): Promise<
    Array<{ host: string; targetUrl: string; runId: string; discoveredAt: string; pages: number }>
  > {
    const dir = path.join(this.dataDir, 'waiting-plans');
    const list: Array<{ host: string; targetUrl: string; runId: string; discoveredAt: string; pages: number }> = [];
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      try {
        const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as StoredPlanRecord;
        list.push({
          host: this.hostOfPlan(record),
          targetUrl: record.plan.targetUrl,
          runId: record.plan.runId,
          discoveredAt: record.plan.discoveredAt,
          pages: record.plan.planPages?.length ?? record.plan.pages.length,
        });
      } catch {
        // not a plan
      }
    }
    return list;
  }

  /**
   * GET: the plans kept aside. POST { host }: brings one back for review; the plan waiting now, if
   * any, is kept aside in its place. Not while scanning or testing.
   */
  private async handleWaitingPlans(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      this.sendJson(res, 200, { plans: (await this.listParkedPlans()).filter((p) => this.isMine(p.runId)) });
      return;
    }
    let body: { host?: string } = {};
    try {
      body = await this.readJsonBody(req);
    } catch {
      // checked below
    }
    if (this.phase === 'scanning' || this.phase === 'testing') {
      this.sendJson(res, 409, {
        error: 'A check-up is running. Wait for it to finish, or stop it first.',
        code: 'ERR_RUN_IN_PROGRESS',
      });
      return;
    }
    if (this.beta && body.host && !this.isMine(this.parkedPlans.get(body.host)?.plan.runId)) {
      this.sendJson(res, 404, { error: 'There’s no plan kept for that site.' });
      return;
    }
    const record = body.host ? await this.unparkPlan(body.host) : null;
    if (!record) {
      this.sendJson(res, 404, { error: 'There’s no plan kept for that site.' });
      return;
    }
    const current = await this.ensurePlanLoaded();
    if (current && this.phase === 'awaiting-review') await this.parkPlan(current);
    await this.savePlan(record);
    this.phase = 'awaiting-review';
    this.isRunning = true;
    this.currentRunId = record.plan.runId;
    this.currentTargetUrl = record.plan.targetUrl;
    this.runEvents = [];
    this.runGeneration++;
    this.broadcastRunnerEvent({ type: 'PLAN_READY', runId: record.plan.runId, resumed: true, timestamp: Date.now() });
    this.sendJson(res, 200, { resumed: true, runId: record.plan.runId, targetUrl: record.plan.targetUrl });
  }

  private async savePlan(record: StoredPlanRecord): Promise<void> {
    this.currentPlanRecord = record;
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.planFile, JSON.stringify(this.planForDisk(record), null, 2), 'utf8');
  }

  /**
   * The plan as written to disk. Sign-in details stay in memory only; after a
   * restart the approval has to send them again.
   */
  private planForDisk(record: StoredPlanRecord): StoredPlanRecord {
    const { profile, ai, ...context } = record.context;
    const roles = profile?.roles || [];
    const notSaved = [...new Set([...(context.signInNotSaved || []), ...roles.map((r) => r.role)])];
    return new Redactor(roles).deep({
      plan: record.plan,
      context: {
        ...context,
        profile: profile && {
          ...profile,
          roles: roles.map(({ role, loginPath }) => ({ role, username: '', loginPath })),
        },
        signInNotSaved: notSaved.length > 0 ? notSaved : undefined,
        // An AI key sent with the request isn't kept either; a saved key is looked up again.
        ai: ai && { provider: ai.provider, model: ai.model },
      },
    });
  }

  /** Forgets the paused plan; with a runId, only while it is still that run's plan (a newer run may have replaced it). */
  private async clearPlan(runId?: string): Promise<void> {
    if (runId && this.currentPlanRecord && this.currentPlanRecord.plan.runId !== runId) return;
    this.currentPlanRecord = null;
    await fs.rm(this.planFile, { force: true }).catch(() => {});
  }

  private async handleGetPlan(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const record = await this.ensurePlanLoaded();
    // Also while testing: a page reopened mid-run draws the map from the approved plan.
    if (!record || (this.phase !== 'awaiting-review' && this.phase !== 'scanning' && this.phase !== 'testing')) {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    this.sendJson(res, 200, planForClient(record.plan));
  }

  private async handlePatchPlan(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const record = await this.ensurePlanLoaded();
    if (!record || this.phase !== 'awaiting-review') {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }

    interface PatchPlanBody {
      flows?: DiscoveredFlow[];
      questions?: Array<{ id: string; selectedAnswer: string }>;
      answers?: Record<string, string>;
      testCases?: TestCase[];
      productContext?: string;
      designNotes?: string;
      /** Plan Items switched on or off: pages, tests on pages, Navigation Checks, journeys ("journey:<id>"). */
      items?: Array<{ id: string; skipped: boolean }>;
      /** The screen sizes the run uses. */
      screenSizes?: Breakpoint[];
      /**
       * What a test or journey should lead to, confirmed or reworded by the person: it's theirs now,
       * not the AI's guess. `expectations` left out confirms the AI's wording as it is.
       */
      expectations?: Array<{ id: string; text?: string }>;
      /** 'quick': desktop only, and only the shared menus' links. */
      preset?: 'quick';
    }

    let body: PatchPlanBody;
    try {
      body = await this.readJsonBody<PatchPlanBody>(req);
    } catch {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    // Every edit gets the same check as the AI's plan. An edited test aimed at something the scan
    // never found is refused, and nothing in this request is applied.
    const validator = new PlanValidator(record.plan.pages, record.context.draft?.forms);
    if (Array.isArray(body.testCases)) {
      const issues = validator.check(body.testCases.map(asFlow));
      if (issues.length > 0) {
        this.sendJson(res, 422, { error: 'Some steps are aimed at things that aren’t on the page.', issues });
        return;
      }
    }

    // A typed sign-in detail becomes its placeholder, so the plan never holds it.
    const roles = record.context.profile?.roles || [];
    for (const item of [
      ...(Array.isArray(body.flows) ? body.flows : []),
      ...(Array.isArray(body.testCases) ? body.testCases : []),
    ]) {
      replaceCredentialsWithPlaceholders(item.steps || [], roles);
    }

    if (body.questions && Array.isArray(body.questions)) {
      for (const patchQ of body.questions) {
        const target = record.plan.questions.find((q) => q.id === patchQ.id);
        if (target) target.selectedAnswer = patchQ.selectedAnswer;
        const draftTarget = record.context.draft?.ambiguityQuestions?.find((q) => q.id === patchQ.id);
        if (draftTarget) draftTarget.selectedAnswer = patchQ.selectedAnswer;
      }
    }

    if (body.answers && typeof body.answers === 'object') {
      for (const [id, given] of Object.entries(body.answers)) {
        // An empty answer clears it: the safe answer is used again.
        const answer = given || undefined;
        const target = record.plan.questions.find((q) => q.id === id);
        if (target) target.selectedAnswer = answer;
        const draftTarget = record.context.draft?.ambiguityQuestions?.find((q) => q.id === id);
        if (draftTarget) draftTarget.selectedAnswer = answer;
      }
    }

    if (body.flows && Array.isArray(body.flows)) {
      validator.markFlowsNeedingHelp(body.flows);
      record.plan.flows = body.flows;
      if (record.context.draft) {
        record.context.draft.flows = body.flows;
        // An added or edited journey that sends a form needs a test copy too.
        markJourneysNeedingTestCopy(record.context.draft);
      }
    }

    if (body.testCases && Array.isArray(body.testCases)) {
      record.plan.testCases = body.testCases;
      record.context.customTestCases = true;
    } else if (record.context.draft) {
      record.plan.testCases = this.testsFor(record.context).specTestCases;
      record.context.customTestCases = undefined;
    }

    if (body.productContext !== undefined) {
      record.context.productContext = body.productContext;
      record.plan.productContext = body.productContext;
      if (body.productContext.trim()) {
        const filePath =
          record.context.contextFilePath || path.join(this.runDir(record.plan.runId), 'product-context.md');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, body.productContext, 'utf8');
        record.context.contextFilePath = filePath;
      }
    }

    if (body.designNotes !== undefined) {
      record.context.designNotes = body.designNotes;
      record.plan.designNotes = body.designNotes;
    }

    // Plan Items switched on or off.
    const draft = record.context.draft;
    for (const item of Array.isArray(body.items) ? body.items : []) {
      const skipped = item.skipped ? true : undefined;
      if (item.id.startsWith('journey:')) {
        const flow = draft?.flows.find((f) => `journey:${f.id}` === item.id);
        if (flow) flow.outOfScope = skipped;
        continue;
      }
      const plan = draft?.plan;
      const found =
        plan?.pages.find((p) => p.id === item.id) ??
        plan?.navigation.find((n) => n.id === item.id) ??
        plan?.pages.flatMap((p) => p.tests).find((t) => t.id === item.id);
      if (found) found.skipped = skipped;
    }
    const sizes = (body.screenSizes || []).filter((s): s is Breakpoint => ['375px', '768px', '1440px'].includes(s));
    if (sizes.length > 0) record.context.breakpoints = sizes;

    // Confirmed or reworded expectations: the person's own from now on.
    const touched = new Set((body.items || []).map((i) => i.id));
    for (const change of Array.isArray(body.expectations) ? body.expectations : []) {
      touched.add(change.id);
      const text = change.text?.trim();
      if (change.id.startsWith('journey:')) {
        const flow = draft?.flows.find((f) => `journey:${f.id}` === change.id);
        if (!flow) continue;
        flow.candidateExpectations = text
          ? { text: { contains: text }, origin: 'user' }
          : { ...(flow.candidateExpectations || {}), origin: 'user' };
        continue;
      }
      const test = draft?.plan?.pages.flatMap((pg) => pg.tests).find((t) => t.id === change.id);
      if (test)
        test.expectations = text
          ? { text: { contains: text }, origin: 'user' }
          : { ...(test.expectations || {}), origin: 'user' };
    }

    // A quick check: desktop only, and each page's own links left out (the shared menus stay).
    if (body.preset === 'quick' && draft?.plan) {
      record.context.breakpoints = ['1440px'];
      for (const nav of draft.plan.navigation) {
        if (!nav.shared && !nav.leavesSite) {
          nav.skipped = true;
          touched.add(nav.id);
        }
      }
    }

    if (draft) this.refreshPlan(record);
    await this.savePlan(record);
    // Only switches, answers and sizes changed: the answer is what changed, not the whole plan.
    const small = !body.flows && !body.testCases && body.productContext === undefined && body.designNotes === undefined;
    this.sendJson(res, 200, small ? planDelta(record.plan, touched) : planForClient(record.plan));
  }

  private async handlePlanMarkdown(res: http.ServerResponse): Promise<void> {
    const record = await this.ensurePlanLoaded();
    if (!record || this.phase !== 'awaiting-review') {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    let host = 'site';
    try {
      host = new URL(record.plan.targetUrl).host.replace(/[^a-z0-9.-]/gi, '_');
    } catch {
      // keep "site"
    }
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="test-plan-${host}.md"`,
    });
    res.end(planToMarkdown(record.plan));
  }

  /** How re-planning should go for this plan: its site, the owner's notes, and what they asked for. */
  private replanOptions(
    record: StoredPlanRecord,
    instructions: string | undefined,
    report: (what: string) => void
  ): ReplanOptions {
    const roles = record.context.profile?.roles || [];
    const redactor = new Redactor(roles);
    return {
      readOnly: !!record.context.readOnly,
      productContext: record.context.productContext,
      instructions: instructions?.trim() || undefined,
      roles,
      forbiddenActions: record.context.profile?.forbiddenActions,
      redact: (text) => redactor.text(text),
      onProgress: report,
    };
  }

  /**
   * Runs a change to the plan that needs the AI or the crawler in the background: answers 202 at
   * once, reports progress as PLAN_UPDATE_PROGRESS events, and ends with PLAN_UPDATED (the plan is
   * saved) or PLAN_UPDATE_FAILED. One at a time; approving waits until it's done.
   */
  private async startPlanUpdate(
    res: http.ServerResponse,
    what: string,
    work: (record: StoredPlanRecord, ai: PacedAI | undefined, report: (step: string) => void) => Promise<string[]>
  ): Promise<void> {
    const record = await this.ensurePlanLoaded();
    if (!record || this.phase !== 'awaiting-review' || !record.context.draft?.plan) {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    if (this.planUpdate) {
      this.sendJson(res, 409, {
        error: 'The plan is already being updated. Wait for it to finish.',
        code: 'ERR_PLAN_UPDATING',
      });
      return;
    }
    const runId = record.plan.runId;
    this.sendJson(res, 202, { updating: true, what });
    this.broadcastRunnerEvent({ type: 'PLAN_UPDATE_STARTED', runId, what, timestamp: Date.now() });
    this.planUpdate = (async () => {
      try {
        const provider = await this.aiFor(record.context);
        const budget = provider ? await this.aiBudgetFor(record.context.ai) : undefined;
        const paced = provider
          ? new PacedAI(provider, budget?.left ?? Infinity, { model: record.context.ai?.model })
          : undefined;
        const notes = await work(record, paced, (step) =>
          this.broadcastRunnerEvent({
            type: 'PLAN_UPDATE_PROGRESS',
            runId,
            what: step,
            requestsUsed: paced?.used ?? 0,
            timestamp: Date.now(),
          })
        );
        const draft = record.context.draft;
        const plan = draft.plan!;
        const used = paced?.used ?? 0;
        plan.budget = {
          needed: plan.budget?.needed ?? 0,
          ...plan.budget,
          used: (plan.budget?.used ?? 0) + used,
          tokens: addTokens(plan.budget?.tokens, paced?.tokens),
          left: budget?.left !== undefined ? Math.max(0, budget.left - used) : plan.budget?.left,
          limit: budget?.limit ?? plan.budget?.limit,
        };
        if (draft.exploration) draft.exploration.notes = [...new Set([...draft.exploration.notes, ...notes])];
        await this.recordModelOutcomes(paced?.models);
        this.refreshPlan(record);
        await this.savePlan(record);
        this.broadcastRunnerEvent({ type: 'PLAN_UPDATED', runId, what, timestamp: Date.now() });
      } catch (err) {
        this.broadcastRunnerEvent({
          type: 'PLAN_UPDATE_FAILED',
          runId,
          what,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
      } finally {
        this.planUpdate = null;
      }
    })();
  }

  /** { itemId, instructions?, promote? } plans one Plan Item again; { all: true, productContext? } plans everything again. */
  private async handleReplan(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: { itemId?: string; all?: boolean; instructions?: string; productContext?: string; promote?: boolean };
    try {
      body = await this.readJsonBody(req);
    } catch {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const id = body.itemId || '';
    const what = body.all
      ? 'Re-planning everything'
      : body.promote
        ? `Testing ${id.replace(/^page:/, '')} on its own`
        : 'Re-planning with the AI';
    await this.startPlanUpdate(res, what, async (record, ai, report) => {
      const draft = record.context.draft;
      if (body.productContext !== undefined) {
        record.context.productContext = body.productContext;
        record.plan.productContext = body.productContext;
      }
      const options = this.replanOptions(record, body.instructions, report);
      const productId = record.context.productId;
      if (body.all) return replanAll(draft, ai, { ...options, productId });
      if (id.startsWith('journey:')) {
        const flow = draft.flows.find((f) => `journey:${f.id}` === id);
        const asked = `Re-plan the journey “${flow?.name ?? id}”${options.instructions ? `: ${options.instructions}` : ''}. Keep the other journeys as they are.`;
        return replanJourneys(draft, ai, { ...options, productId, instructions: asked });
      }
      if (id.startsWith('page:'))
        return replanPage(draft, id.slice('page:'.length), ai, { ...options, promote: body.promote });
      if (id.startsWith('pagetest:'))
        return replanPage(draft, id.slice('pagetest:'.length, id.lastIndexOf(':')), ai, options);
      const nav = draft.plan!.navigation.find((n) => n.id === id);
      if (nav?.shared) return replanMenus(draft, ai, options);
      if (nav) return replanPage(draft, nav.startPage, ai, options);
      throw new Error('That item isn’t in the plan any more.');
    });
  }

  /** { address }: a page no link reaches, added by the person; it's opened and planned like the rest. */
  private async handleAddPage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const record = await this.ensurePlanLoaded();
    let body: { address?: string };
    try {
      body = await this.readJsonBody(req);
    } catch {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    if (!record?.context.draft) {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    let target: URL;
    try {
      target = new URL((body.address || '').trim(), record.context.targetUrl);
    } catch {
      this.sendJson(res, 400, { error: 'That doesn’t look like an address on this site.' });
      return;
    }
    if (!isSameSite(target.host, new URL(record.context.targetUrl).host)) {
      this.sendJson(res, 400, {
        error: 'That address isn’t on this site. Links to other sites are listed under Navigation.',
      });
      return;
    }
    const address = target.pathname + target.search;
    if (record.context.draft.pages.some((p) => pathOf(p.urlPath) === target.pathname)) {
      this.sendJson(res, 400, { error: 'That page is already in the plan.' });
      return;
    }
    await this.startPlanUpdate(res, `Adding ${address}`, async (rec, ai, report) => {
      report(`Opening ${address}`);
      const found = await this.crawlMore(rec, rec.context.targetUrl, {
        startPaths: [address],
        maxPages: 1,
        exploreClicks: false,
      });
      if (found.pages.length === 0) throw new Error(`${address} couldn’t be opened, or it asks for a sign-in.`);
      return (
        await addPagesToPlan(rec.context.draft, found, ai, {
          ...this.replanOptions(rec, undefined, report),
          added: true,
        })
      ).notes;
    });
  }

  /** { host }: another host the site links to, explored and planned like the site's own pages. */
  private async handleIncludeHost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const record = await this.ensurePlanLoaded();
    let body: { host?: string };
    try {
      body = await this.readJsonBody(req);
    } catch {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const draft = record?.context.draft;
    const other = draft?.plan?.otherHosts.find((h) => h.host === body.host);
    const link = draft?.pages
      .flatMap((p) => p.links || [])
      .find((l) => l.leavesSite && new URL(l.to).host === body.host);
    if (!record || !draft || !other || !link) {
      this.sendJson(res, 400, { error: 'That host isn’t linked from this site.' });
      return;
    }
    if (other.included) {
      this.sendJson(res, 400, { error: 'That host is already in the plan.' });
      return;
    }
    const origin = new URL(link.to).origin;
    if (await this.refuseTarget(res, origin)) return;
    await this.startPlanUpdate(res, `Adding ${other.host}`, async (rec, ai, report) => {
      report(`Exploring ${other.host}`);
      const crawled = await this.crawlMore(rec, `${origin}/`, {
        maxPages: INCLUDED_HOST_PAGES,
        exploreClicks: true,
        onPage: (_page, n) => report(`Exploring ${other.host}: ${n} ${n === 1 ? 'page' : 'pages'} found`),
      });
      if (crawled.pages.length === 0) throw new Error(`${other.host} couldn’t be explored.`);
      const out = await addPagesToPlan(
        rec.context.draft,
        onOtherHost(crawled, origin),
        ai,
        this.replanOptions(rec, undefined, report)
      );
      const included = rec.context.draft.plan!.otherHosts.find((h) => h.host === other.host);
      if (included) included.included = true;
      return out.notes;
    });
  }

  /**
   * { role, username, password, loginPath? }: signs in from the review, explores what that role
   * sees, and adds it to the plan: pages only it reaches are planned, and pages everyone reaches are
   * also visited as it. The details stay in memory, like a sign-in given with the scan.
   */
  private async handleAddSignIn(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const record = await this.ensurePlanLoaded();
    let body: Partial<RoleCredential>;
    try {
      body = await this.readJsonBody(req);
    } catch {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const role =
      (body.role || 'member')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .slice(0, 40) || 'member';
    if (!body.username?.trim() || !body.password) {
      this.sendJson(res, 400, { error: 'Enter the username and password to sign in with.' });
      return;
    }
    if (!record?.context.draft?.plan) {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    if (record.context.profile?.roles.some((r) => r.role === role)) {
      this.sendJson(res, 400, { error: `There’s already a sign-in called “${role}”. Give this one another name.` });
      return;
    }
    const credential: RoleCredential = {
      role,
      username: body.username.trim(),
      password: body.password,
      loginPath: body.loginPath?.trim() || undefined,
    };
    await this.startPlanUpdate(res, `Adding the sign-in “${role}”`, async (rec, ai, report) => {
      report(`Signing in as ${role}`);
      const profile: ProductProfile = {
        name: rec.context.productId,
        productId: rec.context.productId,
        roles: [credential],
      };
      const browser = new BrowserManager();
      let found: Awaited<ReturnType<RunnerServer['crawlMore']>>;
      try {
        const signedIn = await new PreFlightChecker().runPreFlight(rec.context.targetUrl, profile, undefined, {
          browserManager: browser,
          authDir: this.authDir,
        });
        const storageState = signedIn.roleStorageStates?.[role];
        if (!storageState)
          throw new Error(`Signing in as “${role}” didn’t work. Check the username, password and sign-in page.`);
        const landing = signedIn.roleLandingPaths?.[role];
        found = await this.crawlMore(rec, rec.context.targetUrl, {
          startPaths: landing ? [landing] : [],
          maxPages: SIGNED_IN_PAGES,
          exploreClicks: true,
          storageState,
          who: role,
          onPage: (_page, n) => report(`Exploring as ${role}: ${n} ${n === 1 ? 'page' : 'pages'} found`),
        });
      } finally {
        await browser.close();
      }
      const draft = rec.context.draft;
      // The sign-in is part of the check-up now: testing signs in as it too.
      rec.context.profile = {
        ...(rec.context.profile ?? { name: rec.context.productId, productId: rec.context.productId, roles: [] }),
      };
      rec.context.profile.roles = [...rec.context.profile.roles, credential];
      // Pages everyone reaches are visited as this role too.
      const known = new Map(draft.pages.map((p) => [pathOf(p.urlPath), p]));
      for (const page of found.pages) {
        const before = known.get(pathOf(page.urlPath));
        if (!before) continue;
        before.reachedBy = [...new Set([...(before.reachedBy?.length ? before.reachedBy : ['visitor']), role])];
        const planned = draft.plan!.pages.find((p) => p.urlPath === before.urlPath);
        if (planned) planned.reachedBy = [...new Set([...planned.reachedBy, role])];
      }
      const out = await addPagesToPlan(draft, found, ai, this.replanOptions(rec, undefined, report));
      // Pages the sign-in wall kept out, now reached.
      if (draft.exploration) {
        const reached = new Set(found.pages.map((p) => pathOf(p.urlPath)));
        draft.exploration.notReached = draft.exploration.notReached?.filter((p) => !reached.has(pathOf(p)));
        draft.exploration.signedInAs = [...new Set([...(draft.exploration.signedInAs || []), role])];
        draft.exploration.notes = draft.exploration.notes.filter(
          (n) => !/not reached|Add a sign-in/i.test(n) || (draft.exploration!.notReached?.length ?? 0) > 0
        );
      }
      return [
        `Signed in as “${role}”: ${out.pages.length} new ${out.pages.length === 1 ? 'page' : 'pages'} added to the plan.`,
        ...out.notes,
      ];
    });
  }

  /**
   * Crawls more for the review: a page added by its address, another host's pages, or what a new
   * sign-in sees (`storageState`, as `who`). It goes as easy on the site as the scan did: robots.txt
   * and a pause between pages on sites we don't own.
   */
  private async crawlMore(
    record: StoredPlanRecord,
    target: string,
    options: {
      startPaths?: string[];
      maxPages: number;
      exploreClicks: boolean;
      onPage?: (page: PageInventoryItem, n: number) => void;
      storageState?: string;
      who?: string;
    }
  ): Promise<{ pages: PageInventoryItem[]; forms: NonNullable<DiscoveryDraft['forms']> }> {
    const browser = new BrowserManager();
    const origin = new URL(target);
    const ownMachine = isPrivateHost(origin.hostname);
    const who = options.who ?? 'visitor';
    try {
      const context = await browser.createContext({ baseUrl: target, storageState: options.storageState });
      if (record.context.readOnly) await blockChanges(context);
      const result = await new DeterministicSpider(
        record.context.profile?.forbiddenActions || [],
        options.maxPages
      ).crawl(context, target, {
        startPaths: options.startPaths,
        exploreClicks: options.exploreClicks,
        robots: ownMachine ? undefined : await RobotsPolicy.fetch(origin.origin, 'QA-Benchmarking-Bot'),
        pageDelayMs: ownMachine ? 0 : 2000,
        screenshotDir: path.join(this.runDir(record.context.runId), 'plan-pages'),
        screenshotPrefix: `more-${Date.now()}`,
        onPage: options.onPage,
      });
      return {
        pages: result.pages.map((p) => ({
          ...p,
          reachedBy: [who],
          links: p.links?.map((l) => ({ ...l, seenBy: [who] })),
        })),
        forms: result.forms.map((f) => ({
          urlPath: f.urlPath,
          inputs: f.inputs.map((i) => ({ selector: i.selector })),
          submitButtonSelector: f.submitButtonSelector,
          method: f.method,
        })),
      };
    } finally {
      await browser.close();
    }
  }

  /** Rebuilds the reviewed plan from the draft after a change: the summary, what won't run and the tests follow. */
  private refreshPlan(record: StoredPlanRecord): void {
    const before = record.plan;
    const since: MemorySummary | undefined = before.sinceLastRun
      ? { seenBefore: true, ...before.sinceLastRun }
      : undefined;
    const custom = record.context.customTestCases ? before.testCases : undefined;
    record.plan = this.buildPlan(record, since, before.aiAvailable ?? true, before.readOnlyReason || '');
    if (custom) record.plan.testCases = custom;
  }

  /**
   * Turns a sentence into a test for one page ({ sentence, urlPath, role }), or into a rule for one
   * journey ({ kind: 'rule', sentence, flowId }). Nothing is added: the person confirms first, and
   * the wizard then sends the result with a PATCH.
   */
  private async handleInterpret(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const record = await this.ensurePlanLoaded();
    if (!record || this.phase !== 'awaiting-review' || !record.context.draft) {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    let body: { sentence?: string; urlPath?: string; role?: string; kind?: 'test' | 'rule'; flowId?: string };
    try {
      body = await this.readJsonBody(req);
    } catch {
      this.sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const ai = await this.aiFor(record.context);
    const draft = record.context.draft;
    if (body.kind === 'rule') {
      const flow = draft.flows.find((f) => f.id === body.flowId);
      if (!flow) {
        this.sendJson(res, 404, { ok: false, message: 'That journey isn’t in the plan any more.' });
        return;
      }
      this.sendJson(res, 200, await interpretRule({ sentence: body.sentence || '', flow, draft, ai }));
      return;
    }
    const interpretation = await interpretTest({
      sentence: body.sentence || '',
      urlPath: body.urlPath || '/',
      role: body.role,
      draft,
      ai,
    });
    if (interpretation.ok) {
      replaceCredentialsWithPlaceholders(interpretation.flow.steps, record.context.profile?.roles || []);
      if (needsTestCopy(interpretation.flow, draft.pages, draft.forms)) interpretation.flow.needsTestCopy = true;
    }
    this.sendJson(res, 200, interpretation);
  }

  private async handleApprovePlan(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const idempotencyKey = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (idempotencyKey && this.recentApprovals.has(idempotencyKey)) {
      const existing = this.recentApprovals.get(idempotencyKey)!;
      if (Date.now() - existing.timestamp < 60 * 60 * 1000) {
        this.sendJson(res, 409, {
          error: 'This plan was already approved and is currently being tested.',
          code: 'ERR_DUPLICATE_APPROVAL',
          runId: existing.runId,
        });
        return;
      }
    }

    const record = await this.ensurePlanLoaded();
    if (!record || this.phase !== 'awaiting-review') {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    if (this.planUpdate) {
      this.sendJson(res, 409, {
        error: 'The plan is still being updated. Approve it when that’s done.',
        code: 'ERR_PLAN_UPDATING',
      });
      return;
    }

    const body: { breakpoints?: string[]; roles?: RoleCredential[] } = await this.readJsonBody<{
      breakpoints?: string[];
      roles?: RoleCredential[];
    }>(req).catch(() => ({}));
    if (body?.breakpoints) {
      record.context.breakpoints = body.breakpoints as Breakpoint[];
    }

    // Sign-in details are never saved to disk, so a plan read back after a restart needs them again.
    const notSaved = record.context.signInNotSaved || [];
    if (notSaved.length > 0 && Array.isArray(body?.roles) && record.context.profile) {
      const sent = new Map(body.roles.map((r) => [r.role, r]));
      record.context.profile.roles = record.context.profile.roles.map((r) => sent.get(r.role) ?? r);
      record.context.signInNotSaved = notSaved.filter((role) => !sent.has(role));
    }
    const stillMissing = record.context.signInNotSaved || [];
    if (stillMissing.length > 0) {
      this.sendJson(res, 409, {
        error: `Release check-up restarted since this plan was made, and sign-in details are never saved to disk. Send them again for: ${stillMissing.join(', ')}.`,
        needsSignIn: stillMissing,
      });
      return;
    }

    // The owner's own answers are remembered for the site; safe answers filled in now are not.
    const draft = record.context.draft;
    const answeredByOwner = Object.fromEntries(
      (draft?.ambiguityQuestions || []).filter((q) => q.key && q.selectedAnswer).map((q) => [q.key!, q.selectedAnswer!])
    );
    applySafeAnswers(record.plan.questions);
    if (draft?.ambiguityQuestions) applySafeAnswers(draft.ambiguityQuestions);

    let specTestCases: TestCase[];
    let notRun: RunOptions['notRun'] = [];
    if (record.context.customTestCases && record.plan.testCases?.length) {
      specTestCases = record.plan.testCases;
    } else if (draft) {
      ({ specTestCases, notRun } = this.testsFor(record.context));
      record.plan.testCases = specTestCases;
    } else {
      specTestCases = [this.defaultTestCase()];
    }
    if (draft) {
      record.context.reportNotes = [...(record.context.reportNotes || []), ...this.handCheckNotes(draft)];
      if (record.context.siteHost) {
        const memory = await loadSiteMemory(this.siteDir(), record.context.siteHost);
        await saveSiteMemory(
          this.siteDir(),
          rememberRun(memory, record.context.siteHost, draft, {
            reviewed: true,
            answeredByOwner,
            screenSizes: this.screenSizesOf(record.context),
          })
        );
      }
    }

    if (idempotencyKey) {
      const now = Date.now();
      for (const [k, v] of this.recentApprovals) {
        if (now - v.timestamp > 60 * 60 * 1000) this.recentApprovals.delete(k);
      }
      this.recentApprovals.set(idempotencyKey, { timestamp: now, runId: record.plan.runId });
    }

    this.sendJson(res, 200, { status: 'approved', runId: record.plan.runId });

    const generation = ++this.runGeneration;
    this.activeAbortController = new AbortController();
    this.finishController = new AbortController();
    this.lastErrorCode = null;
    this.lastRunError = null;
    // A page that opens during testing catches up on this testing, not on the scan or an earlier try.
    this.runEvents = [];
    this.executeTesting(record, specTestCases, notRun, generation).catch((err: unknown) => {
      // Stopped or replaced: whatever stopped it has already said so.
      if (generation !== this.runGeneration || isAbortError(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.lastRunError = msg;
      this.lastErrorCode = 'ERR_TEST_EXECUTION_FAILED';
      this.phase = 'failed';
      this.isRunning = false;
      this.broadcastRunnerEvent({
        type: 'RUN_FAILED',
        runId: record.plan.runId,
        error: msg,
        code: 'ERR_TEST_EXECUTION_FAILED',
        timestamp: Date.now(),
      });
    });
  }

  private async handleServeBaseline(fileName: string, res: http.ServerResponse): Promise<void> {
    const target = path.resolve(this.baselineDir, fileName);
    if (!isInside(this.baselineDir, target)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    try {
      const data = await fs.readFile(target);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Baseline image not found');
    }
  }

  private async handleListBaselines(res: http.ServerResponse): Promise<void> {
    try {
      await fs.mkdir(this.baselineDir, { recursive: true });
      const entries = await fs.readdir(this.baselineDir, { withFileTypes: true });
      const items = [];

      // Check current report for any visual diff findings
      const visualFindings = (this.lastReport?.findings || []).filter(
        (f) => f.checker === 'design-standards' && f.title?.toLowerCase().includes('visual regression')
      );

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
        const stat = await fs.stat(path.join(this.baselineDir, entry.name));
        const base = entry.name.slice(0, -4);
        const matchBp = base.match(/(375px|768px|1440px)$/);
        const breakpoint = (matchBp ? matchBp[1] : '1440px') as Breakpoint;
        const testCaseId = matchBp ? base.slice(0, -matchBp[1].length - 1) : base;

        // Check if there's a finding for this testCase and breakpoint
        const matchingFinding = visualFindings.find(
          (f) => f.testCaseId === testCaseId && f.where.breakpoint === breakpoint
        );

        let diffPercent: number | undefined;
        let diffUrl: string | undefined;
        let currentUrl: string | undefined;

        if (matchingFinding) {
          const matchPercent = matchingFinding.expectedVsActual.actual?.match(/([\d.]+)%\s+of pixels differ/);
          if (matchPercent) diffPercent = parseFloat(matchPercent[1]);
          if (matchingFinding.evidence?.screenshotPath) {
            diffUrl = `/api/evidence/${matchingFinding.evidence.screenshotPath}`;
          }
        }

        items.push({
          id: base,
          testCaseId,
          breakpoint,
          fileName: entry.name,
          fileSizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
          previewUrl: `/api/baselines/${encodeURIComponent(entry.name)}`,
          hasRegression: !!matchingFinding,
          diffPercent,
          diffUrl,
          currentUrl,
        });
      }

      this.sendJson(res, 200, items);
    } catch (err: unknown) {
      this.sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleAcceptBaseline(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody<{ id: string; currentEvidencePath?: string }>(req).catch(() => null);
    if (!body || !body.id) {
      this.sendJson(res, 400, { error: 'Missing baseline id' });
      return;
    }
    try {
      await fs.mkdir(this.baselineDir, { recursive: true });
      const dest = path.join(this.baselineDir, `${body.id}.png`);
      if (body.currentEvidencePath) {
        const src = path.resolve(this.outputDir, body.currentEvidencePath);
        if (isInside(this.outputDir, src)) {
          await fs.copyFile(src, dest);
        }
      }
      this.sendJson(res, 200, { ok: true, id: body.id });
    } catch (err: unknown) {
      this.sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleDeleteBaseline(id: string, res: http.ServerResponse): Promise<void> {
    const cleanId = id.replace(/\.png$/, '');
    const target = path.join(this.baselineDir, `${cleanId}.png`);
    if (!isInside(this.baselineDir, target)) {
      this.sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    try {
      await fs.unlink(target);
      this.sendJson(res, 200, { ok: true });
    } catch {
      this.sendJson(res, 404, { error: 'Baseline not found' });
    }
  }

  /** The AI for the improvement ideas: the one saved in Settings, or none (fixed rules write them then). */
  private async benchmarkAi(): Promise<AIProvider | undefined> {
    const settings = await this.readAiModels();
    const provider = settings.provider ?? 'openrouter';
    if (provider === 'mock') return undefined;
    const key = await this.storedKey(provider);
    return key ? this.makeAIProvider(provider, key, settings.text ?? undefined) : undefined;
  }

  /** An address as typed, with the scheme filled in: http for this computer or a private network, https for the rest. */
  private benchmarkAddress(typed: string | undefined): string | null {
    const text = (typed ?? '').trim();
    if (!text || (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text))) return null;
    try {
      const withScheme = /^https?:\/\//i.test(text)
        ? text
        : `${isPrivateHost(new URL(`http://${text}`).hostname) ? 'http' : 'https'}://${text}`;
      const url = new URL(withScheme);
      return /^https?:$/.test(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  }

  private benchmarkStore(): BenchmarkStore {
    return new BenchmarkStore(path.join(this.siteDir(), 'benchmarks'));
  }

  private async handleStartBenchmark(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody<{
      ourUrl?: string;
      ourName?: string;
      refUrl?: string;
      refName?: string;
      flowType?: string;
    }>(req).catch(() => null);
    const ourUrl = this.benchmarkAddress(body?.ourUrl);
    const refUrl = this.benchmarkAddress(body?.refUrl);
    if (!body || !ourUrl || !refUrl) {
      this.sendJson(res, 400, {
        error: 'Both addresses are needed, each a web address such as https://example.com.',
        code: 'ERR_INVALID_REQUEST',
      });
      return;
    }
    if ((await this.refuseTarget(res, ourUrl)) || (await this.refuseTarget(res, refUrl))) return;
    if (this.phase === 'scanning' || this.phase === 'testing' || this.benchmarkBusy) {
      this.sendJson(res, 409, {
        error: this.beta
          ? 'Someone else is using this shared copy right now. Try again in a few minutes.'
          : 'A check-up or comparison is running. Wait for it to finish first.',
        code: 'ERR_RUN_IN_PROGRESS',
      });
      return;
    }

    const id = `bench-${Date.now()}`;
    const flowType = cleanFlowType(body.flowType);
    const ourName = siteName(ourUrl, body.ourName);
    const refName = siteName(refUrl, body.refName);
    const job: BenchmarkJob = {
      id,
      status: 'running',
      stage: 'Starting…',
      flowType,
      ourUrl,
      refUrl,
      startedAt: new Date().toISOString(),
    };
    this.benchmarkJobs.set(id, { job, owner: this.beta ? currentSessionId() : undefined });
    this.benchmarkBusy = true;
    const store = this.benchmarkStore();
    const shots = path.join(this.dataDir, 'benchmark-shots', id);
    this.sendJson(res, 202, { id });

    void (async () => {
      try {
        const { result, aiUsed } = await compareSites({
          ourUrl,
          ourName,
          refUrl,
          refName,
          flowType,
          outputDir: shots,
          resolveUrl: (address) => this.resolveTargetUrl(address),
          ai: await this.benchmarkAi(),
          onStage: (stage) => {
            job.stage = stage;
          },
        });
        // The screenshots are not kept: they are another visitor's pages on a shared copy, and large.
        result.ourProduct.screenshots = [];
        result.referenceProduct.screenshots = [];
        job.result = result;
        job.aiUsed = aiUsed;
        job.status = 'done';
        job.stage = 'Done';
      } catch (err) {
        job.status = 'failed';
        job.stage = 'Stopped';
        job.error = `The comparison couldn’t finish: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        this.benchmarkBusy = false;
        await store.save(job).catch(() => undefined);
        await fs.rm(shots, { recursive: true, force: true }).catch(() => undefined);
        // Kept on disk now; the copy in memory only serves the screen that is waiting on it.
        setTimeout(() => this.benchmarkJobs.delete(id), 60_000).unref();
      }
    })();
  }

  /** The comparisons this visitor can see: any running now, then the kept ones, newest first. The full result is fetched one at a time. */
  private async handleListBenchmarks(res: http.ServerResponse): Promise<void> {
    const me = this.beta ? currentSessionId() : undefined;
    const running = [...this.benchmarkJobs.values()]
      .filter((e) => e.job.status === 'running' && (!this.beta || e.owner === me))
      .map((e) => e.job);
    const kept = await this.benchmarkStore().list();
    const list = [...running, ...kept.filter((k) => !running.some((r) => r.id === k.id))];
    this.sendJson(
      res,
      200,
      list.map(({ result: _result, ...summary }) => summary)
    );
  }

  private async handleBenchmarkById(id: string, method: string, res: http.ServerResponse): Promise<void> {
    const live = this.benchmarkJobs.get(id);
    const mine = live && (!this.beta || live.owner === currentSessionId());
    if (method === 'DELETE') {
      if (mine && live.job.status === 'running') {
        this.sendJson(res, 409, { error: 'That comparison is still running.', code: 'ERR_RUN_IN_PROGRESS' });
        return;
      }
      if (mine) this.benchmarkJobs.delete(id);
      const removed = await this.benchmarkStore().remove(id);
      this.sendJson(res, removed ? 200 : 404, { removed });
      return;
    }
    const job = mine ? live.job : await this.benchmarkStore().get(id);
    if (!job) {
      this.sendJson(res, 404, { error: 'That comparison isn’t here any more.', code: 'ERR_NOT_FOUND' });
      return;
    }
    this.sendJson(res, 200, job);
  }

  private async handleAddSchedule(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody<{
      targetUrl: string;
      name?: string;
      cadence?: 'daily' | 'weekly' | 'hourly';
      hour?: number;
      dayOfWeek?: number;
      preset?: 'full' | 'quick';
    }>(req).catch(() => null);

    if (!body || !body.targetUrl) {
      this.sendJson(res, 400, { error: 'Target URL is required' });
      return;
    }

    try {
      let hostname = body.targetUrl;
      try {
        hostname = new URL(body.targetUrl).hostname;
      } catch {}
      const schedule = await this.scheduler.addSchedule({
        targetUrl: body.targetUrl,
        name: body.name || `Checkup for ${hostname}`,
        cadence: body.cadence || 'daily',
        hour: body.hour ?? 2,
        dayOfWeek: body.dayOfWeek ?? 1,
        preset: body.preset || 'full',
        enabled: true,
      });
      this.sendJson(res, 201, schedule);
    } catch (err: unknown) {
      this.sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private defaultTestCase(): TestCase {
    return {
      id: 'TC-DEFAULT-001',
      flowId: 'landing-verification',
      name: 'Home page sanity check',
      role: 'anonymous',
      startPage: '/',
      steps: [{ action: 'wait', name: 'Wait for page load' }],
      expectations: { url: { pattern: '/*' } },
    };
  }
}
