/**
 * Helper access (REQ-033, ADR 0037, Q-15): whether Helper sign-in is on, who the signed-in Helper is, and what
 * they may do on the Website Audit a request names. Grants are read from the audit store on every request,
 * so removing a grant takes effect on the Helper's next request without signing them out (REQ-033 AC-2).
 *
 * `helperGrants` is the hook BE-102's dispatch calls for 'view' | 'edit' | 'export' rows. `refusal` gives the
 * answer for a signed-in Helper the dispatch refused: 404 ERR_AUDIT_NOT_FOUND for an audit not given to them
 * (its existence is not revealed), 403 ERR_FORBIDDEN on an owner-only row or without the permission.
 */
import type http from 'http';
import type { AuditAccess, AuditErrorCode, HelperGrant, HelperPermission } from '@qa/types';
import { FirebaseTokenVerifier, type KeysFetch } from './firebase-token.js';
import {
  HELPER_SESSION_KEY_BYTES,
  newHelperSessionKey,
  readHelperSession,
  type HelperSessionClaims,
} from './helper-session.js';

/** The store calls Helper access needs; the audit store (BE-601) provides them. */
export interface HelperGrantSource {
  grantsFor(email: string): Promise<HelperGrant[]>;
}

/** Public Firebase web settings the wizard's sign-in needs (not secrets). */
export interface FirebaseWebSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

export interface HelperAccessSettings {
  /** FIREBASE_PROJECT_ID. Helper sign-in is off without it. */
  projectId?: string;
  /** RUNNER_ACCESS_TOKEN. Helper sign-in is off without it: with no key every local caller is the owner (DEC-004). */
  accessToken?: string;
  /** FIREBASE_WEB_API_KEY: sent to the wizard with the status when set. */
  webApiKey?: string;
  /** FIREBASE_AUTH_DOMAIN. Default `<projectId>.firebaseapp.com`. */
  authDomain?: string;
}

/** The settings from the environment, by name. Values are only passed on, never printed. */
export function helperSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): HelperAccessSettings {
  return {
    projectId: env.FIREBASE_PROJECT_ID,
    accessToken: env.RUNNER_ACCESS_TOKEN,
    webApiKey: env.FIREBASE_WEB_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
  };
}

export interface HelperAccessOptions extends HelperAccessSettings {
  store: HelperGrantSource;
  /** Key download for the token check; tests inject a fake. */
  fetch?: KeysFetch;
  now?: () => Date;
  /**
   * Tests only: the cookie signing key (at least 32 bytes). Default: 32 random bytes made when this
   * HelperAccess is created, held in memory only (DEC-011). Never derive it from the access key.
   */
  sessionKey?: Buffer;
}

/** A refusal in the audit error model. */
export interface HelperRefusal {
  status: 403 | 404;
  code: AuditErrorCode;
  error: string;
}

export const AUDIT_NOT_FOUND_REFUSAL = 'Website Audit not found.';
export const FORBIDDEN_REFUSAL = 'A Helper cannot do this.';

/** The permissions a grant gives: 'edit' and 'export' include 'view'. */
export function grantedPermissions(grant: Pick<HelperGrant, 'permissions'>): Set<HelperPermission> {
  const set = new Set<HelperPermission>();
  for (const permission of grant.permissions) {
    if (permission === 'view' || permission === 'edit' || permission === 'export') set.add(permission);
  }
  if (set.size > 0) set.add('view');
  return set;
}

/** The one permission check: does a grant (stored permissions, as-is) allow `needed`, with edit/export including view? */
export function allows(grant: Pick<HelperGrant, 'permissions'>, needed: HelperPermission): boolean {
  return grantedPermissions(grant).has(needed);
}

function isHelperPermission(access: AuditAccess | undefined): access is HelperPermission {
  return access === 'view' || access === 'edit' || access === 'export';
}

export class HelperAccess {
  /**
   * Helper sign-in is on: FIREBASE_PROJECT_ID and RUNNER_ACCESS_TOKEN are both set. The access key only
   * switches sign-in on; Helper sessions are signed with this instance's own random key, so another
   * HelperAccess (or a runner restart) refuses them.
   */
  readonly enabled: boolean;
  /** Present only when enabled. */
  readonly verifier: FirebaseTokenVerifier | null;
  /** The wizard's Firebase settings; null when off or without a web API key. */
  readonly firebaseWeb: FirebaseWebSettings | null;
  readonly store: HelperGrantSource;
  readonly now: () => Date;
  private readonly key: Buffer | null;

  constructor(options: HelperAccessOptions) {
    const projectId = options.projectId?.trim() || '';
    const accessToken = options.accessToken?.trim() || '';
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.enabled = projectId !== '' && accessToken !== '';
    if (this.enabled && options.sessionKey && options.sessionKey.length < HELPER_SESSION_KEY_BYTES) {
      throw new Error('A Helper session key needs at least 32 bytes.');
    }
    this.key = this.enabled ? (options.sessionKey ? Buffer.from(options.sessionKey) : newHelperSessionKey()) : null;
    this.verifier = this.enabled ? new FirebaseTokenVerifier({ projectId, fetch: options.fetch, now: this.now }) : null;
    const apiKey = options.webApiKey?.trim() || '';
    this.firebaseWeb =
      this.enabled && apiKey
        ? { apiKey, authDomain: options.authDomain?.trim() || `${projectId}.firebaseapp.com`, projectId }
        : null;
  }

  /** The cookie signing key; throws when Helper sign-in is off (callers check `enabled` first). */
  sessionKey(): Buffer {
    if (!this.key) throw new Error('Helper sign-in is off.');
    return this.key;
  }

  /** The signed-in Helper, or null (off, no cookie, tampered or expired). */
  session(req: http.IncomingMessage): HelperSessionClaims | null {
    if (!this.key) return null;
    return readHelperSession(this.key, req, this.now());
  }

  /** The Helper's grant on this audit, read from the store now; null when none. */
  async grantOn(email: string, auditId: string): Promise<HelperGrant | null> {
    const grants = await this.store.grantsFor(email);
    return grants.find((g) => g.auditId === auditId && g.email === email) ?? null;
  }

  /**
   * The dispatch hook (RunnerServerOptions.helperGrants): the permissions the signed-in Helper holds on the
   * audit `params.id` names. A row without `:id` grants nothing, so no Helper reaches cross-audit lists.
   */
  helperGrants = async (
    req: http.IncomingMessage,
    params: Readonly<Record<string, string>>
  ): Promise<HelperPermission[]> => {
    const session = this.session(req);
    const auditId = params.id;
    if (!session || !auditId) return [];
    const grant = await this.grantOn(session.email, auditId);
    return grant ? [...grantedPermissions(grant)] : [];
  };

  /**
   * The answer for a request the dispatch refused, when it comes from a signed-in Helper without the access
   * key; null otherwise (keep the dispatch's own refusal). Owner rows: 403 ERR_FORBIDDEN. View/edit/export
   * rows: 404 ERR_AUDIT_NOT_FOUND when the audit is not given to this Helper, 403 ERR_FORBIDDEN when it is but
   * without the permission.
   */
  async refusal(
    req: http.IncomingMessage,
    access: AuditAccess | undefined,
    params: Readonly<Record<string, string>>
  ): Promise<HelperRefusal | null> {
    const session = this.session(req);
    if (!session) return null;
    if (access === 'owner') return { status: 403, code: 'ERR_FORBIDDEN', error: FORBIDDEN_REFUSAL };
    if (!isHelperPermission(access)) return null;
    const auditId = params.id;
    let grant: HelperGrant | null = null;
    if (auditId) {
      try {
        grant = await this.grantOn(session.email, auditId);
      } catch {
        grant = null;
      }
    }
    if (!grant) {
      return auditId
        ? { status: 404, code: 'ERR_AUDIT_NOT_FOUND', error: AUDIT_NOT_FOUND_REFUSAL }
        : { status: 403, code: 'ERR_FORBIDDEN', error: FORBIDDEN_REFUSAL };
    }
    return allows(grant, access) ? null : { status: 403, code: 'ERR_FORBIDDEN', error: FORBIDDEN_REFUSAL };
  }
}

export function createHelperAccess(options: HelperAccessOptions): HelperAccess {
  return new HelperAccess(options);
}
