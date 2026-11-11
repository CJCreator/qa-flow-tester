# T-309: Plan steps and start pages stay on the target site, and sign-in placeholders fill only on the target origin

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/same-site.ts`
- `packages/core/src/credentials.ts`
- `packages/core/src/orchestrator.ts`
- `packages/core/src/discovery/plan-validator.ts`
- `packages/core/tests/plan-steps-stay-on-site.test.ts` (new)
- `packages/core/tests/redaction.test.ts`

**Do not build in parallel with:** T-247, T-252, T-310, T-312, T-316, T-318, T-329, T-342, T-358 (all edit `orchestrator.ts`); T-316, T-356 (all edit `redaction.test.ts`).

## Problem

A Plan's start pages and `navigate` steps come from the AI (journeys: `packages/core/src/plan/journeys.ts:182` asks for a "starting URL path", and the AI reads page text, so a page can steer it), from Plan edits in the wizard, and from saved Plans. The orchestrator opens them with no check:

- `packages/core/src/orchestrator.ts:740` `new URL(testCase.startPage, options.targetUrl)` and `orchestrator.ts:923` `page.goto(new URL(step.value || '', options.targetUrl)...)`. An absolute value wins over the base, so `https://other.example/`, `//other.example/` or `/\other.example/` opens another site, and any scheme is accepted. `file:///proc/self/environ` is not a network request, so the route guard never sees it (T-307), and the step's screenshot shows the runner's own files and environment on the hosted copy.
- `packages/core/src/discovery/plan-validator.ts:111` and `:116-120` read `startPage` and a `navigate` value only to find "the current page"; any value passes.

Sign-in details follow the same path. `resolveCredentialPlaceholders` (`packages/core/src/credentials.ts:22-31`) swaps `{{username}}` and `{{password}}` for the real values whatever page the browser is on (`orchestrator.ts:880`), and when the test's role has no sign-in details it takes the first role's (`credentials.ts:24`, `|| roles[0]`). A journey that navigates to, or is redirected to, another site types a Role's password there. The deterministic sign-in already refuses a cross-origin login page (`packages/core/src/preflight.ts:229-236`, `originsMatch` at `preflight.ts:60-72`); the Plan's own steps do not.

## Current code

Branch from `main`.

`packages/core/src/orchestrator.ts` (`grep -n "new URL(testCase.startPage\|new URL(step.value\|resolveCredentialPlaceholders(" packages/core/src/orchestrator.ts`):

```ts
            const startUrl = new URL(testCase.startPage, options.targetUrl).toString();
...
                    const value = resolveCredentialPlaceholders(planned, testCase.role, options.profile?.roles || []);
...
                    await page.goto(new URL(step.value || '', options.targetUrl).toString(), {
```

`packages/core/src/credentials.ts` (`grep -n "roles\[0\]" packages/core/src/credentials.ts`):

```ts
export function resolveCredentialPlaceholders(value: string, role: string, roles: RoleCredential[]): string {
  if (!value.includes('{{')) return value;
  const credential = roles.find((r) => r.role === role) || roles[0];
```

`packages/core/src/discovery/plan-validator.ts` (`grep -n "if (step.action === 'navigate')" -A 4 packages/core/src/discovery/plan-validator.ts`):

```ts
      if (step.action === 'navigate') {
        const target = normalizePath(step.value);
        currentPath = this.elementsByPath.has(target) ? target : null;
        return;
      }
```

`packages/core/src/same-site.ts` exports only `isSameSite(host, siteHost)` (import-free).

## Change

1. `same-site.ts`: add

```ts
/**
 * The full address of a Plan's start page or `navigate` step, or null when it leaves the checked App:
 * http or https only, no user name or password in it, on the target's site (its www twin included) or a host
 * on the Domain Allowlist.
 */
export function onSiteAddress(value: string, targetUrl: string, allowedHosts: string[] = []): string | null {
  try {
    const target = new URL(targetUrl);
    const u = new URL(value, target);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    const host = u.host.toLowerCase();
    const allowed = isSameSite(host, target.host) || allowedHosts.some((h) => isSameSite(host, h.toLowerCase()));
    return allowed ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A Plan path on the site itself: starts with one `/` and names no other host (`//x`, `/\x` do). */
export function isSitePath(value: string | undefined): boolean {
  if (!value || !value.startsWith('/')) return false;
  try {
    return new URL(value, 'http://site.invalid').host === 'site.invalid';
  } catch {
    return false;
  }
}
```

2. `credentials.ts`: import `isSameSite` from `./same-site.js`. Add `export class CredentialPlaceholderError extends Error {}` and change the resolver to take where the browser is:

```ts
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
  if (!value.includes(CREDENTIAL_PLACEHOLDERS.username) && !value.includes(CREDENTIAL_PLACEHOLDERS.password)) return value;
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
  if (!onSite) throw new CredentialPlaceholderError('Sign-in details are typed only on the checked site; this page is elsewhere.');
  return value
    .split(CREDENTIAL_PLACEHOLDERS.username)
    .join(credential.username || '')
    .split(CREDENTIAL_PLACEHOLDERS.password)
    .join(credential.password || '');
}
```

   The error text never names the page address or a value.

3. `orchestrator.ts`: import `onSiteAddress` from `./same-site.js`.
   - Start page (line 740): `const startUrl = onSiteAddress(testCase.startPage, options.targetUrl, options.headerHosts);` then `if (!startUrl) throw new Error(\`The start page ${testCase.startPage} is not on the checked site, so it was not opened.\`);` before `navigate(...)`. The existing catch reports it like a page that failed to load.
   - Fill step (line 880): pass `{ pageUrl: page.url(), targetUrl: options.targetUrl }` as the fourth argument.
   - Navigate step (line 923): `const to = onSiteAddress(step.value || '', options.targetUrl, options.headerHosts);` then `if (!to) throw new Error(\`Step “${step.name}” goes to ${step.value}, which is not on the checked site.\`);` and `await page.goto(to, { ... })`. The step's catch turns it into a failed step.

4. `plan-validator.ts`: import `isSitePath` from `../same-site.js`. At the top of `checkFlow`, before `if (!this.canCheck) return [];`, add:
   - when `!isSitePath(flow.startPage)`: an issue at `stepIndex: -1`, `stepName: 'Start page'`, message `The flow starts at ${flow.startPage}, which is not a path on this site. Use a path such as /pricing.`
   - for each `navigate` step whose `value` is not a site path: the issue `Step "${step.name}" goes to ${step.value}, which is not a path on this site. Use a path such as /pricing.`
   Flows with these issues are marked "needs your help" and are not run; the journeys planner already sends issues back to the AI for one repair (`plan/journeys.ts:213`).

5. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/core/tests/plan-steps-stay-on-site.test.ts` (unit tier, no browser):

- `onSiteAddress`: `'/pricing'` → `https://example.com/pricing` for target `https://example.com/`; `'https://www.example.com/a'` is kept; `'https://other.example/'`, `'//other.example/'`, `'/\\other.example/'`, `'file:///etc/passwd'`, `'javascript:alert(1)'`, `'data:text/html,x'`, `'chrome://settings'` and `'https://user:pw@example.com/'` → null; `'https://auth.partner.example/login'` → kept only when `['auth.partner.example']` is passed as allowed hosts.
- `isSitePath`: true for `/`, `/a/b?x=1`; false for `''`, `pricing`, `//x`, `/\\x`, `https://example.com/`, `file:///x`.
- `resolveCredentialPlaceholders` with roles `[{ role: 'manager', username: 'm@example.com', password: 'pw' }]`:
  - on `https://example.com/login` with target `https://example.com/` (and on `https://www.example.com/login`): `{{password}}` → `pw`.
  - on `https://other.example/login`: throws `CredentialPlaceholderError`.
  - on `http://example.com/login` with target `https://example.com/`: throws (no password over a downgraded page).
  - role `visitor` (no details): throws; it no longer types the manager's password.
  - a value with no placeholder (`hello`) is returned unchanged on any page.
- `PlanValidator.checkFlow` with the `pages` fixture style of `plan-validator.test.ts`: a flow with `startPage: 'https://other.example/'` gets the start-page issue; a `navigate` step to `//other.example/x` gets the step issue; a flow with `startPage: '/dashboard'` and `navigate` to `/invoices/new` gets neither.

`packages/core/tests/redaction.test.ts`: the test at the `resolveCredentialPlaceholders` lines passes `{ pageUrl: 'https://example.com/login', targetUrl: 'https://example.com/' }`; the `someone-else` case now expects a throw (`toThrow(CredentialPlaceholderError)`) instead of the first role's username.

Run: `pnpm exec vitest run packages/core/tests/plan-steps-stay-on-site.test.ts packages/core/tests/redaction.test.ts packages/core/tests/plan-validator.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "new URL(testCase.startPage, options.targetUrl).toString()\|new URL(step.value" packages/core/src/orchestrator.ts` prints nothing.
- [ ] `grep -n "roles\[0\]" packages/core/src/credentials.ts` prints nothing.
- [ ] `grep -n "isSitePath" packages/core/src/discovery/plan-validator.ts` finds the start-page and navigate checks.
- [ ] The new test and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding H7 (audit of 11 Nov 2026 on `d225418`).
- This applies the host confinement of ADR 0003 to a Plan's own steps; it loosens nothing, so no new ADR.
- The orchestrator is the boundary: Plan edits from the wizard and saved Plans reach it without the validator. The validator only makes the AI repair its answer early.
- `orchestrator.ts:418` opens `roleLandingPaths` (where the browser landed after sign-in) the same way. It comes from the site's own redirect, not the Plan; not changed here.
- T-316 (redaction on every exit), T-318 (token and header Roles) and T-329 (visual baselines) also edit `orchestrator.ts`; so do T-247 and T-252.
