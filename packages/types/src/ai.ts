export type AIProviderType = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'mock';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // base64 data URIs
}

/** What an AI request was for, so token use can be added up per stage. */
export type AIStage = 'planning' | 'repair' | 'journeys' | 'visual-review' | 'interpret' | 'other';

export interface AICompletionOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  responseFormat?: 'json' | 'text';
  /**
   * 'low' asks a reasoning model to think briefly and keep its reasoning out of the answer, so the
   * output allowance goes to the answer. Services that don't know the setting ignore it.
   */
  reasoning?: 'low';
  stage?: AIStage;
}

/** Tokens one AI request used, as the service reported them. */
export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  /** Part of `completionTokens` spent on hidden reasoning, when the service says. */
  reasoningTokens?: number;
}

/** One AI answer with what it cost and why it ended. */
export interface AICompletion {
  text: string;
  /** 'length' means the model hit its output allowance: the answer is cut off or empty. */
  finishReason?: string;
  /** The model that answered. */
  model?: string;
  usage?: AIUsage;
}
