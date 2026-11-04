/**
 * Audit AI routes (REQ-039, REQ-030, REQ-011): the model per audit stage, and the Section rewrite
 * (list, approve, run, accept). Everything the routes touch is injected, so this module imports only
 * @qa/types and the route helpers; BE-190 registers the rows with the real stores.
 *
 * Replies never carry the AI key or a provider's error text: refusals use AuditErrorReply codes and fixed
 * wording, and an unexpected failure answers a plain 500.
 */
import type http from 'http';
import {
  AUDIT_AI_API,
  AUDIT_AI_STAGES,
  AUDIT_API,
  isDocumentLanguage,
  modelForStage,
  validateAuditAiModelsUpdate,
  type AuditAiModels,
  type AuditAiModelsErrors,
  type AuditAiModelsReply,
  type AuditErrorCode,
  type AuditVersion,
  type DocumentLanguage,
  type EditOverlay,
  type OverlapFlag,
  type PageContent,
  type RewriteAcceptReply,
  type RewriteListReply,
  type RewriteReply,
  type RewriteState,
  type SectionEdit,
} from '@qa/types';
import type { Route, RouteContext } from './route.js';
import { readJsonBody, sendJson } from './body.js';

/** Largest models body (characters): four stages of at most 200 characters each fit many times over. */
export const AUDIT_AI_MODELS_BODY_MAX = 20_000;
/** Largest rewrite body (characters): 20 000 characters of copy, even fully escaped, fit. */
export const AUDIT_REWRITE_BODY_MAX = 200_000;
/** Longest urlPath / sectionId the routes pass on; the rewrite store checks their exact form. */
const FIELD_MAX = 2_048;

// ---------------------------------------------------------------------------------------------------
// Injected dependencies

export interface RewriteSectionRef {
  urlPath: string;
  sectionId: string;
}

/** A refusal from the rewrite operations (BE-408's RewriteFailure). */
export type RewriteOpFailure =
  | {
      ok: false;
      code: 'ERR_INVALID_REQUEST' | 'ERR_NOT_APPROVED' | 'ERR_NO_AI_KEY' | 'ERR_OVERLAP';
      message: string;
      fields?: Record<string, string>;
      overlaps?: OverlapFlag[];
    }
  | { ok: false; code: 'ai-failed'; message: string; problem?: string };

export type RewriteOpResult = { ok: true; rewrite: RewriteState } | RewriteOpFailure;
export type RewriteAcceptOpResult = { ok: true; rewrite: RewriteState; edit: SectionEdit } | RewriteOpFailure;

/**
 * The rewrite operations of one audit version (BE-408's RewriteStore). `run` is already bound to the
 * tool user's AI (the wiring adds `resolveAi`); property syntax keeps a bare RewriteStore, whose `run`
 * needs `resolveAi`, from being passed in by mistake.
 */
export interface AuditRewriteOps {
  list: () => Promise<RewriteState[]>;
  approve: (section: RewriteSectionRef) => Promise<RewriteOpResult>;
  run: (
    input: RewriteSectionRef & { language: DocumentLanguage },
    deps: { content: PageContent | null; overlapWords?: number; signal?: AbortSignal }
  ) => Promise<RewriteOpResult>;
  accept: (
    input: RewriteSectionRef & { text: string },
    deps: { content: PageContent | null; overlapWords?: number }
  ) => Promise<RewriteAcceptOpResult>;
}

type MaybePromise<T> = T | Promise<T>;

export interface AuditAiRouteDeps {
  /** The models saved per audit stage. */
  readModels: () => MaybePromise<AuditAiModels>;
  writeModels: (models: AuditAiModels) => MaybePromise<void>;
  /** The saved text and vision models (the slot defaults). */
  aiDefaults: () => MaybePromise<{ text?: string | null; vision?: string | null }>;
  /** Is an AI key saved? Only the yes/no: the key itself never reaches these routes. */
  hasAiKey: () => MaybePromise<boolean>;
  /** The audit's version (`version` absent: the latest); null when the audit or version does not exist. */
  findVersion: (
    auditId: string,
    version: number | undefined
  ) => MaybePromise<Pick<AuditVersion, 'version' | 'status' | 'language'> | null>;
  /** The rewrite operations of one existing audit version. */
  rewrites: (auditId: string, version: number) => MaybePromise<AuditRewriteOps>;
  /** The recorded Page Content holding the Section; null when the page is not recorded. */
  loadSection: (
    auditId: string,
    version: number,
    urlPath: string,
    sectionId: string
  ) => MaybePromise<PageContent | null>;
  /** Puts accepted copy into the version's edit overlay and returns the overlay. */
  applyRewriteEdit: (auditId: string, version: number, edit: SectionEdit) => MaybePromise<EditOverlay>;
  /** AuditSettings.rewriteOverlapWords. */
  overlapWords: () => MaybePromise<number>;
}

// ---------------------------------------------------------------------------------------------------
// Replies

/** The error reply. `code` is an AuditErrorCode, or ERR_AI_FAILED when the AI gave no usable copy. */
interface AuditAiErrorReply {
  error: string;
  code: AuditErrorCode | 'ERR_AI_FAILED';
  /** ERR_INVALID_REQUEST: a message per field (per stage for the models). */
  errors?: AuditAiModelsErrors;
  /** ERR_OVERLAP: the runs the copy still shares with the original. */
  overlaps?: OverlapFlag[];
}

function refuse(
  res: http.ServerResponse,
  status: number,
  code: AuditAiErrorReply['code'],
  error: string,
  extra: Pick<AuditAiErrorReply, 'errors' | 'overlaps'> = {}
): void {
  const body: AuditAiErrorReply = { error, code, ...extra };
  sendJson(res, status, body);
}

const INVALID = 'Some values are not valid.';
const NOT_FOUND = 'This audit or version does not exist.';
const RUNNING = 'This version is still running. Wait until it finishes.';
const NOT_APPROVED = 'Approve this Section for a rewrite first.';
const NO_AI_KEY = 'Add an AI key to write new copy for this Section.';
const FAILED = 'Something went wrong. Try again.';

/** Maps a rewrite refusal to its reply, copying only fixed fields (never a provider's text). */
function refuseRewrite(res: http.ServerResponse, failure: RewriteOpFailure): void {
  switch (failure.code) {
    case 'ERR_INVALID_REQUEST':
      return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID, failure.fields ? { errors: { ...failure.fields } } : {});
    case 'ERR_NOT_APPROVED':
      return refuse(res, 409, 'ERR_NOT_APPROVED', NOT_APPROVED);
    case 'ERR_NO_AI_KEY':
      return refuse(res, 409, 'ERR_NO_AI_KEY', NO_AI_KEY);
    case 'ERR_OVERLAP':
      return refuse(
        res,
        422,
        'ERR_OVERLAP',
        'This copy still repeats phrases from the original. Reword the marked phrases.',
        { overlaps: (failure.overlaps ?? []).map((o) => ({ words: o.words, wordCount: o.wordCount })) }
      );
    default:
      // 'ai-failed': the store's message is fixed wording (budget, failure, claim words), no provider text.
      return refuse(res, 502, 'ERR_AI_FAILED', typeof failure.message === 'string' ? failure.message : FAILED);
  }
}

// ---------------------------------------------------------------------------------------------------
// Input

class BadBody extends Error {}

async function readBody(req: http.IncomingMessage, maxChars: number): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await readJsonBody<unknown>(req, maxChars);
  } catch {
    throw new BadBody();
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new BadBody();
  return body as Record<string, unknown>;
}

/** A version number from a body or query: undefined when absent, null when present but not 1, 2, 3… */
function versionOf(raw: unknown): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : raw;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function sectionField(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' && raw.length <= FIELD_MAX ? raw : undefined;
}

interface SectionRequest extends RewriteSectionRef {
  version: number | undefined;
}

/** urlPath, sectionId and version from a rewrite body, or the field messages. */
function sectionRequest(
  body: Record<string, unknown>
): { ok: true; value: SectionRequest } | { ok: false; errors: AuditAiModelsErrors } {
  const errors: AuditAiModelsErrors = {};
  const urlPath = sectionField(body.urlPath);
  const sectionId = sectionField(body.sectionId);
  const version = versionOf(body.version);
  if (!urlPath) errors.urlPath = 'must be the page path, such as /about.';
  if (!sectionId) errors.sectionId = 'must be a Section id such as s1.';
  if (version === null) errors.version = 'must be a version number: 1, 2, 3…';
  if (!urlPath || !sectionId || version === null) return { ok: false, errors };
  return { ok: true, value: { urlPath, sectionId, version } };
}

/** The audit id from the path; the route table already checked it against AUDIT_ID_PATTERN. */
function auditIdOf(ctx: RouteContext): string | undefined {
  const id = ctx.params?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** A signal that aborts when the caller goes away before the reply is sent: no AI spend for nobody. */
function callerSignal(
  req: http.IncomingMessage,
  res: http.ServerResponse
): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('close', onClose);
  res.once('close', onClose);
  return {
    signal: controller.signal,
    release: () => {
      req.off('close', onClose);
      res.off('close', onClose);
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Routes

export function createAuditAiRoutes(deps: AuditAiRouteDeps): Route[] {
  async function modelsReply(): Promise<AuditAiModelsReply> {
    const saved = (await deps.readModels()) ?? {};
    const raw = await deps.aiDefaults();
    const defaults = {
      text: typeof raw?.text === 'string' && raw.text.trim() !== '' ? raw.text : null,
      vision: typeof raw?.vision === 'string' && raw.vision.trim() !== '' ? raw.vision : null,
    };
    const models: AuditAiModels = {};
    const effective = {} as AuditAiModelsReply['effective'];
    for (const stage of AUDIT_AI_STAGES) {
      const own = saved[stage];
      if (typeof own === 'string' && own.trim() !== '') models[stage] = own;
      effective[stage] = modelForStage(stage, models, defaults);
    }
    return { models, defaults, effective };
  }

  /** Runs a handler; bad bodies answer 400, anything unexpected a plain 500 with no internals. */
  function guarded(handler: (ctx: RouteContext) => Promise<void>): (ctx: RouteContext) => Promise<void> {
    return async (ctx) => {
      try {
        await handler(ctx);
      } catch (err) {
        if (ctx.res.headersSent || ctx.res.writableEnded || ctx.res.destroyed) return;
        if (err instanceof BadBody) {
          refuse(ctx.res, 400, 'ERR_INVALID_REQUEST', 'Send a JSON object no larger than the limit.');
          return;
        }
        sendJson(ctx.res, 500, { error: FAILED });
      }
    };
  }

  /** The existing version, or a 404 / 400 already sent. */
  async function versionFor(
    ctx: RouteContext,
    version: number | undefined
  ): Promise<{ auditId: string; version: Pick<AuditVersion, 'version' | 'status' | 'language'> } | undefined> {
    const auditId = auditIdOf(ctx);
    if (!auditId) {
      refuse(ctx.res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
      return undefined;
    }
    const found = await deps.findVersion(auditId, version);
    if (!found) {
      refuse(ctx.res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FOUND);
      return undefined;
    }
    return { auditId, version: found };
  }

  /** Body, section fields and a finished version for the approve/run/accept rows. */
  async function sectionTarget(ctx: RouteContext): Promise<
    | {
        body: Record<string, unknown>;
        auditId: string;
        version: number;
        language: DocumentLanguage;
        section: RewriteSectionRef;
      }
    | undefined
  > {
    const body = await readBody(ctx.req, AUDIT_REWRITE_BODY_MAX);
    const check = sectionRequest(body);
    if (!check.ok) {
      refuse(ctx.res, 400, 'ERR_INVALID_REQUEST', INVALID, { errors: check.errors });
      return undefined;
    }
    const parsed = check.value;
    const found = await versionFor(ctx, parsed.version);
    if (!found) return undefined;
    if (found.version.status === 'running') {
      refuse(ctx.res, 409, 'ERR_AUDIT_RUNNING', RUNNING);
      return undefined;
    }
    return {
      body,
      auditId: found.auditId,
      version: found.version.version,
      language: isDocumentLanguage(found.version.language) ? found.version.language : 'en',
      section: { urlPath: parsed.urlPath, sectionId: parsed.sectionId },
    };
  }

  return [
    {
      method: AUDIT_AI_API.getModels.method,
      path: AUDIT_AI_API.getModels.path,
      access: AUDIT_AI_API.getModels.access,
      handle: guarded(async ({ res }) => {
        sendJson(res, 200, await modelsReply());
      }),
    },
    {
      method: AUDIT_AI_API.putModels.method,
      path: AUDIT_AI_API.putModels.path,
      access: AUDIT_AI_API.putModels.access,
      handle: guarded(async ({ req, res }) => {
        const body = await readBody(req, AUDIT_AI_MODELS_BODY_MAX);
        const check = validateAuditAiModelsUpdate(body);
        if (!check.ok) {
          refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID, { errors: check.errors });
          return;
        }
        const saved = (await deps.readModels()) ?? {};
        const next: AuditAiModels = {};
        // Only known stages are read or written: nothing else from the body reaches the store.
        for (const stage of AUDIT_AI_STAGES) {
          const change = Object.prototype.hasOwnProperty.call(check.value.models, stage)
            ? check.value.models[stage]
            : undefined;
          if (change === null) continue;
          const value = typeof change === 'string' ? change : saved[stage];
          if (typeof value === 'string' && value.trim() !== '') next[stage] = value;
        }
        await deps.writeModels(next);
        sendJson(res, 200, await modelsReply());
      }),
    },
    {
      method: AUDIT_API.listRewrites.method,
      path: AUDIT_API.listRewrites.path,
      access: AUDIT_API.listRewrites.access,
      handle: guarded(async (ctx) => {
        const version = versionOf(ctx.url.searchParams.get('version') ?? undefined);
        if (version === null) {
          refuse(ctx.res, 400, 'ERR_INVALID_REQUEST', INVALID, {
            errors: { version: 'must be a version number: 1, 2, 3…' },
          });
          return;
        }
        const found = await versionFor(ctx, version);
        if (!found) return;
        const ops = await deps.rewrites(found.auditId, found.version.version);
        const reply: RewriteListReply = { rewrites: await ops.list() };
        sendJson(ctx.res, 200, reply);
      }),
    },
    {
      method: AUDIT_API.approveRewrite.method,
      path: AUDIT_API.approveRewrite.path,
      access: AUDIT_API.approveRewrite.access,
      handle: guarded(async (ctx) => {
        const target = await sectionTarget(ctx);
        if (!target) return;
        const ops = await deps.rewrites(target.auditId, target.version);
        const result = await ops.approve(target.section);
        if (!result.ok) return refuseRewrite(ctx.res, result);
        const reply: RewriteReply = { rewrite: result.rewrite };
        sendJson(ctx.res, 200, reply);
      }),
    },
    {
      method: AUDIT_API.runRewrite.method,
      path: AUDIT_API.runRewrite.path,
      access: AUDIT_API.runRewrite.access,
      handle: guarded(async (ctx) => {
        const target = await sectionTarget(ctx);
        if (!target) return;
        const rawLanguage = target.body.language;
        if (rawLanguage !== undefined && !isDocumentLanguage(rawLanguage)) {
          refuse(ctx.res, 400, 'ERR_INVALID_REQUEST', INVALID, {
            errors: { language: 'must be one of the document languages.' },
          });
          return;
        }
        const language: DocumentLanguage = rawLanguage ?? target.language;
        const ops = await deps.rewrites(target.auditId, target.version);

        // Approval first (REQ-030 AC-1), then the key (REQ-011 AC-2): nothing reaches the AI before both.
        const key = `${target.section.urlPath}\n${target.section.sectionId}`;
        const state = (await ops.list()).find((r) => `${r.urlPath}\n${r.sectionId}` === key);
        if (!state?.approvedAt) return refuse(ctx.res, 409, 'ERR_NOT_APPROVED', NOT_APPROVED);
        if (!(await deps.hasAiKey())) return refuse(ctx.res, 409, 'ERR_NO_AI_KEY', NO_AI_KEY);

        const content = await deps.loadSection(
          target.auditId,
          target.version,
          target.section.urlPath,
          target.section.sectionId
        );
        const overlapWords = await deps.overlapWords();
        const scope = callerSignal(ctx.req, ctx.res);
        try {
          const result = await ops.run(
            { ...target.section, language },
            { content, overlapWords, signal: scope.signal }
          );
          if (scope.signal.aborted) return;
          if (!result.ok) return refuseRewrite(ctx.res, result);
          const reply: RewriteReply = { rewrite: result.rewrite };
          sendJson(ctx.res, 200, reply);
        } finally {
          scope.release();
        }
      }),
    },
    {
      method: AUDIT_API.acceptRewrite.method,
      path: AUDIT_API.acceptRewrite.path,
      access: AUDIT_API.acceptRewrite.access,
      handle: guarded(async (ctx) => {
        const target = await sectionTarget(ctx);
        if (!target) return;
        const text = target.body.text;
        if (typeof text !== 'string') {
          refuse(ctx.res, 400, 'ERR_INVALID_REQUEST', INVALID, { errors: { text: 'must not be empty.' } });
          return;
        }
        const ops = await deps.rewrites(target.auditId, target.version);
        const content = await deps.loadSection(
          target.auditId,
          target.version,
          target.section.urlPath,
          target.section.sectionId
        );
        const overlapWords = await deps.overlapWords();
        const result = await ops.accept({ ...target.section, text }, { content, overlapWords });
        if (!result.ok) return refuseRewrite(ctx.res, result);
        // Only clean, accepted copy reaches the overlay, marked as a rewrite (REQ-030 AC-2).
        const edit: SectionEdit = { ...result.edit, by: 'rewrite' };
        const edits = await deps.applyRewriteEdit(target.auditId, target.version, edit);
        const reply: RewriteAcceptReply = { rewrite: result.rewrite, edits };
        sendJson(ctx.res, 200, reply);
      }),
    },
  ];
}
