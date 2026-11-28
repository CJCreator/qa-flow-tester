/**
 * Helper routes (REQ-033, ADR 0037): the owner's Helper list per Website Audit (listHelpers, grantHelper,
 * removeHelper: 'owner') and the Helper's own sign-in (helperStatus, helperSignIn, helperSession,
 * helperSignOut: 'sign-in'). Method, path and access come from AUDIT_API. Not registered here: BE-190 adds
 * the rows to allRoutes and passes the HelperAccess hook to RunnerServerOptions.helperGrants.
 *
 * The Google ID token is read from one POST body, verified, and dropped: never stored, logged or echoed.
 */
import {
  isRecord,
  AUDIT_API,
  type AuditEndpointName,
  type HelperGrant,
  type HelperGrantReply,
  type HelperListReply,
  type HelperPermission,
  type HelperSession,
  type HelperStatusReply,
} from '@qa/types';
import { BODY_TOO_LARGE_MESSAGE, BodyTooLargeError, readJsonBody, sendJson } from './body.js';
import { AUDIT_NOT_FOUND, refuse, refuseBadAuditBody, refuseStoreFailure } from './audit-common.js';
import type { Route, RouteContext } from './route.js';
import { HelperSignInError, MAX_ID_TOKEN_CHARS } from '../helpers/firebase-token.js';
import type { HelperAccess } from '../helpers/helper-access.js';
import {
  clearHelperSessionCookie,
  helperSessionCookie,
  isHttpsRequest,
  signHelperSession,
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
  helpersOff: 'Helper sign-in is not set up on this copy.',
  signInFailed: 'Google sign-in did not work.',
} as const;

/** Helper answers carry a session or grants: never cached. */
const NO_STORE = { 'Cache-Control': 'no-store' };

function auditIdOf(context: RouteContext): string | undefined {
  return context.params?.id;
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
    if (!auditId) return refuse(context.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND, undefined, NO_STORE);
    try {
      if (!(await store.getAudit(auditId)))
        return refuse(context.res, 404, 'ERR_AUDIT_NOT_FOUND', AUDIT_NOT_FOUND, undefined, NO_STORE);
      await then(auditId);
    } catch (err) {
      refuseStoreFailure(context.res, err, undefined, NO_STORE);
    }
  }

  return [
    row('listHelpers', (context) =>
      withAudit(context, async (auditId) => {
        const reply: HelperListReply = { helpers: await store.listHelpers(auditId) };
        sendJson(context.res, 200, reply, NO_STORE);
      })
    ),

    row('grantHelper', async (context) => {
      let body: unknown;
      try {
        body = await readJsonBody<unknown>(context.req, MAX_GRANT_BODY_CHARS);
      } catch (err) {
        return refuseBadAuditBody(context.res, err, MESSAGES.invalid, NO_STORE);
      }
      if (!isRecord(body))
        return refuse(context.res, 400, 'ERR_INVALID_REQUEST', MESSAGES.invalid, undefined, NO_STORE);
      const { email, permissions } = body;
      await withAudit(context, async (auditId) => {
        // The store trims, lower-cases and checks the email, and checks the permissions (unknown input is refused there).
        const helper = await store.grantHelper(auditId, email as string, permissions as HelperPermission[]);
        const reply: HelperGrantReply = { helper };
        sendJson(context.res, 200, reply, NO_STORE);
      });
    }),

    row('removeHelper', (context) => {
      const email = context.url.searchParams.get('email');
      if (!email)
        return refuse(
          context.res,
          400,
          'ERR_INVALID_REQUEST',
          'The Helper email address is missing.',
          undefined,
          NO_STORE
        );
      return withAudit(context, async (auditId) => {
        await store.removeHelper(auditId, email);
        sendJson(context.res, 200, { removed: true }, NO_STORE);
      });
    }),

    row('helperStatus', (context) => {
      const reply: HelperStatusReply = access.enabled
        ? access.firebaseWeb
          ? { enabled: true, firebase: access.firebaseWeb }
          : { enabled: true }
        : { enabled: false };
      sendJson(context.res, 200, reply, NO_STORE);
    }),

    row('helperSignIn', async (context) => {
      const { req, res } = context;
      if (!access.enabled || !access.verifier)
        return refuse(res, 404, 'ERR_HELPERS_OFF', MESSAGES.helpersOff, undefined, NO_STORE);
      let body: unknown;
      try {
        body = await readJsonBody<unknown>(req, MAX_SIGN_IN_BODY_CHARS);
      } catch (err) {
        // Too large answers 413 like every other route; an unreadable body is a failed sign-in.
        if (err instanceof BodyTooLargeError)
          return refuse(res, 413, 'ERR_INVALID_REQUEST', BODY_TOO_LARGE_MESSAGE, undefined, NO_STORE);
        return refuse(res, 401, 'ERR_SIGN_IN_FAILED', MESSAGES.signInFailed, undefined, NO_STORE);
      }
      let email: string;
      let sub: string;
      try {
        // The verifier refuses a token without a non-empty `sub`; the session is bound to it (DEC-011).
        ({ email, sub } = await access.verifier.verify(isRecord(body) ? body.idToken : undefined));
      } catch (err) {
        if (!(err instanceof HelperSignInError)) {
          // Fixed message only: neither the token nor the error text is logged.
          console.warn('[helpers] Sign-in check failed unexpectedly.');
        }
        return refuse(res, 401, 'ERR_SIGN_IN_FAILED', MESSAGES.signInFailed, undefined, NO_STORE);
      }
      body = undefined;

      let grants: HelperGrant[];
      try {
        grants = await store.grantsFor(email);
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        // A verified address the store's email rule refuses can't hold grants: same refusal as a bad token.
        if (code === 'invalid-input')
          return refuse(res, 401, 'ERR_SIGN_IN_FAILED', MESSAGES.signInFailed, undefined, NO_STORE);
        return refuseStoreFailure(res, err, undefined, NO_STORE);
      }
      const cookie = signHelperSession(
        access.sessionKey(),
        { email, sub },
        access.now(),
        access.sessionSeconds,
        access.sessionSeconds
      );
      const reply: HelperSession = { email, grants };
      sendJson(res, 200, reply, {
        ...NO_STORE,
        'Set-Cookie': helperSessionCookie(cookie, isHttpsRequest(req), access.sessionSeconds, access.sessionSeconds),
      });
    }),

    row('helperSession', async (context) => {
      const { req, res } = context;
      if (!access.enabled) return refuse(res, 404, 'ERR_HELPERS_OFF', MESSAGES.helpersOff, undefined, NO_STORE);
      const session = access.session(req);
      if (!session) return refuse(res, 401, 'ERR_SIGN_IN_FAILED', 'You are not signed in.', undefined, NO_STORE);
      try {
        const grants = (await store.grantsFor(session.email)).filter((g) => g.email === session.email);
        const reply: HelperSession = { email: session.email, grants };
        sendJson(res, 200, reply, NO_STORE);
      } catch (err) {
        refuseStoreFailure(res, err, undefined, NO_STORE);
      }
    }),

    row('helperSignOut', (context) => {
      const { req, res } = context;
      if (!access.enabled) return refuse(res, 404, 'ERR_HELPERS_OFF', MESSAGES.helpersOff, undefined, NO_STORE);
      sendJson(
        res,
        200,
        { signedOut: true },
        {
          ...NO_STORE,
          'Set-Cookie': clearHelperSessionCookie(isHttpsRequest(req)),
        }
      );
    }),
  ];
}
