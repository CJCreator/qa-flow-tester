import { AUDIT_API, type AuditAccess, type AuditContentReply, type PageContent } from '@qa/types';
import { pageContentName, type AuditStore } from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { sendJson } from './body.js';
import { AUDIT_NOT_FOUND, mayUseAudit, refuse, refuseStoreFailure, type AuditCaller } from './audit-store.js';

/** What the Page Content and screenshot rows need (BE-190 supplies them from the runner). */
export interface AuditContentRouteDeps {
  store: AuditStore;
  /** Reads the caller from the request; the owner when the access key was sent. */
  caller: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
}

const VERSION = /^[1-9][0-9]{0,6}$/;
const MAX_PATH_CHARS = 2000;
const INVALID_VERSION = 'The version must be a whole number from 1.';
const INVALID_PATH = 'The path is missing or not valid.';
const PAGE_NOT_FOUND = 'This page is not in this version of the Website Audit.';
const FILE_NOT_FOUND = 'This file is not in this version of the Website Audit.';

/** Image types a version's screenshots may have; anything else is refused before the store is asked. */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** `?version=`: absent means the latest; anything but a whole number from 1 is refused. */
function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  return VERSION.test(raw) ? Number(raw) : 'invalid';
}

/** A page path as the audit records it: starts with '/', no control characters, bounded length. */
function validPagePath(raw: string | null): raw is string {
  return raw !== null && raw.length <= MAX_PATH_CHARS && raw.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(raw);
}

/**
 * A screenshot path relative to the version's folder: no absolute path, '..', backslash or encoded
 * separator, and an image extension. The store checks the name again before any read.
 */
function screenshotType(raw: string | null): string | null {
  if (raw === null || raw.length === 0 || raw.length > MAX_PATH_CHARS) return null;
  if (raw.startsWith('/') || raw.includes('\\') || raw.includes('%') || raw.includes('..')) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const dot = raw.lastIndexOf('.');
  return IMAGE_TYPES[raw.slice(dot + 1).toLowerCase()] ?? null;
}

function row(key: 'content' | 'file', handle: Route['handle']): Route & { method: string; access: AuditAccess } {
  const { method, path, access } = AUDIT_API[key];
  return { method, path, access, handle };
}

/** AUDIT_API content and file (REQ-048, REQ-020). BE-190 registers these in the route table. */
export function auditContentRoutes(deps: AuditContentRouteDeps): Route[] {
  const { store } = deps;

  /** The version asked for (latest by default), or null after the refusal was sent. */
  const resolveVersion = async (c: RouteContext): Promise<{ auditId: string; version: number } | null> => {
    const { res } = c;
    const auditId = c.params?.id ?? '';
    const wanted = versionQuery(c.url);
    if (wanted === 'invalid') {
      refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_VERSION);
      return null;
    }
    const caller = await deps.caller(c);
    // A Helper without a view grant gets the same answer as for an audit that does not exist.
    if (!(await mayUseAudit(store, caller, auditId, 'view'))) {
      refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      return null;
    }
    const record = await store.readAuditRecord(auditId);
    const number = wanted ?? record?.latestVersion;
    const version = record && number !== undefined ? await store.getVersion(auditId, number) : null;
    if (!version) {
      refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      return null;
    }
    return { auditId, version: version.version };
  };

  const getContent = async (c: RouteContext): Promise<void> => {
    const { res } = c;
    try {
      const path = c.url.searchParams.get('path');
      if (!validPagePath(path)) return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_PATH);
      const target = await resolveVersion(c);
      if (!target) return;
      const content = await store.readVersionJson<PageContent>(target.auditId, target.version, pageContentName(path));
      if (!content) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', PAGE_NOT_FOUND);
      const reply: AuditContentReply = { content };
      sendJson(res, 200, reply);
    } catch (err) {
      refuseStoreFailure(res, err);
    }
  };

  const getFile = async (c: RouteContext): Promise<void> => {
    const { res } = c;
    try {
      const path = c.url.searchParams.get('path');
      const type = screenshotType(path);
      if (!path || !type) return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID_PATH);
      const target = await resolveVersion(c);
      if (!target) return;
      const data = await store.getVersionFile(target.auditId, target.version, path);
      if (!data) return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', FILE_NOT_FOUND);
      const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': String(bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      res.end(bytes);
    } catch (err) {
      refuseStoreFailure(res, err);
    }
  };

  return [row('content', getContent), row('file', getFile)];
}
