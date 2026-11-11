import { AUDIT_ERROR_CODES, type AuditErrorCode } from '@qa/types/src/browser.js';

/** Shown when a request got no answer at all. One wording for every Website Audit screen. */
export const NOT_ANSWERING =
  'The tool is not answering. Check your connection and that the tool is still running, then try again.';

/** True for a code the runner's Website Audit routes can return. */
export function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}
