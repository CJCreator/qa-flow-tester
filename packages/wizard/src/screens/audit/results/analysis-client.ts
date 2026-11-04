import {
  AUDIT_API,
  AUDIT_ERROR_CODES,
  AUDIT_ID_PATTERN,
  auditPath,
  type AuditContentReply,
  type AuditErrorCode,
  type AuditGetReply,
} from '@qa/types/src/browser.js';

/**
 * The analysis screen's calls to the runner: one Website Audit version (`AUDIT_API.get`) and the Page
 * Content of one page (`AUDIT_API.content`). Nothing here throws: every refusal or failure comes back as
 * `{ ok: false, error, code }`, where `error` is a plain sentence safe to show as-is.
 */

export type AuditCallResult<T> = { ok: true; reply: T } | { ok: false; error: string; code?: AuditErrorCode };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 15000;
const NOT_ANSWERING = 'The tool is not answering. Make sure it is still open in its terminal, then try again.';
const UNREADABLE = 'The tool sent an answer that could not be read. Try again.';
const BAD_ID = 'This Website Audit address is not valid. Open the Website Audit from its list.';

/** Plain sentences for the refusals these two routes give, used when the reply carries no message. */
const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_AUDIT_NOT_FOUND: 'This Website Audit, version or page was not found. It may have been deleted.',
  ERR_AUDIT_RUNNING: 'This Website Audit is still in progress. Its analysis shows once it has finished.',
  ERR_FORBIDDEN: 'You do not have access to this Website Audit.',
};

function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}

function versionQuery(version: number | undefined): string | null {
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? `version=${version}` : null;
}

function withQuery(path: string, parts: Array<string | null>): string {
  const query = parts.filter((part): part is string => part !== null).join('&');
  return query === '' ? path : `${path}?${query}`;
}

/** `GET /api/audits/:id`, with `?version=` when a version is given. */
export function auditResultUrl(auditId: string, version?: number): string {
  return withQuery(auditPath(AUDIT_API.get.path, { id: auditId }), [versionQuery(version)]);
}

/** `GET /api/audits/:id/content?path=…`, the page path encoded, with `&version=` when a version is given. */
export function pageContentUrl(auditId: string, urlPath: string, version?: number): string {
  return withQuery(auditPath(AUDIT_API.content.path, { id: auditId }), [
    `path=${encodeURIComponent(urlPath)}`,
    versionQuery(version),
  ]);
}

async function call<T>(
  url: string,
  method: string,
  isReply: (body: unknown) => body is T,
  fetchImpl: Fetch
): Promise<AuditCallResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, error: NOT_ANSWERING };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (res.ok) {
    return isReply(body) ? { ok: true, reply: body } : { ok: false, error: UNREADABLE };
  }
  const refusal = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = isAuditErrorCode(refusal.code) ? refusal.code : undefined;
  const message =
    typeof refusal.error === 'string' && refusal.error.trim() !== ''
      ? refusal.error.trim()
      : (code && REFUSALS[code]) || 'The Website Audit could not be opened. Try again.';
  return code ? { ok: false, error: message, code } : { ok: false, error: message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGetReply(body: unknown): body is AuditGetReply {
  if (!isObject(body) || !isObject(body.version) || !('result' in body)) return false;
  const result = body.result;
  return result === null || (isObject(result) && Array.isArray(result.pages) && Array.isArray(result.findings));
}

function isContentReply(body: unknown): body is AuditContentReply {
  return isObject(body) && isObject(body.content) && typeof body.content.urlPath === 'string';
}

/** One version of a Website Audit (the latest without `version`), with its result once it has finished. */
export async function getAuditResult(
  auditId: string,
  version?: number,
  fetchImpl: Fetch = fetch
): Promise<AuditCallResult<AuditGetReply>> {
  if (!AUDIT_ID_PATTERN.test(auditId)) return { ok: false, error: BAD_ID, code: 'ERR_AUDIT_NOT_FOUND' };
  return call(auditResultUrl(auditId, version), AUDIT_API.get.method, isGetReply, fetchImpl);
}

/** The Page Content of one recorded page of a Website Audit version. */
export async function getPageContent(
  auditId: string,
  urlPath: string,
  version?: number,
  fetchImpl: Fetch = fetch
): Promise<AuditCallResult<AuditContentReply>> {
  if (!AUDIT_ID_PATTERN.test(auditId)) return { ok: false, error: BAD_ID, code: 'ERR_AUDIT_NOT_FOUND' };
  return call(pageContentUrl(auditId, urlPath, version), AUDIT_API.content.method, isContentReply, fetchImpl);
}
