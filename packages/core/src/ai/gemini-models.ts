import { createHash } from 'crypto';

/**
 * Which Gemini model a Google AI Studio key can use. Google renames and retires models often, and a free key
 * only reaches some of them, so the model is chosen from what the key itself lists and then tried once.
 */

const STUDIO = 'https://generativelanguage.googleapis.com/v1beta';
/** Pages of the model list followed at most: one page of 1000 holds every model today. */
const MAX_PAGES = 20;
/** How long a working model is remembered per key. */
const PICK_TTL_MS = 30 * 60 * 1000;
/** How long "no model works for this key" is remembered, so failing AI steps do not each list and probe again. */
const FAILED_PICK_TTL_MS = 2 * 60 * 1000;
/** Longest a shared pick may take before it gives up. */
const PICK_DEADLINE_MS = 60_000;

export interface GeminiModelProbe {
  model: string;
  status: number;
}

export type GeminiModelPick =
  | { ok: true; model: string; tried: GeminiModelProbe[] }
  | {
      ok: false;
      reason: 'key-invalid' | 'no-credit' | 'no-model' | 'network';
      /** A short plain sentence for people: never the key, never raw JSON. */
      detail: string;
      tried: GeminiModelProbe[];
    };

export interface GeminiModelOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export interface GeminiPickOptions extends GeminiModelOptions {
  /** Candidates tried at most, best first. Default 4. */
  maxProbes?: number;
}

/** An AI Studio answer other than 2xx. The message names the status and Google's message, never the key. */
export class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    summary: string
  ) {
    super(`Gemini API error (${status}): ${summary}`);
    this.name = 'GeminiApiError';
  }
}

const KEY_INVALID = /API_KEY_INVALID|API key (not valid|expired)/i;
const MODEL_MISSING = /not found|not supported|unsupported|unexpected model name/i;
const NO_CREDIT = /prepayment|credits? (are |is )?(depleted|exhausted)|RESOURCE_EXHAUSTED|quota/i;

/** Whether an AI Studio answer means the model does not exist for this key (or cannot generate content). */
export function geminiModelMissing(status: number, body: string): boolean {
  if (status === 404) return true;
  return status === 400 && !KEY_INVALID.test(body) && MODEL_MISSING.test(body);
}

function scrub(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[key]') : text;
}

/** Google's own message from an error body, without the JSON around it. */
function summarize(body: string, apiKey: string): string {
  let text = body;
  try {
    const err = (JSON.parse(body) as { error?: { message?: string; status?: string } }).error;
    if (err?.message) text = err.status ? `${err.message} [${err.status}]` : err.message;
  } catch {
    // not JSON: the text as sent
  }
  const clean = scrub(text, apiKey).replace(/\s+/g, ' ').trim();
  return clean.length > 300 ? `${clean.slice(0, 297)}...` : clean;
}

function fetcher(opts?: GeminiModelOptions): typeof fetch {
  return opts?.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
}

/** A fetch that failed before any answer, its message cleaned of the key. A cancel passes through unchanged. */
async function call(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  apiKey: string,
  signal?: AbortSignal
): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(scrub(err instanceof Error ? err.message : String(err), apiKey));
  }
}

/**
 * The models this key can call `generateContent` on, without the `models/` prefix. Throws a GeminiApiError
 * (its message carries the HTTP status) when AI Studio refuses, and a plain Error when it cannot be reached.
 */
export async function listGeminiModels(apiKey: string, opts?: GeminiModelOptions): Promise<string[]> {
  const fetchFn = fetcher(opts);
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${STUDIO}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await call(fetchFn, url, { method: 'GET' }, apiKey, opts?.signal);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new GeminiApiError(res.status, scrub(body, apiKey), summarize(body, apiKey));
    }
    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      nextPageToken?: string;
    };
    for (const m of data.models ?? []) {
      if (!m.name || !m.supportedGenerationMethods?.includes('generateContent')) continue;
      const id = m.name.replace(/^models\//, '');
      if (!ids.includes(id)) ids.push(id);
    }
    pageToken = data.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return ids;
}

const EXCLUDED = /embedding|tts|image|audio|live|aqa|learnlm|gemma|thinking|latest/i;
const PREVIEW = /preview|(^|-)exp(-|$|\d)/i;
const STABLE_FLASH = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/i;

/** The version in `gemini-<version>-...` as [major, minor], or null. */
function versionOf(id: string): [number, number] | null {
  const m = /^gemini-(\d+)(?:\.(\d+))?-/i.exec(id);
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null;
}

/** Newest version first (no version last), then flash before the smaller flash-lite and 8b, then by name. */
function byVersionThenFlash(a: string, b: string): number {
  const va = versionOf(a);
  const vb = versionOf(b);
  if (va && vb && (va[0] !== vb[0] || va[1] !== vb[1])) return vb[0] - va[0] || vb[1] - va[1];
  if (!va !== !vb) return va ? -1 : 1;
  const small = (id: string) => (/flash-(lite|8b)/i.test(id) ? 1 : 0);
  return small(a) - small(b) || a.localeCompare(b);
}

/**
 * Candidates for the audit's text and screenshot work, best first: the stable `gemini-<version>-flash` and
 * `-flash-lite` models (the free-tier ones), newest version first and flash before flash-lite; then other
 * stable Flash models. Speech, image, audio, live, embedding, Gemma, thinking and `-latest` models are left
 * out. Preview and experimental Flash models are used only when no stable one is listed.
 */
export function rankGeminiModels(ids: string[]): string[] {
  const flash = [...new Set(ids)].filter((id) => /^gemini-.*flash/i.test(id) && !EXCLUDED.test(id));
  const stable = flash.filter((id) => !PREVIEW.test(id));
  const preferred = stable.filter((id) => STABLE_FLASH.test(id)).sort(byVersionThenFlash);
  const others = stable.filter((id) => !STABLE_FLASH.test(id)).sort(byVersionThenFlash);
  if (preferred.length + others.length > 0) return [...preferred, ...others];
  return flash.filter((id) => PREVIEW.test(id)).sort(byVersionThenFlash);
}

const KEY_INVALID_DETAIL =
  'Google AI Studio did not accept this key. Check that it was copied in full, or make a new key in Google AI Studio.';
const KEY_DENIED_DETAIL =
  'This key is not allowed to use the Gemini API. Check its restrictions in Google Cloud, or make a new key in Google AI Studio.';
const NO_PREPAID_DETAIL =
  "This key's Google project has no prepaid credit left. Top up in Google AI Studio, or save `adc` to use Google sign-in.";
const NO_FREE_REQUESTS_DETAIL =
  "This key's free Gemini requests are used up for now. Try again later, top up in Google AI Studio, or save `adc` to use Google sign-in.";
const NETWORK_DETAIL = 'Google AI Studio could not be reached. Check the internet connection and try again.';
const SERVICE_DETAIL = 'Google AI Studio had a problem answering. Try again in a minute.';

export type GeminiPickFailure = Extract<GeminiModelPick, { ok: false }>['reason'];

/** Why listGeminiModels failed, as a pick failure reason and a plain sentence for people. */
export function explainGeminiListError(err: unknown): { reason: GeminiPickFailure; detail: string } {
  if (!(err instanceof GeminiApiError)) return { reason: 'network', detail: NETWORK_DETAIL };
  const { status, body } = err;
  if ((status === 400 && KEY_INVALID.test(body)) || status === 401) {
    return { reason: 'key-invalid', detail: KEY_INVALID_DETAIL };
  }
  if (status === 403) return { reason: 'key-invalid', detail: KEY_DENIED_DETAIL };
  if (status === 402 || /prepayment/i.test(body)) return { reason: 'no-credit', detail: NO_PREPAID_DETAIL };
  if (status === 429) return { reason: 'no-credit', detail: NO_FREE_REQUESTS_DETAIL };
  if (status >= 500) return { reason: 'network', detail: SERVICE_DETAIL };
  return { reason: 'no-model', detail: `Google AI Studio would not list its models for this key (error ${status}).` };
}

type ProbeKind = 'ok' | 'key' | 'credit' | 'missing' | 'other';

function probeKind(status: number, body: string): ProbeKind {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403 || (status === 400 && KEY_INVALID.test(body))) return 'key';
  if (status === 402 || /prepayment/i.test(body) || (status === 429 && NO_CREDIT.test(body))) return 'credit';
  if (geminiModelMissing(status, body)) return 'missing';
  return 'other';
}

/**
 * Lists the key's models, ranks them, and tries the best few in order with one tiny request each until one
 * answers. Says why when none does: the key is refused, its project is out of credit, no model fits, or AI
 * Studio could not be reached.
 */
export async function pickGeminiModel(apiKey: string, opts?: GeminiPickOptions): Promise<GeminiModelPick> {
  const signal = opts?.signal;
  let ids: string[];
  try {
    ids = await listGeminiModels(apiKey, opts);
  } catch (err) {
    if (signal?.aborted) throw err;
    return { ok: false, ...explainGeminiListError(err), tried: [] };
  }
  const candidates = rankGeminiModels(ids).slice(0, Math.max(1, opts?.maxProbes ?? 4));
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'no-model',
      detail: 'Google AI Studio lists no Gemini Flash model for this key that reads text and screenshots.',
      tried: [],
    };
  }

  const fetchFn = fetcher(opts);
  const probe = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
    generationConfig: { maxOutputTokens: 8 },
  });
  const tried: GeminiModelProbe[] = [];
  const kinds: ProbeKind[] = [];
  let prepaid = false;
  for (const model of candidates) {
    let res: Response;
    try {
      res = await call(
        fetchFn,
        `${STUDIO}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: probe },
        apiKey,
        signal
      );
    } catch (err) {
      if (signal?.aborted) throw err;
      tried.push({ model, status: 0 });
      return { ok: false, reason: 'network', detail: NETWORK_DETAIL, tried };
    }
    tried.push({ model, status: res.status });
    const body = await res.text().catch(() => '');
    const kind = probeKind(res.status, body);
    if (kind === 'ok') return { ok: true, model, tried };
    // A key AI Studio rejects outright is not tried on other models.
    if (kind === 'key' && res.status !== 403) {
      return { ok: false, reason: 'key-invalid', detail: KEY_INVALID_DETAIL, tried };
    }
    if (kind === 'credit' && (res.status === 402 || /prepayment/i.test(body))) prepaid = true;
    kinds.push(kind);
  }

  if (kinds.every((k) => k === 'key')) return { ok: false, reason: 'key-invalid', detail: KEY_DENIED_DETAIL, tried };
  if (kinds.includes('credit')) {
    return { ok: false, reason: 'no-credit', detail: prepaid ? NO_PREPAID_DETAIL : NO_FREE_REQUESTS_DETAIL, tried };
  }
  if (tried.some((t) => t.status >= 500)) return { ok: false, reason: 'network', detail: SERVICE_DETAIL, tried };
  return {
    ok: false,
    reason: 'no-model',
    detail: `None of the Gemini models tried answered for this key (${tried.map((t) => t.model).join(', ')}).`,
    tried,
  };
}

const picks = new Map<string, { until: number; model: Promise<string | null> }>();

function cacheKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/** Waits for a shared promise, or stops early when this caller cancels. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    );
  });
}

/**
 * A model that works with this key, or null: pickGeminiModel, remembered per key for 30 minutes (a failed pick
 * for 2), and shared by callers asking at the same time. The key itself is not kept, only its hash.
 */
export async function workingGeminiModel(apiKey: string, opts?: GeminiPickOptions): Promise<string | null> {
  const id = cacheKey(apiKey);
  const now = Date.now();
  let entry = picks.get(id);
  if (!entry || entry.until <= now) {
    const model = pickGeminiModel(apiKey, {
      fetchFn: opts?.fetchFn,
      maxProbes: opts?.maxProbes,
      // One caller's cancel must not end the pick other callers wait on: it has its own deadline.
      signal: AbortSignal.timeout(PICK_DEADLINE_MS),
    }).then(
      (pick) => {
        const current = picks.get(id);
        if (current?.model === model) current.until = Date.now() + (pick.ok ? PICK_TTL_MS : FAILED_PICK_TTL_MS);
        return pick.ok ? pick.model : null;
      },
      () => {
        if (picks.get(id)?.model === model) picks.delete(id);
        return null;
      }
    );
    entry = { until: now + PICK_TTL_MS, model };
    picks.set(id, entry);
  }
  return untilAborted(entry.model, opts?.signal);
}
