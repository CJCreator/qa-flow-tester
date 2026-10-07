import type { AIProvider } from '../ai-provider.js';
import { DEFAULT_MODELS } from '../default-models.js';
import type { AICompletion, AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';

export class OpenAIProvider implements AIProvider {
  readonly providerType: AIProviderType;
  private apiKey: string;
  private baseUrl: string;

  private defaultModel?: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1', defaultModel?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.providerType = baseUrl.includes('openrouter') ? 'openrouter' : 'openai';
    this.defaultModel = defaultModel;
  }

  async generateText(messages: AIMessage[], options: AICompletionOptions = {}): Promise<string> {
    return (await this.complete(messages, options)).text;
  }

  async complete(messages: AIMessage[], options: AICompletionOptions = {}): Promise<AICompletion> {
    const formattedMessages = messages.map((m) => {
      if (m.images && m.images.length > 0) {
        const contentParts: any[] = [{ type: 'text', text: m.content }];
        for (const img of m.images) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: img },
          });
        }
        return { role: m.role, content: contentParts };
      }
      return { role: m.role, content: m.content };
    });

    const body: Record<string, any> = {
      model:
        options.model ||
        this.defaultModel ||
        DEFAULT_MODELS[this.providerType === 'openrouter' ? 'openrouter' : 'openai'],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens || 4096,
      messages: formattedMessages,
    };

    if (options.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }
    // OpenRouter: think briefly and leave the reasoning out, so the output allowance goes to the answer.
    if (this.providerType === 'openrouter') {
      if (options.reasoning === 'low') {
        body.reasoning = { effort: 'low', exclude: true };
      } else if (!options.reasoning) {
        body.reasoning = { enabled: false };
      }
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // fetch only says "fetch failed"; the reason is in its cause.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(
        `Couldn’t reach the AI service: ${cause?.code || cause?.message || (err instanceof Error ? err.message : String(err))}`
      );
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI/OpenRouter API error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error(
        `The AI's answer was cut off at its length limit (${body.max_tokens} tokens) before it finished.`
      );
    }
    const usage = data.usage;
    return {
      text: choice?.message?.content || '',
      finishReason: choice?.finish_reason ?? choice?.native_finish_reason,
      model: data.model || body.model,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? undefined,
          }
        : undefined,
    };
  }
}
