import type http from 'http';
import { matchAuditPath, type AuditAccess, type HelperPermission } from '@qa/types';
import type { RunnerServer } from '../server.js';

/** Path parameters of a matched row (`:id`, `:linkId`), decoded and already checked against their rule. */
export type RouteParams = Readonly<Record<string, string>>;

/** What a handler is given. Grows in the follow-up plan; kept minimal on purpose. */
export interface RouteContext {
  readonly server: RunnerServer; // for the plan rows in this wave; T-207 replaces this with the session
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly url: URL;
  /** The row's path parameters; empty for rows without any. */
  readonly params?: RouteParams;
}

/** Whether a row is served on a beta copy (RUNNER_BETA=1). Missing means 'closed'. */
export type RouteBetaPolicy = 'allow' | 'closed';

export interface Route {
  /** 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS' | '*'. */
  method?: string;
  /**
   * Exact path, or an array of exact paths (aliases such as abort/stop). A segment `:id` or `:linkId` is a
   * parameter that must meet `AUDIT_ID_PATTERN` / `SHARE_LINK_ID_PATTERN`; anything else is no match.
   */
  path: string | string[];
  /** Prefix rows match `/api/runs/…`-style paths; the handler gets the full URL. */
  prefix?: boolean;
  /** Some rows accept any method (today's `/api/runner/waiting-plans`). */
  anyMethod?: boolean;
  /**
   * Who may call the row. Required by dispatch: a row without one is refused (closed by default).
   * 'scheduler' is route-only (ADR 0039): the Cloud Scheduler job, proven by a Google-signed OIDC token.
   */
  access?: AuditAccess | 'scheduler';
  /** Served on a beta copy only when 'allow'. Default 'closed'. */
  beta?: RouteBetaPolicy;
  handle: (context: RouteContext) => Promise<void> | void;
}

/** Fallback 404 handler when no route or UI matched. */
export function sendNotFound(res: http.ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

export const notFound = sendNotFound;
export const fallbackNotFound = sendNotFound;

/** A matched row and its path parameters. */
export interface RouteMatch {
  route: Route;
  params: RouteParams;
}

const NO_PARAMS: RouteParams = Object.freeze({});

/** An exact or parameter path against the pathname: its params, or null when it does not match. */
function matchExactPath(path: string, pathname: string): RouteParams | null {
  if (!path.includes('/:')) return path === pathname ? NO_PARAMS : null;
  return matchAuditPath(path, pathname) as RouteParams | null;
}

/**
 * The first row that matches wins, with its parameters. Exact and parameter rows beat prefix rows at the
 * same path; between themselves they rank in table order. A parameter that fails its rule is no match.
 */
export function resolveRoute(routes: readonly Route[], method: string, pathname: string): RouteMatch | undefined {
  const normMethod = (method ?? 'GET').toUpperCase();
  let firstPrefixMatch: Route | undefined;

  for (const route of routes) {
    const methodMatches =
      Boolean(route.anyMethod) ||
      route.method === '*' ||
      (route.method !== undefined && route.method.toUpperCase() === normMethod);
    if (!methodMatches) continue;

    const paths = Array.isArray(route.path) ? route.path : [route.path];

    if (!route.prefix) {
      for (const p of paths) {
        const params = matchExactPath(p, pathname);
        if (params) return { route, params };
      }
    } else {
      if (!firstPrefixMatch) {
        const matches = paths.some((p) => {
          if (pathname === p) return true;
          const prefixWithSlash = p.endsWith('/') ? p : `${p}/`;
          if (pathname.startsWith(prefixWithSlash)) return true;
          if (p.endsWith('/') && pathname === p.slice(0, -1)) return true;
          return false;
        });
        if (matches) {
          firstPrefixMatch = route;
        }
      }
    }
  }

  return firstPrefixMatch ? { route: firstPrefixMatch, params: NO_PARAMS } : undefined;
}

/** The first row that matches wins. Exact rows beat prefix rows at the same path. */
export function matchRoute(routes: readonly Route[], method: string, pathname: string): Route | undefined {
  return resolveRoute(routes, method, pathname)?.route;
}

export type { HelperPermission };

/** Loopback socket addresses: the local machine (DEC-004). */
const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The request's socket address is the local machine. Consulted only when no access key is set (DEC-004). */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

/** Who is asking, as far as a row's access level cares. */
export interface RouteCaller {
  /**
   * The request carries the owner's access key. With no key set, true only for a request from the local
   * machine (loopback socket address, DEC-004).
   */
  hasAccessKey: boolean;
  /** The runner is a beta copy (RUNNER_BETA=1). */
  beta: boolean;
  /**
   * Does a signed-in Helper hold `permission` on the audit this request names? The hook REQ-033 supplies;
   * missing means no Helper.
   */
  helper?: (permission: HelperPermission) => boolean;
  /** The request carries a valid Google-signed scheduler token (ADR 0039). Missing means no. */
  scheduler?: boolean;
  /**
   * The caller is signed in with a Google account whose email is in AUDIT_OWNER_EMAILS (ADR 0042 / T-86).
   * The access key is `hasAccessKey`, never this. Passes 'owner' and audit rows on a beta copy.
   */
  auditOwner?: boolean;
}

export type RouteDecision = { allow: true } | { allow: false; status: 401 | 403; code: string; error: string };

export const ACCESS_KEY_REFUSAL = 'This QA Tool is shared privately: send its access key.';
export const BETA_REFUSAL = 'This is closed on the shared beta copy, so testers don’t change each other’s check-ups.';
export const CLOSED_REFUSAL = 'This address is not open.';
/** Fixed text: says nothing about why the scheduler token was refused. */
export const SCHEDULER_REFUSAL = 'The scheduler token was refused.';

const ALLOW: RouteDecision = { allow: true };

function isHelperPermission(access: AuditAccess | 'scheduler'): access is HelperPermission {
  return access === 'view' || access === 'edit' || access === 'export';
}

/**
 * May this caller use this row? Pure: no request, no I/O. Closed by default: a row without an access level
 * is refused. 'owner' needs the access key; 'view' | 'edit' | 'export' the key or a Helper grant of that
 * permission; 'scheduler' a valid scheduler token (no key); 'sign-in' and 'public' neither. On a beta copy only rows whose beta policy is 'allow' are
 * served, plus Helper sign-in rows and rows a signed-in Helper holds a grant for (D-004, D-005).
 */
export function authorizeRoute(route: Pick<Route, 'access' | 'beta'>, caller: RouteCaller): RouteDecision {
  const access = route.access;
  if (!access) return { allow: false, status: 403, code: 'ERR_ROUTE_CLOSED', error: CLOSED_REFUSAL };

  let helperGranted = false;
  const isOwner = caller.hasAccessKey || caller.auditOwner === true;
  if (access === 'owner') {
    if (!isOwner) return { allow: false, status: 401, code: 'ERR_ACCESS_KEY', error: ACCESS_KEY_REFUSAL };
  } else if (isHelperPermission(access)) {
    helperGranted = caller.helper?.(access) === true;
    if (!isOwner && !helperGranted) {
      return { allow: false, status: 401, code: 'ERR_ACCESS_KEY', error: ACCESS_KEY_REFUSAL };
    }
  } else if (access === 'scheduler') {
    if (caller.scheduler !== true) {
      return { allow: false, status: 401, code: 'ERR_SCHEDULER_AUTH', error: SCHEDULER_REFUSAL };
    }
  } else if (access !== 'sign-in' && access !== 'public') {
    // An access level this code doesn't know is closed too.
    return { allow: false, status: 403, code: 'ERR_ROUTE_CLOSED', error: CLOSED_REFUSAL };
  }

  if (caller.beta) {
    const auditOwnerAllowed = caller.auditOwner === true && (access === 'owner' || isHelperPermission(access));
    const servedInBeta = route.beta === 'allow' || access === 'sign-in' || helperGranted || auditOwnerAllowed;
    if (!servedInBeta) return { allow: false, status: 403, code: 'ERR_BETA', error: BETA_REFUSAL };
  }
  return ALLOW;
}
