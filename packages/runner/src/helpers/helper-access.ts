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
import { createHash } from 'crypto';
import {
  ACCOUNT_SESSION_SECONDS,
  HELPER_SESSION_KEY_BYTES,
  HELPER_SESSION_SECONDS,
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
  /**
   * RUNNER_SESSION_SECRET (Secret Manager `qa-session-secret`): turns on account mode (ADR 0050). The sign-in
   * cookie is signed with a key made from it, so it survives a cold start, and lasts 7 days. At least 32
   * characters; a shorter or empty value is ignored (random key, 8 hours, no account mode).
   */
  sessionSecret?: string;
  /** AUDIT_OWNER_EMAILS: emails of Google accounts that pass owner audit rows on a beta copy. */
  auditOwnerEmails?: readonly string[];
  /** AUDIT_DAILY_LIMIT: daily audit starts per owner email per UTC day. */
  auditDailyLimit?: number;
}

/** Parses comma-separated owner emails from string or array into normalized, lower-cased array. */
export function parseOwnerEmails(raw?: string | readonly string[]): string[] {
  if (!raw) return [];
  const list: readonly string[] = typeof raw === 'string' ? raw.split(',') : raw;
  return list.map((s: string) => s.trim().toLowerCase()).filter(Boolean);
}

/** The settings from the environment, by name. Values are only passed on, never printed. */
export function helperSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): HelperAccessSettings {
  return {
    projectId: env.FIREBASE_PROJECT_ID,
    accessToken: env.RUNNER_ACCESS_TOKEN,
    sessionSecret: env.RUNNER_SESSION_SECRET,
    webApiKey: env.FIREBASE_WEB_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    auditOwnerEmails: parseOwnerEmails(env.AUDIT_OWNER_EMAILS),
    auditDailyLimit: env.AUDIT_DAILY_LIMIT ? parseInt(env.AUDIT_DAILY_LIMIT, 10) : undefined,
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

/** Shortest RUNNER_SESSION_SECRET that is used. */
export const MIN_SESSION_SECRET_CHARS = 32;

/** The cookie signing key made from RUNNER_SESSION_SECRET: its SHA-256, so any 32+ character secret fits. */
export function sessionKeyFromSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
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
  readonly auditOwnerEmails: readonly string[];
  readonly auditDailyLimit?: number;
  /**
   * Account mode (ADR 0050): a stable RUNNER_SESSION_SECRET is set, so any verified Google account is a way in
   * to the Check-up routes of a beta copy. Off without it: a signed-in Helper only reaches Website Audits.
   */
  readonly accounts: boolean;
  /** Longest sign-in: 7 days in account mode, else 8 hours. */
  readonly sessionSeconds: number;
  private readonly key: Buffer | null;

  constructor(options: HelperAccessOptions) {
    const projectId = options.projectId?.trim() || '';
    const accessToken = options.accessToken?.trim() || '';
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.auditOwnerEmails = parseOwnerEmails(options.auditOwnerEmails);
    this.auditDailyLimit = options.auditDailyLimit;
    const secret = options.sessionSecret?.trim() || '';
    this.accounts = projectId !== '' && secret.length >= MIN_SESSION_SECRET_CHARS;
    this.sessionSeconds = this.accounts ? ACCOUNT_SESSION_SECONDS : HELPER_SESSION_SECONDS;
    // The access key switches Helper sign-in on; so does a stable session secret (accounts need no key to sign in).
    this.enabled = projectId !== '' && (accessToken !== '' || this.accounts);
    if (this.enabled && options.sessionKey && options.sessionKey.length < HELPER_SESSION_KEY_BYTES) {
      throw new Error('A Helper session key needs at least 32 bytes.');
    }
    this.key = this.enabled
      ? options.sessionKey
        ? Buffer.from(options.sessionKey)
        : this.accounts
          ? sessionKeyFromSecret(secret)
          : newHelperSessionKey()
      : null;
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

  /** Whether this email is in AUDIT_OWNER_EMAILS. */
  isAuditOwner(email?: string): boolean {
    if (!email) return false;
    return this.auditOwnerEmails.includes(email.trim().toLowerCase());
  }

  /** The signed-in Helper, or null (off, no cookie, tampered or expired). */
  session(req: http.IncomingMessage): HelperSessionClaims | null {
    if (!this.key) return null;
    return readHelperSession(this.key, req, this.now(), this.sessionSeconds);
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
    if (this.isAuditOwner(session.email)) return null;
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
