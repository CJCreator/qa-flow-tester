import type { ReleaseReport, RoleCredential } from '@qa/types';

/**
 * Every call to the runner lives here, and every failure becomes a RunnerError whose message is a
 * plain-language sentence safe to show as-is. Raw fetch errors and status codes never reach the UI.
 */

export const RUNNER_URL =
  ((import.meta.env.VITE_RUNNER_URL as string | undefined) || 'http://localhost:3001').replace(/\/+$/, '');
export const STREAM_URL = `${RUNNER_URL}/api/runner/stream`;

export class RunnerError extends Error {}

const NOT_RESPONDING = 'The QA Tool isn’t responding. Make sure it’s still running, then try again.';

async function call(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  try {
    return await fetch(`${RUNNER_URL}${path}`, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new RunnerError(NOT_RESPONDING);
  }
}

async function json<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new RunnerError(NOT_RESPONDING);
  }
}

export interface RunnerStatus {
  isRunning: boolean;
  hasReport: boolean;
  lastRunError: string | null;
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

/**
 * Whether the QA Tool already has a working AI key, and the free model it chose. Both live on the
 * QA Tool, not in this browser, so any browser or device skips the setup screen once it's done.
 */
export async function getAiSetup(): Promise<{ configured: boolean; model: string | null }> {
  const res = await call('/api/ai/openrouter/key');
  if (!res.ok) throw new RunnerError(NOT_RESPONDING);
  const body = await json<{ configured: boolean; model?: string | null }>(res);
  return { configured: body.configured, model: body.model ?? null };
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

export type Reachability = { ok: true } | { ok: false; reason: string };

export async function checkReachable(targetUrl: string): Promise<Reachability> {
  const res = await call('/api/runner/preflight', { method: 'POST', body: JSON.stringify({ targetUrl }) }, 15000);
  const body = await json<{ reachable: boolean; reason?: string }>(res);
  if (body.reachable) return { ok: true };
  if (body.reason === 'server-error') {
    return { ok: false, reason: 'That site answered with an error page. It may be down right now. Try again later.' };
  }
  if (body.reason === 'invalid-url') {
    return { ok: false, reason: 'That doesn’t look like a web address. Try something like shop.example.com.' };
  }
  return { ok: false, reason: 'Couldn’t reach that site — check the URL and try again.' };
}

export type StartRunRequest =
  | {
      mode: 'product';
      targetUrl: string;
      aiModel: string;
      roles: RoleCredential[];
      productContext?: string;
    }
  | { mode: 'safe-public'; targetUrl: string };

export async function startRun(request: StartRunRequest): Promise<string> {
  const productId = new URL(request.targetUrl).hostname;
  const body =
    request.mode === 'safe-public'
      ? { targetUrl: request.targetUrl, productId, mode: 'safe-public' }
      : {
          targetUrl: request.targetUrl,
          productId,
          useAI: true,
          aiProvider: 'openrouter',
          aiModel: request.aiModel,
          roles: request.roles,
          ...(request.productContext ? { productContext: request.productContext } : {}),
        };

  const res = await call('/api/runner/run', { method: 'POST', body: JSON.stringify(body) });
  if (res.status === 409) {
    throw new RunnerError('Another check is already running. Wait for it to finish, then start this one.');
  }
  if (!res.ok) throw new RunnerError('The check couldn’t be started. Try again.');
  return (await json<{ runId: string }>(res)).runId;
}

export async function getReport(): Promise<ReleaseReport> {
  const res = await call('/api/report');
  if (!res.ok) throw new RunnerError('The report isn’t available. Run the check again.');
  return json<ReleaseReport>(res);
}

/** Saves report.md and findings.json exactly as the runner wrote them. */
export async function downloadReportFiles(): Promise<void> {
  for (const file of ['report.md', 'findings.json']) {
    const res = await call(`/api/report/download/${file}`);
    if (!res.ok) throw new RunnerError('The report files couldn’t be downloaded. Try again.');
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = file;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }
}
