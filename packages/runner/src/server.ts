import http from 'http';
import https from 'https';
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
} from '@qa/types';
import {
  FlowTestOrchestrator,
  DiscoveryAgent,
  TestPlanner,
  buildPageSweep,
  createAIProvider,
  pushRunToHub,
  runSafeWebsiteScan,
  KeyResolver,
  OpenRouterClient,
  OpenRouterAuthError,
  pickRecommendedModel,
  pickVisionModel,
  keepOrPickModels,
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
  withPortablePaths,
  type ReplanOptions,
  type VisualReviewItemInput,
  type MemorySummary,
  type SiteMemory,
  type RunOptions,
  type AIProvider,
  type OrchestratorEvent,
} from '@qa/core';

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Saved sign-in sessions (auth/<role>.json) hold live session cookies: no folder called "auth" is
 * served, at any depth. Any case: Windows and macOS read "AUTH" as "auth".
 */
function isSavedSession(dir: string, file: string): boolean {
  return path.relative(dir, file).split(path.sep).some((part) => part.toLowerCase() === 'auth');
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

/** Check-ups kept per site; older ones are deleted after each run. Their grade history is kept. */
const RUNS_KEPT_PER_SITE = 10;

/** "30 September 2026", for sentences in the report. */
function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
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

/** Headers that describe one connection, not the message: never passed on to or from the Hub. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);

const MAX_RUN_EVENTS = 5000;
/** AI requests the visual review of a finished run may use: part of the AI Request Budget estimate. */
const VISUAL_REVIEW_CALLS = 20;
/** Pages explored on another host the person includes from the review. */
const INCLUDED_HOST_PAGES = 30;
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
  /** The Report Hub that /api/v1/* is passed on to. Without one, /api/v1/* answers "Hub not connected". */
  hubUrl?: string;
}

export interface TriggerRunBody {
  targetUrl: string;
  productId?: string;
  useAI?: boolean;
  aiProvider?: AIProviderType;
  apiKey?: string;
  aiModel?: string;
  hubUrl?: string;
  hubToken?: string;
  releaseTarget?: string;
  breakpoints?: string[];
  headless?: boolean;
  /** Login credentials per role, used for pre-flight auth against the target site. */
  roles?: RoleCredential[];
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
    hubUrl?: string;
    hubToken?: string;
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
    /** Design tokens / design notes. */
    designNotes?: string;
    /** Path to product context file on disk if written. */
    contextFilePath?: string;
  };
}

/** Why a run is read-only, in plain words. */
function readOnlyReason(owner: boolean, testHost: boolean): string {
  if (!owner) {
    return 'You didn’t say you own this site, so it’s only looked at: nothing is sent or changed. If you do, start a new check-up and tick “I own this site”.';
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
 * DiscoveryAgent on behalf of the interactive web dashboard. It is intentionally kept
 * separate from the Hub (a passive, durable, cross-run aggregator) and from
 * @qa/dashboard (a read-only reviewer of one finished CLI run) — this is the live,
 * single-flight execution engine for UI-triggered runs.
 */
export class RunnerServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private outputDir: string;
  private dataDir: string;
  private planFile: string;
  private streamClients = new Set<http.ServerResponse>();

  private localhostAlias?: string;
  private hostAliases: Record<string, string>;
  private keyResolver: KeyResolver;
  private openRouter: OpenRouterClient;
  private makeAIProvider: (provider: AIProviderType, apiKey: string, model?: string) => AIProvider;
  private uiApps: UiApp[];
  private hubUrl?: string;

  private isRunning = false;
  private phase: RunnerPhase = 'idle';
  private lastReport: ReleaseReport | null = null;
  private lastRunError: string | null = null;
  private lastErrorCode: string | null = null;
  private activeAbortController: AbortController | null = null;
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

  constructor(options: RunnerServerOptions = {}) {
    this.port = options.port || 3001;
    this.host = options.host || 'localhost';
    this.outputDir = path.resolve(options.outputDir || path.join(process.cwd(), '.qa-runner-report'));
    this.localhostAlias = options.localhostAlias;
    this.hostAliases = Object.fromEntries(Object.entries(options.hostAliases || {}).map(([k, v]) => [k.toLowerCase(), v]));
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), '.qa-data'));
    if (!options.dataDir) this.legacyDataDir = process.cwd();
    this.authDir = path.join(this.outputDir, 'auth');
    this.planFile = path.join(this.dataDir, '.qa-plan.json');
    this.aiModelsFile = path.join(this.dataDir, '.qa-ai-models.json');
    this.keyResolver = options.keyResolver || new KeyResolver(this.dataDir);
    this.openRouter = options.openRouter || new OpenRouterClient();
    this.makeAIProvider =
      options.createAIProvider || ((provider, apiKey, model) => createAIProvider(provider, apiKey, undefined, model));
    this.uiApps = options.ui || [];
    this.hubUrl = options.hubUrl?.replace(/\/+$/, '') || undefined;
  }


  public broadcastRunnerEvent(event: OrchestratorEvent | Record<string, unknown>): void {
    this.recordRunEvent(event as Record<string, unknown>);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.streamClients) {
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
    if (!this.currentRunId || event.type === 'HUB_PUSH_RESULT') return;
    if (typeof event.runId === 'string' && event.runId !== this.currentRunId) return;
    this.runEvents.push(event.type === 'RUN_COMPLETED' ? { type: event.type, runId: event.runId } : event);
    if (this.runEvents.length > MAX_RUN_EVENTS) {
      const half = this.runEvents.length / 2;
      this.runEvents = this.runEvents.filter((e, i) => i >= half || (e.type !== 'STEP_STARTED' && e.type !== 'STEP_COMPLETED'));
    }
  }

  /** Stores the report before announcing completion, so a client reacting to RUN_COMPLETED gets this run's report. */
  private forwardRunEvent(event: OrchestratorEvent): void {
    if (event.type === 'RUN_COMPLETED') this.lastReport = this.portable(event.report);
    this.broadcastRunnerEvent(event);
  }

  /**
   * The report as it's kept and served: paths inside the run's folder are relative to it
   * (evidence/TC-1-1440px/step-1.png), which is how the Wizard addresses them
   * (/api/evidence/runs/<runId>/<path>), and no full path of this computer is handed out.
   */
  private portable(report: ReleaseReport): ReleaseReport {
    return withPortablePaths(report, this.runDir(report.runId));
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

          // Only this computer's own names are answered, so a page can't point a name it controls at
          // this port (DNS rebinding) and read reports and evidence as if it were this computer.
          if (!isLoopbackHost(req.headers.host)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Release check-up only answers on this computer. Open http://localhost:${this.port}/ instead.`);
            return;
          }

          // Only localhost pages may drive the runner; a wildcard would let any website trigger runs.
          const origin = req.headers.origin;
          if (origin && isLoopbackOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

          // /api/v1/* belongs to the Report Hub, a separate service: passed on when one is set up. So
          // does /hub, the Hub's own dashboard, whose buttons call /api/v1/* on this same address.
          if (pathname === '/api/v1' || pathname.startsWith('/api/v1/') || pathname === '/hub' || pathname.startsWith('/hub/')) {
            this.forwardToHub(req, res, url);
            return;
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
            });
            res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
            // A page that opens or reconnects mid-run catches up: this run's events so far, in order.
            for (const event of this.runEvents) res.write(`data: ${JSON.stringify({ ...event, replayed: true })}\n\n`);
            this.streamClients.add(res);
            req.on('close', () => {
              this.streamClients.delete(res);
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
                hubConnected: !!this.hubUrl,
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
          // POST /api/runner/plan/include-host — explore another host the site links to, and plan its pages
          if (pathname === '/api/runner/plan/include-host' && req.method === 'POST') {
            await this.handleIncludeHost(req, res);
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

          if (pathname.startsWith('/api/ai/openrouter/')) {
            await this.handleOpenRouter(pathname.replace('/api/ai/openrouter/', ''), req, res);
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
            const realRoot = realTarget ? await fs.realpath(this.outputDir).catch(() => this.outputDir) : this.outputDir;
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

  /** Passes a Report Hub request on unchanged and streams the Hub's answer back. */
  private forwardToHub(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    if (!this.hubUrl) {
      this.sendJson(res, 503, { error: 'Hub not connected', hubConnected: false });
      return;
    }
    const target = new URL(url.pathname + url.search, this.hubUrl);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
    const hubRequest = (target.protocol === 'https:' ? https : http).request(
      target,
      { method: req.method, headers: { ...headers, host: target.host } },
      (hubRes) => {
        const answer = Object.fromEntries(Object.entries(hubRes.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
        res.writeHead(hubRes.statusCode || 502, answer);
        hubRes.pipe(res);
      }
    );
    hubRequest.on('error', () => {
      if (res.headersSent) res.end();
      else this.sendJson(res, 502, { error: 'The Report Hub isn’t responding.', hubConnected: false });
    });
    req.pipe(hubRequest);
  }

  /** True when the address is this server, as the request reached it. */
  private isThisServer(address: string, req: http.IncomingMessage): boolean {
    try {
      return new URL(address).host === req.headers.host;
    } catch {
      return false;
    }
  }

  private async readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    return JSON.parse(body) as T;
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

    // Said before the scan: whether this address can be tested fully (a Test Copy), and what was
    // chosen for the site last time, so the screen can start from it.
    const typed = new URL(targetUrl);
    const memory = await loadSiteMemory(this.dataDir, typed.host).catch(() => null);
    const about = {
      host: typed.host,
      testCopy: isTestHost(typed.hostname, memory?.staging ? [typed.hostname] : []),
      remembered: memory ? { owner: memory.owner, markedTestCopy: memory.staging || undefined } : undefined,
    };

    const check = await new PreFlightChecker().checkUrlReachable(this.resolveTargetUrl(targetUrl));
    if (check.ok) {
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
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(this.portable(report)), 'utf8');
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
      if (!isRunId(name) || finished.has(name) || name === this.currentRunId) continue;
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
      this.sendJson(res, 200, { runs: await this.listRuns() });
      return;
    }
    const [, runId, action, file] = rest.split('/');
    if (!runId || !isRunId(runId)) {
      this.sendJson(res, 404, { error: 'No such check-up' });
      return;
    }

    if (!action && req.method === 'GET') {
      const report = await this.readRunReport(runId);
      if (!report) this.sendJson(res, 404, { error: 'That check-up’s report isn’t there any more.' });
      else this.sendJson(res, 200, report);
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
          host = new URL((await this.readRunReport(runId))?.targetUrl || '').host.replace(/[^a-z0-9.-]/gi, '_') || 'site';
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
      if (runId === this.currentRunId && (this.phase === 'scanning' || this.phase === 'testing' || this.phase === 'awaiting-review')) {
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
        console.log(`[Release check-up] Moved ${name} into ${path.relative(process.cwd(), this.dataDir) || this.dataDir}`);
      } catch (err) {
        console.warn(`[Release check-up] Couldn’t move ${name} into the data folder:`, err instanceof Error ? err.message : err);
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

  public pendingAiScreens: VisualReviewItemInput[] = [];

  private async handleAiFinish(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.lastReport) {
      this.sendJson(res, 404, { error: 'No report available to finish AI review' });
      return;
    }
    const key = await this.storedOpenRouterKey();
    const provider = key ? createAIProvider('openrouter', key) : undefined;
    const reviewer = new VisualReviewer();

    const screens = this.pendingAiScreens.length > 0 ? this.pendingAiScreens : [];
    if (screens.length === 0) {
      this.sendJson(res, 200, {
        completed: true,
        message: 'No remaining screens to review',
        reviewedCount: 0,
        addedFindingsCount: 0,
        grades: this.lastReport.grades,
      });
      return;
    }

    const result = await reviewer.reviewScreens(screens, provider, { maxCalls: VISUAL_REVIEW_CALLS });
    this.pendingAiScreens = result.remainingScreens;

    if (result.findings.length > 0) {
      this.lastReport.findings.push(...withPortablePaths(result.findings, this.runDir(this.lastReport.runId)));
      const ran = this.lastReport.results.flatMap((r) => (r.checks || []).map((c) => c.checker));
      this.lastReport.grades = calculateSiteAspectGrades(this.lastReport.findings, { checkersRun: [...ran, 'ai-review'] });
      this.lastReport.recommendations = generateRankedRecommendations(this.lastReport.findings);
      const dir = this.runDir(this.lastReport.runId);
      await generateSingleFileHtmlReport(this.lastReport, { outputDir: dir }).catch(() => {});
      await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(this.lastReport), 'utf8').catch(() => {});
    }

    this.sendJson(res, 200, {
      completed: result.status === 'completed',
      reviewedCount: result.reviewedCount,
      remainingCount: this.pendingAiScreens.length,
      addedFindingsCount: result.findings.length,
      grades: this.lastReport.grades,
      note: result.note,
    });
  }

  /** The OpenRouter key saved on this machine, if any. Never returned to clients. */
  private async storedOpenRouterKey(): Promise<string | undefined> {
    const resolved = await this.keyResolver.resolveKey('openrouter');
    return resolved?.provider === 'openrouter' ? resolved.apiKey : undefined;
  }

  private async readAiModels(): Promise<{ text?: string | null; vision?: string | null }> {
    try {
      return JSON.parse(await fs.readFile(this.aiModelsFile, 'utf8'));
    } catch {
      return {};
    }
  }

  /** Keeps the chosen free models while they are still free, replacing any that has gone. */
  private async refreshAiModels(apiKey: string): Promise<{ text: string | null; vision: string | null }> {
    const models = keepOrPickModels(await this.openRouter.listFreeModels(apiKey), await this.readAiModels());
    await fs.mkdir(path.dirname(this.aiModelsFile), { recursive: true });
    await fs.writeFile(this.aiModelsFile, JSON.stringify({ ...models, chosenAt: new Date().toISOString() }, null, 2), 'utf8');
    return models;
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
    // free requests the key has left today (one call to OpenRouter), for the Settings page.
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
      const models = await this.refreshAiModels(apiKey!.trim()).catch(() => ({ text: null, vision: null }));
      this.sendJson(res, 200, { saved: true, model: models.text, visionModel: models.vision });
      return;
    }

    // GET free-models: key from the Authorization header, else the saved key.
    if (route === 'free-models' && req.method === 'GET') {
      const header = req.headers.authorization;
      const apiKey = header?.startsWith('Bearer ') ? header.slice(7) : await this.storedOpenRouterKey();
      try {
        const models = await this.openRouter.listFreeModels(apiKey);
        this.sendJson(res, 200, {
          models,
          recommendedModel: pickRecommendedModel(models),
          recommendedVisionModel: pickVisionModel(models),
        });
      } catch (err) {
        if (err instanceof OpenRouterAuthError) {
          this.sendJson(res, 401, { error: err.message });
        } else {
          this.sendJson(res, 502, { error: 'Couldn’t get the model list from OpenRouter. Try again in a minute.' });
        }
      }
      return;
    }

    this.sendJson(res, 404, { error: 'Not found' });
  }

  private async handleTriggerRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.phase === 'scanning' || this.phase === 'testing') {
      this.sendJson(res, 409, {
        error: 'Another check-up is running. Wait for it to finish, or stop it first.',
        code: 'ERR_RUN_IN_PROGRESS',
        suggestion: 'Wait for the check-up in progress to finish, or stop it, then start this one.',
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

    // A new run throws away a plan that's waiting for review, so the caller has to say so.
    await this.ensurePlanLoaded();
    if (this.phase === 'awaiting-review' && this.currentPlanRecord && !body.replacePlan) {
      let waitingFor = this.currentPlanRecord.plan.targetUrl;
      try {
        waitingFor = new URL(waitingFor).host;
      } catch {
        // keep it as typed
      }
      this.sendJson(res, 409, {
        error: `The plan for ${waitingFor} is waiting for your review. Starting a new check-up throws it away.`,
        code: 'ERR_PLAN_WAITING',
        suggestion: 'Open the plan to finish reviewing it, or start again to replace it.',
        targetUrl: this.currentPlanRecord.plan.targetUrl,
      });
      return;
    }

    // A caller that names this server as its Hub means the Hub behind /api/v1: runs go to that Hub directly.
    if (body.hubUrl && this.isThisServer(body.hubUrl, req)) body.hubUrl = this.hubUrl;

    // The wizard's plan is written by the AI (ADR 0009), so its scans need a working AI key.
    const wizardScan = body.owner !== undefined && body.mode !== 'safe-public' && !body.specTestCases?.length;
    if (wizardScan && body.useAI && (body.aiProvider ?? 'openrouter') === 'openrouter' && !body.apiKey && !(await this.storedOpenRouterKey())) {
      this.sendJson(res, 400, {
        error: 'An AI key is needed: the AI writes the plan.',
        code: 'ERR_NO_AI_KEY',
        suggestion: 'Add an OpenRouter key in Settings (the free tier works), then start the check-up again.',
      });
      return;
    }

    await this.clearPlan();

    const productId = body.productId || 'default-product';
    // Generated here (not by the orchestrator) so the id we hand back in the 202 response
    // is the SAME id the orchestrator will use for RUN_STARTED/RUN_COMPLETED — otherwise a
    // UI that trusts this response id would never see it appear in the SSE stream.
    const runId = `run-${Date.now()}`;
    this.currentRunId = runId;
    this.currentTargetUrl = body.targetUrl;
    this.runEvents = [];
    const generation = ++this.runGeneration;

    this.isRunning = true;
    this.phase = 'scanning';
    this.lastRunError = null;
    this.lastErrorCode = null;
    this.activeAbortController = new AbortController();

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

  private async handleAbortRun(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const runId = this.currentRunId;
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
        this.lastReport = this.portable(report);
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
      const profile: ProductProfile | undefined =
        body.roles && body.roles.length > 0
          ? { name: productId, productId, roles: body.roles }
          : undefined;
      const breakpoints: Breakpoint[] = (body.breakpoints as Breakpoint[]) || ['375px', '768px', '1440px'];

      // Full testing needs the owner's say-so and a test host. Decided here, not by the screen.
      const typed = new URL(body.targetUrl);
      const siteHost = typed.host;
      let memory = await loadSiteMemory(this.dataDir, siteHost);
      // What the person chose for the site is remembered, so the next check-up starts from it.
      if (body.stagingHost !== undefined || body.owner !== undefined) {
        memory = {
          ...(memory ?? emptySiteMemory(siteHost)),
          ...(body.stagingHost !== undefined ? { staging: body.stagingHost || undefined } : {}),
          ...(body.owner !== undefined ? { owner: body.owner } : {}),
        };
        await saveSiteMemory(this.dataDir, memory);
      }
      const urlFirst = body.owner !== undefined;
      const owner = body.owner ?? true;
      const testHost = isTestHost(typed.hostname, memory?.staging ? [typed.hostname] : []);
      const readOnly = !(owner && testHost);

      const context: StoredPlanRecord['context'] = {
        targetUrl,
        productId,
        runId,
        profile,
        breakpoints,
        headless: body.headless ?? true,
        hubUrl: body.hubUrl,
        hubToken: body.hubToken,
        releaseTarget: body.releaseTarget,
        draft: undefined as unknown as DiscoveryDraft,
        readOnly,
        siteHost,
        productContext: body.productContext,
        designNotes: body.designNotes,
      };

      if (body.specTestCases && body.specTestCases.length > 0) {
        // Caller supplied an explicit spec — takes priority over AI discovery.
        await this.executeTesting({ plan: this.emptyPlan(runId, body.targetUrl), context }, body.specTestCases, [], generation);
        return;
      }
      if (!body.useAI && !urlFirst) {
        await this.executeTesting({ plan: this.emptyPlan(runId, body.targetUrl), context }, [this.defaultTestCase()], [], generation);
        return;
      }

      const ai = await this.prepareAI(body);
      context.aiModels = ai.models;
      context.ai = ai.settings;
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
        aiProvider: ai.provider,
        readOnly,
        maxPages: typeof body.maxPages === 'number' && body.maxPages > 0 ? Math.min(Math.floor(body.maxPages), 1000) : undefined,
        aiBudget,
        onProgress: (progress) => {
          if (current()) this.broadcastRunnerEvent({ type: 'DISCOVERY_PROGRESS', runId, ...progress, timestamp: Date.now() });
        },
        // The last approved Plan is reused where the site hasn't changed, unless asked to start afresh.
        remembered: body.replanAll ? undefined : memory?.plan,
      });
      if (!current()) return;
      const sinceLastRun = applySiteMemory(draft, memory);
      context.draft = draft;
      context.reportNotes = [...(draft.exploration?.notes || [])];
      this.broadcastRunnerEvent({ type: 'DISCOVERY_COMPLETED', runId, flowsFound: draft.flows.length, timestamp: Date.now() });

      const record: StoredPlanRecord = { plan: this.emptyPlan(runId, body.targetUrl), context };
      record.plan = this.buildPlan(record, sinceLastRun, !!ai.provider, readOnlyReason(owner, testHost));

      // Test again: nothing new since the plan was approved, so it's tested as approved. The plan is
      // still kept, so stopping or a failure can go back to it.
      const approvedAt = memory?.planApprovedAt;
      if (body.testAgain && approvedAt && memory && this.nothingNew(draft, sinceLastRun, memory)) {
        applySafeAnswers(record.plan.questions);
        applySafeAnswers(draft.ambiguityQuestions);
        await saveSiteMemory(this.dataDir, rememberRun(memory, siteHost, draft, { reviewed: false }));
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
      await saveSiteMemory(this.dataDir, rememberRun(memory, siteHost, draft, { reviewed: false }));
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
  private async prepareAI(
    body: TriggerRunBody
  ): Promise<{ provider?: AIProvider; models?: { text?: string; vision?: string }; settings?: StoredPlanRecord['context']['ai']; key?: string }> {
    if (!body.useAI) return {};
    const providerType: AIProviderType = body.aiProvider || 'mock';
    let apiKey = body.apiKey;
    if (!apiKey && providerType === 'openrouter') {
      apiKey = await this.storedOpenRouterKey();
      if (!apiKey) {
        throw Object.assign(new Error('No OpenRouter key is saved. Add one in Settings, then start the check-up again.'), {
          code: 'ERR_NO_AI_KEY',
        });
      }
    }
    // One fixed free model per role (text, vision) chosen by the runner, so every run of a
    // site is planned by the same model and the report can say which.
    let model = body.aiModel;
    let visionModel: string | null | undefined;
    if (providerType === 'openrouter') {
      const chosen = await this.refreshAiModels(apiKey!).catch(async () => this.readAiModels());
      model ??= chosen.text ?? undefined;
      visionModel = chosen.vision;
      if (!model) {
        throw Object.assign(new Error('No free AI models are available right now — please try again later.'), { code: 'ERR_NO_FREE_MODELS' });
      }
    }
    return {
      provider: this.makeAIProvider(providerType, apiKey || 'mock-key', model),
      models: model ? { text: model, vision: visionModel ?? undefined } : undefined,
      settings: { provider: providerType, model, apiKey: body.apiKey },
      key: apiKey,
    };
  }

  /** What the key has left of today's free AI requests, when OpenRouter says (ADR 0009's AI Request Budget). */
  private async aiBudgetFor(settings: StoredPlanRecord['context']['ai'], key?: string): Promise<{ left?: number; limit?: number; visualReview: number }> {
    const today = settings?.provider === 'openrouter' ? await this.openRouter.freeRequestsToday(key ?? (await this.storedOpenRouterKey())) : null;
    return { left: today?.remaining, limit: today?.limit, visualReview: VISUAL_REVIEW_CALLS };
  }

  /** The text model again, for turning a sentence into a test during the review. */
  private async aiFor(context: StoredPlanRecord['context']): Promise<AIProvider | undefined> {
    const settings = context.ai;
    if (!settings) return undefined;
    const apiKey = settings.apiKey || (settings.provider === 'openrouter' ? await this.storedOpenRouterKey() : 'mock-key');
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
      planPages: draft.plan?.pages.map((p) => ({ ...p, screenshotPath: relative(p.screenshotPath) ?? p.screenshotPath })),
      navigation: draft.plan?.navigation,
      gradedChecks: draft.plan ? GRADED_CHECKS : undefined,
      layoutGroups: draft.plan?.layoutGroups,
      screenSizes: this.screenSizesOf(record.context),
      roles: draft.plan ? [...new Set(draft.pages.flatMap((p) => p.reachedBy?.length ? p.reachedBy : ['visitor']))] : undefined,
      wontRun,
      budget: draft.plan?.budget,
      summary,
      otherHosts: draft.plan?.otherHosts,
    };
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
      const expanded = expandPlan(draft, { readOnly, screenSizes: this.screenSizesOf(context), questions: draft.ambiguityQuestions });
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
      .flatMap((f) => (f.userRules || []).filter((r) => !r.checkable).map((r) => `Check by hand (“${f.name}”): ${r.text}`));
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
        breakpoints: context.breakpoints || ['375px', '768px', '1440px'],
        repoRoot: process.cwd(),
        runId: context.runId,
        reportNotes: context.reportNotes,
        aiModels: context.aiModels,
        readOnly: context.readOnly,
        notRun,
        siteMap: context.draft ? this.siteMapOf(context.draft, context.runId) : undefined,
        testedWithApprovedPlan: extra.testedWithApprovedPlan,
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
      const memory = await loadSiteMemory(this.dataDir, context.siteHost);
      if (memory) {
        rememberObservations(memory, context.draft, report);
        await saveSiteMemory(this.dataDir, memory).catch(() => {});
      }
    }

    // Kept for Past check-ups, with its files, before the run is reported as done.
    await this.keepRun(report, record.plan.targetUrl || context.targetUrl, context.siteHost).catch((err) =>
      console.warn('[Release check-up] Couldn’t keep the run’s report:', err instanceof Error ? err.message : err)
    );
    this.lastReport = this.portable(report);
    this.phase = 'done';
    this.isRunning = false;
    this.currentTargetUrl = null;

    if (context.hubUrl) {
      try {
        const pushResult = await pushRunToHub(report, {
          hubUrl: context.hubUrl,
          hubToken: context.hubToken,
          outputDir: runDir,
          releaseTarget: context.releaseTarget || 'latest',
        });
        this.broadcastRunnerEvent({ type: 'HUB_PUSH_RESULT', ...pushResult, timestamp: Date.now() });
      } catch (hubErr) {
        this.broadcastRunnerEvent({
          type: 'HUB_PUSH_RESULT',
          synced: false,
          error: hubErr instanceof Error ? hubErr.message : String(hubErr),
          timestamp: Date.now(),
        });
      }
    }
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

  private async savePlan(record: StoredPlanRecord): Promise<void> {
    this.currentPlanRecord = record;
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.planFile, JSON.stringify(this.planForDisk(record), null, 2), 'utf8');
  }

  /**
   * The plan as written to disk. Sign-in details and the hub token stay in memory only; after a
   * restart the approval has to send them again.
   */
  private planForDisk(record: StoredPlanRecord): StoredPlanRecord {
    const { profile, hubToken: _hubToken, ai, ...context } = record.context;
    const roles = profile?.roles || [];
    const notSaved = [...new Set([...(context.signInNotSaved || []), ...roles.map((r) => r.role)])];
    return new Redactor(roles).deep({
      plan: record.plan,
      context: {
        ...context,
        profile: profile && { ...profile, roles: roles.map(({ role, loginPath }) => ({ role, username: '', loginPath })) },
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
    if (!record || (this.phase !== 'awaiting-review' && this.phase !== 'scanning')) {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    this.sendJson(res, 200, record.plan);
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
    for (const item of [...(Array.isArray(body.flows) ? body.flows : []), ...(Array.isArray(body.testCases) ? body.testCases : [])]) {
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
      for (const [id, answer] of Object.entries(body.answers)) {
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
        const filePath = record.context.contextFilePath || path.join(this.runDir(record.plan.runId), 'product-context.md');
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

    if (draft) this.refreshPlan(record);
    await this.savePlan(record);
    this.sendJson(res, 200, record.plan);
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
  private replanOptions(record: StoredPlanRecord, instructions: string | undefined, report: (what: string) => void): ReplanOptions {
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
      this.sendJson(res, 409, { error: 'The plan is already being updated. Wait for it to finish.', code: 'ERR_PLAN_UPDATING' });
      return;
    }
    const runId = record.plan.runId;
    this.sendJson(res, 202, { updating: true, what });
    this.broadcastRunnerEvent({ type: 'PLAN_UPDATE_STARTED', runId, what, timestamp: Date.now() });
    this.planUpdate = (async () => {
      try {
        const provider = await this.aiFor(record.context);
        const budget = provider ? await this.aiBudgetFor(record.context.ai) : undefined;
        const paced = provider ? new PacedAI(provider, budget?.left ?? Infinity) : undefined;
        const notes = await work(record, paced, (step) =>
          this.broadcastRunnerEvent({ type: 'PLAN_UPDATE_PROGRESS', runId, what: step, requestsUsed: paced?.used ?? 0, timestamp: Date.now() })
        );
        const draft = record.context.draft;
        const plan = draft.plan!;
        const used = paced?.used ?? 0;
        plan.budget = {
          needed: plan.budget?.needed ?? 0,
          ...plan.budget,
          used: (plan.budget?.used ?? 0) + used,
          left: budget?.left !== undefined ? Math.max(0, budget.left - used) : plan.budget?.left,
          limit: budget?.limit ?? plan.budget?.limit,
        };
        if (draft.exploration) draft.exploration.notes = [...new Set([...draft.exploration.notes, ...notes])];
        this.refreshPlan(record);
        await this.savePlan(record);
        this.broadcastRunnerEvent({ type: 'PLAN_UPDATED', runId, what, timestamp: Date.now() });
      } catch (err) {
        this.broadcastRunnerEvent({ type: 'PLAN_UPDATE_FAILED', runId, what, error: err instanceof Error ? err.message : String(err), timestamp: Date.now() });
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
    const what = body.all ? 'Re-planning everything' : body.promote ? `Testing ${id.replace(/^page:/, '')} on its own` : 'Re-planning with the AI';
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
      if (id.startsWith('page:')) return replanPage(draft, id.slice('page:'.length), ai, { ...options, promote: body.promote });
      if (id.startsWith('pagetest:')) return replanPage(draft, id.slice('pagetest:'.length, id.lastIndexOf(':')), ai, options);
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
      this.sendJson(res, 400, { error: 'That address isn’t on this site. Links to other sites are listed under Navigation.' });
      return;
    }
    const address = target.pathname + target.search;
    if (record.context.draft.pages.some((p) => pathOf(p.urlPath) === target.pathname)) {
      this.sendJson(res, 400, { error: 'That page is already in the plan.' });
      return;
    }
    await this.startPlanUpdate(res, `Adding ${address}`, async (rec, ai, report) => {
      report(`Opening ${address}`);
      const found = await this.crawlMore(rec, rec.context.targetUrl, { startPaths: [address], maxPages: 1, exploreClicks: false });
      if (found.pages.length === 0) throw new Error(`${address} couldn’t be opened, or it asks for a sign-in.`);
      return (await addPagesToPlan(rec.context.draft, found, ai, { ...this.replanOptions(rec, undefined, report), added: true })).notes;
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
    const link = draft?.pages.flatMap((p) => p.links || []).find((l) => l.leavesSite && new URL(l.to).host === body.host);
    if (!record || !draft || !other || !link) {
      this.sendJson(res, 400, { error: 'That host isn’t linked from this site.' });
      return;
    }
    if (other.included) {
      this.sendJson(res, 400, { error: 'That host is already in the plan.' });
      return;
    }
    const origin = new URL(link.to).origin;
    await this.startPlanUpdate(res, `Adding ${other.host}`, async (rec, ai, report) => {
      report(`Exploring ${other.host}`);
      const crawled = await this.crawlMore(rec, `${origin}/`, {
        maxPages: INCLUDED_HOST_PAGES,
        exploreClicks: true,
        onPage: (_page, n) => report(`Exploring ${other.host}: ${n} ${n === 1 ? 'page' : 'pages'} found`),
      });
      if (crawled.pages.length === 0) throw new Error(`${other.host} couldn’t be explored.`);
      const out = await addPagesToPlan(rec.context.draft, onOtherHost(crawled, origin), ai, this.replanOptions(rec, undefined, report));
      const included = rec.context.draft.plan!.otherHosts.find((h) => h.host === other.host);
      if (included) included.included = true;
      return out.notes;
    });
  }

  /**
   * Crawls more for the review, signed out: a page added by its address, or another host's pages.
   * It goes as easy on the site as the scan did: robots.txt and a pause between pages on sites we don't own.
   */
  private async crawlMore(
    record: StoredPlanRecord,
    target: string,
    options: { startPaths?: string[]; maxPages: number; exploreClicks: boolean; onPage?: (page: PageInventoryItem, n: number) => void }
  ): Promise<{ pages: PageInventoryItem[]; forms: NonNullable<DiscoveryDraft['forms']> }> {
    const browser = new BrowserManager();
    const origin = new URL(target);
    const ownMachine = isPrivateHost(origin.hostname);
    try {
      const context = await browser.createContext({ baseUrl: target });
      if (record.context.readOnly) await blockChanges(context);
      const result = await new DeterministicSpider(record.context.profile?.forbiddenActions || [], options.maxPages).crawl(context, target, {
        startPaths: options.startPaths,
        exploreClicks: options.exploreClicks,
        robots: ownMachine ? undefined : await RobotsPolicy.fetch(origin.origin, 'QA-Benchmarking-Bot'),
        pageDelayMs: ownMachine ? 0 : 2000,
        screenshotDir: path.join(this.runDir(record.context.runId), 'plan-pages'),
        screenshotPrefix: `more-${Date.now()}`,
        onPage: options.onPage,
      });
      return {
        pages: result.pages.map((p) => ({ ...p, reachedBy: ['visitor'], links: p.links?.map((l) => ({ ...l, seenBy: ['visitor'] })) })),
        forms: result.forms.map((f) => ({ urlPath: f.urlPath, inputs: f.inputs.map((i) => ({ selector: i.selector })), submitButtonSelector: f.submitButtonSelector, method: f.method })),
      };
    } finally {
      await browser.close();
    }
  }

  /** Rebuilds the reviewed plan from the draft after a change: the summary, what won't run and the tests follow. */
  private refreshPlan(record: StoredPlanRecord): void {
    const before = record.plan;
    const since: MemorySummary | undefined = before.sinceLastRun ? { seenBefore: true, ...before.sinceLastRun } : undefined;
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
    const record = await this.ensurePlanLoaded();
    if (!record || this.phase !== 'awaiting-review') {
      this.sendJson(res, 404, { error: 'No plan awaiting review' });
      return;
    }
    if (this.planUpdate) {
      this.sendJson(res, 409, { error: 'The plan is still being updated. Approve it when that’s done.', code: 'ERR_PLAN_UPDATING' });
      return;
    }

    const body: { breakpoints?: string[]; roles?: RoleCredential[]; hubToken?: string } = await this.readJsonBody<{
      breakpoints?: string[];
      roles?: RoleCredential[];
      hubToken?: string;
    }>(req).catch(() => ({}));
    if (body?.breakpoints) {
      record.context.breakpoints = body.breakpoints as Breakpoint[];
    }
    if (body?.hubToken) record.context.hubToken = body.hubToken;

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
        const memory = await loadSiteMemory(this.dataDir, record.context.siteHost);
        await saveSiteMemory(this.dataDir, rememberRun(memory, record.context.siteHost, draft, { reviewed: true, answeredByOwner }));
      }
    }

    this.sendJson(res, 200, { status: 'approved', runId: record.plan.runId });

    const generation = ++this.runGeneration;
    this.activeAbortController = new AbortController();
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
      this.broadcastRunnerEvent({ type: 'RUN_FAILED', runId: record.plan.runId, error: msg, code: 'ERR_TEST_EXECUTION_FAILED', timestamp: Date.now() });
    });
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

