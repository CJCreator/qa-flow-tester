import { AUDIT_ERROR_CODES, isRecord, type AuditErrorCode } from '@qa/types/src/browser.js';

/** Shown when a request got no answer at all. One wording for every Website Audit screen. */
export const NOT_ANSWERING =
  'The tool is not answering. Check your connection and that the tool is still running, then try again.';

/** True for a code the runner's Website Audit routes can return. */
export function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}

/** `path` with the defined `query` values appended as a query string; undefined values are left out. */
export function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}

/** What a Website Audit request gives a screen: the accepted value, or one sentence to show (and the code). */
export type AuditOutcome<T> = { ok: true; value: T } | { ok: false; message: string; code?: AuditErrorCode };

/**
 * One Website Audit request. No answer gives NOT_ANSWERING; a 2xx body `accept` refuses gives `fallback`; a refusal
 * gives the screen's own sentence for its code from `refusals`, else the runner's error text, else `fallback`.
 */
export async function callAudit<T>(
  url: string,
  init: RequestInit,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  fallback: string,
  accept: (body: unknown) => T | null,
  refusals: Partial<Record<AuditErrorCode, string>>
): Promise<AuditOutcome<T>> {
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
  const refusal = isRecord(body) ? body : {};
  const code = isAuditErrorCode(refusal.code) ? refusal.code : undefined;
  if (code && refusals[code]) return { ok: false, message: refusals[code]!, code };
  const error = typeof refusal.error === 'string' && refusal.error.trim() !== '' ? refusal.error.trim() : fallback;
  return { ok: false, message: error, code };
}
