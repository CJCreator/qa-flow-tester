/**
 * The Improved version rows (ADR 0049): AUDIT_API createImprove (owner: it spends the tool user's AI key),
 * listImprove and getImprove (view). Design variants are written by core's makeVariants, one 'preview' stage
 * request each, and stored as `improved/<page>/<variant>.html` with an `improved/variants.json` index. A page
 * or variant in an address is looked up in that list, never used as a path. Variants are served with the
 * Shared Link page headers (ADR 0036).
 *
 * Handlers take their dependencies as arguments, so they run without a RunnerServer.
 */
import type http from 'http';
import type { AuditResult, ImproveCreateReply, ImproveListReply, PageContent } from '@qa/types';
import {
  checkImproveBody,
  improvePages,
  makeOutboundFetch,
  makeVariants,
  pageContentName,
  readImproveIndex,
  variantFileName,
  PREVIEW_IMAGE_MAX_BYTES,
  PREVIEW_IMAGE_TIMEOUT_MS,
  type AuditAiResolution,
  type AuditStore,
  type ImproveIo,
  type VariantAxeScan,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { auditRow, readEdits, versionQuery } from './audit-common.js';
import { sendJson } from './body.js';
import {
  AUDIT_FORBIDDEN,
  AUDIT_NOT_FOUND,
  mayUseAudit,
  refuse,
  refuseStoreFailure,
  type AuditCaller,
} from './audit-store.js';
import { previewHeaders, type PreviewImageFetcher } from './audit-preview.js';

const MAX_IMPROVE_BODY_CHARS = 4_000;

export const IMPROVE_NO_AI_KEY = 'An AI key is needed to make the Improved version. Add one in Settings.';
export const IMPROVE_NOT_FOUND = 'There is no such variant for this version yet. Make it first.';
const NOT_FINISHED = 'This version has no finished result, so there is nothing to improve.';
const RUNNING = 'This version of the Website Audit is still running. Make the Improved version when it has finished.';

export interface AuditImproveRouteDeps {
  store: AuditStore;
  caller: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
  /** The tool user's audit AI, as for the preview; no key refuses the request. */
  resolveAi: () => Promise<AuditAiResolution>;
  /** The price of one request in US dollars, or null when the model's price is not known. */
  usdPerRequest?: () => Promise<number | null>;
  fetchImage?: PreviewImageFetcher;
  aiTimeoutMs?: number;
  /** The quality gate's axe scan (T-414); default: a lab browser per batch. */
  scanAxe?: VariantAxeScan;
  now?: () => Date;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  if (typeof req.setEncoding === 'function') req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_IMPROVE_BODY_CHARS) throw new Error('too large');
  }
  return body;
}

/** The store's files of one version, as core's ImproveIo. */
function versionIo(store: AuditStore, auditId: string, version: number): ImproveIo {
  return {
    readContent: (urlPath) => store.readVersionJson<PageContent>(auditId, version, pageContentName(urlPath)),
    readFile: (name) => store.getVersionFile(auditId, version, name),
    writeFile: (name, data) => store.putVersionFile(auditId, version, name, data),
    readJson: (name) => store.readVersionJson(auditId, version, name),
    writeJson: (name, value) => store.writeVersionJson(auditId, version, name, value),
  };
}

/** AUDIT_API createImprove, listImprove and getImprove. */
export function auditImproveRoutes(deps: AuditImproveRouteDeps): Route[] {
  const { store } = deps;
  const fetchImage: PreviewImageFetcher =
    deps.fetchImage ??
    makeOutboundFetch({ maxBytes: PREVIEW_IMAGE_MAX_BYTES, timeoutMs: PREVIEW_IMAGE_TIMEOUT_MS, maxRedirects: 3 });

  /** The finished version asked for (or the latest) and its result, or a refusal already sent. */
  const finished = async (
    res: http.ServerResponse,
    auditId: string,
    wanted: number | undefined
  ): Promise<{ version: { version: number; language: AuditResult['language'] }; result: AuditResult } | null> => {
    const record = await store.readAuditRecord(auditId);
    const number = wanted ?? record?.latestVersion;
    const version = record && number !== undefined ? await store.getVersion(auditId, number) : null;
    if (!version) return (refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND), null);
    if (version.status === 'running') return (refuse(res, 409, 'ERR_AUDIT_RUNNING', RUNNING), null);
    const result = await store.getResult(auditId, version.version);
    if (!result) return (refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', NOT_FINISHED), null);
    return { version, result };
  };

  const createImprove = async (c: RouteContext): Promise<void> => {
    const { res } = c;
    try {
      const auditId = c.params?.id ?? '';
      const caller = await deps.caller(c);
      // 'owner' only: variants spend the tool user's AI key, which a Helper never does.
      if (!caller.owner) return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN);
      let raw: unknown;
      try {
        const text = await readBody(c.req);
        raw = text.trim() === '' ? {} : JSON.parse(text);
      } catch {
        return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The request is not valid JSON, or too large.');
      }
      const wanted = raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
      if (wanted !== undefined && (typeof wanted !== 'number' || !Number.isInteger(wanted) || wanted < 1))
        return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The version must be a whole number from 1.');
      const found = await finished(res, auditId, wanted as number | undefined);
      if (!found) return;
      const body = checkImproveBody(raw, improvePages(found.result));
      if (typeof body === 'string') return refuse(res, 400, 'ERR_INVALID_REQUEST', body);

      const resolved = await deps.resolveAi();
      if (!resolved.ok) return refuse(res, 409, 'ERR_NO_AI_KEY', IMPROVE_NO_AI_KEY);

      const edits = await readEdits(store, auditId, found.version.version);
      const made = await makeVariants(
        {
          result: found.result,
          edits,
          language: found.version.language,
          pages: body.pages,
          variants: body.variants,
          ...(body.only !== undefined ? { only: body.only } : {}),
        },
        {
          io: versionIo(store, auditId, found.version.version),
          ai: resolved.ai,
          fetchImage,
          timeoutMs: deps.aiTimeoutMs,
          now: deps.now,
          ...(deps.scanAxe ? { scanAxe: deps.scanAxe } : {}),
        }
      );
      const reply: ImproveCreateReply = { requests: made.requests, variants: made.variants };
      sendJson(res, 200, reply);
    } catch (err) {
      refuseStoreFailure(res, err);
    }
  };

  const listImprove = async (c: RouteContext): Promise<void> => {
    const { res } = c;
    try {
      const auditId = c.params?.id ?? '';
      const wanted = versionQuery(c.url);
      if (wanted === 'invalid')
        return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The version must be a whole number from 1.');
      const caller = await deps.caller(c);
      if (!(await mayUseAudit(store, caller, auditId, 'view')))
        return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      const found = await finished(res, auditId, wanted);
      if (!found) return;
      const index = await readImproveIndex(
        versionIo(store, auditId, found.version.version),
        found.version.version,
        found.version.language
      );
      const usdPerRequest = caller.owner && deps.usdPerRequest ? await deps.usdPerRequest().catch(() => null) : null;
      const reply: ImproveListReply = {
        version: found.version.version,
        language: found.version.language,
        pages: improvePages(found.result),
        variants: index.variants,
        ...(index.best ? { best: index.best } : {}),
        estimate: { usdPerRequest },
      };
      sendJson(res, 200, reply);
    } catch (err) {
      refuseStoreFailure(res, err);
    }
  };

  const getImprove = async (c: RouteContext): Promise<void> => {
    const { res } = c;
    try {
      const auditId = c.params?.id ?? '';
      const wanted = versionQuery(c.url);
      if (wanted === 'invalid')
        return refuse(res, 400, 'ERR_INVALID_REQUEST', 'The version must be a whole number from 1.');
      const caller = await deps.caller(c);
      if (!(await mayUseAudit(store, caller, auditId, 'view')))
        return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      const found = await finished(res, auditId, wanted);
      if (!found) return;
      const io = versionIo(store, auditId, found.version.version);
      const index = await readImproveIndex(io, found.version.version, found.version.language);
      // Looked up in the index: the address parts never become a path themselves.
      const entry = index.variants.find(
        (v) => v.page === c.params?.page && String(v.variant) === c.params?.variant && v.status === 'made'
      );
      if (!entry || entry.gate?.passed === false) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', IMPROVE_NOT_FOUND);
      const page = await io.readFile(variantFileName(entry.page, entry.variant));
      if (!page) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', IMPROVE_NOT_FOUND);
      const bytes = Buffer.from(page.buffer, page.byteOffset, page.byteLength);
      res.writeHead(200, { ...previewHeaders(bytes.toString('utf8')), 'Content-Length': String(page.byteLength) });
      res.end(bytes);
    } catch (err) {
      refuseStoreFailure(res, err);
    }
  };

  return [
    auditRow('createImprove', createImprove),
    auditRow('listImprove', listImprove),
    auditRow('getImprove', getImprove),
  ];
}
