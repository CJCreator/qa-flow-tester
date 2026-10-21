import type { RoleCredential } from '@qa/types';
import type { NetDeps } from '@qa/core';
import { testCopyFor } from '../host-policy.js';
import type { RunAuthorization } from './checkup-run-types.js';

/** At least one role has both a username and a password. */
export function hasCompleteSignIn(roles?: Array<{ username?: string; password?: string }>): boolean {
  return (roles ?? []).some((r) => !!r.username && !!r.password);
}

/**
 * Whether a run only looks. Test sign-in details count as consent to full testing on this machine
 * (ADR 0022), never on a shared machine (beta). Per run: never saved.
 */
export function resolveReadOnly(input: {
  beta: boolean;
  owner: boolean;
  /** The request said `owner: true` itself. An omitted owner counts as an owner elsewhere, but never as consent. */
  ownerExplicit: boolean;
  testHost: boolean;
  signInConsent?: unknown;
  roles?: Array<{ username?: string; password?: string }>;
}): { readOnly: boolean; consent: boolean } {
  const consent = !input.beta && input.ownerExplicit && input.signInConsent === true && hasCompleteSignIn(input.roles);
  return { consent, readOnly: !(input.owner && (input.testHost || consent)) };
}

/** Why a run is read-only, in plain words. */
export function readOnlyReason(owner: boolean, testHost: boolean, unverifiedMarked = false): string {
  if (!owner) {
    return 'You didn’t say you own this site, so it’s only looked at: nothing is sent or changed. If it’s yours, start a new check-up and tick “I own this site”.';
  }
  if (!testHost && unverifiedMarked) {
    return 'This address isn’t a verified test copy yet, so it’s only looked at: nothing is sent or changed. Publish the Verified Domain line shown for it, then start a new check-up.';
  }
  if (!testHost) {
    return 'This looks like a live site, so it’s only looked at: nothing is sent or changed. If it’s a test copy of your site, start a new check-up and choose “This is a test copy”.';
  }
  return '';
}

/** The one place that decides read-only, Test Copy and consent. Used by handleTriggerRun and by checkup.ts. */
export async function resolveAuthorization(input: {
  targetUrl: string;
  owner?: boolean;
  ownerExplicit?: boolean;
  signInConsent?: boolean;
  roles?: RoleCredential[];
  testCopyMarked?: boolean;
  stagingHost?: boolean;
  beta?: boolean;
  hostChecks?: NetDeps;
  token?: () => string | undefined;
}): Promise<RunAuthorization> {
  const url = new URL(input.targetUrl);
  const owner = input.owner ?? true;
  const ownerExplicit = input.ownerExplicit ?? input.owner === true;
  const marked = input.testCopyMarked ?? input.stagingHost ?? false;
  const beta = !!input.beta;

  const testCopy = await testCopyFor({
    beta,
    hostname: url.hostname,
    origin: url.origin,
    marked,
    token: input.token ?? (() => undefined),
    deps: input.hostChecks,
  });

  const { readOnly, consent } = resolveReadOnly({
    beta,
    owner,
    ownerExplicit,
    testHost: testCopy,
    signInConsent: input.signInConsent,
    roles: input.roles,
  });

  const reason = readOnlyReason(owner, testCopy, beta && marked);

  return {
    readOnly,
    readOnlyReason: reason,
    testCopy,
    owner,
    signInConsent: consent,
  };
}

/** The keychain account a site's saved sign-in password is kept under. */
export function signInAccount(host: string, role: string): string {
  return `signin:${host.toLowerCase()}:${role}`;
}
