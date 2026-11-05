import {
  AUDIT_API,
  AUDIT_ERROR_CODES,
  auditPath,
  type AuditContentReply,
  type AuditEditsPatch,
  type AuditEditsReply,
  type AuditErrorCode,
  type AuditGetReply,
  type EditOverlay,
  type PageContent,
} from '@qa/types/src/browser.js';

/**
 * The review and edit screen's calls to the runner (REQ-020): the version and its edits
 * (`GET /api/audits/:id`), the saved edits alone (`GET /api/audits/:id/edits`), a page's Page Content
 * (`GET /api/audits/:id/content`) and the save (`PATCH /api/audits/:id/edits`). Every refusal becomes a plain
 * sentence safe to show as-is; status codes and raw errors never reach the screen.
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ReviewOutcome<T> = { ok: true; value: T } | { ok: false; message: string; code?: AuditErrorCode };

const NOT_ANSWERING = 'The tool is not answering. Check your connection and that the tool is still running, then try again.';

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_AUDIT_NOT_FOUND: 'This Website Audit was not found. It may have been deleted.',
  ERR_AUDIT_RUNNING: 'This version of the Website Audit is still running. Review it when it has finished.',
  ERR_FORBIDDEN: 'You do not have permission to do this on this Website Audit.',
};

function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `?version=2&path=…`, with only the values that are set. */
function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}

async function call<T>(
  url: string,
  init: RequestInit,
  fetchImpl: Fetch,
  fallback: string,
  accept: (body: unknown) => T | null
): Promise<ReviewOutcome<T>> {
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
  const error = typeof refusal.error === 'string' && refusal.error.trim() !== '' ? refusal.error.trim() : fallback;
  return { ok: false, message: error, code };
}

function isEditOverlay(value: unknown): value is EditOverlay {
  return (
    isObject(value) &&
    Array.isArray(value.findings) &&
    Array.isArray(value.sections) &&
    Array.isArray(value.removedPages) &&
    Array.isArray(value.recommendations)
  );
}

function acceptEdits(body: unknown): EditOverlay | null {
  return isObject(body) && isEditOverlay(body.edits) ? body.edits : null;
}

/** `GET /api/audits/:id`: the version (the latest when `version` is not given), its result and its edits. */
export function loadAudit(
  auditId: string,
  version?: number,
  fetchImpl: Fetch = fetch
): Promise<ReviewOutcome<AuditGetReply>> {
  return call(
    withQuery(auditPath(AUDIT_API.get.path, { id: auditId }), { version }),
    { method: AUDIT_API.get.method },
    fetchImpl,
    'The Website Audit could not be opened. Try again.',
    (body) => {
      if (!isObject(body) || !isObject(body.version) || !isEditOverlay(body.edits)) return null;
      if (body.result !== null && !isObject(body.result)) return null;
      return body as unknown as AuditGetReply;
    }
  );
}

/** `GET /api/audits/:id/edits`: the version's saved edits. */
export function loadEdits(
  auditId: string,
  version?: number,
  fetchImpl: Fetch = fetch
): Promise<ReviewOutcome<EditOverlay>> {
  return call(
    withQuery(auditPath(AUDIT_API.getEdits.path, { id: auditId }), { version }),
    { method: AUDIT_API.getEdits.method },
    fetchImpl,
    'The saved edits could not be loaded. Try again.',
    acceptEdits
  );
}

/** `GET /api/audits/:id/content?path=…`: one page's Page Content with its Sections. */
export function loadPageContent(
  auditId: string,
  urlPath: string,
  version?: number,
  fetchImpl: Fetch = fetch
): Promise<ReviewOutcome<PageContent>> {
  return call(
    withQuery(auditPath(AUDIT_API.content.path, { id: auditId }), { version, path: urlPath }),
    { method: AUDIT_API.content.method },
    fetchImpl,
    'The Page Content of this page could not be loaded. Try again.',
    (body) => {
      const content = isObject(body) ? (body as Partial<AuditContentReply>).content : undefined;
      return isObject(content) && typeof content.text === 'string' && Array.isArray(content.sections) ? content : null;
    }
  );
}

/** `PATCH /api/audits/:id/edits`: saves the changes and returns every saved edit of the version. */
export function saveEdits(
  auditId: string,
  patch: AuditEditsPatch,
  version?: number,
  fetchImpl: Fetch = fetch
): Promise<ReviewOutcome<EditOverlay>> {
  return call(
    withQuery(auditPath(AUDIT_API.patchEdits.path, { id: auditId }), { version }),
    {
      method: AUDIT_API.patchEdits.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    fetchImpl,
    'The changes could not be saved. Try again.',
    (body) => acceptEdits(body as Partial<AuditEditsReply>)
  );
}
