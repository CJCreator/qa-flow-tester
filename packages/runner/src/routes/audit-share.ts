/**
 * Shared Link routes (REQ-024, REQ-019, Q-30, ADR 0036): list, create and revoke the Shared Links of a
 * Website Audit, and the public page `/s/:linkId`, the only audit route open without the access key (D-004).
 *
 * A Shared Link points to a snapshot copied when the link is made: the Pitch Glimpse rendered by G5, or the
 * version's stored `preview.html`. The public page reads only that snapshot, never the live audit, so no
 * contact detail, other version, Shortlist entry or Helper grant can reach a visitor (F-009). BE-190
 * registers these rows in the route table.
 */
import type http from 'http';
import {
  AUDIT_API,
  isDocumentLanguage,
  type AuditErrorCode,
  type AuditErrorReply,
  type AuditResult,
  type DocumentLanguage,
  type EditOverlay,
  type PageContent,
  type ShareLink,
  type ShareLinkKind,
  type ShareLinkReply,
  type ShareListReply,
} from '@qa/types';
import {
  AuditRecordError,
  AuditStoreError,
  MAX_AUDIT_VERSION,
  PITCH_TOP_FINDINGS,
  editedViewOf,
  emptyOverlay,
  generatePitchGlimpse,
  pageContentName,
  previewCspForHtml,
  shareRecordKey,
  shareSnapshotKey,
  type AuditStore,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { readJsonBody, sendJson } from './body.js';
import { mayUseAudit, type AuditCaller } from './audit-store.js';

/** What the Shared Link rows need. */
export interface AuditShareDeps {
  /** The Website Audit store (G6). Its clock decides expiry. */
  store: AuditStore;
  /** The tool user's saved opt-out text per language (audit settings); the Pitch Glimpse prints it. */
  optOutText: () => Promise<Partial<Record<DocumentLanguage, string>>>;
  /** Reads the caller from the request; the owner when the access key was sent. */
  caller: (context: RouteContext) => AuditCaller | Promise<AuditCaller>;
}

/**
 * Headers on every `/s/` reply, whatever its status. The Content-Security-Policy is built per response from
 * the exact page served (DEC-008): no script, no external resource, no form, no framing, images only as
 * data: URIs, styles only by the sha256 of the page's own `<style>` text, never 'unsafe-inline'.
 */
export function sharedPageHeaders(html: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': previewCspForHtml(html),
  };
}

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';

/** The stored improved-homepage preview of a version (BE-605). */
export const PREVIEW_FILE_NAME = 'preview.html';
/** The edit overlay beside a version's result (BE-509). */
const EDITS_NAME = 'edits';
/** A share body is three short fields. */
const MAX_SHARE_BODY_CHARS = 10_000;
/** Largest screenshot embedded in a Pitch Glimpse snapshot. */
const MAX_SCREENSHOT_BYTES = 3_000_000;
const SHARE_KINDS: readonly ShareLinkKind[] = ['pitch', 'preview'];

const AUDIT_NOT_FOUND = 'This Website Audit was not found. It may have been deleted.';
const LINK_NOT_FOUND = 'This Shared Link was not found.';
const INVALID = 'The request is not valid.';
export const NO_PREVIEW_MESSAGE =
  'This version has no improved homepage preview yet. Make the preview first, then share it.';
const NO_RESULT_MESSAGE = 'This version did not finish, so it has no Pitch Glimpse to share.';
const RUNNING_MESSAGE = 'This version of the Website Audit is still running. Share it when it has finished.';
const SHARE_FAILED = 'The Shared Link could not be made. Try again.';
const STORE_FAILED = 'The Shared Links could not be read or saved. Try again.';

// ---------------------------------------------------------------------------------------------------
// JSON rows
// ---------------------------------------------------------------------------------------------------

function refuse(res: http.ServerResponse, status: number, code: AuditErrorCode, error: string): void {
  const body: AuditErrorReply = { error, code };
  sendJson(res, status, body);
}

/** Store failures become fixed sentences: no keys, paths or backend text reach the caller. */
function refuseStoreFailure(res: http.ServerResponse, err: unknown, notFoundMessage = AUDIT_NOT_FOUND): void {
  if (err instanceof AuditRecordError) {
    if (err.code === 'not-found') return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', notFoundMessage);
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID);
  }
  if (err instanceof AuditStoreError && err.code === 'invalid-key') {
    return refuse(res, 400, 'ERR_INVALID_REQUEST', INVALID);
  }
  sendJson(res, 500, { error: STORE_FAILED });
}

/** The audit named by `:id`, or null after a 404 was sent. */
async function existingAudit(store: AuditStore, c: RouteContext): Promise<string | null> {
  const auditId = c.params?.id;
  if (!auditId || !(await store.readAuditRecord(auditId))) {
    refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
    return null;
  }
  return auditId;
}

interface ShareRequest {
  kind: ShareLinkKind;
  language?: DocumentLanguage;
  version?: number;
}

/** Checks a create body: kind pitch or preview, an optional document language and version. */
export function checkShareBody(body: unknown): { ok: true; value: ShareRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: INVALID };
  const b = body as Record<string, unknown>;
  if (typeof b.kind !== 'string' || !SHARE_KINDS.includes(b.kind as ShareLinkKind)) {
    return { ok: false, error: 'kind: only a Pitch Glimpse (pitch) or a preview (preview) can be shared.' };
  }
  const value: ShareRequest = { kind: b.kind as ShareLinkKind };
  if (b.language !== undefined) {
    if (!isDocumentLanguage(b.language)) return { ok: false, error: 'language: pick one of the document languages.' };
    value.language = b.language;
  }
  if (b.version !== undefined) {
    if (
      typeof b.version !== 'number' ||
      !Number.isInteger(b.version) ||
      b.version < 1 ||
      b.version > MAX_AUDIT_VERSION
    ) {
      return { ok: false, error: 'version: a whole number from 1.' };
    }
    value.version = b.version;
  }
  return { ok: true, value };
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Screenshots of the findings the Pitch Glimpse shows, as data: URIs. A missing or odd one is left out. */
async function pitchScreenshots(
  store: AuditStore,
  auditId: string,
  version: number,
  result: AuditResult,
  contents: PageContent[],
  edits: EditOverlay
): Promise<Record<string, string>> {
  const shots: Record<string, string> = {};
  const top = editedViewOf({ result, contents, edits }).result.findings.slice(0, PITCH_TOP_FINDINGS);
  for (const finding of top) {
    const name = finding.screenshotPath;
    if (!name || Object.prototype.hasOwnProperty.call(shots, name)) continue;
    const type = IMAGE_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
    if (!type) continue;
    try {
      const bytes = await store.getVersionFile(auditId, version, name);
      if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_SCREENSHOT_BYTES) {
        shots[name] = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
      }
    } catch {
      // A path the store refuses is shown as "no screenshot", never as an error.
    }
  }
  return shots;
}

/** The Pitch Glimpse of a finished version with its edits applied, rendered once for the snapshot. */
async function renderPitch(
  deps: AuditShareDeps,
  auditId: string,
  version: number,
  result: AuditResult,
  language: DocumentLanguage
): Promise<string> {
  const { store } = deps;
  // Read together: on the hosted copy each read is a Cloud Storage request. Order follows result.pages.
  const read = await Promise.all(
    result.pages.map((page) =>
      store
        .readVersionJson<PageContent>(auditId, version, pageContentName(page.urlPath))
        // A page without readable Page Content keeps its stored text.
        .catch(() => null)
    )
  );
  const contents: PageContent[] = read.filter((content): content is PageContent => !!content);
  const edits = (await store.readVersionJson<EditOverlay>(auditId, version, EDITS_NAME)) ?? emptyOverlay();
  const screenshots = await pitchScreenshots(store, auditId, version, result, contents, edits);
  const optOutText = await deps.optOutText();
  return generatePitchGlimpse({ result, contents, edits, language, settings: { optOutText }, screenshots }).html;
}

/** Writes the snapshot under the audit lock, only while the link record still exists. */
async function saveSnapshot(store: AuditStore, link: ShareLink, html: Uint8Array): Promise<boolean> {
  return store.withAuditLock(link.auditId, async () => {
    if (!(await store.backend.getJson<ShareLink>(shareRecordKey(link.auditId, link.id)))) return false;
    await store.backend.putBytes(shareSnapshotKey(link.auditId, link.id), html);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------
// The public page
// ---------------------------------------------------------------------------------------------------

function messagePage(title: string, text: string, code?: AuditErrorCode): string {
  const codeAttr = code ? ` data-code="${code}"` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
${ROBOTS_META}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}</style>
</head>
<body>
<main${codeAttr}>
<h1>${title}</h1>
<p>${text}</p>
</main>
</body>
</html>
`;
}

/** Unknown and malformed links get this exact body, so a reply says nothing about other links. */
export const SHARED_NOT_FOUND_PAGE = messagePage(
  'Link not found',
  'This link does not lead to a shared page. Check that it was copied in full.'
);
/** Revoked, expired, or its audit was deleted. Shows no audit data. */
export const SHARED_GONE_PAGE = messagePage(
  'This link has ended',
  'This shared page is no longer available. Ask the person who sent it for a new link.',
  'ERR_LINK_GONE'
);
const SHARED_FAILED_PAGE = messagePage(
  'Not available right now',
  'This shared page could not be opened. Try again later.'
);

/** Puts the robots meta tag at the start of the snapshot's head (or the page, when it has none). */
export function withRobotsMeta(html: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (!head) return `${ROBOTS_META}\n${html}`;
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}\n${ROBOTS_META}${html.slice(at)}`;
}

function sendSharedPage(res: http.ServerResponse, status: number, html: string): void {
  // The page sets no cookie: drop any a layer before this one (the beta session) prepared.
  res.removeHeader('Set-Cookie');
  res.writeHead(status, sharedPageHeaders(html));
  res.end(html);
}

// ---------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------

/** The Shared Link rows: list (view), create and revoke (owner), and the public page (public). */
export function auditShareRoutes(deps: AuditShareDeps): Route[] {
  const { store } = deps;

  const listShares = async (c: RouteContext): Promise<void> => {
    try {
      const auditId = await existingAudit(store, c);
      if (!auditId) return;
      const caller = await deps.caller(c);
      // Checked where the data is read: a Helper needs a view grant on this audit.
      if (!(await mayUseAudit(store, caller, auditId, 'view'))) {
        return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      }
      const links = await store.listShares(auditId);
      // A link id is a bearer secret for the public page: only the owner gets it (SEC-002).
      const reply: ShareListReply = caller.owner
        ? { links }
        : { links: links.map(({ id: _id, ...rest }) => rest as unknown as ShareLink) };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err);
    }
  };

  const createShare = async (c: RouteContext): Promise<void> => {
    try {
      const auditId = await existingAudit(store, c);
      if (!auditId) return;

      let body: unknown;
      try {
        body = await readJsonBody<unknown>(c.req, MAX_SHARE_BODY_CHARS);
      } catch {
        return refuse(c.res, 400, 'ERR_INVALID_REQUEST', 'The request is not valid JSON or is too large.');
      }
      const checked = checkShareBody(body);
      if (!checked.ok) return refuse(c.res, 400, 'ERR_INVALID_REQUEST', checked.error);
      const wanted = checked.value;

      const record = await store.readAuditRecord(auditId);
      const versionNumber = wanted.version ?? record?.latestVersion;
      const version = versionNumber === undefined ? null : await store.getVersion(auditId, versionNumber);
      if (!record || !version) return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND);
      if (version.status === 'running') return refuse(c.res, 409, 'ERR_AUDIT_RUNNING', RUNNING_MESSAGE);
      const language: DocumentLanguage = wanted.language ?? version.language;

      // The snapshot is made first: a link is only created when there is something to show.
      let snapshot: Uint8Array;
      if (wanted.kind === 'preview') {
        const preview = await store.getVersionFile(auditId, version.version, PREVIEW_FILE_NAME);
        if (!preview || preview.byteLength === 0) return refuse(c.res, 400, 'ERR_INVALID_REQUEST', NO_PREVIEW_MESSAGE);
        snapshot = preview;
      } else {
        const result = await store.getResult(auditId, version.version);
        if (!result) return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', NO_RESULT_MESSAGE);
        snapshot = new TextEncoder().encode(await renderPitch(deps, auditId, version.version, result, language));
      }

      const link = await store.createShare(auditId, { version: version.version, kind: wanted.kind, language });
      let saved = false;
      try {
        saved = await saveSnapshot(store, link, snapshot);
      } catch {
        saved = false;
      }
      if (!saved) {
        // A link without its snapshot must never open: revoke it (it answers 410) and say it failed.
        await store.revokeShare(auditId, link.id).catch(() => undefined);
        return sendJson(c.res, 500, { error: SHARE_FAILED });
      }
      const reply: ShareLinkReply = { link };
      sendJson(c.res, 201, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err);
    }
  };

  const revokeShare = async (c: RouteContext): Promise<void> => {
    try {
      const auditId = await existingAudit(store, c);
      if (!auditId) return;
      const linkId = c.params?.linkId;
      if (!linkId) return refuse(c.res, 404, 'ERR_AUDIT_NOT_FOUND', LINK_NOT_FOUND);
      const reply: ShareLinkReply = { link: await store.revokeShare(auditId, linkId) };
      sendJson(c.res, 200, reply);
    } catch (err) {
      refuseStoreFailure(c.res, err, LINK_NOT_FOUND);
    }
  };

  /** Reads only the link record (via the index) and its snapshot; the resolved audit summary is not used. */
  const sharedPage = async (c: RouteContext): Promise<void> => {
    try {
      const linkId = c.params?.linkId;
      if (!linkId) return sendSharedPage(c.res, 404, SHARED_NOT_FOUND_PAGE);
      const resolved = await store.resolveShare(linkId);
      if (resolved.status === 'missing') return sendSharedPage(c.res, 404, SHARED_NOT_FOUND_PAGE);
      if (resolved.status === 'gone') return sendSharedPage(c.res, 410, SHARED_GONE_PAGE);
      const { link } = resolved;
      const bytes = await store.backend.getBytes(shareSnapshotKey(link.auditId, link.id));
      if (!bytes || bytes.byteLength === 0) return sendSharedPage(c.res, 410, SHARED_GONE_PAGE);
      sendSharedPage(c.res, 200, withRobotsMeta(new TextDecoder().decode(bytes)));
    } catch {
      sendSharedPage(c.res, 500, SHARED_FAILED_PAGE);
    }
  };

  /** Any other GET under `/s/` (a malformed id) gets the same 404 body as an unknown id. */
  const sharedNotFound = (c: RouteContext): void => sendSharedPage(c.res, 404, SHARED_NOT_FOUND_PAGE);

  return [
    {
      method: AUDIT_API.listShares.method,
      path: AUDIT_API.listShares.path,
      access: AUDIT_API.listShares.access,
      handle: listShares,
    },
    {
      method: AUDIT_API.createShare.method,
      path: AUDIT_API.createShare.path,
      access: AUDIT_API.createShare.access,
      handle: createShare,
    },
    {
      method: AUDIT_API.revokeShare.method,
      path: AUDIT_API.revokeShare.path,
      access: AUDIT_API.revokeShare.access,
      handle: revokeShare,
    },
    {
      method: AUDIT_API.sharedPage.method,
      path: AUDIT_API.sharedPage.path,
      access: AUDIT_API.sharedPage.access,
      beta: 'allow',
      handle: sharedPage,
    },
    { method: 'GET', path: '/s', prefix: true, access: 'public', beta: 'allow', handle: sharedNotFound },
  ];
}
