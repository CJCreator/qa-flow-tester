import http from 'http';
import { promises as fs, constants as fsConstants } from 'fs';
import path from 'path';
import {
  journeyPages,
  releaseVerdict,
  signInReasonText,
  summarizeDocument,
  type DocumentSummary,
  type StorageStateData,
  type RunStartBody,
} from '@qa/types';
import { serveUi, type UiApp } from './ui-static.js';
import {
  createCheckupSession,
  type CheckupSession,
  type StoredPlanRecord,
  createCheckupRun,
  type CheckupRun,
  resolveAuthorization,
  type RunAuthorization,
  resolveReadOnly,
  readOnlyReason,
  hasCompleteSignIn,
  screensForReview,
  nothingNew,
  redactedMessage,
  signInAccount,
  ALL_SCREEN_SIZES,
  LOOPBACK_HOSTS,
  formatDay,
} from './session/checkup-session.js';
import {
  allRoutes,
  matchRoute,
  readJsonBody,
  sendJson,
  MAX_BODY_CHARS,
  type PlanRouteContext,
} from './routes/index.js';
import type {
  RunSummary,
  SiteMapSummary,
  ProductProfile,
  ReleaseReport,
  RoleCredential,
  AIProviderType,
  RunnerPhase,
  Breakpoint,
  PlanIntent,
  AmbiguityQuestion,
  DiscoveryDraft,
  PageInventoryItem,
  BenchmarkJob,
  SignInFailureReason,
  RunCap,
  ProviderLimits,
  FindingSeverity,
} from '@qa/types';
import {
  FlowTestOrchestrator,
  DiscoveryAgent,
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
  SignInFailedError,
  PlanValidator,
  Redactor,
  redactUrl,
  type PreFlightResult,
  replaceCredentialsWithPlaceholders,
  applySafeAnswers,
  isTestHost,
  setBrowserPolicy,
  makeRequestGuard,
  verifyDomainProof,
  resolvePublic,
  isIpLiteral,
  safeGet,
  proofUrl,
  proofLine,
  type NetDeps,
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
  emptyPlan,
  defaultTestCase,
  buildPlan,
  testsFor,
  screenSizesOf,
  gradedChecksFor,
  siteMapOf,
  handCheckNotes,
  planToMarkdown,
  planToPlaywrightProject,
  zipFiles,
  PacedAI,
  BudgetSpentError,
  pacingFor,
  estimateUsd,
  fetchDocsPages,
  makeGuardedDocsGet,
  localDocsGet,
  buildIssuesModel,
  renderIssuesMarkdown,
  renderIssuesHtml,
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
  docxToMarkdown,
  DOCX_MAX_BYTES,
  type ReplanOptions,
  type VisualReviewItemInput,
  type MemorySummary,
  type SiteMemory,
  type RunOptions,
  type AIProvider,
  type OrchestratorEvent,
  writeJsonAtomic,
  readJsonSafe,
  runPostDeploySmoke,
  smokeReport,
  generateApiChecks,
  runApiChecks,
  apiChecksSection,
  ReportGenerator,
} from '@qa/core';
import { BenchmarkStore, cleanFlowType, compareSites, siteName } from './benchmarks.js';
import { SchedulerManager, type CheckupSchedule } from './scheduler.js';
import { waitingPlanMaxAgeMs } from './session/plan-store.js';
import {
  SessionKeyResolver,
  betaLimitsFromEnv,
  keepSessionFoldersIn,
  sweepSessionFolders,
  claimBetaRun,
  currentSessionId,
  enterSession,
  refusedTarget,
  proofTokenFor,
  peekProofToken,
  claimProofCheck,
  sessionFor,
  pinSession,
  SessionRateLimited,
  type BetaLimits,
} from './beta.js';
import { testCopyFor } from './host-policy.js';
import {
  checkAiCap,
  checkContextDocuments,
  checkContextUrl,
  checkIntentsOff,
  checkSavedSessions,
  checkTestCap,
  checkCrawlConcurrency,
  checkCrawlDelayMs,
  checkCustomHeaders,
  checkRoles,
  checkLoginPath,
} from './run-inputs.js';
import {
  isInside,
  isSavedSession,
  hasDotDotSegment,
  isRunId,
  exists,
  sendFileRanged,
  DOWNLOADABLE_REPORT_FILES,
} from './server-files.js';
import { gzipLargeAnswers, isLoopbackHost, ACCESS_COOKIE, cookieValue, matchesSecret } from './server-http.js';
import { addTokens, AI_PROVIDERS, VISUAL_REVIEW_CALLS, type AiSettings } from './server-ai.js';
import { BETA_CLOSED_ROUTES } from './server-beta-routes.js';

export { redactedMessage };
export { BETA_CLOSED_ROUTES };

const RUNS_KEPT_PER_SITE = 10;
/** Beta: finished runs kept per visitor, across every site. Their oldest are deleted. */
const RUNS_KEPT_PER_VISITOR = 10;

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
   * Where sign-in sessions (cookies) are kept while a run works. Default `<outputDir>/auth`. A caller
   * whose output folder is uploaded or served (the CI check-up) must set a folder outside it.
   */
  authDir?: string;
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
  /** Test seam for a shared machine (beta): replaces DNS lookup and the pinned connection used for host checks. */
  hostChecks?: NetDeps;
  /** Beta only: check-ups per visitor and per day. A test seam; default from RUNNER_BETA_RUNS_PER_VISITOR / _PER_DAY. */
  betaLimits?: BetaLimits;
  /** Most time one test step may spend finding and acting on its element, in ms (env RUNNER_STEP_TIMEOUT_MS). Default 10000. */
  stepTimeoutMs?: number;
}

export type { StoredPlanRecord };

/** An address's host as typed ("localhost:3050"), or the address itself when it isn't one. */
function hostOfAddress(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

export { resolveReadOnly };

/**
 * RunnerServer is the only component that actually invokes FlowTestOrchestrator /
 * DiscoveryAgent on behalf of the Wizard. It is the live, single-flight execution engine
 * for UI-triggered runs.
 */
/** How long a health result is reused: the browser launch behind /healthz is not repeated on every probe. */
const HEALTH_CACHE_MS = 5 * 60 * 1000;
/** How long "no Plan waiting" is reused by status polls: an idle page does not open the Plan file on every poll. */
const STATUS_NO_PLAN_MS = 10 * 1000;

export class RunnerServer {
  private server: http.Server | null = null;
  private healthCheck: { at: number; result: Promise<string | null> } | null = null;
  private noPlanCheckedAt: number | null = null;
  private port: number;
  private host: string;
  private outputDir: string;
  private dataDir: string;
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
  private betaLimits: BetaLimits;
  private hostChecks: NetDeps | undefined;
  private stepTimeoutMs: number | undefined;
  private openRouter: OpenRouterClient;
  private makeAIProvider: (provider: AIProviderType, apiKey: string, model?: string) => AIProvider;
  private uiApps: UiApp[];
  private allowedOrigins: Set<string>;
  private accessToken?: string;

  public readonly session: CheckupSession;
  /** The chosen free models (not secret), kept beside the key so every browser gets the same setup. */
  private aiModelsFile: string;
  /** How each AI model has done on this machine. */
  private modelRecordFile: string;
  /** The defaults a check-up starts with (screen sizes). */
  private defaultsFile: string;
  private baselineDir: string;
  private scheduler: SchedulerManager;
  private checkupRun: CheckupRun;

  private get isRunning(): boolean {
    return this.session.run.isRunning;
  }
  private set isRunning(val: boolean) {
    this.session.run.setIsRunning(val);
  }

  private get phase(): RunnerPhase {
    return this.session.run.phase;
  }
  private set phase(p: RunnerPhase) {
    this.session.run.setPhase(p);
  }

  private get currentRunId(): string | null {
    return this.session.run.runId;
  }
  private set currentRunId(val: string | null) {
    this.session.run.setRunId(val);
  }

  private get currentTargetUrl(): string | null {
    return this.session.run.targetUrl;
  }
  private set currentTargetUrl(val: string | null) {
    this.session.run.setTargetUrl(val);
  }

  private get runGeneration(): number {
    return this.session.run.generation;
  }
  private set runGeneration(val: number) {
    this.session.run.setGeneration(val);
  }

  private get activeAbortController(): AbortController | null {
    return this.session.run.abortController();
  }
  private set activeAbortController(val: AbortController | null) {
    this.session.run.setAbortController(val);
  }

  private get finishController(): AbortController | null {
    return this.session.run.finishController();
  }
  private set finishController(val: AbortController | null) {
    this.session.run.setFinishController(val);
  }

  private get lastReport(): ReleaseReport | null {
    return this.session.report.last;
  }
  private set lastReport(val: ReleaseReport | null) {
    this.session.report.set(val);
  }

  private get lastRunError(): string | null {
    return this.session.report.error().message;
  }
  private set lastRunError(val: string | null) {
    this.session.report.setError(val, this.session.report.error().code);
  }

  private get lastErrorCode(): string | null {
    return this.session.report.error().code;
  }
  private set lastErrorCode(val: string | null) {
    this.session.report.setError(this.session.report.error().message, val);
  }

  private get currentCustomHeaders(): Record<string, string> | undefined {
    return this.session.secrets.headers;
  }
  private set currentCustomHeaders(val: Record<string, string> | undefined) {
    this.session.secrets.set({
      headers: val,
      tunnelAuth: this.session.secrets.tunnelAuth,
      headerHosts: this.session.secrets.headerHosts,
      userAgent: this.session.secrets.userAgent,
    });
  }

  private get currentTunnelAuth(): string | undefined {
    return this.session.secrets.tunnelAuth;
  }
  private set currentTunnelAuth(val: string | undefined) {
    this.session.secrets.set({
      headers: this.session.secrets.headers,
      tunnelAuth: val,
      headerHosts: this.session.secrets.headerHosts,
      userAgent: this.session.secrets.userAgent,
    });
  }

  private get currentHeaderHosts(): string[] | undefined {
    return this.session.secrets.headerHosts;
  }
  private set currentHeaderHosts(val: string[] | undefined) {
    this.session.secrets.set({
      headers: this.session.secrets.headers,
      tunnelAuth: this.session.secrets.tunnelAuth,
      headerHosts: val,
      userAgent: this.session.secrets.userAgent,
    });
  }

  private get currentUserAgent(): string | undefined {
    return this.session.secrets.userAgent;
  }
  private set currentUserAgent(val: string | undefined) {
    this.session.secrets.set({
      headers: this.session.secrets.headers,
      tunnelAuth: this.session.secrets.tunnelAuth,
      headerHosts: this.session.secrets.headerHosts,
      userAgent: val,
    });
  }

  private get authDir(): string {
    return this.session.paths.authDir;
  }

  private get planFile(): string {
    return this.session.plan.file;
  }

  private get legacyDataDir(): string | undefined {
    return this.session.paths.legacyDataDir;
  }

  get savedSessions(): Map<string, Record<string, StorageStateData>> {
    return this.session.secrets.savedSessions;
  }

  public runAuthDir(runId: string): string {
    return this.session.secrets.authDirFor(runId);
  }

  public async cleanAuthDir(runId: string): Promise<void> {
    await this.session.secrets.clean(runId);
  }

  private redactedMessage(err: unknown, extraRoles?: Array<Partial<RoleCredential>>): string {
    const headers = this.currentCustomHeaders || this.session.plan.currentRecord?.context?.customHeaders;
    const tunnel = this.currentTunnelAuth || this.session.plan.currentRecord?.context?.tunnelAuth;
    return redactedMessage(err, {
      roles: extraRoles,
      customHeaders: headers,
      tunnelAuth: tunnel,
      targetUrl: this.currentTargetUrl || this.session.plan.currentRecord?.context?.targetUrl || undefined,
    });
  }

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
    const legacyDataDir = !options.dataDir ? process.cwd() : undefined;
    this.session = createCheckupSession({
      outputDir: this.outputDir,
      dataDir: this.dataDir,
      authDir: options.authDir,
      legacyDataDir,
    });
    this.scheduler = new SchedulerManager(this.dataDir);
    this.aiModelsFile = path.join(this.dataDir, '.qa-ai-models.json');
    this.modelRecordFile = path.join(this.dataDir, '.qa-ai-model-record.json');
    this.defaultsFile = path.join(this.dataDir, '.qa-settings.json');
    this.beta = !!options.beta;
    this.betaLimits = options.betaLimits ?? betaLimitsFromEnv();
    if (this.beta) keepSessionFoldersIn(this.dataDir);
    this.hostChecks = options.hostChecks;
    this.stepTimeoutMs = options.stepTimeoutMs;
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
    this.checkupRun = createCheckupRun(this.session, {
      prepareAI: (body) => this.prepareAI(body),
      aiBudgetFor: (settings, key, cap) => this.aiBudgetFor(settings, key, cap),
      signInsFor: (body, memory, host) => this.signInsFor(body, memory, host),
      readDefaults: () => this.readDefaults(),
      siteDir: () => this.siteDir(),
      hostAliases: this.hostAliases,
      localhostAlias: this.localhostAlias,
      beta: this.beta,
      hostChecks: this.hostChecks,
      stepTimeoutMs: this.stepTimeoutMs,
      onEvent: (event) => this.broadcastRunnerEvent(event),
      afterKeep: (runId) => {
        void this.pruneVisitorRuns(this.runOwners.get(runId)).catch(() => {});
      },
      screensForReview: (report, draft) => this.screensForReview(report, draft),
      visualReview: (report, screens, options) => this.visualReview(report, screens, options),
      saveReviewedReport: (report) => this.saveReviewedReport(report),
      recordModelOutcomes: (models) => this.recordModelOutcomes(models),
      claimOwner: (runId) => {
        if (this.beta) {
          const me = currentSessionId();
          if (me) {
            this.runOwners.set(runId, me);
            pinSession(me);
          }
        }
      },
      isMine: (runId) => this.isMine(runId),
    });
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
    this.session.events.publish(event.type === 'RUN_COMPLETED' ? { type: event.type, runId: event.runId } : event);
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

  /** What stops this runner working, or null. Cached for HEALTH_CACHE_MS; concurrent probes share one check. */
  private healthProblem(): Promise<string | null> {
    if (this.healthCheck && Date.now() - this.healthCheck.at < HEALTH_CACHE_MS) return this.healthCheck.result;
    const result = this.checkHealth();
    this.healthCheck = { at: Date.now(), result };
    return result;
  }

  /** The data folder must take a write (metadata only, no read), and a headless Chromium must launch. */
  private async checkHealth(): Promise<string | null> {
    let problem: string | null = null;
    try {
      // A fresh install has no data folder yet; it is created on first write, so create it here (fails if read-only).
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.access(this.dataDir, fsConstants.W_OK);
    } catch {
      problem = `Data folder ${this.dataDir} is not writable`;
    }
    if (!problem) {
      const browser = new BrowserManager();
      try {
        await browser.launch('chromium', true);
      } catch (err) {
        problem = `Chromium does not launch: ${err instanceof Error ? err.message.split('\n')[0] : err}`;
      } finally {
        await browser.close();
      }
    }
    if (problem) console.warn(`[Release check-up] Health check failed: ${problem}`);
    return problem;
  }

  public async start(): Promise<string> {
    // A shared machine checks every browser request: nothing may reach a non-public address (ADR 0014).
    if (this.beta) setBrowserPolicy({ guard: makeRequestGuard(this.hostChecks) });
    await this.moveLegacyData();
    // Waiting plans not written for the limit (RUNNER_WAITING_PLAN_DAYS) are removed and named in the log.
    const expired = await this.session.plan.expireWaiting(waitingPlanMaxAgeMs());
    if (expired.length > 0) {
      console.warn(`[Release check-up] Removed ${expired.length} expired waiting plan(s): ${expired.join(', ')}`);
    }
    if (this.beta) await sweepSessionFolders();
    await this.ensurePlanLoaded();
    await this.loadLatestReport();
    // A schedule does what its screen says: it is checked every minute from the moment the server is up.
    // Schedules are closed in beta, so the shared copy never starts runs on its own.
    if (!this.beta) this.scheduler.start((schedule) => this.runSchedule(schedule));
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
          const pathname = url.pathname;

          // A host's health check asks this and nothing else: it says the server can work and shows no data.
          // 503 when the data folder cannot be written or Chromium cannot launch (cached, see healthProblem).
          if (pathname === '/healthz') {
            const problem = await this.healthProblem();
            res.writeHead(problem ? 503 : 200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(problem ? 'unhealthy' : 'ok');
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
          // Only exact origins: this server's own, or one listed. Not any other localhost port.
          const ownHost = (req.headers.host ?? '').toLowerCase();
          const isOwnOrigin =
            !!originNorm && !!ownHost && [`http://${ownHost}`, `https://${ownHost}`].includes(originNorm.toLowerCase());
          if (origin && (isOwnOrigin || (originNorm && this.allowedOrigins.has(originNorm)))) {
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

          gzipLargeAnswers(req, res);
          if (!this.grantAccess(req, res, url)) return;

          if (this.beta) {
            const proto = req.headers['x-forwarded-proto'];
            try {
              enterSession(sessionFor(req, res, (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ?? false));
            } catch (err) {
              if (!(err instanceof SessionRateLimited)) throw err;
              res.setHeader('Retry-After', '600');
              this.sendJson(res, 429, { error: err.message, code: 'ERR_BETA_LIMIT' });
              return;
            }
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
            // A page that opens mid-run catches up: this run's events so far, in order (beta: only the visitor's own run).
            // A reconnect (`?reconnect=1`) gets only the connected snapshot: the page drops its feed and reads the status over REST.
            if (url.searchParams.get('reconnect') !== '1' && this.isMine(this.currentRunId))
              for (const event of this.session.events.log)
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
            // Read only: a Plan waiting on disk is shown as awaiting review, but the run state is not changed here.
            const waiting = this.phase === 'idle' ? await this.waitingPlanForStatus() : null;
            const phase = waiting ? 'awaiting-review' : this.phase;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                isRunning: this.isRunning || !!waiting,
                hasReport: !!this.lastReport,
                lastRunError: this.lastRunError,
                lastErrorCode: this.lastErrorCode,
                phase,
                hasPlan: !!this.session.plan.currentRecord,
                runId: waiting ? waiting.plan.runId : this.currentRunId,
                // The site the run in progress or paused is for, as typed, for the Resume card.
                targetUrl: this.session.plan.currentRecord?.plan.targetUrl ?? this.currentTargetUrl,
                // The finished report, when the last run finished.
                reportRunId: this.lastReport?.runId ?? null,
                // A copy shared with other people: their check-ups and reports are visible to each other.
                beta: this.beta,
              })
            );
            return;
          }

          const route = matchRoute(allRoutes, req.method ?? 'GET', pathname);
          if (route) {
            await route.handle({
              server: this,
              ...this.planRouteContext(req, res, url),
            });
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

          // POST /api/runner/context/docx — a Word file as Markdown (stateless; open in beta)
          if (pathname === '/api/runner/context/docx' && req.method === 'POST') {
            await this.handleContextDocx(req, res);
            return;
          }

          // POST /api/runner/domain-proof — the Verified Domain line to publish, and whether it is there now
          if (pathname === '/api/runner/domain-proof' && req.method === 'POST') {
            await this.handleDomainProof(req, res);
            return;
          }

          // GET /api/report/download/<report.md|findings.json> — the run's files, byte-for-byte
          if (pathname.startsWith('/api/report/download/') && req.method === 'GET') {
            await this.handleReportDownload(pathname.replace('/api/report/download/', ''), req, res);
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
            await this.handleServeBaseline(decodeURIComponent(pathname.replace('/api/baselines/', '')), req, res);
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
          // The poll while a comparison runs: its state only, without the result.
          if (pathname.startsWith('/api/runner/benchmark/') && pathname.endsWith('/progress') && req.method === 'GET') {
            await this.handleBenchmarkProgress(
              decodeURIComponent(pathname.slice('/api/runner/benchmark/'.length).replace(/\/progress$/, '')),
              res
            );
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
            try {
              this.sendJson(res, 200, await this.scheduler.loadSchedules());
            } catch (err: unknown) {
              this.sendJson(res, 500, { error: this.redactedMessage(err) });
            }
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

          // Spec Drift Overrides API (FR-2.6, FR-9.4.1)
          if (pathname === '/api/runner/spec-override' && req.method === 'POST') {
            await this.handleRecordSpecOverride(req, res);
            return;
          }
          if (pathname === '/api/runner/spec-overrides' && req.method === 'GET') {
            await this.handleListSpecOverrides(res);
            return;
          }

          // GET /api/evidence/* — static evidence file serving, rooted at this runner's own output
          // dir. A run's files are under runs/<runId>/ (evidence, page thumbnails, its reports).
          if (pathname.startsWith('/api/evidence/') && req.method === 'GET') {
            const relPath = decodeURIComponent(pathname.replace('/api/evidence/', ''));
            if (hasDotDotSegment(relPath)) {
              res.writeHead(403, { 'Content-Type': 'text/plain' });
              res.end('Forbidden');
              return;
            }
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
              sendFileRanged(req, res, targetFile, stat, mime, { 'Cache-Control': 'private, max-age=3600' });
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
          // Headers (or a streamed body) may already be out; a second writeHead would throw.
          if (res.headersSent) {
            res.end();
            return;
          }
          const msg = this.redactedMessage(err);
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

  /**
   * A due schedule starts a read-only check-up of its address (nothing is sent or changed, no AI request
   * is spent). False when it could not start, for instance because a check-up is already running.
   */
  private async runSchedule(schedule: CheckupSchedule): Promise<boolean> {
    if (this.phase === 'scanning' || this.phase === 'testing' || this.benchmarkBusy || this.runStartDone) return false;
    let finishStart!: () => void;
    this.runStartDone = new Promise<void>((resolve) => (finishStart = resolve));
    try {
      const body: RunStartBody = {
        targetUrl: schedule.targetUrl,
        owner: false,
        useAI: false,
        planWithoutAI: true,
        skipReview: true,
        maxPages: schedule.preset === 'quick' ? 20 : undefined,
      };
      const authorization = await resolveAuthorization({
        targetUrl: body.targetUrl,
        owner: false,
        ownerExplicit: false,
        beta: false,
        hostChecks: this.hostChecks,
      });
      await this.checkupRun.start({ body, authorization });
      return true;
    } catch {
      return false;
    } finally {
      this.runStartDone = null;
      finishStart();
    }
  }

  /**
   * Shutdown on SIGTERM or SIGINT: a running check-up is stopped (its plan is kept), given up to
   * `deadlineMs` to close its browsers, then the sign-in folders are removed and the server closes.
   */
  public async shutdown(deadlineMs = 8000): Promise<void> {
    await this.checkupRun.stop().catch(() => {});
    await this.checkupRun.waitFor(deadlineMs);
    await this.session.secrets.sweepLeftovers().catch(() => {});
    await this.stop();
  }

  public async stop(): Promise<void> {
    this.scheduler.stop();
    if (this.beta) setBrowserPolicy(null);
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

  private async readJsonBody<T>(req: http.IncomingMessage, maxChars?: number): Promise<T> {
    return readJsonBody<T>(req, maxChars);
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
      // Ownership is read from the decoded path; one that climbs out of its run folder is nobody's.
      if (hasDotDotSegment(rel)) return this.refuseNotMine(res, undefined);
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
    return BETA_CLOSED_ROUTES.some((r) => r.closes(method, pathname));
  }

  /** Beta only: answers 400 and returns true when a tester asked for an address that isn't on the public internet. */
  private async refuseTarget(res: http.ServerResponse, address: string | undefined): Promise<boolean> {
    if (!this.beta || !address) return false;
    const reason = await refusedTarget(address, this.hostChecks?.lookup);
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

  /**
   * Beta only: counts this start against the visitor's and the day's limits. Answers 429 and returns true
   * when one is reached. Call it after every other check, so a refused start costs nothing. Counted: check-up
   * and comparison starts. Not counted: preflight (no browser run) and the plan routes, which continue an
   * already counted check-up (known gap: include-host / add-page can repeat within one plan; the day's cap
   * and one run at a time bound it). Keyed on the session, never the address.
   */
  private betaLimitHit(res: http.ServerResponse): boolean {
    if (!this.beta) return false;
    const hit = claimBetaRun(currentSessionId(), { limits: this.betaLimits });
    if (!hit) return false;
    this.sendJson(res, 429, {
      error: hit.error,
      code: 'ERR_BETA_LIMIT',
      suggestion: hit.suggestion,
      scope: hit.scope,
      resetsAt: hit.resetsAt,
    });
    return true;
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    sendJson(res, status, body);
  }

  private planRouteContext(req: http.IncomingMessage, res: http.ServerResponse, url: URL): PlanRouteContext {
    return {
      session: this.session,
      req,
      res,
      url,
      broadcastRunnerEvent: (event) => this.broadcastRunnerEvent(event),
      isMine: (runId) => this.isMine(runId),
      isBeta: this.beta,
      aiFor: (context) => this.aiFor(context),
      aiBudgetFor: (settings, key, cap) => this.aiBudgetFor(settings, key, cap),
      recordModelOutcomes: (models) => this.recordModelOutcomes(models),
      refuseTarget: (response, target) => this.refuseTarget(response, target),
      siteDir: () => this.siteDir(),
      testCopyOf: (typed, marked) => this.testCopyOf(typed, marked),
      onApproved: (record, specTestCases, notRun, generation) => {
        this.checkupRun.executeTesting(record, specTestCases, notRun, generation).catch((err: unknown) => {
          if (generation !== this.runGeneration || isAbortError(err)) return;
          const msg = this.redactedMessage(err);
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
      },
    };
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

  /**
   * Whether this address is a Test Copy. Local mode: by its name (and the owner's mark), as before.
   * Shared machine: marked AND public AND the Verified Domain proof passes right now (ADR 0014).
   */
  private testCopyOf(typed: URL, marked: boolean): Promise<boolean> {
    return testCopyFor({
      beta: this.beta,
      hostname: typed.hostname,
      origin: typed.origin,
      marked,
      token: () => peekProofToken(typed.origin),
      deps: this.hostChecks,
    });
  }

  /** Shared machine: a GET whose every hop is resolved, checked and connected to by address. */
  private async sharedGet(
    url: string,
    headers: Record<string, string>
  ): Promise<{ status: number; headers: Record<string, string> }> {
    const got = await safeGet(url, { headers, maxBytes: 5_000_000 }, this.hostChecks);
    if (got.ok) {
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(got.headers))
        if (v !== undefined) flat[k] = Array.isArray(v) ? v.join(', ') : v;
      return { status: got.status, headers: flat };
    }
    // A page over the size cap was still answered: only its body is not read.
    if (got.reason === 'too-large' && got.status) return { status: got.status, headers: {} };
    throw new Error(got.reason);
  }

  /**
   * POST /api/runner/context/docx { name, base64 }: one Word file turned into Markdown for the Product
   * Context, with what was read from it. Stateless: nothing is stored, logged or shared, so it stays open
   * on a shared copy. The size caps and ZIP checks live in docxToMarkdown.
   */
  private async handleContextDocx(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const refuse = (error: string): void => this.sendJson(res, 400, { error, code: 'ERR_INVALID_CONTEXT' });
    let input: { name?: unknown; base64?: unknown };
    try {
      input = await this.readJsonBody<{ name?: unknown; base64?: unknown }>(req);
    } catch {
      refuse('Send { name, base64 } with one Word file, 2 MB at most.');
      return;
    }
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || typeof input.base64 !== 'string' || !input.base64) {
      refuse('Send the file name and its content as base64.');
      return;
    }
    if (!/\.docx$/i.test(name)) {
      refuse(`${name}: only .docx files are converted here.`);
      return;
    }
    // base64 is 4 characters per 3 bytes; stop before decoding anything bigger than the raw cap.
    if (input.base64.length > Math.ceil((DOCX_MAX_BYTES * 4) / 3) + 8) {
      refuse(`${name} is larger than 2 MB. Remove images or split it into smaller files.`);
      return;
    }
    const bytes = new Uint8Array(Buffer.from(input.base64, 'base64'));
    try {
      const { text, warnings } = await docxToMarkdown(bytes);
      const summary: DocumentSummary = summarizeDocument(text);
      this.sendJson(res, 200, { text, warnings, summary });
    } catch (err) {
      refuse(this.redactedMessage(err) || `${name} could not be read.`);
    }
  }

  /**
   * POST /api/runner/domain-proof { targetUrl }: the one line to publish at /.well-known/qa-verify.txt on
   * the exact address, and whether it is there now. Shared machine only; the fetched file is never sent back.
   */
  private async handleDomainProof(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let typed: URL;
    try {
      const { targetUrl } = await this.readJsonBody<{ targetUrl?: string }>(req);
      typed = new URL(targetUrl || '');
      if (!/^https?:$/.test(typed.protocol)) throw new Error();
    } catch {
      this.sendJson(res, 400, {
        code: 'ERR_INVALID_URL',
        error: 'Please enter a valid HTTP or HTTPS address.',
      });
      return;
    }
    const origin = typed.origin;
    if (!this.beta) {
      this.sendJson(res, 200, { required: false, verified: true, origin, proofUrl: '', line: '' });
      return;
    }
    if (await this.refuseTarget(res, origin)) return;
    const url = proofUrl(origin);
    if (!url) {
      this.sendJson(res, 200, {
        required: true,
        verified: false,
        origin,
        proofUrl: '',
        line: '',
        reason: typed.protocol === 'https:' ? 'private-address' : 'not-https',
      });
      return;
    }
    let token: string;
    try {
      token = proofTokenFor(origin);
    } catch {
      this.sendJson(res, 400, { code: 'ERR_NO_SESSION', error: 'Open the QA Tool in your browser first.' });
      return;
    }
    if (!claimProofCheck(origin)) {
      this.sendJson(res, 429, {
        code: 'ERR_RATE',
        error: 'The Verified Domain line was checked a moment ago. Wait about 10 seconds and check again.',
      });
      return;
    }
    const result = await verifyDomainProof(origin, token, this.hostChecks);
    this.sendJson(res, 200, {
      required: true,
      verified: result.ok,
      origin,
      proofUrl: url,
      line: proofLine(token),
      ...(result.ok ? {} : { reason: result.reason }),
    });
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
      testCopy: await this.testCopyOf(typed, !!memory?.staging),
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

    const check = await new PreFlightChecker().checkUrlReachable(
      this.resolveTargetUrl(targetUrl),
      undefined,
      this.beta ? (url, headers) => this.sharedGet(url, headers) : undefined
    );
    if (check.ok || check.startWarning) {
      // On a shared machine a response header never makes a test copy (ADR 0014).
      if (check.testCopyHeader && !this.beta) {
        about.testCopy = true;
      }
      // A 4xx is reachable, but it is not the page the person expected: pass the warning through so the
      // wizard can say so without blocking the Check-up (LC-007).
      this.sendJson(res, 200, {
        reachable: true,
        statusCode: check.status,
        ...(check.startWarning ? { startWarning: check.startWarning } : {}),
        ...about,
      });
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
        ...(check.startWarning ? { startWarning: check.startWarning } : {}),
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
    if (host && req.method === 'GET') {
      const memory = await loadSiteMemory(this.siteDir(), host);
      if (!memory) {
        this.sendJson(res, 404, { error: 'That site isn’t remembered.' });
        return;
      }
      const needsPassword: string[] = [];
      for (const s of memory.signIns ?? []) {
        const hasPw = await this.keyResolver.readSecret(this.signInAccount(memory.host, s.role));
        if (!hasPw) needsPassword.push(s.role);
      }
      this.sendJson(res, 200, {
        host: memory.host,
        owner: memory.owner,
        markedTestCopy: memory.staging || undefined,
        searchChecks: memory.searchChecks,
        signIns: memory.signIns ?? [],
        needsPassword: needsPassword.length > 0 ? needsPassword : undefined,
        updatedAt: memory.updatedAt,
      });
      return;
    }
    if (host && req.method === 'POST') {
      let body: {
        searchChecks?: boolean | null;
        forgetSignIn?: string;
        addSignIn?: {
          role?: string;
          username?: string;
          password?: string;
          loginPath?: string;
          usernameSelector?: string;
          passwordSelector?: string;
          submitSelector?: string;
          postLoginSelector?: string;
          postLoginUrl?: string;
        };
        testSignIn?: string;
        rememberSignIns?: RoleCredential[];
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
      if (Array.isArray(body.rememberSignIns)) {
        const memory = (await loadSiteMemory(this.siteDir(), host)) ?? emptySiteMemory(host);
        const notSaved: string[] = [];
        const existingSignIns = [...(memory.signIns ?? [])];
        for (const role of body.rememberSignIns) {
          if (role.password) {
            const saved = await this.keyResolver.saveSecret(this.signInAccount(host, role.role), role.password);
            if (!saved) {
              notSaved.push(role.role);
              continue;
            }
          }
          const idx = existingSignIns.findIndex((s) => s.role === role.role);
          const entry = {
            role: role.role,
            username: role.username,
            loginPath: role.loginPath,
            usernameSelector: role.usernameSelector,
            passwordSelector: role.passwordSelector,
            submitSelector: role.submitSelector,
            postLoginSelector: role.postLoginSelector,
            postLoginUrl: role.postLoginUrl,
          };
          if (idx >= 0) {
            existingSignIns[idx] = { ...existingSignIns[idx], ...entry };
          } else {
            existingSignIns.push(entry);
          }
        }
        memory.signIns = existingSignIns;
        await saveSiteMemory(this.siteDir(), memory);
        this.sendJson(res, 200, {
          saved: true,
          signIns: memory.signIns,
          notSaved: notSaved.length > 0 ? notSaved : undefined,
        });
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
      addSignIn?: {
        role?: string;
        username?: string;
        password?: string;
        loginPath?: string;
        usernameSelector?: string;
        passwordSelector?: string;
        submitSelector?: string;
        postLoginSelector?: string;
        postLoginUrl?: string;
      };
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
        usernameSelector: body.addSignIn.usernameSelector?.trim() || undefined,
        passwordSelector: body.addSignIn.passwordSelector?.trim() || undefined,
        submitSelector: body.addSignIn.submitSelector?.trim() || undefined,
        postLoginSelector: body.addSignIn.postLoginSelector?.trim() || undefined,
        postLoginUrl: body.addSignIn.postLoginUrl?.trim() || undefined,
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
      const scheme = /^https?:\/\//i.test(host)
        ? typed.protocol
        : !this.beta && isTestHost(typed.hostname)
          ? 'http:'
          : 'https:';
      target = this.resolveTargetUrl(`${scheme}//${typed.host}`);
    } catch {
      this.sendJson(res, 400, { error: 'That isn’t a site address.' });
      return;
    }
    const browser = new BrowserManager();
    let result: { ok: boolean; landingPath?: string; reason?: SignInFailureReason };
    try {
      const context = await browser.createContext({
        baseUrl: target,
        customHeaders: this.currentCustomHeaders,
        userAgent: this.currentUserAgent,
        tunnelAuth: this.currentTunnelAuth,
        headerHosts: this.currentHeaderHosts,
      });
      result = await new PreFlightChecker().signIn(context, target, credential);
    } catch {
      result = { ok: false, reason: 'unreachable' };
    } finally {
      await browser.close();
    }

    if (!result.ok) {
      // The reason is one of four fixed ids and the words are fixed text: no typed detail can appear here.
      const reason: SignInFailureReason = result.reason ?? 'no-form';
      this.sendJson(res, body.addSignIn ? 422 : 200, {
        verified: false,
        reason,
        error: signInReasonText(reason),
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
      const existing = [...(memory.signIns ?? [])];
      const idx = existing.findIndex((s) => s.role === credential.role);
      const entry = {
        role: credential.role,
        username: credential.username,
        loginPath: credential.loginPath,
        usernameSelector: credential.usernameSelector,
        passwordSelector: credential.passwordSelector,
        submitSelector: credential.submitSelector,
        postLoginSelector: credential.postLoginSelector,
        postLoginUrl: credential.postLoginUrl,
      };
      if (idx >= 0) {
        existing[idx] = { ...existing[idx], ...entry };
      } else {
        existing.push(entry);
      }
      memory.signIns = existing;
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
    body: RunStartBody,
    memory: SiteMemory | null,
    host: string
  ): Promise<{ roles?: RoleCredential[]; memory: SiteMemory | null; note?: string }> {
    if (body.roles?.length) {
      if (!body.rememberSignIns) return { roles: body.roles, memory };
      const currentSignIns = [...(memory?.signIns ?? [])];
      const notSaved: string[] = [];
      for (const role of body.roles) {
        if (role.password && !(await this.keyResolver.saveSecret(this.signInAccount(host, role.role), role.password))) {
          notSaved.push(role.role);
          continue;
        }
        const idx = currentSignIns.findIndex((s) => s.role === role.role);
        const entry = {
          role: role.role,
          username: role.username,
          loginPath: role.loginPath,
          usernameSelector: role.usernameSelector,
          passwordSelector: role.passwordSelector,
          submitSelector: role.submitSelector,
          postLoginSelector: role.postLoginSelector,
          postLoginUrl: role.postLoginUrl,
        };
        if (idx >= 0) {
          currentSignIns[idx] = { ...currentSignIns[idx], ...entry };
        } else {
          currentSignIns.push(entry);
        }
      }
      const next = { ...(memory ?? emptySiteMemory(host)), signIns: currentSignIns };
      return {
        roles: body.roles,
        memory: next,
        note:
          notSaved.length > 0
            ? 'This computer has no keychain to keep passwords in, so the sign-ins weren’t remembered.'
            : undefined,
      };
    }
    if (!body.useSavedSignIns || !memory?.signIns?.length) return { memory };
    const roles: RoleCredential[] = [];
    const needsPassword: string[] = [];
    for (const s of memory.signIns) {
      const password = await this.keyResolver.readSecret(this.signInAccount(host, s.role));
      if (password) {
        roles.push({
          role: s.role,
          username: s.username,
          password,
          loginPath: s.loginPath,
          usernameSelector: s.usernameSelector,
          passwordSelector: s.passwordSelector,
          submitSelector: s.submitSelector,
          postLoginSelector: s.postLoginSelector,
          postLoginUrl: s.postLoginUrl,
        });
      } else {
        needsPassword.push(s.role);
      }
    }
    return {
      roles: roles.length > 0 ? roles : undefined,
      memory,
      note: needsPassword.length > 0 ? `Saved passwords were not found for: ${needsPassword.join(', ')}` : undefined,
    };
  }

  /**
   * { targetUrl, maxPages } → about how many AI requests the scan needs (planning, repairs, and the
   * visual review after the run), and how many the key has left today, before anything starts.
   */
  private async handleAiEstimate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: { targetUrl?: string; maxPages?: number; aiCap?: unknown } = {};
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
    // Pacing and price come from what the provider reports; dollars only when the model has a price.
    const cap = checkAiCap(body.aiCap);
    const capValue = cap.ok ? cap.value : undefined;
    const budget =
      setup.provider === 'openrouter' && setup.key
        ? await this.aiBudgetFor({ provider: setup.provider, model: setup.text }, setup.key, capValue).catch(() => null)
        : null;
    const price =
      budget?.pacing.price ??
      (setup.provider === 'openrouter' && setup.key && setup.text
        ? await this.openRouter.modelPrice(setup.text).catch(() => null)
        : null);
    const requests = estimate.high + estimate.visualReview;
    this.sendJson(res, 200, {
      ...estimate,
      seenBefore: !!memory,
      provider: setup.provider,
      free: setup.provider === 'openrouter',
      left: today?.remaining ?? null,
      limit: today?.limit ?? null,
      concurrency: budget?.pacing.concurrency ?? 1,
      cap: capValue ?? null,
      // Dollars are shown only when the model has a price above zero: a free key shows requests only.
      price: price && (price.prompt > 0 || price.completion > 0) ? price : null,
      estimatedUsd:
        price && (price.prompt > 0 || price.completion > 0) && typeof requests === 'number'
          ? estimateUsd(requests, price)
          : null,
    });
  }

  /** The folder that holds one run's files: its scan, evidence and reports. */
  private runDir(runId: string): string {
    return this.session.report.dirFor(runId);
  }

  /** A path inside a run's folder, as the Wizard addresses it: /api/evidence/runs/<runId>/<path>. */
  private relativeToRun(runId: string, file?: string): string | undefined {
    return this.session.report.relativePath(runId, file);
  }

  /** Every finished check-up, newest first. A folder without a summary is a run that never finished. */
  private async listRuns(): Promise<RunSummary[]> {
    return this.session.report.list();
  }

  /**
   * Keeps a finished run: its full report and a short summary beside the files the run wrote. The
   * newest findings also stay at the top of the report folder, where the next run's delta reads them.
   * Then only the newest RUNS_KEPT_PER_SITE runs of the site are kept.
   */
  private async keepRun(report: ReleaseReport, typedTargetUrl: string, siteHost: string | undefined): Promise<void> {
    return this.session.report.keep(report, typedTargetUrl, siteHost);
  }

  /** Deletes a site's runs past the newest RUNS_KEPT_PER_SITE, and folders of runs that never finished. */
  private async pruneRuns(host: string): Promise<void> {
    return this.session.report.prune(host);
  }

  /**
   * Beta: keeps a visitor's newest RUNS_KEPT_PER_VISITOR finished runs and deletes the rest, oldest first.
   * A run that is running, or waiting for review, is never deleted.
   */
  private async pruneVisitorRuns(owner: string | undefined): Promise<void> {
    if (!this.beta || !owner) return;
    const protectedIds = new Set([this.currentRunId, this.session.plan.currentRecord?.plan.runId]);
    const mine = (await this.listRuns()).filter((r) => this.runOwners.get(r.runId) === owner);
    for (const run of mine.slice(RUNS_KEPT_PER_VISITOR)) {
      if (protectedIds.has(run.runId)) continue;
      await fs.rm(this.runDir(run.runId), { recursive: true, force: true }).catch(() => {});
      this.runOwners.delete(run.runId);
    }
  }

  /** The newest finished run's report, so a restart still has it. */
  private async loadLatestReport(): Promise<void> {
    return this.session.report.loadLatest();
  }

  /** A run's report: the one just finished is in memory (its file may not be written yet), older ones on disk. */
  private async readRunReport(runId: string): Promise<ReleaseReport | null> {
    return this.session.report.read(runId);
  }

  private async handleRuns(rest: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if ((rest === '' || rest === '/') && req.method === 'GET') {
      if (this.beta) await this.pruneVisitorRuns(currentSessionId());
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

    // POST accept-judgement { titles, accept? }: the person has judged these "Needs your judgement"
    // items and counts them as problems (accept: false puts them back). The verdict, grades and
    // recommendations follow from the findings; the issues files are written again.
    if (action === 'accept-judgement' && req.method === 'POST') {
      let body: { titles?: string[]; accept?: boolean };
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
          error: report ? 'Say which item.' : 'That check-up’s report isn’t there any more.',
        });
        return;
      }
      const accept = body.accept !== false;
      for (const f of report.findings) {
        if (!f.needsJudgement || !titles.includes(f.title)) continue;
        f.judgementAccepted = accept || undefined;
        f.needsConfirmation = accept ? undefined : true;
      }
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
        const target = path.join(this.runDir(runId), file);
        const stat = await fs.stat(target);
        let host = 'site';
        try {
          host =
            new URL((await this.readRunReport(runId))?.targetUrl || '').host.replace(/[^a-z0-9.-]/gi, '_') || 'site';
        } catch {
          // keep "site"
        }
        const [base, ext] = file.split('.');
        sendFileRanged(req, res, target, stat, contentType, {
          'Content-Disposition': `attachment; filename="${base}-${host}-${runId}.${ext}"`,
        });
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
        console.warn(`[Release check-up] Couldn’t move ${name} into the data folder:`, this.redactedMessage(err));
      }
    }
  }

  private async handleReportDownload(
    fileName: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
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
      const target = (await exists(own)) ? own : path.join(this.outputDir, fileName);
      sendFileRanged(req, res, target, await fs.stat(target), contentType, {
        'Content-Disposition': `attachment; filename="${fileName}"`,
      });
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

  private screensForReview(report: ReleaseReport, draft?: DiscoveryDraft): VisualReviewItemInput[] {
    return screensForReview(report, draft, this.runDir(report.runId));
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
    // The issues files follow the report (an accepted judgement item now counts).
    try {
      const model = buildIssuesModel(report);
      await fs.writeFile(path.join(dir, 'issues.md'), renderIssuesMarkdown(model), 'utf8');
      await fs.writeFile(path.join(dir, 'issues.html'), await renderIssuesHtml(model, dir), 'utf8');
    } catch {
      // the report's own files are what matter
    }
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report), 'utf8').catch(() => {});
    const summaryFile = path.join(dir, 'summary.json');
    const summary = JSON.parse(await fs.readFile(summaryFile, 'utf8').catch(() => 'null')) as RunSummary | null;
    if (!summary) return;
    const verdict = releaseVerdict(report.findings, undefined, report.grades, report.coverage);
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
    await this.pruneVisitorRuns(this.runOwners.get(report.runId));
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
      // Beta: the model choice file is shared by every tester, so only the tester's own key is kept.
      if (!this.beta) {
        await this.writeAiModels({
          provider,
          text: body.model !== undefined ? body.model : sameProvider ? current.text : null,
          vision: body.visionModel !== undefined ? body.visionModel : sameProvider ? current.vision : null,
          chosenBy: chosen ? 'person' : sameProvider ? current.chosenBy : undefined,
        });
      }
      // Without a chosen model, OpenRouter's free models are picked automatically.
      const key = await this.storedKey(provider);
      if (!this.beta && provider === 'openrouter' && key && !chosen) {
        await this.refreshAiModels(key).catch(() => null);
      }
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
        const message = this.redactedMessage(err);
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
            this.sendJson(res, 401, { error: this.redactedMessage(err) });
          } else {
            this.sendJson(res, 200, {
              models: [],
              authError: true,
              error: this.redactedMessage(err),
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

  /** Set synchronously when a start begins and cleared when it has claimed the slot or failed. */
  private runStartDone: Promise<void> | null = null;

  private async handleTriggerRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (
      this.phase === 'scanning' ||
      this.phase === 'testing' ||
      this.benchmarkBusy ||
      this.runStartDone // a second start while the first is still starting
    ) {
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
    // No await between the check above and this line, so two requests never both pass it.
    let finishStart!: () => void;
    this.runStartDone = new Promise<void>((resolve) => (finishStart = resolve));
    try {
      await this.startRunFromRequest(req, res);
    } finally {
      this.runStartDone = null;
      finishStart();
    }
  }

  private async startRunFromRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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

    let body: RunStartBody;
    try {
      body = await this.readJsonBody<RunStartBody>(req);
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
    // Outside beta refuseTarget lets everything through, so the scheme is checked here for every copy.
    if (
      /^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(body.targetUrl.trim()) &&
      !/^https?:\/\//i.test(body.targetUrl.trim())
    ) {
      this.sendJson(res, 400, {
        error: 'Only http and https addresses can be checked.',
        code: 'ERR_INVALID_REQUEST',
        suggestion: 'Type an address that starts with http:// or https://.',
      });
      return;
    }

    // Smoke Check-up: a few read-only GETs, no browser, no plan. Runs here and answers with the report.
    if (body.preset === 'smoke') {
      try {
        const result = await runPostDeploySmoke({
          targetUrl: body.targetUrl,
          healthPath: body.healthPath,
          expectedVersion: body.expectedVersion,
          confirmLive: body.stagingHost === true,
          beta: this.beta,
        });
        if (result.refused) {
          this.sendJson(res, 400, { error: result.refused, code: 'ERR_SMOKE_REFUSED' });
          return;
        }
        const report = smokeReport(result, body.targetUrl);
        // No API description is given on this route, so the API section says so and nothing is sent.
        const api = await runApiChecks(generateApiChecks(undefined), { baseUrl: body.targetUrl });
        report.findings.push(...api.findings);
        report.notes = [...(report.notes ?? []), ...apiChecksSection(api)];
        await fs.mkdir(this.outputDir, { recursive: true });
        await new ReportGenerator(this.outputDir).generate(report);
        const verdict = releaseVerdict(report.findings, undefined, report.grades, report.coverage);
        this.sendJson(res, 200, { preset: 'smoke', report, verdict });
      } catch (err: unknown) {
        this.sendJson(res, 500, { error: this.redactedMessage(err) });
      }
      return;
    }

    // The new Source inputs are checked before anything starts. Messages never repeat what was sent.
    let typedHostname = '';
    try {
      typedHostname = new URL(body.targetUrl).hostname;
    } catch {
      // refuseTarget has already judged the address
    }
    for (const checked of [
      checkContextDocuments(body.contextDocuments),
      checkContextUrl(body.contextUrl),
      checkSavedSessions(body.savedSessions, typedHostname),
      checkAiCap(body.aiCap),
      checkCustomHeaders(body.customHeaders),
    ]) {
      if (!checked.ok) {
        this.sendJson(res, 400, { error: checked.problem.error, code: checked.problem.code });
        return;
      }
    }
    if (body.roles) {
      const checkedRoles = checkRoles(body.roles);
      if (!checkedRoles.ok) {
        this.sendJson(res, 400, { error: checkedRoles.problem.error, code: checkedRoles.problem.code });
        return;
      }
      for (const role of body.roles) {
        if (role.loginPath) {
          const checkedLogin = checkLoginPath(role.loginPath, body.targetUrl);
          if (!checkedLogin.ok) {
            this.sendJson(res, 400, { error: checkedLogin.problem.error, code: checkedLogin.problem.code });
            return;
          }
        }
      }
    }
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
    const waiting = this.phase === 'awaiting-review' ? this.session.plan.currentRecord : null;
    // Beta: a plan another visitor left waiting is kept aside for them, whatever the site, and is never named here.
    const othersPlan = this.beta && !!waiting && !this.isMine(waiting.plan.runId);
    // Beta: another visitor's waiting plan is never moved aside by this start; the start waits instead.
    if (othersPlan) {
      this.sendJson(res, 409, {
        error: 'Someone else is running a check-up on this shared copy. Try again in a few minutes.',
        code: 'ERR_RUN_IN_PROGRESS',
        suggestion: 'Only one check-up runs at a time here. Try again in a few minutes.',
      });
      return;
    }
    const parkWaiting = !!waiting && this.hostOfPlan(waiting) !== hostOfAddress(body.targetUrl);
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

    if (this.betaLimitHit(res)) return;

    let typed: URL;
    try {
      typed = new URL(body.targetUrl);
    } catch {
      typed = new URL(`http://${body.targetUrl}`);
    }
    const siteHost = typed.host;
    const memory = await loadSiteMemory(this.siteDir(), siteHost);
    const marked = body.stagingHost !== undefined ? !!body.stagingHost : !!memory?.staging;
    const signIns = await this.signInsFor(body, memory, siteHost);
    const authorization = await resolveAuthorization({
      targetUrl: body.targetUrl,
      owner: body.owner,
      ownerExplicit: body.owner === true,
      signInConsent: body.signInConsent,
      roles: signIns.roles,
      testCopyMarked: marked,
      stagingHost: body.stagingHost,
      beta: this.beta,
      hostChecks: this.hostChecks,
      token: () => peekProofToken(typed.origin),
    });

    try {
      const { runId } = await this.checkupRun.start({ body, authorization });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ runId }));
    } catch (err: any) {
      if (err?.code === 'ERR_PLAN_WAITING') {
        this.sendJson(res, 409, {
          error: err.message,
          code: err.code,
          suggestion: err.suggestion,
          targetUrl: err.targetUrl,
        });
        return;
      }
      if (err?.code === 'ERR_RUN_IN_PROGRESS') {
        this.sendJson(res, 409, { error: err.message, code: err.code });
        return;
      }
      this.sendJson(res, 500, { error: this.redactedMessage(err) });
    }
  }

  private async handleAbortRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody<{ finish?: boolean; discard?: boolean }>(req).catch(
      () => ({}) as { finish?: boolean; discard?: boolean }
    );
    // A stop that arrives while a start is still under way waits for the start, then stops that run.
    if (this.runStartDone) await this.runStartDone;
    const result = await this.checkupRun.stop(body);
    if (result.finishing) {
      this.sendJson(res, 200, { aborted: false, finishing: true });
      return;
    }
    if (!result.aborted) {
      this.sendJson(res, 200, { aborted: false, message: 'No run currently active' });
      return;
    }
    this.sendJson(res, 200, {
      aborted: true,
      planKept: result.planKept,
      code: 'ERR_RUN_ABORTED',
      message: 'Run aborted successfully',
    });
  }

  /**
   * The text model for a run. Without a key or a free model there's no run: the plan is written by
   * the AI (ADR 0009). `key` is the key used, for reading its AI Request Budget; it isn't saved.
   */
  private async prepareAI(body: RunStartBody): Promise<{
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
      const chosen = await this.refreshAiModels(apiKey!).catch(async (err: unknown) => {
        // A rejected key is not a reason to carry on with older model names: say so.
        if (err instanceof OpenRouterAuthError) {
          throw Object.assign(new Error('The key was not recognised. Check it in Settings, then start again.'), {
            code: 'ERR_NO_AI_KEY',
          });
        }
        return { ...(await this.readAiModels()), fallbacks: [] as string[] };
      });
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
    key?: string,
    cap?: RunCap
  ): Promise<{
    left?: number;
    limit?: number;
    visualReview: number;
    /** How to pace the AI: from what the provider reports, with the person's cap and the model's price. */
    pacing: { gapMs: number; concurrency: number; cap?: RunCap; price?: { prompt: number; completion: number } };
    limits: ProviderLimits | null;
  }> {
    const openrouter = settings?.provider === 'openrouter';
    const apiKey = openrouter ? (key ?? (await this.storedOpenRouterKey())) : undefined;
    const today = openrouter ? await this.openRouter.freeRequestsToday(apiKey) : null;
    let limits: ProviderLimits | null = null;
    let price: { prompt: number; completion: number } | null = null;
    if (openrouter) {
      try {
        limits = await this.openRouter.keyLimits(apiKey);
        // The price matters only for a dollar cap.
        if (cap?.dollars !== undefined && settings?.model) price = await this.openRouter.modelPrice(settings.model);
      } catch {
        // nothing reported: today's pacing
      }
    }
    const reported: ProviderLimits | null =
      limits || today ? { ...(limits ?? {}), remainingRequests: limits?.remainingRequests ?? today?.remaining } : null;
    const { gapMs, concurrency } = pacingFor(reported, settings?.provider ?? 'openrouter');
    return {
      left: today?.remaining,
      limit: today?.limit,
      visualReview: VISUAL_REVIEW_CALLS,
      pacing: { gapMs, concurrency, cap, price: price ?? undefined },
      limits: reported,
    };
  }

  /** The text model again, for turning a sentence into a test during the review. */
  private async aiFor(context: StoredPlanRecord['context']): Promise<AIProvider | undefined> {
    const settings = context.ai;
    if (!settings) return undefined;
    const apiKey = settings.apiKey || (await this.storedKey(settings.provider));
    if (!apiKey) return undefined;
    return this.makeAIProvider(settings.provider, apiKey, settings.model);
  }

  private async ensurePlanLoaded(): Promise<StoredPlanRecord | null> {
    const record = await this.session.plan.current();
    if (record && this.phase === 'idle') {
      this.session.run.begin(record.plan.runId, record.plan.targetUrl);
      this.session.run.setPhase('awaiting-review');
    }
    return record;
  }

  /** The site a plan is for, as typed ("localhost:3050"). */
  private hostOfPlan(record: StoredPlanRecord): string {
    return this.session.plan.hostOf(record);
  }

  private parkedFile(host: string): string {
    return this.session.plan.parkedFileFor(host);
  }

  /** Keeps a waiting plan aside while another site is checked: in memory (with its sign-ins) and on disk (without). */
  private async parkPlan(record: StoredPlanRecord): Promise<void> {
    return this.session.plan.park(record);
  }

  /** Takes a site's kept-aside plan back out, or null when there's none. */
  private async unparkPlan(host: string): Promise<StoredPlanRecord | null> {
    return this.session.plan.unpark(host);
  }

  /** Every plan kept aside, for the new check-up screen. */
  private async listParkedPlans(): Promise<
    Array<{ host: string; targetUrl: string; runId: string; discoveredAt: string; pages: number }>
  > {
    const waiting = await this.session.plan.waiting();
    return waiting.map(({ host, record }) => ({
      host,
      targetUrl: record.plan.targetUrl,
      runId: record.plan.runId,
      discoveredAt: record.plan.discoveredAt,
      pages: record.plan.planPages?.length ?? record.plan.pages.length,
    }));
  }

  private async savePlan(record: StoredPlanRecord): Promise<void> {
    return this.session.plan.save(record);
  }

  /**
   * The plan as written to disk. Sign-in details stay in memory only; after a
   * restart the approval has to send them again.
   */
  private planForDisk(record: StoredPlanRecord): StoredPlanRecord {
    return this.session.plan.forDisk(record);
  }

  /**
   * The Plan waiting for review, for a status poll. With none in memory, the Plan file is checked at most once every
   * STATUS_NO_PLAN_MS: the runner sets the Plan in memory when it writes one, so the next poll sees it at once.
   */
  private async waitingPlanForStatus(): Promise<StoredPlanRecord | null> {
    if (this.session.plan.currentRecord) return this.session.plan.current();
    if (this.noPlanCheckedAt !== null && Date.now() - this.noPlanCheckedAt < STATUS_NO_PLAN_MS) return null;
    const waiting = await this.session.plan.current();
    this.noPlanCheckedAt = waiting ? null : Date.now();
    return waiting;
  }

  /** Forgets the paused plan; with a runId, only while it is still that run's plan (a newer run may have replaced it). */
  private async clearPlan(runId?: string): Promise<void> {
    return this.session.plan.clear(runId);
  }

  private async handleServeBaseline(
    fileName: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const target = path.resolve(this.baselineDir, fileName);
    if (!isInside(this.baselineDir, target)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    try {
      sendFileRanged(req, res, target, await fs.stat(target), 'image/png', {
        'Cache-Control': 'private, max-age=3600',
      });
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
      this.sendJson(res, 500, { error: this.redactedMessage(err) });
    }
  }

  private async handleAcceptBaseline(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody<{ id: string; currentEvidencePath?: string }>(req).catch(() => null);
    if (!body || typeof body.id !== 'string' || !body.id) {
      this.sendJson(res, 400, { error: 'Missing baseline id' });
      return;
    }
    if (!/^[\w-]+$/.test(body.id)) {
      this.sendJson(res, 400, { error: 'That baseline id is not allowed.' });
      return;
    }
    try {
      await fs.mkdir(this.baselineDir, { recursive: true });
      const dest = path.join(this.baselineDir, `${body.id}.png`);
      if (!isInside(this.baselineDir, dest)) {
        this.sendJson(res, 403, { error: 'Forbidden' });
        return;
      }
      if (body.currentEvidencePath) {
        const src = path.resolve(this.outputDir, String(body.currentEvidencePath));
        if (isInside(this.outputDir, src) && !isSavedSession(this.outputDir, src)) {
          await fs.copyFile(src, dest);
        }
      }
      this.sendJson(res, 200, { ok: true, id: body.id });
    } catch (err: unknown) {
      this.sendJson(res, 500, { error: this.redactedMessage(err) });
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
    if (this.betaLimitHit(res)) return;

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
        job.error = `The comparison couldn’t finish: ${this.redactedMessage(err)}`;
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
      // Beta: another visitor's live comparison is not there for this one, so nothing is removed.
      // A finished one is kept in the starter's own session folder, so the store lookup below misses it too.
      if (this.beta && live && !mine) {
        this.sendJson(res, 404, { error: 'That comparison isn’t here any more.', code: 'ERR_NOT_FOUND' });
        return;
      }
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

  /** The state a comparison's poll needs: no result, so the answer stays small while it runs. */
  private async handleBenchmarkProgress(id: string, res: http.ServerResponse): Promise<void> {
    const live = this.benchmarkJobs.get(id);
    const mine = live && (!this.beta || live.owner === currentSessionId());
    const job = mine ? live.job : await this.benchmarkStore().get(id);
    if (!job) {
      this.sendJson(res, 404, { error: 'That comparison isn’t here any more.', code: 'ERR_NOT_FOUND' });
      return;
    }
    this.sendJson(res, 200, {
      id: job.id,
      status: job.status,
      stage: job.stage,
      aiUsed: job.aiUsed,
      error: job.error,
    });
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
      this.sendJson(res, 500, { error: this.redactedMessage(err) });
    }
  }

  private async handleRecordSpecOverride(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody<{
      requirementId: string;
      runId?: string;
      reason?: string;
      status?: 'retired' | 'updated' | 'postponed';
      newSelector?: string;
      newUrlPath?: string;
    }>(req).catch(() => null);

    if (!body || !body.requirementId) {
      this.sendJson(res, 400, { error: 'requirementId is required' });
      return;
    }

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const filePath = path.join(this.dataDir, 'spec-overrides.json');
      let records: Array<{
        id: string;
        requirementId: string;
        runId?: string;
        reason?: string;
        status?: 'retired' | 'updated' | 'postponed';
        newSelector?: string;
        newUrlPath?: string;
        timestamp: string;
      }> = [];

      try {
        const raw = await fs.readFile(filePath, 'utf8');
        records = JSON.parse(raw);
        if (!Array.isArray(records)) records = [];
      } catch {
        records = [];
      }

      const newRecord = {
        id: `spec-override-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        requirementId: body.requirementId,
        runId: body.runId,
        reason: body.reason || 'Spec updated/changed in product',
        status: body.status || 'updated',
        newSelector: body.newSelector,
        newUrlPath: body.newUrlPath,
        timestamp: new Date().toISOString(),
      };

      const existingIdx = records.findIndex((r) => r.requirementId === body.requirementId);
      if (existingIdx >= 0) {
        records[existingIdx] = newRecord;
      } else {
        records.push(newRecord);
      }

      await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf8');
      this.sendJson(res, 200, { ok: true, override: newRecord });
    } catch (err: unknown) {
      this.sendJson(res, 500, { error: this.redactedMessage(err) });
    }
  }

  private async handleListSpecOverrides(res: http.ServerResponse): Promise<void> {
    try {
      const filePath = path.join(this.dataDir, 'spec-overrides.json');
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const records = JSON.parse(raw);
        this.sendJson(res, 200, Array.isArray(records) ? records : []);
      } catch {
        this.sendJson(res, 200, []);
      }
    } catch (err: unknown) {
      this.sendJson(res, 500, { error: this.redactedMessage(err) });
    }
  }
}
