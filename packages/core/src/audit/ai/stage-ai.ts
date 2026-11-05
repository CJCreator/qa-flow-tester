/**
 * The Website Audit's AI, by stage (REQ-011, REQ-039). The tool user brings their own key (BYOK): no key,
 * no AI step, and nothing is created or sent. With a key, every request goes to the tool user's AI Provider
 * with the model chosen for its stage (or the stage slot's default), the caller's abort signal and timeout,
 * and counts against an optional AI Request Budget. Every answer is checked for claim words (ADR 0018).
 */
import type {
  AICompletion,
  AICompletionOptions,
  AIMessage,
  AIProviderType,
  AuditAiModels,
  AuditAiStage,
} from '@qa/types';
import { modelForStage } from '@qa/types';
import { completeWith, createAIProvider, type AIProvider } from '../../ai/ai-provider.js';
import type { KeyResolver } from '../../ai/key-resolver.js';
import { stopIfAborted } from '../../abort.js';
import { findClaimWords } from './claim-words.js';

/** The saved AI setup, as the runner's AI settings hold it (not secret). */
export interface AuditAiSetup {
  provider?: AIProviderType;
  text?: string | null;
  vision?: string | null;
}

/** How many AI requests the audit may still make. `take` uses one; false when none is left. */
export interface AuditAiRequestBudget {
  take(): boolean;
}

/** A budget of `requests` AI requests, counted in memory. */
export function auditAiRequestBudget(requests: number): AuditAiRequestBudget {
  let left = Math.max(0, Math.floor(requests));
  return {
    take() {
      if (left <= 0) return false;
      left -= 1;
      return true;
    },
  };
}

export interface ResolveAuditAiDeps {
  setup: AuditAiSetup;
  /** KeyResolver, SessionKeyResolver, or anything with the same `resolveKey`. */
  keys: Pick<KeyResolver, 'resolveKey'>;
  /** The models saved per audit stage. */
  models?: AuditAiModels;
  budget?: AuditAiRequestBudget;
  /** Seam for tests; defaults to createAIProvider. */
  createProvider?: (type: AIProviderType, apiKey: string) => AIProvider;
  /**
   * Whether this computer has Google sign-in for Gemini (ADC); the runner passes `hasGoogleAdc`. When set, no
   * key at all, or a key the provider refuses, falls back to Gemini through Vertex AI (ADR 0042). Unset: no
   * fallback.
   */
  hasAdc?: () => Promise<boolean>;
}

/**
 * The provider refused the key itself: rejected, expired, no permission or no credit (401, 402, 403). Not a
 * timeout, a 429 rate limit or a bad answer, which another key would not fix.
 */
export function isKeyRefused(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return (
    /\((401|402|403)\)/.test(message) ||
    /api key (expired|invalid|not valid)|credits? (are )?depleted|insufficient (credits|balance|quota)|billing/i.test(
      message
    )
  );
}

export interface AuditAiAskOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
  reasoning?: 'low';
}

export type AuditAiAnswer =
  | {
      ok: true;
      completion: AICompletion;
      /** The model asked for; null when the provider's own default was used. */
      model: string | null;
      /** ADR 0018 claim words in the answer; the caller must not show an answer that has any. */
      claimWords: string[];
    }
  | { ok: false; reason: 'budget-spent' };

export interface AuditAi {
  readonly provider: AIProviderType;
  ask(stage: AuditAiStage, messages: AIMessage[], options?: AuditAiAskOptions): Promise<AuditAiAnswer>;
}

export type AuditAiResolution = { ok: true; ai: AuditAi } | { ok: false; reason: 'no-ai-key' };

export async function resolveAuditAi(deps: ResolveAuditAiDeps): Promise<AuditAiResolution> {
  const create = deps.createProvider ?? createAIProvider;
  const hasAdc = deps.hasAdc;
  const key = await deps.keys.resolveKey(deps.setup.provider);
  // No saved key anywhere, but this computer has Google sign-in: Gemini through Vertex AI (ADR 0042).
  if (!key || !key.apiKey) {
    if (!hasAdc || !(await hasAdc())) return { ok: false, reason: 'no-ai-key' };
    return { ok: true, ai: auditAiOn(deps, create('gemini', 'adc'), 'gemini', true) };
  }
  return { ok: true, ai: auditAiOn(deps, create(key.provider, key.apiKey), key.provider, false, hasAdc) };
}

/**
 * The audit's AI on one provider. When that provider refuses its key (expired, rejected, out of credit) and
 * this computer has Google sign-in, the request is made again on Gemini through Vertex AI, and the rest of the
 * audit stays there. Gemini itself is not switched: it already tries Google sign-in when its key is refused.
 */
function auditAiOn(
  deps: ResolveAuditAiDeps,
  first: AIProvider,
  firstType: AIProviderType,
  onAdc: boolean,
  hasAdc?: () => Promise<boolean>
): AuditAi {
  const create = deps.createProvider ?? createAIProvider;
  let provider = first;
  let providerType = firstType;
  let switched = onAdc;
  // Requests run in parallel (ADR 0043): the switch is made once, and every request that was sent on the old
  // provider before it waits for the same decision.
  let switching: Promise<boolean> | null = null;
  const switchToAdc = (): Promise<boolean> => {
    switching ??= (async () => {
      if (!hasAdc || !(await hasAdc())) return false;
      provider = create('gemini', 'adc');
      providerType = 'gemini';
      switched = true;
      return true;
    })();
    return switching;
  };

  /** Saved model ids belong to the saved provider: another provider, or Google sign-in, uses its own defaults. */
  const savedFor = (type: AIProviderType, adc: boolean) => {
    const same = !adc && (!deps.setup.provider || deps.setup.provider === type);
    return {
      models: same ? deps.models : undefined,
      defaults: same ? { text: deps.setup.text, vision: deps.setup.vision } : {},
    };
  };

  const send = async (stage: AuditAiStage, messages: AIMessage[], options: AuditAiAskOptions) => {
    const { models, defaults } = savedFor(providerType, switched);
    const model = modelForStage(stage, models, defaults);
    const request: AICompletionOptions = {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      responseFormat: options.responseFormat,
      reasoning: options.reasoning,
      model: model ?? undefined,
      stage,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    };
    const completion = await completeWith(provider, messages, request);
    return { completion, model };
  };

  return {
    get provider() {
      return providerType;
    },
    async ask(stage, messages, options = {}) {
      stopIfAborted(options.signal);
      if (deps.budget && !deps.budget.take()) return { ok: false, reason: 'budget-spent' };
      const sentWith = provider;
      const sentAs = providerType;
      try {
        const { completion, model } = await send(stage, messages, options);
        return { ok: true, completion, model, claimWords: findClaimWords(completion.text) };
      } catch (err) {
        // Sent on the old provider while another request switched to Google sign-in: try the one in use now.
        // Otherwise switch only for a refused key, on a provider other than Gemini.
        const movedOn = provider !== sentWith;
        if (!movedOn) {
          const canSwitch = sentAs !== 'gemini' && hasAdc !== undefined && isKeyRefused(err);
          if (!canSwitch || !(await switchToAdc())) throw err;
        }
        stopIfAborted(options.signal);
        const { completion, model } = await send(stage, messages, options);
        return { ok: true, completion, model, claimWords: findClaimWords(completion.text) };
      }
    },
  };
}
