import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { ProductProfile, ReleaseReport, RoleCredential, TestCase, AIProviderType } from '@qa/types';
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
  type AIProvider,
  type OrchestratorEvent,
} from '@qa/core';

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const DOWNLOADABLE_REPORT_FILES: Record<string, string> = {
  'report.md': 'text/markdown; charset=utf-8',
  'findings.json': 'application/json; charset=utf-8',
};

export interface RunnerServerOptions {
  port?: number;
  host?: string;
  outputDir?: string;
  /** Where saved settings live when no OS keychain exists. Must not be inside outputDir, which is served. */
  dataDir?: string;
  /**
   * When the runner runs in a container, `localhost` in a target URL means the user's machine,
   * not the container. Set this (e.g. "host.docker.internal") to rewrite such hosts.
   */
  localhostAlias?: string;
  keyResolver?: KeyResolver;
  openRouter?: OpenRouterClient;
  /** Test seam: replaces the real AI provider construction. */
  createAIProvider?: (provider: AIProviderType, apiKey: string, model?: string) => AIProvider;
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
  private streamClients = new Set<http.ServerResponse>();

  private localhostAlias?: string;
  private keyResolver: KeyResolver;
  private openRouter: OpenRouterClient;
  private makeAIProvider: (provider: AIProviderType, apiKey: string, model?: string) => AIProvider;

  private isRunning = false;
  private lastReport: ReleaseReport | null = null;
  private lastRunError: string | null = null;
  /** The chosen free models (not secret), kept beside the key so every browser gets the same setup. */
  private aiModelsFile: string;

  constructor(options: RunnerServerOptions = {}) {
    this.port = options.port || 3001;
    this.host = options.host || 'localhost';
    this.outputDir = path.resolve(options.outputDir || path.join(process.cwd(), '.qa-runner-report'));
    this.localhostAlias = options.localhostAlias;
    const dataDir = path.resolve(options.dataDir || process.cwd());
    this.aiModelsFile = path.join(dataDir, '.qa-ai-models.json');
    this.keyResolver = options.keyResolver || new KeyResolver(dataDir);
    this.openRouter = options.openRouter || new OpenRouterClient();
    this.makeAIProvider =
      options.createAIProvider || ((provider, apiKey, model) => createAIProvider(provider, apiKey, undefined, model));
  }

  public broadcastRunnerEvent(event: OrchestratorEvent | Record<string, unknown>): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.streamClients) {
      try {
        client.write(payload);
      } catch {
        this.streamClients.delete(client);
      }
    }
  }

  /** Stores the report before announcing completion, so a client reacting to RUN_COMPLETED gets this run's report. */
  private forwardRunEvent(event: OrchestratorEvent): void {
    if (event.type === 'RUN_COMPLETED') this.lastReport = event.report;
    this.broadcastRunnerEvent(event);
  }

  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
          const pathname = url.pathname;

          // Only localhost pages may drive the runner; a wildcard would let any website trigger runs.
          const origin = req.headers.origin;
          if (origin && isLoopbackOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

          // GET /api/runner/stream (Server-Sent Events)
          if (pathname === '/api/runner/stream' && req.method === 'GET') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
            });
            res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                isRunning: this.isRunning,
                hasReport: !!this.lastReport,
                lastRunError: this.lastRunError,
              })
            );
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

          if (pathname.startsWith('/api/ai/openrouter/')) {
            await this.handleOpenRouter(pathname.replace('/api/ai/openrouter/', ''), req, res);
            return;
          }

          // GET /api/evidence/* — static evidence file serving, rooted at this runner's
          // own output dir.
          if (pathname.startsWith('/api/evidence/') && req.method === 'GET') {
            const relPath = decodeURIComponent(pathname.replace('/api/evidence/', ''));
            const targetFile = path.resolve(this.outputDir, relPath);
            // Saved sign-in sessions (auth/<role>.json) hold live session cookies: never served.
            const isSavedSession = path.relative(this.outputDir, targetFile).split(path.sep)[0] === 'auth';
            if (!isInside(this.outputDir, targetFile) || isSavedSession) {
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
    }
    return JSON.parse(body) as T;
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  /** Maps localhost targets to the host machine when the runner itself runs in a container. */
  private resolveTargetUrl(targetUrl: string): string {
    if (!this.localhostAlias) return targetUrl;
    try {
      const u = new URL(targetUrl);
      if (LOOPBACK_HOSTS.includes(u.hostname)) {
        u.hostname = this.localhostAlias;
        return u.toString();
      }
    } catch {
      // Invalid URLs are reported by the caller.
    }
    return targetUrl;
  }

  private async handlePreflight(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let targetUrl: string | undefined;
    try {
      ({ targetUrl } = await this.readJsonBody<{ targetUrl?: string }>(req));
      if (!targetUrl || !/^https?:$/.test(new URL(targetUrl).protocol)) throw new Error();
    } catch {
      this.sendJson(res, 400, { reachable: false, reason: 'invalid-url' });
      return;
    }

    const check = await new PreFlightChecker().checkUrlReachable(this.resolveTargetUrl(targetUrl));
    if (check.ok) {
      this.sendJson(res, 200, { reachable: true, statusCode: check.status });
    } else {
      this.sendJson(res, 200, {
        reachable: false,
        reason: check.status ? 'server-error' : 'unreachable',
        statusCode: check.status,
      });
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
      const content = await fs.readFile(path.join(this.outputDir, fileName));
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      });
      res.end(content);
    } catch {
      this.sendJson(res, 404, { error: `${fileName} was not written for the last run` });
    }
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
    // free models chosen for it, so any browser can skip the setup screen.
    if (route === 'key' && req.method === 'GET') {
      const configured = !!(await this.storedOpenRouterKey());
      const models = configured ? await this.readAiModels() : {};
      this.sendJson(res, 200, { configured, model: models.text ?? null, visionModel: models.vision ?? null });
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
    if (this.isRunning) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'A run is already in progress' }));
      return;
    }

    let body: TriggerRunBody;
    try {
      body = await this.readJsonBody<TriggerRunBody>(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    if (!body.targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'targetUrl is required' }));
      return;
    }

    const productId = body.productId || 'default-product';
    // Generated here (not by the orchestrator) so the id we hand back in the 202 response
    // is the SAME id the orchestrator will use for RUN_STARTED/RUN_COMPLETED — otherwise a
    // UI that trusts this response id would never see it appear in the SSE stream.
    const runId = `run-${Date.now()}`;

    this.isRunning = true;
    this.lastRunError = null;

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runId }));

    // Fire the actual run asynchronously — the HTTP response has already been sent;
    // progress and completion are delivered exclusively over the SSE stream.
    this.executeRun(body, productId, runId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastRunError = msg;
      this.isRunning = false;
      this.broadcastRunnerEvent({ type: 'RUN_FAILED', runId, error: msg, timestamp: Date.now() });
    });
  }

  private async executeRun(body: TriggerRunBody, productId: string, runId: string): Promise<void> {
    const targetUrl = this.resolveTargetUrl(body.targetUrl);

    if (body.mode === 'safe-public') {
      // Read-only path: never touches DiscoveryAgent or FlowTestOrchestrator.
      try {
        this.lastReport = await runSafeWebsiteScan({
          targetUrl,
          productId: body.productId,
          outputDir: this.outputDir,
          runId,
          headless: body.headless ?? true,
          onEvent: (event) => this.forwardRunEvent(event),
        });
      } finally {
        this.isRunning = false;
      }
      return;
    }

    try {
      const profile: ProductProfile | undefined =
        body.roles && body.roles.length > 0
          ? { name: productId, productId, roles: body.roles }
          : undefined;
      let specTestCases: TestCase[];
      let reportNotes: string[] | undefined;
      let aiModels: { text?: string; vision?: string } | undefined;

      if (body.specTestCases && body.specTestCases.length > 0) {
        // Caller supplied an explicit spec — takes priority over AI discovery.
        specTestCases = body.specTestCases;
      } else if (body.useAI) {
        const providerType: AIProviderType = body.aiProvider || 'mock';
        let apiKey = body.apiKey;
        if (!apiKey && providerType === 'openrouter') {
          apiKey = await this.storedOpenRouterKey();
          if (!apiKey) throw new Error('No OpenRouter key is saved. Add one before starting an AI run.');
        }
        // One fixed free model per role (text, vision) chosen by the runner, so every run of a
        // site is planned by the same model and the report can say which.
        let model = body.aiModel;
        let visionModel: string | null | undefined;
        if (providerType === 'openrouter') {
          const chosen = await this.refreshAiModels(apiKey!).catch(async () => this.readAiModels());
          model ??= chosen.text ?? undefined;
          visionModel = chosen.vision;
          if (!model) throw new Error('No free AI models are available right now — please try again later.');
        }
        aiModels = model ? { text: model, vision: visionModel ?? undefined } : undefined;
        const aiProvider = this.makeAIProvider(providerType, apiKey || 'mock-key', model);

        let contextFilePath: string | undefined;
        if (body.productContext?.trim()) {
          await fs.mkdir(this.outputDir, { recursive: true });
          contextFilePath = path.join(this.outputDir, `product-context-${runId}.md`);
          await fs.writeFile(contextFilePath, body.productContext, 'utf8');
        }

        this.broadcastRunnerEvent({ type: 'DISCOVERY_STARTED', runId, timestamp: Date.now() });
        const agent = new DiscoveryAgent();
        const draft = await agent.discover({
          targetUrl,
          productId,
          profile,
          contextFilePath,
          outputDir: this.outputDir,
          aiProvider,
        });
        this.broadcastRunnerEvent({ type: 'DISCOVERY_COMPLETED', runId, flowsFound: draft.flows.length, timestamp: Date.now() });
        reportNotes = draft.exploration?.notes;
        const planner = new TestPlanner();
        // The planned journeys, then a visit to every page found, so problems no journey passes
        // through (a broken button, a page with no way out) are still found.
        specTestCases = [...planner.plan(draft).testCases, ...buildPageSweep(draft)];
        if (specTestCases.length === 0) {
          // Nothing discovered/plannable — fall back to a trivial sanity check rather
          // than running zero test cases (which would look like a silent success).
          specTestCases = [this.defaultTestCase()];
        }
      } else {
        specTestCases = [this.defaultTestCase()];
      }

      // Phone, tablet and desktop by default: some problems only show at one width.
      const breakpoints = (body.breakpoints as any) || ['375px', '768px', '1440px'];
      const orchestrator = new FlowTestOrchestrator();
      const report = await orchestrator.run({
        targetUrl,
        productId,
        specTestCases,
        profile,
        headless: body.headless ?? true,
        outputDir: this.outputDir,
        breakpoints,
        repoRoot: process.cwd(),
        runId,
        reportNotes,
        aiModels,
        onEvent: (event) => this.forwardRunEvent(event),
      });

      this.lastReport = report;
      this.isRunning = false;

      if (body.hubUrl) {
        try {
          const pushResult = await pushRunToHub(report, {
            hubUrl: body.hubUrl,
            hubToken: body.hubToken,
            outputDir: this.outputDir,
            releaseTarget: body.releaseTarget || 'latest',
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
    } catch (err) {
      this.isRunning = false;
      throw err;
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
