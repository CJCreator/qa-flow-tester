import type { AIProviderType, AIRequestBudget } from '@qa/types';

/** Token use per stage, added together. */
export function addTokens(a: AIRequestBudget['tokens'], b: AIRequestBudget['tokens']): AIRequestBudget['tokens'] {
  if (!b || Object.keys(b).length === 0) return a;
  const sum: NonNullable<AIRequestBudget['tokens']> = JSON.parse(JSON.stringify(a ?? {}));
  for (const [stage, u] of Object.entries(b) as Array<
    [keyof typeof sum, NonNullable<(typeof sum)[keyof typeof sum]>]
  >) {
    const s = (sum[stage] ??= { requests: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, truncated: 0 });
    s.requests += u.requests;
    s.promptTokens += u.promptTokens;
    s.completionTokens += u.completionTokens;
    s.reasoningTokens += u.reasoningTokens;
    s.truncated += u.truncated;
  }
  return sum;
}

/** The AI settings kept beside the key (not secret), so every browser gets the same setup. */
export interface AiSettings {
  provider?: AIProviderType;
  text?: string | null;
  vision?: string | null;
  /** The person picked the models in Settings: they're kept while available, even when they struggle. */
  chosenBy?: 'person';
  chosenAt?: string;
}

/** The AI services a key can be added for. OpenRouter's free models cost nothing; the others are paid. */
export const AI_PROVIDERS: Array<{ id: AIProviderType; name: string; free: boolean }> = [
  { id: 'openrouter', name: 'OpenRouter (free models)', free: true },
  { id: 'anthropic', name: 'Anthropic (Claude)', free: false },
  { id: 'openai', name: 'OpenAI', free: false },
  { id: 'gemini', name: 'Google Gemini', free: false },
];
/** AI requests the visual review of a finished run may use: part of the AI Request Budget estimate. */
export const VISUAL_REVIEW_CALLS = 20;
/** Pages explored on another host the person includes from the review. */
export const INCLUDED_HOST_PAGES = 30;
/** Pages explored for a sign-in added from the review. */
export const SIGNED_IN_PAGES = 60;
