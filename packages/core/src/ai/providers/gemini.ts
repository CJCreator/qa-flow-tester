import type { AIProvider } from '../ai-provider.js';
import { DEFAULT_MODELS } from '../default-models.js';
import { geminiModelMissing, workingGeminiModel } from '../gemini-models.js';
import { requestError, requestSignal } from '../timeout.js';
import type { AICompletion, AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';

interface AdcAuth {
  accessToken: string;
  projectId?: string;
}

let cachedAdc: { auth: AdcAuth; expiresAt: number } | null = null;

/** Where gcloud keeps Application Default Credentials, or GOOGLE_APPLICATION_CREDENTIALS when set. */
async function adcCredentialsPath(): Promise<string> {
  const path = await import('path');
  const os = await import('os');
  return (
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    (process.platform === 'win32'
      ? path.join(
          process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
          'gcloud',
          'application_default_credentials.json'
        )
      : path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'))
  );
}

/**
 * Whether this computer has Google sign-in for Gemini (Application Default Credentials, from
 * `gcloud auth application-default login`). Only the file's presence is checked; nothing is read or sent.
 */
export async function hasGoogleAdc(): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    await fs.access(await adcCredentialsPath());
    return true;
  } catch {
    return false;
  }
}

/** Shown when Google sign-in is used and no project is named. Fixed wording: it is shown to the person. */
export const NO_GOOGLE_PROJECT =
  'Google sign-in needs a Google Cloud project. Set GOOGLE_CLOUD_PROJECT, or run "gcloud auth application-default set-quota-project <project>".';

async function resolveAdcToken(signal?: AbortSignal): Promise<AdcAuth | null> {
  if (cachedAdc && Date.now() < cachedAdc.expiresAt) {
    return cachedAdc.auth;
  }
  try {
    const fs = await import('fs/promises');
    const credPath = await adcCredentialsPath();

    const raw = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(raw);
    const projectId: string | undefined =
      creds.quota_project_id || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || undefined;

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
        signal,
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const auth = { accessToken: data.access_token, projectId };
        cachedAdc = { auth, expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000 };
        return auth;
      }
    }
  } catch (err) {
    // A cancel or a passed deadline stops the call; other failures mean "no ADC".
    if (signal?.aborted) throw err;
  }
  return null;
}

/**
 * The Vertex AI model for a requested one. AI Studio's moving aliases (`gemini-flash-latest`, `gemini-pro-latest`
 * and the like) do not exist on Vertex AI, where they answer 404; they become the default model.
 */
export function vertexModelFor(model: string): string {
  return /-latest$/i.test(model) ? DEFAULT_MODELS.gemini : model;
}

/**
 * Whether an AI Studio answer means "this key cannot be used now", so Google sign-in (ADC, Vertex AI) is
 * tried instead: a rejected or expired key (400 API_KEY_INVALID, 401, 403), used-up prepaid credit (402) or
 * an exhausted quota (429).
 */
export function aiStudioKeyUnusable(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  return status === 400 && /API_KEY_INVALID|API key (not valid|expired)/i.test(body);
}

function vertexEndpoint(project: string, model: string): string {
  return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
}

/** One Vertex AI call; a 404 for a model other than the default is tried once more with the default. */
async function postVertex(
  token: string,
  project: string,
  model: string,
  body: string,
  signal: AbortSignal
): Promise<{ res: Response; model: string }> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Goog-User-Project': project,
  };
  const first = vertexModelFor(model);
  const res = await fetch(vertexEndpoint(project, first), { method: 'POST', headers, body, signal });
  if (res.status === 404 && first !== DEFAULT_MODELS.gemini) {
    const again = await fetch(vertexEndpoint(project, DEFAULT_MODELS.gemini), {
      method: 'POST',
      headers,
      body,
      signal,
    });
    return { res: again, model: DEFAULT_MODELS.gemini };
  }
  return { res, model: first };
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
    const { signal, release } = requestSignal(options);
    try {
      return await this.send(messages, options, signal);
    } catch (err) {
      throw requestError(err, signal, 'Gemini');
    } finally {
      release();
    }
  }

  private async send(messages: AIMessage[], options: AICompletionOptions, signal: AbortSignal): Promise<AICompletion> {
    const model = options.model || this.defaultModel || DEFAULT_MODELS.gemini;
    const isAdc = this.apiKey === 'adc' || this.apiKey.startsWith('ya29.');

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

    const payload = JSON.stringify(body);
    let res: Response;
    let usedModel = model;

    if (isAdc) {
      // Google sign-in (ADC) or a bearer token: Vertex AI.
      const adc = await resolveAdcToken(signal);
      if (!adc && !this.apiKey.startsWith('ya29.')) {
        throw new Error(
          'No Google Application Default Credentials found. Please authenticate via gcloud auth application-default login.'
        );
      }
      const token = this.apiKey.startsWith('ya29.') ? this.apiKey : adc!.accessToken;
      const proj = adc?.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
      if (!proj) throw new Error(NO_GOOGLE_PROJECT);
      ({ res, model: usedModel } = await postVertex(token, proj, model, payload, signal));
    } else {
      const postStudio = (m: string) =>
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: payload,
          signal,
        });
      res = await postStudio(model);
      if (!res.ok) {
        let studioText = await res.text();
        // The model is gone or never existed for this key (a retired name, a mistyped one): once, a model this
        // key can use, chosen from the key's own model list and remembered.
        if (geminiModelMissing(res.status, studioText)) {
          const working = await workingGeminiModel(this.apiKey, { signal });
          if (working && working !== model) {
            res = await postStudio(working);
            usedModel = working;
            studioText = res.ok ? '' : await res.text();
          }
        }
        if (!res.ok) {
          // The key cannot be used now (rejected, expired, out of credit or quota): Google sign-in (ADC) on
          // Vertex AI is tried when this computer has it. When that fails too, both answers are named.
          const adc = aiStudioKeyUnusable(res.status, studioText) ? await resolveAdcToken(signal) : null;
          if (!adc || !adc.projectId) throw new Error(`Gemini API error (${res.status}): ${studioText}`);
          const vertex = await postVertex(adc.accessToken, adc.projectId, usedModel, payload, signal);
          if (!vertex.res.ok) {
            const vertexText = await vertex.res.text();
            throw new Error(
              `Gemini API error (${res.status}): ${studioText} | Vertex AI with Google sign-in (${vertex.res.status}): ${vertexText}`
            );
          }
          res = vertex.res;
          usedModel = vertex.model;
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
      model: usedModel,
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
