import type { RoleCredential, TestCaseStep } from '@qa/types';
import { isSameSite } from './same-site.js';

export class CredentialPlaceholderError extends Error {}

/**
 * Plans, drafts and reports never hold sign-in details. A step that types them says one of these
 * placeholders, and the runner puts in the role's real value just before typing.
 */
export const CREDENTIAL_PLACEHOLDERS = {
  username: '{{username}}',
  password: '{{password}}',
} as const;

/** Swaps any role's real username or password in fill steps for its placeholder, in place. */
export function replaceCredentialsWithPlaceholders(steps: TestCaseStep[], roles: RoleCredential[]): void {
  for (const step of steps) {
    if (step.action !== 'fill' || !step.value) continue;
    if (roles.some((r) => r.password && step.value === r.password)) step.value = CREDENTIAL_PLACEHOLDERS.password;
    else if (roles.some((r) => r.username && step.value === r.username)) step.value = CREDENTIAL_PLACEHOLDERS.username;
  }
}

/**
 * The value to actually type: placeholders become the test's own Role's real details, and only on a page of
 * the checked App (same site and same scheme as the target). Throws, typing nothing, when the Role has no
 * sign-in details or the page is elsewhere.
 */
export function resolveCredentialPlaceholders(
  value: string,
  role: string,
  roles: RoleCredential[],
  where: { pageUrl: string; targetUrl: string }
): string {
  if (!value.includes(CREDENTIAL_PLACEHOLDERS.username) && !value.includes(CREDENTIAL_PLACEHOLDERS.password))
    return value;
  const credential = roles.find((r) => r.role === role);
  if (!credential) throw new CredentialPlaceholderError(`The Role “${role}” has no sign-in details to type here.`);
  let onSite = false;
  try {
    const page = new URL(where.pageUrl);
    const target = new URL(where.targetUrl);
    onSite = page.protocol === target.protocol && isSameSite(page.host, target.host);
  } catch {
    onSite = false;
  }
  if (!onSite)
    throw new CredentialPlaceholderError('Sign-in details are typed only on the checked site; this page is elsewhere.');
  return value
    .split(CREDENTIAL_PLACEHOLDERS.username)
    .join(credential.username || '')
    .split(CREDENTIAL_PLACEHOLDERS.password)
    .join(credential.password || '');
}
