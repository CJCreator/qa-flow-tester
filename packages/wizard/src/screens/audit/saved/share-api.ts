import {
  AUDIT_API,
  AUDIT_ERROR_CODES,
  DOCUMENT_LANGUAGE_INFO,
  SHARE_LINK_DAYS,
  SHARED_LINK_PREFIX,
  auditPath,
  isDocumentLanguage,
  type AuditErrorCode,
  type DocumentLanguage,
  type PreviewCreateBody,
  type PreviewReply,
  type ShareCreateBody,
  type ShareLink,
  type ShareLinkKind,
} from '@qa/types/src/browser.js';

/**
 * The preview and Shared Link screen's calls to the runner (REQ-024): make the improved-homepage preview
 * (`POST /api/audits/:id/preview`), open it (`GET /api/audits/:id/preview?version=n`, a page the browser shows),
 * and list, create and revoke Shared Links (`GET|POST /api/audits/:id/share`, `DELETE /api/audits/:id/share/:linkId`).
 * Every refusal becomes a plain sentence safe to show as-is; status codes and raw errors never reach the screen.
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ShareOutcome<T> = { ok: true; value: T } | { ok: false; message: string; code?: AuditErrorCode };

const NOT_ANSWERING = 'The tool is not answering. Make sure it is still open in its terminal, then try again.';

/** Shown when the preview needs an AI key and none is saved; the screen links to Settings beside it. */
export const NO_AI_KEY_MESSAGE =
  'An AI key is needed to write the improved homepage. Add one in Settings, then try again.';

/** Said wherever a Shared Link is made or shown. */
export const SHARED_LINK_WARNING =
  'Anyone holding this Shared Link can open it, without the access key. Hand it only to the site owner. You can revoke it at any time.';

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_NO_AI_KEY: NO_AI_KEY_MESSAGE,
  ERR_AUDIT_NOT_FOUND: 'This Website Audit was not found. It may have been deleted.',
  ERR_AUDIT_RUNNING: 'This version of the Website Audit is still running. Try again when it has finished.',
  ERR_FORBIDDEN: 'You do not have permission to do this on this Website Audit.',
  ERR_LINK_GONE: 'This Shared Link has already expired or been revoked.',
  ERR_RUN_IN_PROGRESS:
    'Another run is in progress: a Check-up, a benchmark or a Website Audit. Wait for it to finish, then try again.',
};

/** The languages offered for the preview and the Pitch Glimpse. */
export const SHARE_LANGUAGES = ['en', 'ta'] as const satisfies readonly DocumentLanguage[];
export type ShareLanguage = (typeof SHARE_LANGUAGES)[number];

export const KIND_LABEL: Readonly<Record<ShareLinkKind, string>> = {
  pitch: 'Pitch Glimpse',
  preview: 'Improved homepage preview',
};

export const SHARE_KINDS: readonly ShareLinkKind[] = ['pitch', 'preview'];

function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isShareLink(value: unknown): value is ShareLink {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.version === 'number' &&
    (value.kind === 'pitch' || value.kind === 'preview') &&
    isDocumentLanguage(value.language) &&
    typeof value.createdAt === 'string' &&
    typeof value.expiresAt === 'string' &&
    (value.revokedAt === null || typeof value.revokedAt === 'string')
  );
}

async function call<T>(
  url: string,
  init: RequestInit,
  fetchImpl: Fetch,
  fallback: string,
  accept: (body: unknown) => T | null
): Promise<ShareOutcome<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
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
    const value = accept(body);
    return value === null ? { ok: false, message: fallback } : { ok: true, value };
  }
  const refusal = isObject(body) ? body : {};
  const code = isAuditErrorCode(refusal.code) ? refusal.code : undefined;
  if (code && REFUSALS[code]) return { ok: false, message: REFUSALS[code]!, code };
  return { ok: false, message: fallback, code };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// ---------------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------------

/** `POST /api/audits/:id/preview`: the AI writes the improved homepage of one version, in one language. */
export function createPreview(
  auditId: string,
  version: number,
  language: ShareLanguage,
  fetchImpl: Fetch = fetch
): Promise<ShareOutcome<PreviewReply['preview']>> {
  const body: PreviewCreateBody = { version, language };
  return call(
    auditPath(AUDIT_API.createPreview.path, { id: auditId }),
    jsonInit(AUDIT_API.createPreview.method, body),
    fetchImpl,
    'The improved homepage preview could not be made. Try again.',
    (reply) =>
      isObject(reply) && isObject(reply.preview) && typeof reply.preview.version === 'number'
        ? (reply.preview as unknown as PreviewReply['preview'])
        : null
  );
}

/** The address of `GET /api/audits/:id/preview?version=n`, opened by the browser in a new tab (REQ-024 AC-1). */
export function previewUrl(auditId: string, version: number): string {
  return `${auditPath(AUDIT_API.getPreview.path, { id: auditId })}?version=${encodeURIComponent(String(version))}`;
}

/** `GET /api/audits/:id/share`: every Shared Link of the Website Audit, revoked ones included. */
export function listSharedLinks(auditId: string, fetchImpl: Fetch = fetch): Promise<ShareOutcome<ShareLink[]>> {
  return call(
    auditPath(AUDIT_API.listShares.path, { id: auditId }),
    { method: AUDIT_API.listShares.method },
    fetchImpl,
    'The Shared Links could not be loaded. Try again.',
    (reply) => (isObject(reply) && Array.isArray(reply.links) ? reply.links.filter(isShareLink) : null)
  );
}

/** `POST /api/audits/:id/share`: a new Shared Link to the Pitch Glimpse or the preview of one version. */
export function createSharedLink(
  auditId: string,
  choice: { version: number; kind: ShareLinkKind; language: ShareLanguage },
  fetchImpl: Fetch = fetch
): Promise<ShareOutcome<ShareLink>> {
  const body: ShareCreateBody = { version: choice.version, kind: choice.kind, language: choice.language };
  return call(
    auditPath(AUDIT_API.createShare.path, { id: auditId }),
    jsonInit(AUDIT_API.createShare.method, body),
    fetchImpl,
    'The Shared Link could not be made. Try again.',
    (reply) => (isObject(reply) && isShareLink(reply.link) ? reply.link : null)
  );
}

/** `DELETE /api/audits/:id/share/:linkId`: the link stops working at once; it stays in the list as revoked. */
export function revokeSharedLink(
  auditId: string,
  linkId: string,
  fetchImpl: Fetch = fetch
): Promise<ShareOutcome<ShareLink>> {
  return call(
    auditPath(AUDIT_API.revokeShare.path, { id: auditId, linkId }),
    { method: AUDIT_API.revokeShare.method },
    fetchImpl,
    'The Shared Link could not be revoked. Try again.',
    (reply) => (isObject(reply) && isShareLink(reply.link) ? reply.link : null)
  );
}

/**
 * Revokes only after the person confirms. Returns null when they cancel, so nothing is sent.
 */
export async function revokeAfterConfirm(
  confirmed: () => Promise<boolean>,
  auditId: string,
  linkId: string,
  fetchImpl: Fetch = fetch
): Promise<ShareOutcome<ShareLink> | null> {
  if (!(await confirmed())) return null;
  return revokeSharedLink(auditId, linkId, fetchImpl);
}

// ---------------------------------------------------------------------------------------------------
// Wording and pure helpers
// ---------------------------------------------------------------------------------------------------

/** The full address of a Shared Link: the tool's own address plus `/s/<id>`. */
export function sharedLinkAddress(origin: string, link: Pick<ShareLink, 'id'>): string {
  return `${origin.replace(/\/+$/, '')}${SHARED_LINK_PREFIX}${encodeURIComponent(link.id)}`;
}

export function languageName(language: DocumentLanguage): string {
  return DOCUMENT_LANGUAGE_INFO[language].name;
}

/** The list state of a Shared Link, in words: revoked, expired or open until a day. */
export type LinkState = 'open' | 'expired' | 'revoked';

export function linkState(link: ShareLink, now: Date = new Date()): LinkState {
  if (link.revokedAt !== null) return 'revoked';
  const expires = new Date(link.expiresAt).getTime();
  return !Number.isNaN(expires) && expires <= now.getTime() ? 'expired' : 'open';
}

export const LINK_STATE_LABEL: Readonly<Record<LinkState, string>> = {
  open: 'Open',
  expired: 'Expired',
  revoked: 'Revoked',
};

/** "Expires 3 December 2026, 30 days after it was made." */
export function expiryText(formattedDay: string): string {
  return `Expires ${formattedDay}, ${SHARE_LINK_DAYS} days after it was made.`;
}

/** Puts a revoked or new link in the list, newest first, replacing the one with the same id. */
export function withLink(links: readonly ShareLink[], link: ShareLink): ShareLink[] {
  return [link, ...links.filter((other) => other.id !== link.id)].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}
