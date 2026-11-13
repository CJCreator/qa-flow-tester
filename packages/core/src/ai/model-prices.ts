import type { AIProviderType } from '@qa/types';

export interface ModelPrice {
  /** US dollars per million prompt (input) tokens. */
  prompt: number;
  /** US dollars per million completion (output) tokens. */
  completion: number;
}

/**
 * Standard list prices for the default models of the paid providers (`DEFAULT_MODELS`), read on 13 Nov 2026:
 * - anthropic: claude-sonnet-5-5, base input and output price, https://platform.claude.com/docs/en/about-claude/pricing
 * - openai: gpt-4o, Standard tier, flagship models table, https://developers.openai.com/api/docs/pricing
 * - gemini: gemini-3.8-flash, Paid Tier (Standard), per 1M tokens, https://aistudio.google.com/docs/pricing.
 *   That page says the price rises on 1 Jan 2027 to $1.50 input and $7.50 output: update this entry then.
 * A model not listed here has no known price: a dollar cap on it is refused (see `checkDollarCapPrice`).
 * OpenRouter is not in this table: the runner asks OpenRouter for its prices.
 */
const PRICES: Record<'anthropic' | 'openai' | 'gemini', Record<string, ModelPrice>> = {
  anthropic: {
    'claude-sonnet-5-5': { prompt: 2, completion: 10 },
  },
  openai: {
    'gpt-4o': { prompt: 2.5, completion: 10 },
  },
  gemini: {
    'gemini-3.8-flash': { prompt: 0.75, completion: 3.75 },
  },
};

/** The price per million tokens of a provider's model, or undefined when it is not known. */
export function knownPrice(provider: AIProviderType, model: string | undefined): ModelPrice | undefined {
  if (provider === 'mock') return { prompt: 0, completion: 0 };
  if (provider === 'openrouter' || !model) return undefined;
  return Object.prototype.hasOwnProperty.call(PRICES[provider], model) ? PRICES[provider][model] : undefined;
}
