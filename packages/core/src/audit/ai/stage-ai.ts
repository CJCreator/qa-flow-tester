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
  const key = await deps.keys.resolveKey(deps.setup.provider);
  if (!key || !key.apiKey) return { ok: false, reason: 'no-ai-key' };

  const providerType = key.provider;
  const provider = (deps.createProvider ?? createAIProvider)(providerType, key.apiKey);
  // Saved model ids belong to the saved provider: a key found for another provider uses its own defaults.
  const sameProvider = !deps.setup.provider || deps.setup.provider === providerType;
  const models = sameProvider ? deps.models : undefined;
  const defaults = sameProvider ? { text: deps.setup.text, vision: deps.setup.vision } : {};

  return {
    ok: true,
    ai: {
      provider: providerType,
      async ask(stage, messages, options = {}) {
        stopIfAborted(options.signal);
        if (deps.budget && !deps.budget.take()) return { ok: false, reason: 'budget-spent' };
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
        return { ok: true, completion, model, claimWords: findClaimWords(completion.text) };
      },
    },
  };
}
