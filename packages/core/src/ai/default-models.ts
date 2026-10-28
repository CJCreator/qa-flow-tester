import type { AIProviderType } from '@qa/types';

/** The model each provider uses when none is chosen. OpenRouter's is free, so no request costs money by default. */
export const DEFAULT_MODELS: Record<Exclude<AIProviderType, 'mock'>, string> = {
  gemini: 'gemini-2.5-flash',
  openrouter: 'openrouter/free',
  anthropic: 'claude-3-5-haiku',
  openai: 'gpt-4o-mini',
};
