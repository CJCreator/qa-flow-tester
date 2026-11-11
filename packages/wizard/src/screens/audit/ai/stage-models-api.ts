import { type AuditErrorCode } from '@qa/types/src/browser.js';
import { isAuditErrorCode, NOT_ANSWERING } from '../audit-call';

/**
 * The AI model per Website Audit task (REQ-039): the saved models, the defaults and the model each task calls
 * (`GET /api/audit-ai/models`) and the save (`PUT /api/audit-ai/models`). A save sends only the tasks that
 * changed; null puts a task back on its default model. Every refusal becomes a plain sentence safe to show
 * as-is; a 400 keeps its message per field.
 *
 * The stage list, the reply and body shapes, the route and the default slot of each stage are kept in step
 * with `AUDIT_AI_STAGES`, `AuditAiModelsReply`, `AuditAiModelsUpdate`, `AUDIT_AI_API` and `STAGE_MODEL_SLOT` of
 * packages/types/src/ai.ts. The wizard reaches @qa/types through browser.js only (T-211) and ai.ts is not part
 * of it, so a test compares both.
 */

export const AUDIT_AI_STAGES = ['assessment', 'documents', 'preview', 'rewrite'] as const;
export type AuditAiStage = (typeof AUDIT_AI_STAGES)[number];

export interface AuditAiModelsReply {
  models: Partial<Record<AuditAiStage, string>>;
  defaults: { text: string | null; vision: string | null };
  effective: Record<AuditAiStage, string | null>;
}

export interface AuditAiModelsUpdate {
  models: Partial<Record<AuditAiStage, string | null>>;
}

/** One message per field: a stage, or `models` when the body itself was refused. */
export type AuditAiModelsErrors = Partial<Record<string, string>>;

export const AUDIT_AI_MODELS_ROUTE = {
  get: { method: 'GET', path: '/api/audit-ai/models' },
  put: { method: 'PUT', path: '/api/audit-ai/models' },
} as const;

/** Which default a task without its own model uses: the assessment may read screenshots. */
export const STAGE_DEFAULT_SLOT: Readonly<Record<AuditAiStage, 'text' | 'vision'>> = {
  assessment: 'vision',
  documents: 'text',
  preview: 'text',
  rewrite: 'text',
};

/** Each task's name and what it writes, in the order the panel shows them. */
export const STAGE_TEXT: Readonly<Record<AuditAiStage, { label: string; hint: string }>> = {
  assessment: {
    label: 'Assessment notes and redesign or repair',
    hint: 'Notes on each page of a Website Audit, and whether the page needs a redesign or a repair. It may read screenshots, so its default is the vision model.',
  },
  documents: {
    label: 'Audit Documents and Pitch Glimpse',
    hint: 'The written notes in the Audit Documents and the Pitch Glimpse.',
  },
  preview: {
    label: 'Homepage preview',
    hint: 'The improved homepage preview.',
  },
  rewrite: {
    label: 'Section rewrite',
    hint: 'New copy for a Section you approved for a rewrite.',
  },
};

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ModelsOutcome =
  | { ok: true; value: AuditAiModelsReply }
  | { ok: false; message: string; code?: AuditErrorCode; errors?: AuditAiModelsErrors };

/** What the panel's fields hold, per task: a model id, or empty for the default. */
export type ModelsDraft = Record<AuditAiStage, string>;

/** The model a task uses when its field is empty; null when the AI Provider has no default set. */
export function defaultModel(reply: AuditAiModelsReply, stage: AuditAiStage): string | null {
  return reply.defaults[STAGE_DEFAULT_SLOT[stage]];
}

/** The fields as saved. */
export function draftFrom(reply: AuditAiModelsReply): ModelsDraft {
  const draft = {} as ModelsDraft;
  for (const stage of AUDIT_AI_STAGES) draft[stage] = reply.models[stage] ?? '';
  return draft;
}

/** The PUT body for the tasks whose field differs from what is saved: a cleared field sends null. */
export function modelsUpdate(reply: AuditAiModelsReply, draft: ModelsDraft): AuditAiModelsUpdate {
  const models: AuditAiModelsUpdate['models'] = {};
  for (const stage of AUDIT_AI_STAGES) {
    const saved = reply.models[stage] ?? '';
    const wanted = draft[stage].trim();
    if (wanted === saved) continue;
    models[stage] = wanted === '' ? null : wanted;
  }
  return { models };
}

export function isUpdateEmpty(update: AuditAiModelsUpdate): boolean {
  return Object.keys(update.models).length === 0;
}

export const FIX_FIELDS = 'Some fields need a change. See the message next to each one.';

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_FORBIDDEN: 'Only the tool user can change the AI models.',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function modelId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The reply with only well-formed values for the known tasks, or null when it is not a models reply. */
function acceptReply(body: unknown): AuditAiModelsReply | null {
  if (!isObject(body) || !isObject(body.models) || !isObject(body.defaults) || !isObject(body.effective)) return null;
  const reply: AuditAiModelsReply = {
    models: {},
    defaults: { text: modelId(body.defaults.text), vision: modelId(body.defaults.vision) },
    effective: { assessment: null, documents: null, preview: null, rewrite: null },
  };
  for (const stage of AUDIT_AI_STAGES) {
    const own = modelId(body.models[stage]);
    if (own !== null) reply.models[stage] = own;
    reply.effective[stage] = modelId(body.effective[stage]);
  }
  return reply;
}

/** The message per field of a 400, from `errors` or `fields`; only string messages are kept. */
function fieldErrors(refusal: Record<string, unknown>): AuditAiModelsErrors | undefined {
  const source = isObject(refusal.errors) ? refusal.errors : isObject(refusal.fields) ? refusal.fields : undefined;
  if (!source) return undefined;
  const errors: AuditAiModelsErrors = {};
  for (const [field, message] of Object.entries(source)) {
    if (typeof message === 'string' && message.trim() !== '') {
      Object.defineProperty(errors, field, {
        value: message.trim(),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

async function call(
  route: { method: string; path: string },
  init: RequestInit,
  fetchImpl: Fetch,
  fallback: string
): Promise<ModelsOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(route.path, { ...init, method: route.method });
  } catch {
    return { ok: false, message: NOT_ANSWERING };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (res.ok) {
    const value = acceptReply(body);
    return value === null ? { ok: false, message: fallback } : { ok: true, value };
  }
  const refusal = isObject(body) ? body : {};
  const code = isAuditErrorCode(refusal.code) ? refusal.code : undefined;
  if (code && REFUSALS[code]) return { ok: false, message: REFUSALS[code]!, code };
  const errors = res.status === 400 ? fieldErrors(refusal) : undefined;
  if (errors) return { ok: false, message: FIX_FIELDS, code, errors };
  const error = typeof refusal.error === 'string' && refusal.error.trim() !== '' ? refusal.error.trim() : fallback;
  return { ok: false, message: error, code };
}

/** `GET /api/audit-ai/models`: the saved models, the defaults and the model each task calls. */
export function loadModels(fetchImpl: Fetch = fetch): Promise<ModelsOutcome> {
  return call(AUDIT_AI_MODELS_ROUTE.get, {}, fetchImpl, 'The AI models could not be loaded. Try again.');
}

/** `PUT /api/audit-ai/models`: saves the tasks in `update` and returns the models now in effect. */
export function saveModels(update: AuditAiModelsUpdate, fetchImpl: Fetch = fetch): Promise<ModelsOutcome> {
  return call(
    AUDIT_AI_MODELS_ROUTE.put,
    { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) },
    fetchImpl,
    'The AI models could not be saved. Try again.'
  );
}

/** What the panel shows once the AI models are loaded. */
export interface ModelsState {
  reply: AuditAiModelsReply;
  draft: ModelsDraft;
  errors: AuditAiModelsErrors;
  message: { tone: 'pass' | 'fail'; text: string } | null;
}

/**
 * The panel after a save. Saved: the new reply, its fields and no messages per field. Refused: the reply and
 * every typed field stay as they were, with the runner's message next to each field it names.
 */
export function afterSave(state: ModelsState, outcome: ModelsOutcome): ModelsState {
  if (outcome.ok) {
    return {
      reply: outcome.value,
      draft: draftFrom(outcome.value),
      errors: {},
      message: { tone: 'pass', text: 'AI models saved. The next Website Audit uses them.' },
    };
  }
  return { ...state, errors: outcome.errors ?? {}, message: { tone: 'fail', text: outcome.message } };
}
