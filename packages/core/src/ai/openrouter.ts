import type { AIModelOutcome } from '@qa/types';

/**
 * OpenRouter account helpers used by the non-technical wizard: key validation and
 * free-tier model discovery. Keys are only ever sent to OpenRouter; nothing here logs them.
 */

const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const REQUEST_TIMEOUT_MS = 8000;

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number;
  supportsJsonOutput: boolean;
  /** Takes screenshots as input, so it can do the visual review. */
  supportsImages: boolean;
  /** Thinks before it answers, which spends its answer allowance. Such models are tried last. */
  thinks?: boolean;
}

export type KeyValidation = { valid: true } | { valid: false; reason: string };

export class OpenRouterAuthError extends Error {}

interface RawModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
  reasoning?: { mandatory?: boolean };
}

/** Classifier / moderation models are priced at zero but cannot write test plans. */
const NON_CHAT_PATTERN = /content-safety|guard|moderation|embed/i;

/**
 * Routers (openrouter/free, openrouter/auto) send each call to whichever model is up, so the same
 * site could get a different plan on every run. Runs use one fixed model instead.
 */
const ROUTER_PATTERN = /^openrouter\//i;

export class OpenRouterClient {
  constructor(private fetchImpl: typeof fetch = fetch) {}

  async validateKey(apiKey: string | undefined): Promise<KeyValidation> {
    const key = apiKey?.trim();
    if (!key) return { valid: false, reason: 'Please paste your OpenRouter key.' };
    if (!key.startsWith('sk-or-')) {
      return { valid: false, reason: 'That doesn’t look like an OpenRouter key. They start with “sk-or-”.' };
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${OPENROUTER_API}/key`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { valid: false, reason: 'Couldn’t reach OpenRouter to check the key. Check your internet connection.' };
    }

    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403) {
      return {
        valid: false,
        reason: 'OpenRouter doesn’t recognise this key. It may have been deleted, or part of it is missing.',
      };
    }
    if (res.status === 402) {
      return { valid: false, reason: 'This key is out of credit.' };
    }
    return {
      valid: false,
      reason: `OpenRouter couldn’t check the key right now (error ${res.status}). Try again in a minute.`,
    };
  }

  /**
   * The key's free-model requests for the current UTC day, as OpenRouter counts them, or null when
   * it can't say. The AI Request Budget is checked against `remaining`.
   */
  async freeRequestsToday(
    apiKey: string | undefined
  ): Promise<{ used: number; limit: number; remaining: number } | null> {
    const key = apiKey?.trim();
    if (!key) return null;
    try {
      const res = await this.fetchImpl(`${OPENROUTER_API}/key`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: { free_model_daily_requests?: { used?: number; limit?: number; remaining?: number } };
      };
      const today = body.data?.free_model_daily_requests;
      if (typeof today?.remaining !== 'number' || typeof today.limit !== 'number') return null;
      return { used: today.used ?? today.limit - today.remaining, limit: today.limit, remaining: today.remaining };
    } catch {
      return null;
    }
  }

  /**
   * Returns chat-capable models priced at zero. Throws OpenRouterAuthError when the key is rejected,
   * because the model list itself is public and would otherwise hide a bad key.
   */
  async listFreeModels(apiKey: string | undefined): Promise<OpenRouterModel[]> {
    const validation = await this.validateKey(apiKey);
    if (!validation.valid) throw new OpenRouterAuthError(validation.reason);

    const res = await this.fetchImpl(`${OPENROUTER_API}/models`, {
      headers: { Authorization: `Bearer ${apiKey!.trim()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenRouter model list failed: HTTP ${res.status}`);
    const { data } = (await res.json()) as { data?: RawModel[] };

    return (data ?? [])
      .filter((m) => isFree(m) && isChatModel(m))
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length ?? 0,
        supportsJsonOutput: (m.supported_parameters ?? []).includes('response_format'),
        supportsImages: (m.architecture?.input_modalities ?? []).includes('image'),
        thinks: thinks(m) || undefined,
        reasoningMandatory: !!m.reasoning?.mandatory,
      }))
      .sort((a, b) => rank(b) - rank(a) || b.contextLength - a.contextLength)
      .map(({ reasoningMandatory: _r, ...model }) => model);
  }
}

function isFree(m: RawModel): boolean {
  return (m.pricing?.prompt === '0' && m.pricing?.completion === '0') || m.id.endsWith(':free');
}

/** Reads text and writes only text: no music, image or speech models, and no routers. */
function isChatModel(m: RawModel): boolean {
  const input = m.architecture?.input_modalities ?? ['text'];
  const output = m.architecture?.output_modalities ?? ['text'];
  return (
    input.includes('text') &&
    output.length > 0 &&
    output.every((o) => o === 'text') &&
    !ROUTER_PATTERN.test(m.id) &&
    !NON_CHAT_PATTERN.test(`${m.id} ${m.name ?? ''}`)
  );
}

/** A model that reasons before answering: the reasoning comes out of the same answer allowance. */
function thinks(m: RawModel): boolean {
  const params = m.supported_parameters ?? [];
  return !!m.reasoning?.mandatory || params.includes('reasoning') || params.includes('include_reasoning');
}

/**
 * Higher is better: JSON-mode support (planning asks for JSON), then no reasoning at all (a free
 * reasoning model can spend its whole allowance thinking and answer nothing), then reasoning that
 * can at least be turned down.
 */
function rank(m: { supportsJsonOutput: boolean; thinks?: boolean; reasoningMandatory: boolean }): number {
  return (m.supportsJsonOutput ? 4 : 0) + (m.thinks ? 0 : 2) + (m.reasoningMandatory ? 0 : 1);
}

/** How each model has done on this machine: see AIModelOutcome. */
export type ModelRecord = Record<string, AIModelOutcome>;

/** A model that has let planning down more often than it has answered: it's tried after the others. */
export function unreliable(model: string, record: ModelRecord = {}): boolean {
  const r = record[model];
  return !!r && r.truncated + r.failed > 0 && r.truncated + r.failed >= r.ok;
}

/** The list best-first, with models that keep letting planning down moved to the end. */
export function byTrackRecord(models: OpenRouterModel[], record: ModelRecord = {}): OpenRouterModel[] {
  return [...models.filter((m) => !unreliable(m.id, record)), ...models.filter((m) => unreliable(m.id, record))];
}

/** The model that writes the test plan. The list is already sorted best-first. */
export function pickRecommendedModel(models: OpenRouterModel[], record: ModelRecord = {}): string | null {
  return byTrackRecord(models, record)[0]?.id ?? null;
}

/** The model that reviews screenshots: the best one that takes images, or null when none is free. */
export function pickVisionModel(models: OpenRouterModel[], record: ModelRecord = {}): string | null {
  return byTrackRecord(models, record).find((m) => m.supportsImages)?.id ?? null;
}

/** Models to switch to when the chosen one stops before answering: the next best few. */
export function fallbackModels(
  models: OpenRouterModel[],
  chosen: string | null | undefined,
  record: ModelRecord = {},
  count = 3
): string[] {
  return byTrackRecord(models, record)
    .filter((m) => m.id !== chosen && m.supportsJsonOutput && !unreliable(m.id, record))
    .slice(0, count)
    .map((m) => m.id);
}

/**
 * Keeps the models already chosen while they are still free, so runs stay comparable; replaces
 * only a model that has gone away.
 */
export function keepOrPickModels(
  models: OpenRouterModel[],
  current: { text?: string | null; vision?: string | null; chosenBy?: 'person' } = {},
  record: ModelRecord = {}
): { text: string | null; vision: string | null } {
  // A model the person picked is kept while it's free; one picked automatically also has to keep answering.
  const keep = (id: string | null | undefined, needsImages: boolean) =>
    !!id &&
    models.some((m) => m.id === id && (!needsImages || m.supportsImages)) &&
    (current.chosenBy === 'person' || !unreliable(id, record));
  return {
    text: keep(current.text, false) ? current.text! : pickRecommendedModel(models, record),
    vision: keep(current.vision, true) ? current.vision! : pickVisionModel(models, record),
  };
}
