// browser.js only, never the @qa/types barrel (its index pulls in Node-only code) nor another module by
// path: packages/types/tests/browser-entry.test.ts (T-211) holds the wizard to it.
import {
  validateAuditStartBody,
  type AuditStartBody,
  type AuditStartErrors,
  type AuditStartField,
} from '@qa/types/src/browser.js';

/**
 * The Website Audit start form: what the person typed, kept as text so a number can be cleared and
 * retyped, and the client-side check that runs before any request. The check is the runner's own
 * `validateAuditStartBody`, so both ends refuse the same input with the same message (REQ-001 AC-3).
 */

/** The defaults the shared check fills in for a bare address: 200 pages and depth 8 (CRAWL_LIMIT_BOUNDS). */
function sharedDefaults(): { maxPages: number; maxDepth: number } {
  const check = validateAuditStartBody({ url: 'https://example.com' });
  if (!check.ok) throw new Error('validateAuditStartBody refused a bare address');
  return { maxPages: check.value.limits.maxPages, maxDepth: check.value.limits.maxDepth };
}

const DEFAULTS = sharedDefaults();

/**
 * The bounds the form shows and puts on its inputs. CRAWL_LIMIT_BOUNDS is not on browser.js, so the
 * numbers are kept here; audit-start-form.test.ts checks each one against validateAuditStartBody, so they
 * cannot drift from the shared check. The defaults come from the check itself.
 */
export const AUDIT_LIMIT_BOUNDS = {
  minPages: 1,
  maxPages: 1000,
  defaultPages: DEFAULTS.maxPages,
  minDepth: 0,
  maxDepth: 100,
  defaultDepth: DEFAULTS.maxDepth,
  maxPathPrefixes: 50,
} as const;

export interface AuditStartForm {
  address: string;
  maxPages: string;
  maxDepth: string;
  /** One path prefix per line. */
  includePaths: string;
  /** One path prefix per line. */
  excludePaths: string;
}

/** The fields the form shows. `language` is left to its default ('en') on this screen. */
export type AuditFormField = Exclude<AuditStartField, 'language'>;

export const AUDIT_FORM_FIELDS: readonly AuditFormField[] = [
  'url',
  'maxPages',
  'maxDepth',
  'includePaths',
  'excludePaths',
];

export function initialAuditStartForm(): AuditStartForm {
  return {
    address: '',
    maxPages: String(AUDIT_LIMIT_BOUNDS.defaultPages),
    maxDepth: String(AUDIT_LIMIT_BOUNDS.defaultDepth),
    includePaths: '',
    excludePaths: '',
  };
}

/**
 * Estimated number of AI requests for an audit: one per page plus one for the whole audit (REQ-002, ADR 0042).
 */
export function estimateAiRequests(pages: number | string): number {
  const n = typeof pages === 'number' ? pages : parseInt(pages.trim(), 10);
  const valid = Number.isFinite(n) && n > 0 ? n : AUDIT_LIMIT_BOUNDS.defaultPages;
  return valid + 1;
}

/** The element id of a field's input. */
export function fieldId(field: AuditFormField): string {
  return `audit-${field}`;
}

/** The element id of a field's error message. */
export function errorId(field: AuditFormField): string {
  return `audit-${field}-error`;
}

/** The element id of a field's hint. */
export function hintId(field: AuditFormField): string {
  return `audit-${field}-hint`;
}

/** The hint under each field, with the bounds from AUDIT_LIMIT_BOUNDS (REQ-002). */
export const AUDIT_FIELD_HINTS: Readonly<Record<AuditFormField, string>> = {
  url: 'The public address the Website Audit starts from, such as https://example.com.',
  maxPages: `From ${AUDIT_LIMIT_BOUNDS.minPages} to ${AUDIT_LIMIT_BOUNDS.maxPages}. ${AUDIT_LIMIT_BOUNDS.defaultPages} unless you set another number.`,
  maxDepth: `Link steps from the start address, from ${AUDIT_LIMIT_BOUNDS.minDepth} to ${AUDIT_LIMIT_BOUNDS.maxDepth}. ${AUDIT_LIMIT_BOUNDS.defaultDepth} unless you set another number.`,
  includePaths: `Optional. One path per line, such as /blog, up to ${AUDIT_LIMIT_BOUNDS.maxPathPrefixes}. Only pages under these paths are read.`,
  excludePaths: `Optional. One path per line, such as /admin, up to ${AUDIT_LIMIT_BOUNDS.maxPathPrefixes}. Pages under these paths become Skipped Pages.`,
};

/** A typed number: empty or not a number stays NaN, so the shared check refuses it with its own message. */
function numberOf(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/** One path per line; blank lines are dropped. */
export function pathLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The `POST /api/audits` body as typed, before the check. */
export function toAuditStartBody(form: AuditStartForm): AuditStartBody {
  return {
    url: form.address.trim(),
    maxPages: numberOf(form.maxPages),
    maxDepth: numberOf(form.maxDepth),
    includePaths: pathLines(form.includePaths),
    excludePaths: pathLines(form.excludePaths),
  };
}

export type AuditFormCheck = { ok: true; body: AuditStartBody } | { ok: false; errors: AuditStartErrors };

/**
 * Checks the form with the shared validator. On success the body carries the normalised address and the
 * de-duplicated paths, ready to send; on failure there is one message per wrong field and nothing is sent.
 */
export function checkAuditStartForm(form: AuditStartForm): AuditFormCheck {
  const check = validateAuditStartBody(toAuditStartBody(form));
  if (!check.ok) return { ok: false, errors: check.errors };
  const { url, limits } = check.value;
  return {
    ok: true,
    body: {
      url,
      maxPages: limits.maxPages,
      maxDepth: limits.maxDepth,
      includePaths: limits.includePaths,
      excludePaths: limits.excludePaths,
    },
  };
}

/** The first field with a message, in form order: where focus goes after a refused start. */
export function firstErrorField(errors: AuditStartErrors): AuditFormField | null {
  return AUDIT_FORM_FIELDS.find((field) => errors[field]) ?? null;
}
