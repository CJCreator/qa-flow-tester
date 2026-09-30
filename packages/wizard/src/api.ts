import type { ReleaseReport, RoleCredential, ReviewPlan, DiscoveredFlow, TestCase, RunSummary } from '@qa/types';

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
    throw new RunnerError(NOT_RESPONDING, 'ERR_SERVER_UNRESPONSIVE', 'Check that it’s still running in its terminal (start it with pnpm start).');
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
  hubConnected?: boolean;
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

export interface AiSetup {
  configured: boolean;
  model: string | null;
  /** Free requests the key has left today, when asked for and OpenRouter says. */
  requestsLeft?: number;
  requestsLimit?: number;
}

/**
 * Whether the QA Tool already has a working AI key, and the free model it chose. Both live on the
 * QA Tool, not in this browser, so any browser or device skips the setup once it's done. `usage`
 * also asks OpenRouter how many free requests are left today (slower: for Settings).
 */
export async function getAiSetup(usage = false): Promise<AiSetup> {
  const res = await call(`/api/ai/openrouter/key${usage ? '?usage=1' : ''}`);
  if (!res.ok) throw new RunnerError(NOT_RESPONDING);
  const body = await json<{ configured: boolean; model?: string | null; requestsLeft?: number; requestsLimit?: number }>(res);
  return { configured: body.configured, model: body.model ?? null, requestsLeft: body.requestsLeft, requestsLimit: body.requestsLimit };
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
  remembered?: { owner?: boolean; markedTestCopy?: boolean };
}

export type Reachability =
  | ({ ok: true; statusCode?: number } & SiteFacts)
  | ({ ok: false; reason: string; code: string; suggestion: string; statusCode?: number } & SiteFacts);

export async function checkReachable(targetUrl: string): Promise<Reachability> {
  const res = await call('/api/runner/preflight', { method: 'POST', body: JSON.stringify({ targetUrl }) }, 15000);
  const body = await json<
    { reachable: boolean; reason?: string; code?: string; suggestion?: string; statusCode?: number } & SiteFacts
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
    useAI: true,
    aiProvider: 'openrouter',
  };
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

/** Stops the scan or test run. `planKept` when testing stopped: the plan waits for review again. */
export async function abortRun(): Promise<{ aborted: boolean; planKept?: boolean }> {
  try {
    const res = await call('/api/runner/abort', { method: 'POST' });
    if (res.ok) return await json<{ aborted: boolean; planKept?: boolean }>(res);
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
export const replanEverything = (productContext?: string) => startPlanUpdate('/api/runner/plan/replan', { all: true, productContext });
/** Adds a page no link reaches, by its address; it's opened and planned like the rest. */
export const addPageToPlan = (address: string) => startPlanUpdate('/api/runner/plan/add-page', { address });
/** Explores another host the site links to, and plans its pages. */
export const includeHostInPlan = (host: string) => startPlanUpdate('/api/runner/plan/include-host', { host });

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

export async function patchPlan(body: PatchPlanBody): Promise<ReviewPlan> {
  const res = await call('/api/runner/plan', { method: 'PATCH', body: JSON.stringify(body) });
  if (res.status === 422) {
    const err = await json<{ error: string; issues?: string[] }>(res);
    throw new RunnerError(err.error || 'Some steps are aimed at things that aren’t on the page.');
  }
  if (!res.ok) throw new RunnerError('Couldn’t update the plan. Try again.');
  return json<ReviewPlan>(res);
}

export async function approvePlan(options?: { roles?: RoleCredential[]; breakpoints?: string[] }): Promise<void> {
  const res = await call('/api/runner/plan/approve', { method: 'POST', body: JSON.stringify(options || {}) });
  if (res.status === 409) {
    const err = await json<{ error: string; code?: string; needsSignIn?: string[] }>(res);
    throw new RunnerError(err.error, err.code);
  }
  if (res.status === 404) throw new RunnerError('This plan isn’t waiting for review any more. Start a new check-up.', 'ERR_NO_PLAN');
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
  if (res.status === 404) throw new RunnerError('That check-up’s report isn’t on this computer any more.', 'ERR_NO_REPORT');
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
export async function downloadRunFile(runId: string, file: 'report.html' | 'report.md' | 'findings.json'): Promise<void> {
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
