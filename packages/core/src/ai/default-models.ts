import type { AIProviderType } from '@qa/types';

/** The model each provider uses when none is chosen. OpenRouter's is free, so no request costs money by default. */
export const DEFAULT_MODELS: Record<Exclude<AIProviderType, 'mock'>, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o',
  gemini: 'gemini-3.8-flash',
  openrouter: 'openrouter/free',
};
