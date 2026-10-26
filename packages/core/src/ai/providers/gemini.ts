import type { AIProvider } from '../ai-provider.js';
import { DEFAULT_MODELS } from '../default-models.js';
import type { AICompletion, AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';

interface AdcAuth {
  accessToken: string;
  projectId: string;
}

let cachedAdc: { auth: AdcAuth; expiresAt: number } | null = null;

async function resolveAdcToken(): Promise<AdcAuth | null> {
  if (cachedAdc && Date.now() < cachedAdc.expiresAt) {
    return cachedAdc.auth;
  }
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const credPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      (process.platform === 'win32'
        ? path.join(
            process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
            'gcloud',
            'application_default_credentials.json'
          )
        : path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'));

    const raw = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(raw);
    const projectId =
      creds.quota_project_id ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      'qa-flow-tester-512310';

    if (creds.client_id && creds.client_secret && creds.refresh_token) {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          refresh_token: creds.refresh_token,
          grant_type: 'refresh_token',
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const auth = { accessToken: data.access_token, projectId };
        cachedAdc = { auth, expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000 };
        return auth;
      }
    }
  } catch {}
  return null;
}

export class GeminiProvider implements AIProvider {
  readonly providerType: AIProviderType = 'gemini';
  private apiKey: string;
  private defaultModel?: string;

  constructor(apiKey: string, defaultModel?: string) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async generateText(messages: AIMessage[], options: AICompletionOptions = {}): Promise<string> {
    return (await this.complete(messages, options)).text;
  }

  async complete(messages: AIMessage[], options: AICompletionOptions = {}): Promise<AICompletion> {
    const model = options.model || this.defaultModel || DEFAULT_MODELS.gemini;
    const isAdc = this.apiKey === 'adc' || this.apiKey.startsWith('ya29.');
    let endpoint: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (isAdc) {
      const adc = await resolveAdcToken();
      if (!adc && !this.apiKey.startsWith('ya29.')) {
        throw new Error(
          'No Google Application Default Credentials found. Please authenticate via gcloud auth application-default login.'
        );
      }
      const token = this.apiKey.startsWith('ya29.') ? this.apiKey : adc!.accessToken;
      const proj = adc?.projectId || process.env.GOOGLE_CLOUD_PROJECT || 'qa-flow-tester-512310';
      endpoint = `https://aiplatform.googleapis.com/v1/projects/${proj}/locations/global/publishers/google/models/${model}:generateContent`;
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Goog-User-Project'] = proj;
    } else {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    }

    const contents = messages.map((m) => {
      const parts: any[] = [{ text: m.content }];
      if (m.images && m.images.length > 0) {
        for (const img of m.images) {
          const match = img.match(/^data:(image\/[a-z]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

    const body: Record<string, any> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxTokens || 4096,
      },
    };

    if (options.responseFormat === 'json') {
      body.generationConfig.responseMimeType = 'application/json';
    }

    let res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // Fall back to Vertex AI ADC if standard API key has exhausted its quota (HTTP 402/403)
    if (!res.ok && (res.status === 402 || res.status === 403) && !isAdc) {
      const adc = await resolveAdcToken();
      if (adc) {
        const fallbackEndpoint = `https://aiplatform.googleapis.com/v1/projects/${adc.projectId}/locations/global/publishers/google/models/${model}:generateContent`;
        const fallbackHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adc.accessToken}`,
          'X-Goog-User-Project': adc.projectId,
        };
        const fallbackRes = await fetch(fallbackEndpoint, {
          method: 'POST',
          headers: fallbackHeaders,
          body: JSON.stringify(body),
        });
        if (fallbackRes.ok) {
          res = fallbackRes;
        }
      }
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as any;
    const candidate = data.candidates?.[0];
    const usage = data.usageMetadata;
    return {
      text: candidate?.content?.parts?.[0]?.text || '',
      finishReason: candidate?.finishReason === 'MAX_TOKENS' ? 'length' : candidate?.finishReason,
      model,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount ?? 0,
            completionTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
            reasoningTokens: usage.thoughtsTokenCount ?? undefined,
          }
        : undefined,
    };
  }
}
