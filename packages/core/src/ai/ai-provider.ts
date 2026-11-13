import type { AICompletion, AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';

export interface AIProvider {
  readonly providerType: AIProviderType;
  generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string>;
  /** The answer with its token use and why it ended. Providers that can't say only have generateText. */
  complete?(messages: AIMessage[], options?: AICompletionOptions): Promise<AICompletion>;
}

/** Asks the AI and returns its answer with whatever the provider can say about it. */
export async function completeWith(
  ai: AIProvider,
  messages: AIMessage[],
  options?: AICompletionOptions
): Promise<AICompletion> {
  if (ai.complete) return ai.complete(messages, options);
  return { text: await ai.generateText(messages, options) };
}

/** The model hit its output allowance before writing a usable answer (often all of it went on hidden reasoning). */
export class AITruncatedError extends Error {
  constructor(public model?: string) {
    super(`The AI model${model ? ` ${model}` : ''} stopped before it finished answering.`);
    this.name = 'AITruncatedError';
  }
}

export { DEFAULT_MODELS } from './default-models.js';
export { KeyResolver } from './key-resolver.js';
export { MockAIProvider } from './providers/mock.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { OpenAIProvider } from './providers/openai.js';
export { GeminiProvider, hasGoogleAdc, vertexModelFor, aiStudioKeyUnusable } from './providers/gemini.js';
export {
  listGeminiModels,
  rankGeminiModels,
  pickGeminiModel,
  workingGeminiModel,
  explainGeminiListError,
  type GeminiModelPick,
  type GeminiModelProbe,
} from './gemini-models.js';

import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { MockAIProvider } from './providers/mock.js';

export interface CreateAIProviderOptions {
  /** Gemini may use this computer's Google sign-in (ADC). Only a runner bound to this computer, or the CI check-up (ADR 0042). */
  allowAdc?: boolean;
}

export function createAIProvider(
  type: AIProviderType,
  apiKey: string,
  baseUrl?: string,
  defaultModel?: string,
  options: CreateAIProviderOptions = {}
): AIProvider {
  switch (type) {
    case 'anthropic':
      return new AnthropicProvider(apiKey, undefined, defaultModel);
    case 'openai':
    case 'openrouter':
      return new OpenAIProvider(apiKey, type === 'openrouter' ? 'https://openrouter.ai/api/v1' : baseUrl, defaultModel);
    case 'gemini':
      return new GeminiProvider(apiKey, defaultModel, { allowAdc: options.allowAdc === true });
    case 'mock':
      return new MockAIProvider();
    default:
      throw new Error(`Unknown AI provider "${String(type).slice(0, 40)}".`);
  }
}
