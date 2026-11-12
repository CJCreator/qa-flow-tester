import type { AIStage, AIStageUsage } from '@qa/types';

export type StageTokens = Partial<Record<AIStage, AIStageUsage>>;

/**
 * Token use per stage, added together. Adding nothing returns `a` as it is (possibly undefined); otherwise a new
 * object, so a saved report or plan is never changed through an alias.
 */
export function addTokens(a?: StageTokens, b?: StageTokens): StageTokens | undefined {
  if (!b || Object.keys(b).length === 0) return a;
  const sum: StageTokens = {};
  for (const [stage, usage] of Object.entries(a ?? {}) as Array<[AIStage, AIStageUsage]>) {
    sum[stage] = { ...usage };
  }
  for (const [stage, usage] of Object.entries(b) as Array<[AIStage, AIStageUsage]>) {
    const s = (sum[stage] ??= {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      truncated: 0,
    });
    s.requests += usage.requests;
    s.promptTokens += usage.promptTokens;
    s.completionTokens += usage.completionTokens;
    s.reasoningTokens += usage.reasoningTokens;
    s.truncated += usage.truncated;
  }
  return sum;
}
