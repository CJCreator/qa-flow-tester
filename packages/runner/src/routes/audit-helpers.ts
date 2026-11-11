/**
 * Helper routes (REQ-033, ADR 0037): the owner's Helper list per Website Audit (listHelpers, grantHelper,
 * removeHelper: 'owner') and the Helper's own sign-in (helperStatus, helperSignIn, helperSession,
 * helperSignOut: 'sign-in'). Method, path and access come from AUDIT_API. Not registered here: BE-190 adds
 * the rows to allRoutes and passes the HelperAccess hook to RunnerServerOptions.helperGrants.
 *
 * The Google ID token is read from one POST body, verified, and dropped: never stored, logged or echoed.
 */
import type http from 'http';
import {
  AUDIT_API,
  type AuditEndpointName,
  type AuditErrorCode,
  type HelperGrant,
  type HelperGrantReply,
  type HelperListReply,
  type HelperPermission,
  type HelperSession,
  type HelperStatusReply,
} from '@qa/types';
import { readJsonBody } from './body.js';
import type { Route, RouteContext } from './route.js';
import { HelperSignInError, MAX_ID_TOKEN_CHARS } from '../helpers/firebase-token.js';
import type { HelperAccess } from '../helpers/helper-access.js';
import {
  clearHelperSessionCookie,
  helperSessionCookie,
  isHttpsRequest,
  signHelperSession,
  HELPER_SESSION_SECONDS,
} from '../helpers/helper-session.js';

/** The audit store calls these routes use (BE-601's AuditStore provides them). */
export interface HelperRouteStore {
  getAudit(auditId: string): Promise<unknown | null>;
  listHelpers(auditId: string): Promise<HelperGrant[]>;
  grantHelper(auditId: string, email: string, permissions: HelperPermission[]): Promise<HelperGrant>;
  removeHelper(auditId: string, email: string): Promise<boolean>;
  grantsFor(email: string): Promise<HelperGrant[]>;
}

export interface AuditHelperRouteDeps {
  store: HelperRouteStore;
  access: HelperAccess;
}

/** Largest grant body (an email and up to three permissions). */
const MAX_GRANT_BODY_CHARS = 4096;
/** Largest sign-in body: the token plus its JSON wrapper. */
const MAX_SIGN_IN_BODY_CHARS = MAX_ID_TOKEN_CHARS + 256;

const MESSAGES = {
  invalid: 'The request is not valid.',
  notFound: 'Website Audit not found.',
  helpersOff: 'Helper sign-in is not set up on this copy.',
  signInFailed: 'Google sign-in did not work.',
  failed: 'The Helper request could not be completed.',
} as const;

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function refuse(
  res: http.ServerResponse,
  status: number,
  code: AuditErrorCode,
  error: string,
  headers?: Record<string, string>
): void {
  send(res, status, { error, code }, headers);
}

/** Store errors in the audit error model, without internals. Duck-typed so this file needs no @qa/core import. */
function sendStoreError(res: http.ServerResponse, err: unknown): void {
  const name = (err as { name?: unknown } | null)?.name;
  const code = (err as { code?: unknown } | null)?.code;
  if (name === 'AuditRecordError' && code === 'not-found')
    return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', MESSAGES.notFound);
  if (name === 'AuditRecordError' && code === 'invalid-input') {
    const message = err instanceof Error && err.message ? err.message : MESSAGES.invalid;
    return refuse(res, 400, 'ERR_INVALID_REQUEST', message);
  }
  if (name === 'AuditStoreError' && code === 'invalid-key')
    return refuse(res, 404, 'ERR_AUDIT_NOT_FOUND', MESSAGES.notFound);
  // Anything else (storage down, bad data): a fixed message, as the runner's other 500s, with no internals.
  send(res, 500, { error: MESSAGES.failed });
}

function auditIdOf(context: RouteContext): string | undefined {
  return context.params?.id;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function row(name: AuditEndpointName, handle: Route['handle']): Route {
  const endpoint = AUDIT_API[name];
  // Closed in beta (D-004): sign-in rows are served there by authorizeRoute itself.
  return { method: endpoint.method, path: endpoint.path, access: endpoint.access, beta: 'closed', handle };
}

/** The Helper rows, in AUDIT_API order. */
export function auditHelperRoutes(deps: AuditHelperRouteDeps): Route[] {
  const { store, access } = deps;

  async function withAudit(context: RouteContext, then: (auditId: string) => Promise<void>): Promise<void> {
    const auditId = auditIdOf(context);
    if (!auditId) return refuse(context.res, 404, 'ERR_AUDIT_NOT_FOUND', MESSAGES.notFound);
    try {
      if (!(await store.getAudit(auditId))) return refuse(context.res, 404, 'ERR_AUDIT_NOT_FOUND', MESSAGES.notFound);
      await then(auditId);
    } catch (err) {
      sendStoreError(context.res, err);
    }
  }

  return [
    row('listHelpers', (context) =>
      withAudit(context, async (auditId) => {
        const reply: HelperListReply = { helpers: await store.listHelpers(auditId) };
        send(context.res, 200, reply);
      })
    ),

    row('grantHelper', async (context) => {
      let body: unknown;
      try {
        body = await readJsonBody<unknown>(context.req, MAX_GRANT_BODY_CHARS);
      } catch {
        return refuse(context.res, 400, 'ERR_INVALID_REQUEST', MESSAGES.invalid);
      }
      if (!isObject(body)) return refuse(context.res, 400, 'ERR_INVALID_REQUEST', MESSAGES.invalid);
      const { email, permissions } = body;
      await withAudit(context, async (auditId) => {
        // The store trims, lower-cases and checks the email, and checks the permissions (unknown input is refused there).
        const helper = await store.grantHelper(auditId, email as string, permissions as HelperPermission[]);
        const reply: HelperGrantReply = { helper };
        send(context.res, 200, reply);
      });
    }),

    row('removeHelper', (context) => {
      const email = context.url.searchParams.get('email');
      if (!email) return refuse(context.res, 400, 'ERR_INVALID_REQUEST', 'The Helper email address is missing.');
      return withAudit(context, async (auditId) => {
        await store.removeHelper(auditId, email);
        send(context.res, 200, { removed: true });
      });
    }),

    row('helperStatus', (context) => {
      const reply: HelperStatusReply = access.enabled
        ? access.firebaseWeb
          ? { enabled: true, firebase: access.firebaseWeb }
          : { enabled: true }
        : { enabled: false };
      send(context.res, 200, reply);
    }),

    row('helperSignIn', async (context) => {
      const { req, res } = context;
      if (!access.enabled || !access.verifier) return refuse(res, 404, 'ERR_HELPERS_OFF', MESSAGES.helpersOff);
      let body: unknown;
      try {
        body = await readJsonBody<unknown>(req, MAX_SIGN_IN_BODY_CHARS);
      } catch {
        return refuse(res, 401, 'ERR_SIGN_IN_FAILED', MESSAGES.signInFailed);
      }
      let email: string;
      let sub: string;
      try {
        // The verifier refuses a token without a non-empty `sub`; the session is bound to it (DEC-011).
        ({ email, sub } = await access.verifier.verify(isObject(body) ? body.idToken : undefined));
      } catch (err) {
        if (!(err instanceof HelperSignInError)) {
          // Fixed message only: neither the token nor the error text is logged.
          console.warn('[helpers] Sign-in check failed unexpectedly.');
        }
        return refuse(res, 401, 'ERR_SIGN_IN_FAILED', MESSAGES.signInFailed);
      }
      body = undefined;

      let grants: HelperGrant[];
      try {
        grants = await store.grantsFor(email);
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        // A verified address the store's email rule refuses can't hold grants: same refusal as a bad token.
        if (code === 'invalid-input') return refuse(res, 401, 'ERR_SIGN_IN_FAILED', MESSAGES.signInFailed);
        return sendStoreError(res, err);
      }
      const cookie = signHelperSession(access.sessionKey(), { email, sub }, access.now(), HELPER_SESSION_SECONDS);
      const reply: HelperSession = { email, grants };
      send(res, 200, reply, { 'Set-Cookie': helperSessionCookie(cookie, isHttpsRequest(req)) });
    }),

    row('helperSession', async (context) => {
      const { req, res } = context;
      if (!access.enabled) return refuse(res, 404, 'ERR_HELPERS_OFF', MESSAGES.helpersOff);
      const session = access.session(req);
      if (!session) return refuse(res, 401, 'ERR_SIGN_IN_FAILED', 'You are not signed in.');
      try {
        const grants = (await store.grantsFor(session.email)).filter((g) => g.email === session.email);
        const reply: HelperSession = { email: session.email, grants };
        send(res, 200, reply);
      } catch (err) {
        sendStoreError(res, err);
      }
    }),

    row('helperSignOut', (context) => {
      const { req, res } = context;
      if (!access.enabled) return refuse(res, 404, 'ERR_HELPERS_OFF', MESSAGES.helpersOff);
      send(res, 200, { signedOut: true }, { 'Set-Cookie': clearHelperSessionCookie(isHttpsRequest(req)) });
    }),
  ];
}

