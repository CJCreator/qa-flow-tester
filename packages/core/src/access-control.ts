import type { BrowserContext } from 'playwright';
import type { Finding } from '@qa/types';

/**
 * Passive access checks (ADR 0030): plain GETs, no payloads, no Origin header, no redirects followed.
 * Signed-out access to pages only a signed-in Role reached, and one Role's page showing another Role's
 * name. Findings name roles and paths, never a username, cookie or token.
 */

export interface AccessResponse {
  status: number;
  location?: string;
  body: string;
}
export type AccessFetcher = (url: string) => Promise<AccessResponse | undefined>;

export const ACCESS_CHECK_PATH_CAP = 25;
export const ACCESS_CHECKS_NOTE = 'Access checks read pages only; no payloads were sent.';

const RISKY_GET = /log-?out|sign-?out|delete|remove|destroy|unsubscribe|cancel|reset|checkout|purchase|\bpay\b/i;
const SIGN_IN_LOCATION = /log-?in|sign-?in|sign_in|auth|session|sso/i;
const PUBLIC_ROLES = new Set(['visitor', 'anonymous']);

/** A signed-out request to a role-only page. Returns a Blocker when the content was served. */
export function checkSignedOutAccess(params: {
  target: string;
  status: number;
  redirectedToSignIn: boolean;
  hasProtectedContent: boolean;
}): Finding | undefined {
  const { target, status, redirectedToSignIn, hasProtectedContent } = params;
  if (redirectedToSignIn || status === 401 || status === 403) return undefined;
  if (status < 200 || status >= 300 || !hasProtectedContent) return undefined;
  return {
    id: `F-ACCESS-OPEN-${target.replace(/[^a-zA-Z0-9]/g, '_')}`,
    severity: 'Blocker',
    checker: 'permission-matrix',
    title: `Found: "${target}" opens without signing in`,
    where: { urlPath: target, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: {
      expected: 'A page only a signed-in role reached asks for sign-in, or answers 401 or 403, when opened signed out',
      actual: `A plain request with no sign-in got HTTP ${status} and the page content`,
    },
    stepsToReproduce: [`Open ${target} in a browser that is not signed in`, 'Observe the page content is served'],
    evidence: {},
    resolution: `Check on the server that "${target}" requires a signed-in user. Hiding the link is not enough.`,
  };
}

/** Role B's response to a page of Role A carried Role A's name. Names the roles only. */
export function checkSessionIsolation(params: {
  target: string;
  roleA: string;
  roleB: string;
  markerSeenByB: boolean;
}): Finding | undefined {
  const { target, roleA, roleB, markerSeenByB } = params;
  if (!markerSeenByB) return undefined;
  return {
    id: `F-ACCESS-ISOLATION-${roleA}-${roleB}-${target.replace(/[^a-zA-Z0-9]/g, '_')}`,
    severity: 'Blocker',
    checker: 'permission-matrix',
    title: `Found: "${target}" shows the "${roleA}" role's details to the "${roleB}" role`,
    where: { urlPath: target, role: roleB, breakpoint: '1440px' },
    expectedVsActual: {
      expected: `A page opened as "${roleB}" shows only "${roleB}" details`,
      actual: `The page opened as "${roleB}" contained the sign-in name of "${roleA}"`,
    },
    stepsToReproduce: [
      `Sign in as "${roleA}" and open ${target}`,
      `Sign in as "${roleB}" in a separate browser and open ${target}`,
      `Look for the "${roleA}" name on the "${roleB}" page`,
    ],
    evidence: {},
    resolution: `Check that "${target}" builds its answer from the current session only, and is not cached or shared between users.`,
  };
}

export interface AccessCheckInput {
  targetUrl: string;
  /** Pages found by discovery. A page reached only by signed-in roles is role-only. */
  pages: Array<{ urlPath: string; reachedBy?: string[] }>;
  /** A request with no cookies and no sign-in. */
  signedOut: AccessFetcher;
  /** One fetcher per signed-in role (its own isolated session). */
  roles: Record<string, AccessFetcher>;
  /** Sign-in name per role; only used to look for it in another role's page, never reported. */
  markers: Record<string, string | undefined>;
  /** Host policy (ADR 0014); a URL it refuses is not requested. */
  allow?: (url: string) => Promise<boolean>;
}

export interface AccessCheckOutput {
  findings: Finding[];
  notes: string[];
  checkedPaths: number;
}

function hasSignInForm(body: string): boolean {
  return /type\s*=\s*["']?password/i.test(body);
}

export async function runAccessChecks(input: AccessCheckInput): Promise<AccessCheckOutput> {
  const findings: Finding[] = [];
  const notes: string[] = [];
  const origin = new URL(input.targetUrl).origin;
  const roleNames = Object.keys(input.roles);

  const roleOnly = input.pages
    .filter((p) => {
      const by = p.reachedBy ?? [];
      return by.length > 0 && !by.some((r) => PUBLIC_ROLES.has(r));
    })
    .filter((p) => !RISKY_GET.test(p.urlPath));
  const skippedOver = Math.max(0, roleOnly.length - ACCESS_CHECK_PATH_CAP);
  const paths = roleOnly.slice(0, ACCESS_CHECK_PATH_CAP);

  const permitted = async (url: string): Promise<boolean> => {
    if (new URL(url).origin !== origin) return false;
    return input.allow ? await input.allow(url).catch(() => false) : true;
  };

  for (const page of paths) {
    const url = new URL(page.urlPath, input.targetUrl).toString();
    if (!(await permitted(url))) continue;
    const owner = (page.reachedBy ?? []).find((r) => input.roles[r]) ?? roleNames[0];
    const own = owner ? await input.roles[owner]?.(url).catch(() => undefined) : undefined;
    // Only a page that signed in works for its owner is worth asking about signed out.
    if (!own || own.status < 200 || own.status >= 300 || hasSignInForm(own.body)) continue;

    const out = await input.signedOut(url).catch(() => undefined);
    if (out) {
      const redirected = out.status >= 300 && out.status < 400 && SIGN_IN_LOCATION.test(out.location ?? '');
      const finding = checkSignedOutAccess({
        target: page.urlPath,
        status: out.status,
        redirectedToSignIn: redirected,
        hasProtectedContent: out.body.trim().length > 0 && !hasSignInForm(out.body),
      });
      if (finding) findings.push(finding);
    }

    if (roleNames.length >= 2 && owner) {
      const marker = input.markers[owner];
      if (marker && marker.length >= 4 && own.body.includes(marker)) {
        for (const other of roleNames) {
          if (other === owner) continue;
          const otherMarker = input.markers[other];
          if (otherMarker && (otherMarker.includes(marker) || marker.includes(otherMarker))) continue;
          const res = await input.roles[other]?.(url).catch(() => undefined);
          if (!res || res.status < 200 || res.status >= 300) continue;
          const finding = checkSessionIsolation({
            target: page.urlPath,
            roleA: owner,
            roleB: other,
            markerSeenByB: res.body.includes(marker),
          });
          if (finding) findings.push(finding);
        }
      }
    }
  }

  if (paths.length > 0) notes.push(ACCESS_CHECKS_NOTE);
  if (skippedOver > 0)
    notes.push(
      `Access checks covered the first ${ACCESS_CHECK_PATH_CAP} role-only pages; ${skippedOver} more were not checked.`
    );
  if (roleNames.length === 1 && paths.length > 0) {
    notes.push('Only one role signed in, so the two-role isolation check was not run.');
  }
  return { findings, notes, checkedPaths: paths.length };
}

/** A GET through a browser context's request client: its own cookies, no redirects followed. */
export function contextFetcher(context: BrowserContext): AccessFetcher {
  return async (url) => {
    const res = await context.request.get(url, { maxRedirects: 0, timeout: 15000, failOnStatusCode: false });
    const headers = res.headers();
    const body = (await res.text().catch(() => '')).slice(0, 200_000);
    return { status: res.status(), location: headers['location'], body };
  };
}
