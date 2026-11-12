import {
  AUDIT_API,
  HELPER_PERMISSIONS,
  auditPath,
  type AuditErrorCode,
  type HelperGrant,
  type HelperGrantBody,
  type HelperPermission,
  type HelperSession,
} from '@qa/types/src/browser.js';
import { isAuditErrorCode, NOT_ANSWERING } from '../audit-call';
import { announceSessionChange } from '../../../lib/session-event';

/**
 * The Helper screens' calls to the runner (REQ-033): whether Helper sign-in is set up on this copy
 * (`GET /api/helper/status`), the owner's Helper list per Website Audit (`GET|PUT|DELETE /api/audits/:id/helpers`),
 * and the Helper's own session (`POST|GET|DELETE /api/helper/session`). Every refusal becomes a plain sentence
 * safe to show as-is; status codes and raw errors never reach the screen. The Google ID token goes in the body
 * of one POST and nowhere else.
 */

export { loadCallerIsHelper } from './caller-access';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type HelperOutcome<T> = { ok: true; value: T } | { ok: false; message: string; code?: AuditErrorCode };

/** The public Firebase web settings the sign-in needs. Public by design; not a secret. */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

/** Whether Helper sign-in is on, and the Firebase web settings when the runner sends them. */
export interface HelperStatus {
  enabled: boolean;
  firebase: FirebaseWebConfig | null;
}

export const HELPERS_OFF_MESSAGE =
  'Helper sign-in is not set up on this copy. Until it is, give the people helping you the downloaded documents instead. Whoever hosts this copy can turn Helper sign-in on.';
export const SIGN_IN_FAILED_MESSAGE = 'Google sign-in did not work. Try again, or ask the person who gave you access.';

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_AUDIT_NOT_FOUND: 'This Website Audit was not found. It may have been deleted.',
  ERR_FORBIDDEN: 'You do not have permission to do this. A Helper cannot give or remove access.',
  ERR_SIGN_IN_FAILED: SIGN_IN_FAILED_MESSAGE,
  ERR_HELPERS_OFF: HELPERS_OFF_MESSAGE,
};

/** What each permission lets a Helper do, in the order the screens show them. */
export const PERMISSION_LABEL: Readonly<Record<HelperPermission, string>> = {
  view: 'View',
  edit: 'Edit',
  export: 'Export',
};

/** A loose email check for the form; the runner checks it again. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPermission(value: unknown): value is HelperPermission {
  return typeof value === 'string' && (HELPER_PERMISSIONS as readonly string[]).includes(value);
}

function asGrant(value: unknown): HelperGrant | null {
  if (!isObject(value)) return null;
  const { auditId, email, permissions, grantedAt } = value;
  if (typeof auditId !== 'string' || typeof email !== 'string' || !Array.isArray(permissions)) return null;
  return {
    auditId,
    email,
    permissions: permissions.filter(isPermission),
    grantedAt: typeof grantedAt === 'string' ? grantedAt : '',
  };
}

function asGrants(value: unknown): HelperGrant[] | null {
  if (!Array.isArray(value)) return null;
  const grants: HelperGrant[] = [];
  for (const item of value) {
    const grant = asGrant(item);
    if (grant) grants.push(grant);
  }
  return grants;
}

function asFirebaseConfig(value: unknown): FirebaseWebConfig | null {
  if (!isObject(value)) return null;
  const { apiKey, authDomain, projectId } = value;
  if (typeof apiKey !== 'string' || typeof authDomain !== 'string' || typeof projectId !== 'string') return null;
  if (apiKey.trim() === '' || authDomain.trim() === '' || projectId.trim() === '') return null;
  return { apiKey: apiKey.trim(), authDomain: authDomain.trim(), projectId: projectId.trim() };
}

function asSession(body: unknown): HelperSession | null {
  if (!isObject(body) || typeof body.email !== 'string') return null;
  const grants = asGrants(body.grants);
  return grants === null ? null : { email: body.email, grants };
}

async function call<T>(
  url: string,
  init: RequestInit,
  fetchImpl: Fetch,
  fallback: string,
  accept: (body: unknown) => T | null
): Promise<HelperOutcome<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { credentials: 'same-origin', ...init });
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

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The email as the runner stores it, or null when it does not look like an email address. */
export function normalEmail(text: string): string | null {
  const email = text.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

/** The permissions in the shown order, with 'view' always in: 'edit' and 'export' include it. */
export function withView(permissions: readonly HelperPermission[]): HelperPermission[] {
  const set = new Set<HelperPermission>(['view', ...permissions]);
  return HELPER_PERMISSIONS.filter((permission) => set.has(permission));
}

/** "View, Edit" for a grant's permissions. */
export function permissionText(permissions: readonly HelperPermission[]): string {
  return withView(permissions)
    .map((permission) => PERMISSION_LABEL[permission])
    .join(', ');
}

/** `GET /api/helper/status`: is Helper sign-in set up on this copy? A 404 ERR_HELPERS_OFF means no. */
export async function loadHelperStatus(fetchImpl: Fetch = fetch): Promise<HelperOutcome<HelperStatus>> {
  const outcome = await call(
    auditPath(AUDIT_API.helperStatus.path, {}),
    { method: AUDIT_API.helperStatus.method },
    fetchImpl,
    'Could not check whether Helper sign-in is set up. Try again.',
    (body) =>
      isObject(body) && typeof body.enabled === 'boolean'
        ? { enabled: body.enabled, firebase: asFirebaseConfig(body.firebase) }
        : null
  );
  if (!outcome.ok && outcome.code === 'ERR_HELPERS_OFF') return { ok: true, value: { enabled: false, firebase: null } };
  return outcome;
}

/** `GET /api/audits/:id/helpers`: the Helpers of one Website Audit. */
export function listHelpers(auditId: string, fetchImpl: Fetch = fetch): Promise<HelperOutcome<HelperGrant[]>> {
  return call(
    auditPath(AUDIT_API.listHelpers.path, { id: auditId }),
    { method: AUDIT_API.listHelpers.method },
    fetchImpl,
    'The Helpers of this Website Audit could not be loaded. Try again.',
    (body) => (isObject(body) ? asGrants(body.helpers) : null)
  );
}

/** `PUT /api/audits/:id/helpers`: gives (or changes) one Helper's access to the Website Audit. */
export function grantHelper(
  auditId: string,
  grant: HelperGrantBody,
  fetchImpl: Fetch = fetch
): Promise<HelperOutcome<HelperGrant>> {
  const body: HelperGrantBody = { email: grant.email, permissions: withView(grant.permissions) };
  return call(
    auditPath(AUDIT_API.grantHelper.path, { id: auditId }),
    { method: AUDIT_API.grantHelper.method, headers: JSON_HEADERS, body: JSON.stringify(body) },
    fetchImpl,
    'The access could not be given. Try again.',
    (reply) => (isObject(reply) ? asGrant(reply.helper) : null)
  );
}

/** `DELETE /api/audits/:id/helpers?email=…`: removes one Helper's access to the Website Audit. */
export function removeHelper(auditId: string, email: string, fetchImpl: Fetch = fetch): Promise<HelperOutcome<true>> {
  const query = new URLSearchParams({ email }).toString();
  return call(
    `${auditPath(AUDIT_API.removeHelper.path, { id: auditId })}?${query}`,
    { method: AUDIT_API.removeHelper.method },
    fetchImpl,
    'The access could not be removed. Try again.',
    (reply) => (isObject(reply) && reply.removed === true ? true : null)
  );
}

/** `POST /api/helper/session`: hands the Google ID token over once; the runner sets the Helper session cookie. */
export function startHelperSession(idToken: string, fetchImpl: Fetch = fetch): Promise<HelperOutcome<HelperSession>> {
  return call(
    auditPath(AUDIT_API.helperSignIn.path, {}),
    { method: AUDIT_API.helperSignIn.method, headers: JSON_HEADERS, body: JSON.stringify({ idToken }) },
    fetchImpl,
    SIGN_IN_FAILED_MESSAGE,
    asSession
  ).then((outcome) => {
    if (outcome.ok) announceSessionChange();
    return outcome;
  });
}

/** `GET /api/helper/session`: the signed-in Helper and their Website Audits, when a session is open. */
export function loadHelperSession(fetchImpl: Fetch = fetch): Promise<HelperOutcome<HelperSession>> {
  return call(
    auditPath(AUDIT_API.helperSession.path, {}),
    { method: AUDIT_API.helperSession.method },
    fetchImpl,
    'You are not signed in.',
    asSession
  );
}

/** `DELETE /api/helper/session`: signs the Helper out. */
export function endHelperSession(fetchImpl: Fetch = fetch): Promise<HelperOutcome<true>> {
  return call(
    auditPath(AUDIT_API.helperSignOut.path, {}),
    { method: AUDIT_API.helperSignOut.method },
    fetchImpl,
    'Signing out did not work. Try again.',
    (reply) => (isObject(reply) && reply.signedOut === true ? true : null)
  ).then((outcome) => {
    if (outcome.ok) announceSessionChange();
    return outcome;
  });
}
