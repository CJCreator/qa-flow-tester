/**
 * Probes the AI configuration before crawling starts (ADR 0042, T-81).
 * If no key is configured, returns 'no-key' immediately without sending any request.
 * If a key is present, sends one minimal request and returns 'ready' or the classified error.
 */
import type { AIProviderType, AuditAiStatus } from '@qa/types';
import { completeWith, createAIProvider, type AIProvider } from '../../ai/ai-provider.js';
import { classifyAiError } from './stage-ai.js';
import { resolveAuditAi, type AuditAiResolution, type ResolveAuditAiDeps } from './stage-ai.js';

export interface PreflightAuditAiOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  provider?: AIProviderType;
  createProvider?: (type: AIProviderType, apiKey: string) => AIProvider;
}

export type PreflightKeyResolver = (
  provider?: AIProviderType
) => Promise<{ provider: AIProviderType; apiKey: string } | null | undefined>;

export type PreflightAiResolver = () => Promise<AuditAiResolution>;

export type PreflightTarget =
  | PreflightKeyResolver
  | PreflightAiResolver
  | ResolveAuditAiDeps
  | Pick<ResolveAuditAiDeps, 'keys'>
  | { resolveKey?: PreflightKeyResolver; resolveAi?: PreflightAiResolver };

/**
 * Probes the AI setup: returns 'no-key' with no outbound call when unconfigured,
 * or sends a minimal ping request and maps the outcome to AuditAiStatus ('ready' or classified error).
 */
export async function preflightAuditAi(
  target: PreflightTarget,
  options?: PreflightAuditAiOptions
): Promise<AuditAiStatus> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const create = options?.createProvider ?? createAIProvider;

  // 1. Function target: can be resolveKey or resolveAi
  if (typeof target === 'function') {
    const result = await target(options?.provider);
    if (!result) return 'no-key';

    // Check if it's an AuditAiResolution ({ ok: boolean })
    if ('ok' in result) {
      if (!result.ok) return 'no-key';
      try {
        const answer = await result.ai.ask('assessment', [{ role: 'user', content: 'Say hi' }], {
          maxTokens: 5,
          timeoutMs,
          signal: options?.signal,
        });
        if (!answer.ok) return 'quota';
        return 'ready';
      } catch (err) {
        if (options?.signal?.aborted) throw err;
        return classifyAiError(err);
      }
    }

    // It's a ResolvedKeyInfo ({ provider, apiKey })
    if (!result.apiKey) return 'no-key';
    try {
      const provider = create(result.provider, result.apiKey);
      await completeWith(provider, [{ role: 'user', content: 'Say hi' }], {
        maxTokens: 5,
        timeoutMs,
        signal: options?.signal,
      });
      return 'ready';
    } catch (err) {
      if (options?.signal?.aborted) throw err;
      return classifyAiError(err);
    }
  }

  // 2. Object target
  if (typeof target === 'object' && target !== null) {
    if ('resolveAi' in target && typeof target.resolveAi === 'function') {
      const resolution = await target.resolveAi();
      if (!resolution.ok) return 'no-key';
      try {
        const answer = await resolution.ai.ask('assessment', [{ role: 'user', content: 'Say hi' }], {
          maxTokens: 5,
          timeoutMs,
          signal: options?.signal,
        });
        if (!answer.ok) return 'quota';
        return 'ready';
      } catch (err) {
        if (options?.signal?.aborted) throw err;
        return classifyAiError(err);
      }
    }

    if ('resolveKey' in target && typeof target.resolveKey === 'function') {
      const key = await target.resolveKey(options?.provider);
      if (!key || !key.apiKey) return 'no-key';
      try {
        const provider = create(key.provider, key.apiKey);
        await completeWith(provider, [{ role: 'user', content: 'Say hi' }], {
          maxTokens: 5,
          timeoutMs,
          signal: options?.signal,
        });
        return 'ready';
      } catch (err) {
        if (options?.signal?.aborted) throw err;
        return classifyAiError(err);
      }
    }

    // Full ResolveAuditAiDeps
    const resolution = await resolveAuditAi({
      setup: { provider: options?.provider },
      keys: (target as any).keys ?? target,
      createProvider: options?.createProvider,
      ...target,
    });
    if (!resolution.ok) return 'no-key';
    try {
      const answer = await resolution.ai.ask('assessment', [{ role: 'user', content: 'Say hi' }], {
        maxTokens: 5,
        timeoutMs,
        signal: options?.signal,
      });
      if (!answer.ok) return 'quota';
      return 'ready';
    } catch (err) {
      if (options?.signal?.aborted) throw err;
      return classifyAiError(err);
    }
  }

  return 'no-key';
}
