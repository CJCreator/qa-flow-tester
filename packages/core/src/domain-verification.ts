import { isIpLiteral, isPrivateTextHost, isPublicAddress } from './address-class.js';

/**
 * Verified Domain proof and the Test Copy decision on a shared machine (ADR 0014). Pure: no network,
 * no Node imports (only the pure address classifier), so the wizard can share it.
 */

export const PROOF_PATH = '/.well-known/qa-verify.txt';

/** The address of the proof file for an exact origin, or null when that origin cannot be verified. */
export function proofUrl(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname;
  if (!host || isIpLiteral(host) || isPrivateTextHost(host)) return null;
  return `https://${url.host}${PROOF_PATH}`;
}

/** The one line the proof file must hold. */
export function proofLine(token: string): string {
  return `qa-verify=${token}`;
}

/** True only when the body is exactly the line for this token (surrounding whitespace ignored). */
export function proofMatches(body: string, token: string): boolean {
  if (!token) return false;
  return body.replace(/^\uFEFF/, '').trim() === proofLine(token);
}

export type TestCopyReason = 'local' | 'not-marked' | 'dns-failed' | 'bad-address' | 'not-verified' | 'verified-marked';

/**
 * Local mode: a test copy is a text-only test host or one the owner marked (as before). Shared machine:
 * marked AND every resolved address public AND the proof passed. Anything missing is live and read-only.
 */
export function decideTestCopy(i: {
  shared: boolean;
  textTestHost: boolean;
  marked: boolean;
  addresses: string[];
  proofOk: boolean;
}): { testCopy: boolean; reason: TestCopyReason } {
  if (!i.shared) return { testCopy: i.textTestHost || i.marked, reason: 'local' };
  if (!i.marked) return { testCopy: false, reason: 'not-marked' };
  if (i.addresses.length === 0) return { testCopy: false, reason: 'dns-failed' };
  if (!i.addresses.every(isPublicAddress)) return { testCopy: false, reason: 'bad-address' };
  if (!i.proofOk) return { testCopy: false, reason: 'not-verified' };
  return { testCopy: true, reason: 'verified-marked' };
}
