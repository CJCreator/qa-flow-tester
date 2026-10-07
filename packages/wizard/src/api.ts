import type {
  ReleaseReport,
  RoleCredential,
  ReviewPlan,
  DiscoveredFlow,
  TestCase,
  RunSummary,
  BenchmarkJob,
  ReleaseGateCriteria,
} from '@qa/types';

/**
 * Every call to the runner lives here, and every failure becomes a RunnerError whose message is a
 * plain-language sentence safe to show as-is. Raw fetch errors and status codes never reach the UI.
 */

/** The QA Tool serves this page, so its API is on the page's own address. */
export const STREAM_URL = '/api/runner/stream';

export class RunnerError extends Error {
  code?: string;
  suggestion?: string;
  constructor(message: string, code?: string, suggestion?: string) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
    this.suggestion = suggestion;
  }
}

const NOT_RESPONDING = 'Release check-up isn’t responding. Make sure it’s still running, then try again.';

async function call(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new RunnerError(
      NOT_RESPONDING,
      'ERR_SERVER_UNRESPONSIVE',
      'Check that it’s still running in its terminal (start it with pnpm start).'
    );
  }
}

async function json<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new RunnerError(NOT_RESPONDING, 'ERR_INVALID_RESPONSE');
  }
}

export type RunnerPhase = 'idle' | 'scanning' | 'awaiting-review' | 'testing' | 'done' | 'failed';

export interface RunnerStatus {
  isRunning: boolean;
  hasReport: boolean;
  lastRunError: string | null;
  lastErrorCode?: string | null;
  phase?: RunnerPhase;
  hasPlan?: boolean;
  runId?: string | null;
  /** The site the check-up in progress is for, as typed. */
  targetUrl?: string | null;
  /** The run the latest report belongs to. */
  reportRunId?: string | null;
  /** A copy shared with other people (the free online one): check-ups and reports are visible to all of them. */
  beta?: boolean;
  /** Shared copy only: another visitor's check-up is running, so a new one would have to wait. */
  busy?: boolean;
}

/** null means the runner can't be reached (not started yet, or stopped). */
export async function getStatus(): Promise<RunnerStatus | null> {
  try {
    const res = await call('/api/runner/status', {}, 4000);
    return res.ok ? await json<RunnerStatus>(res) : null;
  } catch {
    return null;
  }
}

export type AiProviderId = 'openrouter' | 'anthropic' | 'openai' | 'gemini';

export interface AiSetup {
  configured: boolean;
  model: string | null;
  /** The service the AI runs on. OpenRouter's free models by default. */
  provider?: AiProviderId;
  /** The model that reviews screenshots after a run, when one is set up. */
  visionModel?: string | null;
  /** The person picked the models in Settings, rather than the QA Tool picking free ones. */
  chosenBy?: 'person' | 'auto';
  /** The services a key can be added for. */
  providers?: Array<{ id: AiProviderId; name: string; free: boolean }>;
}

/**
 * Whether the QA Tool already has a working AI key, the service and the model it uses. They live
 * on the QA Tool, not in this browser, so any browser skips the setup once it's done. Answered from
 * this computer alone, so it's quick; today's free requests come from getAiUsage.
 */
export async function getAiSetup(): Promise<AiSetup> {
  const res = await call('/api/ai/settings');
  if (!res.ok) throw new RunnerError(NOT_RESPONDING);
  const body = await json<AiSetup>(res);
  return { ...body, model: body.model ?? null };
}

/** The free requests the key has left today, when OpenRouter says (one call to OpenRouter: slow). */
export async function getAiUsage(): Promise<{ requestsLeft: number | null; requestsLimit: number | null }> {
  const res = await call('/api/ai/usage', {}, 12000);
  if (!res.ok) throw new RunnerError(NOT_RESPONDING);
  return json(res);
}

/** Saves the AI service, a key for it, and the models chosen. A model given here is kept while it's available. */
export async function saveAiSettings(settings: {
  provider: AiProviderId;
  apiKey?: string;
  model?: string | null;
  visionModel?: string | null;
}): Promise<AiSetup> {
  const res = await call('/api/ai/settings', { method: 'POST', body: JSON.stringify(settings) }, 25000);
  const body = await json<AiSetup & { reason?: string; error?: string }>(res).catch(
    () => ({}) as AiSetup & { reason?: string; error?: string }
  );
  if (!res.ok) throw new RunnerError(body.reason || body.error || 'The settings couldn’t be saved. Try again.');
  return { ...body, model: body.model ?? null };
}

export interface FreeModel {
  id: string;
  name: string;
  contextLength: number;
  supportsJsonOutput: boolean;
  supportsImages: boolean;
  /** Thinks before answering, which uses up its answer allowance. */
  thinks?: boolean;
  /** Has let planning down more often than it answered, on this computer. */
  unreliable?: boolean;
}

/** OpenRouter's free models, best first. */
export async function listFreeModels(): Promise<FreeModel[]> {
  const res = await call('/api/ai/openrouter/free-models', {}, 20000);
  if (!res.ok) throw new RunnerError('The model list couldn’t be read from OpenRouter. Try again in a minute.');
  return (await json<{ models: FreeModel[] }>(res)).models;
}

/** One small request to a model, to see that it answers. It uses one of today's requests. */
export async function testModel(model?: string): Promise<{ ok: boolean; ms: number; model?: string; reason?: string }> {
  const res = await call('/api/ai/test-model', { method: 'POST', body: JSON.stringify({ model }) }, 90000);
  if (!res.ok) {
    const body = await json<{ reason?: string }>(res).catch(() => ({ reason: undefined }));
    throw new RunnerError(body.reason || 'The model couldn’t be tested. Try again.');
  }
  return json(res);
}

/** About how many AI requests a scan of the site needs, and how many are left today. */
export interface AiEstimate {
  low: number;
  high: number;
  visualReview: number;
  seenBefore: boolean;
  free: boolean;
  left: number | null;
  limit: number | null;
}

export async function estimateAi(targetUrl: string, maxPages: number): Promise<AiEstimate | null> {
  try {
    const res = await call(
      '/api/runner/ai-estimate',
      { method: 'POST', body: JSON.stringify({ targetUrl, maxPages }) },
      15000
    );
    return res.ok ? await json<AiEstimate>(res) : null;
  } catch {
    return null;
  }
}

export type KeyCheck = { valid: true } | { valid: false; reason: string };

export async function validateKey(apiKey: string): Promise<KeyCheck> {
  const res = await call('/api/ai/openrouter/validate', { method: 'POST', body: JSON.stringify({ apiKey }) }, 12000);
  if (!res.ok) throw new RunnerError(NOT_RESPONDING);
  return json<KeyCheck>(res);
}

/**
 * Saves the key on the QA Tool, which then chooses the free model every run uses. The model is
 * null when OpenRouter has no free model right now.
 */
export async function saveKey(apiKey: string): Promise<{ model: string | null }> {
  const res = await call('/api/ai/openrouter/key', { method: 'POST', body: JSON.stringify({ apiKey }) }, 25000);
  if (res.ok) return { model: (await json<{ model?: string | null }>(res)).model ?? null };
  const body = await json<{ reason?: string }>(res).catch(() => ({ reason: undefined }));
  throw new RunnerError(body.reason || 'The key couldn’t be saved. Try again.');
}

/** What the address check says about the site before anything starts. */
export interface SiteFacts {
  /** The site as typed, e.g. "localhost:3050". */
  host?: string;
  /** The address can be tested fully: this computer, a private network, a tunnel, or marked as a test copy. */
  testCopy?: boolean;
  /** What was chosen for the site last time. */
  remembered?: {
    owner?: boolean;
    markedTestCopy?: boolean;
    /** Whether search was checked last time; unset means never chosen. */
    searchChecks?: boolean;
    /** Sign-ins saved for the site (never their passwords). */
    signIns?: Array<{ role: string; username: string }>;
  };
}

export type Reachability =
  | ({ ok: true; statusCode?: number } & SiteFacts)
  | ({ ok: false; reason: string; code: string; suggestion: string; statusCode?: number } & SiteFacts);

export async function checkReachable(targetUrl: string): Promise<Reachability> {
  const res = await call('/api/runner/preflight', { method: 'POST', body: JSON.stringify({ targetUrl }) }, 15000);
  const body = await json<
    {
      reachable: boolean;
      reason?: string;
      code?: string;
      suggestion?: string;
      statusCode?: number;
      error?: string;
    } & SiteFacts
  >(res);
  const facts: SiteFacts = { host: body.host, testCopy: body.testCopy, remembered: body.remembered };
  if (body.reachable) return { ok: true, statusCode: body.statusCode, ...facts };
  if (body.reason === 'server-error' || body.code === 'ERR_SERVER_ERROR') {
    return {
      ok: false,
      reason: 'That site answered with an error page. It may be down right now.',
      code: body.code || 'ERR_SERVER_ERROR',
      suggestion: 'Check the site is working, then try again.',
      statusCode: body.statusCode,
      ...facts,
    };
  }
  if (body.reason === 'invalid-url' || body.code === 'ERR_INVALID_URL') {
    return {
      ok: false,
      reason: 'That doesn’t look like a valid web address.',
      code: body.code || 'ERR_INVALID_URL',
      suggestion: 'Check the address, for example shop.example.com or localhost:3050.',
      statusCode: body.statusCode,
      ...facts,
    };
  }
  if (res.status === 401 || res.status === 403 || body.error) {
    return {
      ok: false,
      reason: body.error || 'Access to QA runner was refused.',
      code: 'ERR_RUNNER_REFUSED',
      suggestion:
        res.status === 401
          ? 'Open the app using the link with ?access= key.'
          : 'Cross-origin request was refused by the runner.',
      statusCode: res.status,
      ...facts,
    };
  }
  return {
    ok: false,
    reason: 'Couldn’t reach that site.',
    code: body.code || 'ERR_TARGET_UNREACHABLE',
    suggestion: 'Make sure it’s running and the address is right, then try again.',
    statusCode: body.statusCode,
    ...facts,
  };
}

export interface StartRunRequest {
  targetUrl: string;
  owner: boolean;
  /** The person says this live-looking address is a test copy of their site. */
  stagingHost?: boolean;
  roles?: RoleCredential[];
  productContext?: string;
  designNotes?: string;
  /** Pages the crawl explores at most (default 200). */
  maxPages?: number;
  /** Throw away a plan that's waiting for review. */
  replacePlan?: boolean;
  /** Test with the approved plan when nothing on the site is new. */
  testAgain?: boolean;
  /** The AI service saved in Settings. OpenRouter when not given. */
  aiProvider?: AiProviderId;
  /** Plan with fixed rules now, spending no AI requests; re-plan items with the AI later. */
  planWithoutAI?: boolean;
  /** False when there is no AI key at all: no AI is used, and fixed rules write the plan. */
  useAI?: boolean;
  /**
   * Check how search engines and AI assistants see the site. Off for a test copy by default: it
   * matters on the public site.
   */
  searchChecks?: boolean;
  /** Granular 4-lens visibility flags: search, answers, aiSearch, marketing. */
  visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
  /** Remember the sign-ins for this site (passwords in the computer's keychain). */
  rememberSignIns?: boolean;
  /** Sign in with the ones saved for the site. */
  useSavedSignIns?: boolean;
}

/** Starts a check-up: the scan, then the plan waits for review. Returns the run id. */
export async function startRun(request: StartRunRequest): Promise<string> {
  let productId = 'default-product';
  try {
    productId = new URL(request.targetUrl).hostname;
  } catch {
    // handled by the runner
  }

  const body: Record<string, unknown> = {
    targetUrl: request.targetUrl,
    productId,
    owner: request.owner,
    skipReview: false,
    mode: 'product',
    useAI: request.useAI ?? true,
    aiProvider: request.aiProvider ?? 'openrouter',
  };
  if (request.planWithoutAI) body.planWithoutAI = true;
  if (request.rememberSignIns) body.rememberSignIns = true;
  if (request.useSavedSignIns) body.useSavedSignIns = true;
  if (request.searchChecks !== undefined) body.searchChecks = request.searchChecks;
  if (request.visibility !== undefined) body.visibility = request.visibility;
  if (request.stagingHost !== undefined) body.stagingHost = request.stagingHost;
  if (request.roles?.length) body.roles = request.roles;
  if (request.productContext) body.productContext = request.productContext;
  if (request.designNotes) body.designNotes = request.designNotes;
  if (request.maxPages) body.maxPages = request.maxPages;
  if (request.replacePlan) body.replacePlan = true;
  if (request.testAgain) body.testAgain = true;

  interface ApiErrorPayload {
    error?: string;
    code?: string;
    suggestion?: string;
  }

  const res = await call('/api/runner/run', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const err: ApiErrorPayload = await json<ApiErrorPayload>(res).catch((): ApiErrorPayload => ({}));
    throw new RunnerError(
      err.error || 'The check-up couldn’t be started. Try again.',
      err.code || (res.status === 409 ? 'ERR_RUN_IN_PROGRESS' : 'ERR_START_FAILED'),
      err.suggestion
    );
  }
  return (await json<{ runId: string }>(res)).runId;
}

/**
 * Stops the scan or test run. `planKept` when testing stopped: the plan waits for review again.
 * With `finish`, the work so far is kept: the scan plans what it found, testing makes a partial report.
 */
export async function abortRun(finish = false): Promise<{ aborted: boolean; planKept?: boolean; finishing?: boolean }> {
  try {
    const res = await call('/api/runner/abort', {
      method: 'POST',
      body: finish ? JSON.stringify({ finish: true }) : undefined,
    });
    if (res.ok) return await json<{ aborted: boolean; planKept?: boolean; finishing?: boolean }>(res);
  } catch {
    // runner might be busy or unreachable
  }
  return { aborted: false };
}

export async function getPlan(): Promise<ReviewPlan> {
  const res = await call('/api/runner/plan');
  if (res.status === 404) throw new RunnerError('No plan is waiting for review right now.', 'ERR_NO_PLAN');
  if (!res.ok) throw new RunnerError('Couldn’t fetch the plan. Try again.');
  return json<ReviewPlan>(res);
}

export interface PatchPlanBody {
  flows?: DiscoveredFlow[];
  questions?: Array<{ id: string; selectedAnswer: string }>;
  answers?: Record<string, string>;
  testCases?: TestCase[];
  productContext?: string;
  designNotes?: string;
  /** Plan Items switched on or off: pages, tests, Navigation Checks, journeys ("journey:<id>"). */
  items?: Array<{ id: string; skipped: boolean }>;
  /** The screen sizes the run uses. */
  screenSizes?: Array<'375px' | '768px' | '1440px'>;
  /** Confirms the AI's guess of what should happen (no text), or replaces it with the person's words. */
  expectations?: Array<{ id: string; text?: string }>;
  /** 'quick': desktop only, and only the shared menus' links. */
  preset?: 'quick';
}

/** What a small change (a switch, an answer, the sizes) changed: merged into the plan on screen. */
export interface PlanDelta {
  delta: true;
  summary?: ReviewPlan['summary'];
  wontRun?: ReviewPlan['wontRun'];
  screenSizes?: ReviewPlan['screenSizes'];
  questions: ReviewPlan['questions'];
  planPages: NonNullable<ReviewPlan['planPages']>;
  navigation: NonNullable<ReviewPlan['navigation']>;
  flows: ReviewPlan['flows'];
}

/** The plan with a change applied: a whole new plan, or the items a small change touched. */
export function applyPlanChange(plan: ReviewPlan, change: ReviewPlan | PlanDelta): ReviewPlan {
  if (!('delta' in change)) return change;
  const byId = <T extends { id: string }>(items: T[] | undefined, changed: T[]): T[] | undefined =>
    items?.map((item) => changed.find((c) => c.id === item.id) ?? item);
  return {
    ...plan,
    summary: change.summary,
    wontRun: change.wontRun,
    screenSizes: change.screenSizes,
    questions: change.questions,
    planPages: byId(plan.planPages, change.planPages),
    navigation: byId(plan.navigation, change.navigation),
    flows: plan.flows.map((f) => change.flows.find((c) => c.id === f.id) ?? f),
  };
}

/**
 * Starts a change to the plan that needs the AI or the crawler. It runs in the background: the
 * QA Tool reports progress and the result as PLAN_UPDATE_* events, and the plan is fetched again then.
 */
async function startPlanUpdate(route: string, body: unknown): Promise<void> {
  const res = await call(route, { method: 'POST', body: JSON.stringify(body) });
  if (res.status === 202) return;
  const err = await json<{ error?: string }>(res).catch((): { error?: string } => ({}));
  throw new RunnerError(err.error || 'The plan couldn’t be updated. Try again.');
}

/** The AI plans one Plan Item again, with what the person asked for; `promote` tests a covered page on its own. */
export const replanItem = (itemId: string, instructions?: string, promote?: boolean) =>
  startPlanUpdate('/api/runner/plan/replan', { itemId, instructions: instructions?.trim() || undefined, promote });
/** The AI plans everything again, e.g. with new specs. */
export const replanEverything = (productContext?: string) =>
  startPlanUpdate('/api/runner/plan/replan', { all: true, productContext });
/** Adds a page no link reaches, by its address; it's opened and planned like the rest. */
export const addPageToPlan = (address: string) => startPlanUpdate('/api/runner/plan/add-page', { address });
/** Explores another host the site links to, and plans its pages. */
export const includeHostInPlan = (host: string) => startPlanUpdate('/api/runner/plan/include-host', { host });
/** Signs in as a role, explores what it sees, and adds that to the plan. */
export const addSignInToPlan = (signIn: RoleCredential) => startPlanUpdate('/api/runner/plan/add-sign-in', signIn);

/** Saves a response as a file, with the name the QA Tool gave it. */
async function saveResponse(res: Response, fallbackName: string): Promise<void> {
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

/** Saves the whole plan as a Markdown file, for reading, sharing and signing off. */
export async function downloadPlanMarkdown(): Promise<void> {
  const res = await call('/api/runner/plan/markdown');
  if (!res.ok) throw new RunnerError('The plan couldn’t be downloaded. Try again.');
  await saveResponse(res, 'test-plan.md');
}

export async function patchPlan(body: PatchPlanBody): Promise<ReviewPlan | PlanDelta> {
  const res = await call('/api/runner/plan', { method: 'PATCH', body: JSON.stringify(body) });
  if (res.status === 422) {
    const err = await json<{ error: string; issues?: string[] }>(res);
    throw new RunnerError(err.error || 'Some steps are aimed at things that aren’t on the page.');
  }
  if (!res.ok) throw new RunnerError('Couldn’t update the plan. Try again.');
  return json<ReviewPlan | PlanDelta>(res);
}

export async function approvePlan(options?: {
  roles?: RoleCredential[];
  breakpoints?: string[];
  idempotencyKey?: string;
}): Promise<void> {
  const token = options?.idempotencyKey || `approve-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const res = await call('/api/runner/plan/approve', {
    method: 'POST',
    headers: { 'Idempotency-Key': token },
    body: JSON.stringify(options || {}),
  });
  if (res.status === 409) {
    const err = await json<{ error: string; code?: string; needsSignIn?: string[] }>(res);
    if (err.code === 'ERR_DUPLICATE_APPROVAL') {
      return;
    }
    throw new RunnerError(err.error, err.code);
  }
  if (res.status === 404)
    throw new RunnerError('This plan isn’t waiting for review any more. Start a new check-up.', 'ERR_NO_PLAN');
  if (!res.ok) throw new RunnerError('Couldn’t start testing the plan. Try again.');
}

export interface InterpretResult {
  ok: boolean;
  flow?: DiscoveredFlow;
  message?: string;
}

export async function interpretSentence(options: {
  sentence: string;
  urlPath?: string;
  role?: string;
  kind?: 'test' | 'rule';
  flowId?: string;
}): Promise<InterpretResult> {
  const res = await call('/api/runner/plan/interpret', { method: 'POST', body: JSON.stringify(options) });
  if (!res.ok) throw new RunnerError('Couldn’t turn that into a test. Try saying it another way.');
  return json<InterpretResult>(res);
}

/** Every finished check-up kept on this computer, newest first. */
export async function listRuns(): Promise<RunSummary[]> {
  const res = await call('/api/runs');
  if (!res.ok) throw new RunnerError('Couldn’t list your past check-ups. Try again.');
  return (await json<{ runs: RunSummary[] }>(res)).runs;
}

/** One check-up's report. */
export async function getRun(runId: string): Promise<ReleaseReport> {
  const res = await call(`/api/runs/${encodeURIComponent(runId)}`);
  if (res.status === 404)
    throw new RunnerError('That check-up’s report isn’t on this computer any more.', 'ERR_NO_REPORT');
  if (!res.ok) throw new RunnerError('The report couldn’t be opened. Try again.');
  return json<ReleaseReport>(res);
}

export async function deleteRun(runId: string): Promise<void> {
  const res = await call(`/api/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await json<{ error?: string }>(res).catch((): { error?: string } => ({}));
    throw new RunnerError(err.error || 'The check-up couldn’t be deleted. Try again.');
  }
}

/** Saves one of a check-up's files: report.html, report.md or findings.json. */
export async function downloadRunFile(
  runId: string,
  file: 'report.html' | 'report.md' | 'findings.json'
): Promise<void> {
  const res = await call(`/api/runs/${encodeURIComponent(runId)}/download/${file}`);
  if (!res.ok) throw new RunnerError('That file couldn’t be downloaded. Try again.');
  await saveResponse(res, file);
}

/** The address of a file inside a check-up's folder: a screenshot, a thumbnail, a repro script. */
export function runFileUrl(runId: string, relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `/api/evidence/runs/${encodeURIComponent(runId)}/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

/** A text file inside a check-up's folder, e.g. a repro script. */
export async function readRunText(runId: string, relativePath: string): Promise<string> {
  const res = await call(runFileUrl(runId, relativePath));
  if (!res.ok) throw new RunnerError('That file isn’t there any more.');
  return res.text();
}

/** Finishes AI visual and copy review for screens remaining after a partial run. */
export async function finishAiReview(): Promise<{
  completed: boolean;
  reviewedCount: number;
  remainingCount: number;
  addedFindingsCount: number;
  grades?: ReleaseReport['grades'];
  note?: string;
}> {
  const res = await call('/api/runner/ai/finish', { method: 'POST' });
  if (!res.ok) throw new RunnerError('Couldn’t finish the AI review. Try again.');
  return json(res);
}

/** What's remembered about a site on this computer. Passwords are never sent back. */
export interface RememberedSite {
  host: string;
  owner?: boolean;
  markedTestCopy?: boolean;
  /** Whether search is checked; unset means the default (on for a live site, off for a test copy). */
  searchChecks?: boolean;
  signIns: Array<{ role: string; username: string; loginPath?: string }>;
  updatedAt: string;
}

export async function listSites(): Promise<RememberedSite[]> {
  const res = await call('/api/sites');
  if (!res.ok) throw new RunnerError('The remembered sites couldn’t be read. Try again.');
  return (await json<{ sites: RememberedSite[] }>(res)).sites;
}

/** Changes what's remembered for a site: whether search is checked (null: the default), or forgets a saved sign-in. */
export async function updateSite(
  host: string,
  change: { searchChecks?: boolean | null; forgetSignIn?: string }
): Promise<void> {
  const res = await call(`/api/sites/${encodeURIComponent(host)}`, { method: 'POST', body: JSON.stringify(change) });
  if (!res.ok) throw new RunnerError('That couldn’t be saved. Try again.');
}

/**
 * Signs in on the site to check the details work, and keeps them (password in the computer's
 * keychain) only when they do. Throws with the reason when signing in didn't work.
 */
export async function addSiteSignIn(
  host: string,
  signIn: { role: string; username: string; password: string; loginPath?: string }
): Promise<{ landingPath?: string; saved: boolean; note?: string }> {
  const res = await call(
    `/api/sites/${encodeURIComponent(host)}`,
    { method: 'POST', body: JSON.stringify({ addSignIn: signIn }) },
    30000
  );
  const body = await json<{ saved?: boolean; landingPath?: string; error?: string }>(res);
  if (!res.ok) throw new RunnerError(body.error || 'That sign-in couldn’t be saved. Try again.');
  return { landingPath: body.landingPath, saved: !!body.saved, note: body.error };
}

/** Signs in with a saved sign-in to check it still works. */
export async function testSiteSignIn(
  host: string,
  role: string
): Promise<{ verified: boolean; landingPath?: string; error?: string }> {
  const res = await call(
    `/api/sites/${encodeURIComponent(host)}`,
    { method: 'POST', body: JSON.stringify({ testSignIn: role }) },
    30000
  );
  const body = await json<{ verified?: boolean; landingPath?: string; error?: string }>(res);
  if (!res.ok) throw new RunnerError(body.error || 'The sign-in couldn’t be tested. Try again.');
  return { verified: !!body.verified, landingPath: body.landingPath, error: body.error };
}

export type ScreenSize = '375px' | '768px' | '1440px';

/** The screen sizes a new check-up starts with. */
export async function getDefaults(): Promise<{ screenSizes: ScreenSize[] }> {
  const res = await call('/api/settings/defaults');
  if (!res.ok) throw new RunnerError(NOT_RESPONDING);
  return json(res);
}

export async function saveDefaults(defaults: { screenSizes: ScreenSize[] }): Promise<{ screenSizes: ScreenSize[] }> {
  const res = await call('/api/settings/defaults', { method: 'POST', body: JSON.stringify(defaults) });
  const body = await json<{ screenSizes: ScreenSize[]; error?: string }>(res);
  if (!res.ok) throw new RunnerError(body.error || 'The defaults couldn’t be saved. Try again.');
  return body;
}

/**
 * Marks a problem as intended, or as not a problem, with an optional reason; null undoes it. The
 * report is updated and the site's next check-ups don't raise it again. Returns the updated report.
 */
export async function triageProblem(
  runId: string,
  titles: string[],
  status: 'Intended' | 'False Positive' | null,
  reason?: string
): Promise<ReleaseReport> {
  const res = await call(`/api/runs/${encodeURIComponent(runId)}/triage`, {
    method: 'POST',
    body: JSON.stringify({ titles, status, reason }),
  });
  if (!res.ok) {
    const err = await json<{ error?: string }>(res).catch((): { error?: string } => ({}));
    throw new RunnerError(err.error || 'That couldn’t be saved. Try again.');
  }
  return json<ReleaseReport>(res);
}

/** A plan kept aside for its site while another site was checked. */
export interface WaitingPlan {
  host: string;
  targetUrl: string;
  runId: string;
  discoveredAt: string;
  pages: number;
}

export async function listWaitingPlans(): Promise<WaitingPlan[]> {
  try {
    const res = await call('/api/runner/waiting-plans');
    return res.ok ? (await json<{ plans: WaitingPlan[] }>(res)).plans : [];
  } catch {
    return [];
  }
}

/** Brings a kept-aside plan back for review; the plan waiting now, if any, is kept aside instead. */
export async function resumeWaitingPlan(host: string): Promise<{ runId: string; targetUrl: string }> {
  const res = await call('/api/runner/waiting-plans', { method: 'POST', body: JSON.stringify({ host }) });
  const body = await json<{ runId: string; targetUrl: string; error?: string }>(res);
  if (!res.ok) throw new RunnerError(body.error || 'That plan couldn’t be opened. Try again.');
  return body;
}

export interface VisualBaselineItem {
  id: string;
  testCaseId: string;
  breakpoint: string;
  fileName: string;
  fileSizeBytes: number;
  updatedAt: string;
  previewUrl: string;
  hasRegression?: boolean;
  diffPercent?: number;
  diffUrl?: string;
  currentUrl?: string;
}

export async function listVisualBaselines(): Promise<VisualBaselineItem[]> {
  try {
    const res = await call('/api/runner/baselines');
    return res.ok ? json<VisualBaselineItem[]>(res) : [];
  } catch {
    return [];
  }
}

export async function acceptVisualBaseline(id: string, currentEvidencePath?: string): Promise<void> {
  const res = await call('/api/runner/baselines/accept', {
    method: 'POST',
    body: JSON.stringify({ id, currentEvidencePath }),
  });
  if (!res.ok) throw new RunnerError('Couldn’t accept the new visual baseline.');
}

export async function deleteVisualBaseline(id: string): Promise<void> {
  const res = await call(`/api/runner/baselines/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new RunnerError('Couldn’t delete the visual baseline.');
}

/** Starts comparing two sites; the comparison runs on the server and is followed with getBenchmark. */
export async function startBenchmark(params: {
  ourUrl: string;
  ourName?: string;
  refUrl: string;
  refName?: string;
}): Promise<string> {
  const res = await call('/api/runner/benchmark', { method: 'POST', body: JSON.stringify(params) });
  const body = await json<{ id?: string; error?: string }>(res);
  if (!res.ok || !body.id)
    throw new RunnerError(body.error || 'The comparison couldn’t start. Check both addresses and try again.');
  return body.id;
}

export async function getBenchmark(id: string): Promise<BenchmarkJob> {
  const res = await call(`/api/runner/benchmark/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new RunnerError('That comparison isn’t here any more.');
  if (!res.ok) throw new RunnerError('That comparison couldn’t be opened. Try again.');
  return json<BenchmarkJob>(res);
}

/** The running and kept comparisons, newest first, without their full results. */
export async function listBenchmarks(): Promise<BenchmarkJob[]> {
  try {
    const res = await call('/api/runner/benchmarks');
    return res.ok ? json<BenchmarkJob[]>(res) : [];
  } catch {
    return [];
  }
}

export async function deleteBenchmark(id: string): Promise<void> {
  const res = await call(`/api/runner/benchmark/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new RunnerError('That comparison couldn’t be removed.');
}

export interface CheckupSchedule {
  id: string;
  name: string;
  targetUrl: string;
  cadence: 'daily' | 'weekly' | 'hourly';
  hour: number;
  dayOfWeek?: number;
  preset: 'full' | 'quick';
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'passed' | 'failed';
  nextRunAt: string;
}

export async function listSchedules(): Promise<CheckupSchedule[]> {
  try {
    const res = await call('/api/runner/schedules');
    return res.ok ? json<CheckupSchedule[]>(res) : [];
  } catch {
    return [];
  }
}

export async function addSchedule(input: {
  targetUrl: string;
  name?: string;
  cadence?: 'daily' | 'weekly' | 'hourly';
  hour?: number;
  dayOfWeek?: number;
  preset?: 'full' | 'quick';
}): Promise<CheckupSchedule> {
  const res = await call('/api/runner/schedules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new RunnerError('Couldn’t create the scheduled check-up.');
  return json<CheckupSchedule>(res);
}

export async function toggleSchedule(id: string, enabled: boolean): Promise<CheckupSchedule> {
  const res = await call(`/api/runner/schedules/${encodeURIComponent(id)}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new RunnerError('Couldn’t update the schedule status.');
  return json<CheckupSchedule>(res);
}

export async function deleteSchedule(id: string): Promise<void> {
  const res = await call(`/api/runner/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new RunnerError('Couldn’t delete the schedule.');
}

const GATES_STORAGE_KEY = 'qa_release_gate_criteria';

export function getStoredReleaseGates(): ReleaseGateCriteria {
  try {
    const saved = localStorage.getItem(GATES_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { maxBlockers: 0, maxMajors: 0, strictAccessibility: true };
}

export function saveStoredReleaseGates(gates: ReleaseGateCriteria): void {
  try {
    localStorage.setItem(GATES_STORAGE_KEY, JSON.stringify(gates));
  } catch {}
}
