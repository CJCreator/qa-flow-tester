# T-162: analytics cookies are reported as session cookies missing HttpOnly

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | todo |

**Files you may edit (no others):**
- `packages/checkers/src/security.ts`
- `packages/checkers/tests/security.test.ts`

**Do not build in parallel with:** T-175, T-177 (same source file).

## Problem
The cookie check decides a cookie is a session or sign-in cookie when its name contains `session`, `auth`, `token`, `jwt`, `id`, `sid` or `user` anywhere. `id` and `user` match inside ordinary analytics cookie names, so `_gid`, `__stripe_mid`, `ajs_anonymous_id` and `_hjSessionUser_123` each get a Major finding "Sensitive session cookie ... is missing HttpOnly flag". These cookies are set by page scripts and can never be HttpOnly. Each name becomes its own problem in the report.

## Current code
`packages/checkers/src/security.ts:196` (branch `worktree-audit-cleanup`)
```ts
        const isAuthOrSession = /(?:session|auth|token|jwt|id|sid|user)/i.test(cookie.name);
```

## Change
1. Add this constant near the other module-level constants at the top of `packages/checkers/src/security.ts` (for example next to `STACK_TRACE_PATTERN`):
```ts
/**
 * Cookie names that hold a session or a sign-in: a known framework name, or a name with one of these
 * words as a whole part (split on `_`, `-`, `.`). A bare "id" or "user" inside a longer name
 * (`_gid`, `ajs_anonymous_id`) is an analytics cookie, not a session.
 */
const SESSION_COOKIE_NAME =
  /^(?:PHPSESSID|JSESSIONID|connect\.sid|ASP\.NET_SessionId|sessionid|sid)$|(?:^|[_.-])(?:session|sess|auth|token|jwt)(?:$|[_.-])/i;

/**
 * Names that match the words above but must stay readable by page scripts: analytics and tag-manager
 * cookies, and CSRF tokens (the page reads them to send them back in a header).
 */
const SCRIPT_READ_COOKIE_NAME = /^(?:_ga|_gid|_gat|_gcl|_fbp|_hj|ajs_|amp_|mp_|__utm|_clck|_clsk|__stripe_)|csrf|xsrf/i;
```
2. Replace the line shown above with:
```ts
        const isAuthOrSession = SESSION_COOKIE_NAME.test(cookie.name) && !SCRIPT_READ_COOKIE_NAME.test(cookie.name);
```

## Tests
Edit `packages/checkers/tests/security.test.ts`. Copy the set-up of the existing test `cookie flags: Secure only on https, HttpOnly on session cookies, no values in text` (it builds a mock page with `url`, `evaluate: async () => []` and `context: () => ({ cookies: async () => [cookie] })`, then calls `checker.checkPage(mockPage, { ...base })`). Add one test with a table:

| cookie name | expect an "HttpOnly" finding |
|---|---|
| `session_id` | yes |
| `session_token` | yes |
| `auth` | yes |
| `my-app.session` | yes |
| `PHPSESSID` | yes |
| `connect.sid` | yes |
| `jwt` | yes |
| `_gid` | no |
| `__stripe_mid` | no |
| `ajs_anonymous_id` | no |
| `_hjSessionUser_123` | no |
| `XSRF-TOKEN` | no |
| `csrf_token` | no |
| `user_theme` | no |
| `grid_layout` | no |

For each row: cookie `{ name, value: 'v', secure: true, httpOnly: false, sameSite: 'Lax' }`, page url `'https://shop.test/'`. Assert `findings.some((f) => f.title.includes('HttpOnly'))` equals the column.

The existing tests use `session_token` and `session_id`; both still match and must pass unchanged.

Run (this file is in the `browser` tier, see `BROWSER_TESTS` in `vitest.workspace.ts`): `pnpm exec vitest run --project browser packages/checkers/tests/security.test.ts`
If Chromium is not installed, run `pnpm --filter @qa/core exec playwright install chromium` first.

## Done when
- [ ] The table test passes; existing tests in `security.test.ts` pass unchanged.
- [ ] `pnpm build` passes.

## Notes
- The Secure-flag and SameSite checks apply to every cookie and are not changed.
- Only names are read. Never put a cookie value in a finding.
