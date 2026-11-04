import type { AuditEndpoint } from './website-audit.js';

export type AIProviderType ='anthropic' | 'openai' | 'gemini' | 'openrouter' | 'mock';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // base64 data URIs
}

/**
 * What an AI request was for, so token use can be added up per stage and each stage can have its own
 * model (REQ-039). The Website Audit stages (Q-29): `assessment` (notes on the six areas and redesign or
 * repair), `documents` (Audit Document notes and the Pitch Glimpse), `preview` (the improved homepage) and
 * `rewrite` (new copy for an approved Section).
 */
export const AI_STAGES = [
  'planning',
  'repair',
  'journeys',
  'visual-review',
  'interpret',
  'assessment',
  'documents',
  'preview',
  'rewrite',
  'other',
] as const;

export type AIStage = (typeof AI_STAGES)[number];

/**
 * The model the person chose for each AI stage, by model id (REQ-039). A stage left out uses the default
 * model of its slot (`STAGE_MODEL_SLOT`): the text model, or the vision model.
 */
export type ModelsByStage = Partial<Record<AIStage, string>>;

/**
 * Which default a stage without its own model falls back to. Stages that may send screenshots use the
 * vision model: a vision model also reads text, a text model may refuse images.
 */
export const STAGE_MODEL_SLOT: Readonly<Record<AIStage, 'text' | 'vision'>> = {
  planning: 'text',
  repair: 'text',
  journeys: 'text',
  'visual-review': 'vision',
  interpret: 'text',
  assessment: 'vision',
  documents: 'text',
  preview: 'text',
  rewrite: 'text',
  other: 'text',
};

/** The model a stage calls: its own when set, else its slot's default; null when neither is set. */
export function modelForStage(
  stage: AIStage,
  models: ModelsByStage | undefined,
  defaults: { text?: string | null; vision?: string | null }
): string | null {
  const own = models?.[stage];
  if (typeof own === 'string' && own.trim() !== '') return own;
  const fallback = STAGE_MODEL_SLOT[stage] === 'vision' ? defaults.vision : defaults.text;
  return typeof fallback === 'string' && fallback.trim() !== '' ? fallback : null;
}

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
  /** Stops the request when aborted (RISK-005): a cancelled audit stops spending the AI key. */
  signal?: AbortSignal;
  /** Gives up after this many milliseconds. Providers combine it with `signal`. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------------------------------
// Website Audit AI models (REQ-039, Q-29): one model setting per AI feature
// ---------------------------------------------------------------------------------------------------

/** The AI stages of a Website Audit, each with its own model setting. Every one is in `AI_STAGES`. */
export const AUDIT_AI_STAGES = ['assessment', 'documents', 'preview', 'rewrite'] as const satisfies readonly AIStage[];

export type AuditAiStage = (typeof AUDIT_AI_STAGES)[number];

/** The model the tool user chose per audit stage; a stage left out uses its slot's default. */
export type AuditAiModels = Partial<Record<AuditAiStage, string>>;

/** `GET /api/audit-ai/models`: the chosen models, the defaults and the model each stage will call. */
export interface AuditAiModelsReply {
  models: AuditAiModels;
  defaults: { text: string | null; vision: string | null };
  effective: Record<AuditAiStage, string | null>;
}

/** `PUT /api/audit-ai/models` body. `null` puts the stage back on its default. */
export interface AuditAiModelsUpdate {
  models: Partial<Record<AuditAiStage, string | null>>;
}

export type AuditAiModelsErrors = Partial<Record<string, string>>;

export type AuditAiModelsCheck =
  | { ok: true; value: AuditAiModelsUpdate }
  | { ok: false; errors: AuditAiModelsErrors };

/** Longest model id accepted. */
export const AUDIT_AI_MODEL_ID_MAX = 200;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function isAuditAiStage(value: unknown): value is AuditAiStage {
  return typeof value === 'string' && (AUDIT_AI_STAGES as readonly string[]).includes(value);
}

/**
 * Checks a `PUT /api/audit-ai/models` body. Per audit stage: a model id (a non-empty string of at most
 * 200 characters without control characters) or null. Unknown stages are refused. One message per field;
 * `errors.models` when the body itself is malformed.
 */
export function validateAuditAiModelsUpdate(input: unknown): AuditAiModelsCheck {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(input) || !isObject(input.models)) {
    return { ok: false, errors: { models: 'Send the models as an object of stage to model id.' } };
  }
  const errors: AuditAiModelsErrors = {};
  const models: Partial<Record<AuditAiStage, string | null>> = {};
  for (const [stage, raw] of Object.entries(input.models)) {
    if (!isAuditAiStage(stage)) {
      // defineProperty: a `__proto__` key from JSON.parse stays a plain field, never a prototype change.
      Object.defineProperty(errors, stage, {
        value: `Unknown AI stage. Pick one of: ${AUDIT_AI_STAGES.join(', ')}.`,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      continue;
    }
    if (raw === null) {
      models[stage] = null;
      continue;
    }
    if (typeof raw !== 'string' || raw.trim() === '') {
      errors[stage] = 'Enter a model id, or null to use the default model.';
    } else if (raw.length > AUDIT_AI_MODEL_ID_MAX) {
      errors[stage] = `Use a model id of at most ${AUDIT_AI_MODEL_ID_MAX} characters.`;
    } else if (CONTROL_CHARACTERS.test(raw)) {
      errors[stage] = 'The model id must not contain control characters.';
    } else {
      models[stage] = raw.trim();
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { models } };
}

/** The audit AI model routes. Owner only: they choose what spends the AI key. */
export const AUDIT_AI_API = {
  getModels: { method: 'GET', path: '/api/audit-ai/models', replies: 'json', access: 'owner' },
  putModels: { method: 'PUT', path: '/api/audit-ai/models', replies: 'json', access: 'owner' },
} as const satisfies Record<string, AuditEndpoint>;

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
