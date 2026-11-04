/**
 * The improved-homepage preview rows (REQ-024): AUDIT_API createPreview (owner: it spends the tool user's AI
 * key) and getPreview (view). The page is written by the 'preview' AI stage, sanitised in core, and stored as
 * `preview.html` in the version folder, where the export folder and a preview Shared Link (BE-604) read it.
 * It is served with the Shared Link page headers of ADR 0036: strict CSP, noindex, no-store, no-referrer.
 *
 * Handlers take their dependencies as arguments, so they run without a RunnerServer.
 */
import type http from 'http';
import {
  AUDIT_API,
  isDocumentLanguage,
  type AuditAccess,
  type AuditResult,
  type DocumentLanguage,
  type EditOverlay,
  type PageContent,
  type PreviewReply,
} from '@qa/types';
import {
  emptyOverlay,
  makeOutboundFetch,
  pageContentName,
  previewCspForHtml,
  PREVIEW_FILE_NAME,
  PREVIEW_IMAGE_MAX_BYTES,
  PREVIEW_IMAGE_TIMEOUT_MS,
  type AuditAi,
  type AuditAiResolution,
  type AuditStore,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { sendJson } from './body.js';
import { AUDIT_FORBIDDEN, AUDIT_NOT_FOUND, mayUseAudit, refuse, refuseStoreFailure, type AuditCaller } from './audit-store.js';

/**
 * Headers of a served preview: the same as a Shared Link page (ADR 0036). The Content-Security-Policy is
 * computed per response from the page's own `<style>` text (previewCspForHtml), never 'unsafe-inline'.
 */
export function previewHeaders(html: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': previewCspForHtml(html),
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

const MAX_PREVIEW_BODY_CHARS = 2_000;

export const NO_AI_KEY = 'Add an AI key to write the improved homepage preview.';
export const PREVIEW_FAILED = 'The AI could not write the preview this time. Nothing was saved. Try again.';
export const PREVIEW_NOT_FOUND = 'There is no preview for this version yet. Make one first.';
const NOT_FINISHED = 'This version has no finished result, so there is nothing to preview.';
const RUNNING = 'This version of the Website Audit is still running. Make the preview when it has finished.';

/** What the preview generator is given (core's PreviewInput). */
export interface PreviewGeneratorInput {
  result: AuditResult;
  home: PageContent | null;
  edits: EditOverlay;
  language: DocumentLanguage;
}

/** An image response; `bytes` is needed to inline it. makeOutboundFetch's function fits. */
export type PreviewImageFetcher = (
  url: string
) => Promise<{ status: number; headers: Record<string, string>; bytes?: () => Promise<Uint8Array> } | null>;

/** core's generatePreview (packages/core/src/audit/preview). */
export type PreviewGenerator = (
  input: PreviewGeneratorInput,
  options: { ai: AuditAi; fetchImage?: PreviewImageFetcher; signal?: AbortSignal; timeoutMs?: number }
) => Promise<{ ok: true; html: string } | { ok: false; problem: string }>;

export interface AuditPreviewRouteDeps {
  store: AuditStore;
  /** Reads the caller from the request; the owner when the access key was sent. */
  caller: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
  /**
   * The tool user's audit AI: resolveAuditAi with the saved AI setup, the key resolver and the models per
   * audit stage (REQ-039), so the 'preview' stage uses its chosen model. No key: `{ ok: false }`.
   */
  resolveAi: () => Promise<AuditAiResolution>;
  generate: PreviewGenerator;
  /** Image requests; default makeOutboundFetch with a byte cap and a timeout (BE-101). */
  fetchImage?: PreviewImageFetcher;
  /** Deadline of the AI request; the generator's default when absent. */
  aiTimeoutMs?: number;
  now?: () => Date;
}

function row(key: 'createPreview' | 'getPreview', handle: Route['handle']): Route & { method: string; access: AuditAccess } {
  const { method, path, access } = AUDIT_API[key];
  return { method, path, access, handle };
}

const VERSION = /^[1-9][0-9]{0,6}$/;

/** `?version=`: absent means the latest; anything but a whole number from 1 is refused. */
function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  return VERSION.test(raw) ? Number(raw) : 'invalid';
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_PREVIEW_BODY_CHARS) throw new Error('too large');
  }
  return body;
}

/** `{ version?, language? }`, nothing else; an empty body is `{}`. */
function checkCreateBody(raw: string): { version?: number; language?: DocumentLanguage } | string {
  let body: unknown;
  try {
    body = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    return 'The request is not valid JSON.';
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'The request must be a JSON object.';
  const value = body as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (key !== 'version' && key !== 'language') return `Unknown field: ${key.slice(0, 40)}.`;
  }
  const out: { version?: number; language?: DocumentLanguage } = {};
  if (value.version !== undefined) {
    if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1 || value.version > 9_999_999) {
      return 'The version must be a whole number from 1.';
    }
    out.version = value.version;
  }
  if (value.language !== undefined) {
    if (!isDocumentLanguage(value.language)) return 'The language is not one of the document languages.';
    out.language = value.language;
  }
  return out;
}

/** AUDIT_API createPreview and getPreview. BE-190 registers these in the route table. */
export function auditPreviewRoutes(deps: AuditPreviewRouteDeps): Route[] {
  const { store } = deps;
  const fetchImage: PreviewImageFetcher =
    deps.fetchImage ??
    makeOutboundFetch({ maxBytes: PREVIEW_IMAGE_MAX_BYTES, timeoutMs: PREVIEW_IMAGE_TIMEOUT_MS, maxRedirects: 3 });

  const createPreview = async (c: RouteContext): Promise<void> => {
    const { res } = c;
    try {
      const auditId = c.params?.id ?? '';
      const caller = await deps.caller(c);
      // 'owner' only: the preview spends the tool user's AI key, which a Helper never does.
      if (!caller.owner) return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN);

      let raw: string;
      try {
        raw = await readBody(c.req);
      } catch {
        return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The request is too large.');
      }
      const body = checkCreateBody(raw);
      if (typeof body === 'string') return refuse(res, 400, 'ERR_INVALID_REQUEST', body);

      const record = await store.readAuditRecord(auditId);
      const versionNumber = body.version ?? record?.latestVersion;
      const version = record && versionNumber !== undefined ? await store.getVersion(auditId, versionNumber) : null;
      if (!version) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      if (version.status === 'running') return refuse(res, 409, 'ERR_AUDIT_RUNNING', RUNNING);
      const result = await store.getResult(auditId, version.version);
      if (!result) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FINISHED);

      const resolved = await deps.resolveAi();
      if (!resolved.ok) return refuse(res, 409, 'ERR_NO_AI_KEY', NO_AI_KEY);

      const language = body.language ?? version.language;
      const home = await store.readVersionJson<PageContent>(
        auditId,
        version.version,
        pageContentName(result.hierarchy.root.urlPath)
      );
      const edits = (await store.readVersionJson<EditOverlay>(auditId, version.version, 'edits')) ?? emptyOverlay();

      let generated: Awaited<ReturnType<PreviewGenerator>>;
      try {
        generated = await deps.generate(
          { result, home, edits, language },
          { ai: resolved.ai, fetchImage, timeoutMs: deps.aiTimeoutMs }
        );
      } catch {
        generated = { ok: false, problem: 'failed' };
      }
      // Fixed wording: no provider text, key or page content reaches the reply. Nothing is stored.
      if (!generated.ok) return sendJson(res, 502, { error: PREVIEW_FAILED, code: 'ERR_AI_FAILED' });

      await store.putVersionFile(auditId, version.version, PREVIEW_FILE_NAME, new TextEncoder().encode(generated.html));
      const reply: PreviewReply = {
        preview: { version: version.version, language, createdAt: (deps.now?.() ?? new Date()).toISOString() },
      };
      sendJson(res, 200, reply);
    } catch (err) {
      refuseStoreFailure(res, err);
    }
  };

  const getPreview = async (c: RouteContext): Promise<void> => {
    const { res } = c;
    try {
      const auditId = c.params?.id ?? '';
      const wanted = versionQuery(c.url);
      if (wanted === 'invalid') return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The version must be a whole number from 1.');
      const caller = await deps.caller(c);
      // A Helper without a view grant gets the same answer as for an audit that does not exist.
      if (!(await mayUseAudit(store, caller, auditId, 'view'))) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);

      const record = await store.readAuditRecord(auditId);
      const versionNumber = wanted ?? record?.latestVersion;
      const version = record && versionNumber !== undefined ? await store.getVersion(auditId, versionNumber) : null;
      if (!version) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      const page = await store.getVersionFile(auditId, version.version, PREVIEW_FILE_NAME);
      if (!page) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', PREVIEW_NOT_FOUND);

      const bytes = Buffer.from(page.buffer, page.byteOffset, page.byteLength);
      res.writeHead(200, { ...previewHeaders(bytes.toString('utf8')), 'Content-Length': String(page.byteLength) });
      res.end(bytes);
    } catch (err) {
      refuseStoreFailure(res, err);
    }
  };

  return [row('createPreview', createPreview), row('getPreview', getPreview)];
}
