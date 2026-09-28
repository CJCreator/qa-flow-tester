import type { RoleCredential, TestCaseStep } from '@qa/types';

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

/** The value to actually type: placeholders become the role's real details (or the first role's). */
export function resolveCredentialPlaceholders(value: string, role: string, roles: RoleCredential[]): string {
  if (!value.includes('{{')) return value;
  const credential = roles.find((r) => r.role === role) || roles[0];
  if (!credential) return value;
  return value
    .split(CREDENTIAL_PLACEHOLDERS.username)
    .join(credential.username || '')
    .split(CREDENTIAL_PLACEHOLDERS.password)
    .join(credential.password || '');
}
