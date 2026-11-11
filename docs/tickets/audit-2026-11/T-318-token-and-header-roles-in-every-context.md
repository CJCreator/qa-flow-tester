# T-318: Token and header Roles stay signed in for every test context; the re-login context always closes

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/preflight.ts`
- `packages/core/src/orchestrator.ts`
- `packages/core/src/access-control.ts`
- `packages/core/tests/role-headers-every-context.test.ts` (new)
- `packages/core/tests/access-control.test.ts`

**Do not build in parallel with:** T-247, T-252, T-309, T-310, T-312, T-316, T-329, T-342, T-358 (all edit `orchestrator.ts`).

## Problem

A Role can sign in with a token or with request headers instead of a password (`RoleCredential.token`, `headers`). Pre-flight sends them: `signIn` adds the Role's headers, and `Authorization: Bearer <token>`, to every request to the checked site through a `context.route` handler (`packages/core/src/preflight.ts:238-259`). That handler lives on the sign-in context only. The browser's saved state (`storageState`) keeps cookies and local storage, not request headers.

Every later context for that Role gets only `storageState`:

- the check that a saved session still works (`packages/core/src/orchestrator.ts:406-415`), so a token Role always looks signed out there and is signed in again from scratch;
- each test context (`openPage`, `:714-726`), so every test of a token or header Role runs signed out;
- the access checks (`:1479-1495`), whose fetcher sends only the context's cookies (`packages/core/src/access-control.ts:183-197`), so "can this Role open this page" is asked without the Role's token.

The report then shows a token Role's pages as sign-in walls or access problems that are not real.

Separately, the re-login context (`orchestrator.ts:777-797`) is closed only on the normal path: `await this.preflightChecker.signIn(...)` sits between `createContext` and `reloginContext.close()` with no `try/finally`. When `signIn` throws, the context stays open until the whole run ends.

## Current code

Branch from `main`.

`packages/core/src/preflight.ts` (`grep -n "const roleHeaders = {" packages/core/src/preflight.ts`):

```ts
    const roleHeaders = {
      ...credential.headers,
      ...(credential.token ? { Authorization: `Bearer ${credential.token}` } : {}),
    };
    if (Object.keys(roleHeaders).length > 0) {
      // Only the checked site gets the Role's headers: never a CDN, analytics or font host.
      const siteHost = new URL(baseUrl).host.toLowerCase();
      await context
        .route('**/*', async (route) => {
```

`packages/core/src/orchestrator.ts` (`grep -n "storageState: roleStorageStates\[testCase.role\]\|const reloginContext\|await reloginContext.close" packages/core/src/orchestrator.ts`):

```ts
              storageState: roleStorageStates[testCase.role],
...
                  const reloginContext = await this.browserManager.createContext({
...
                  const reloginRes = await this.preflightChecker.signIn(
...
                  await reloginContext.close().catch(() => {});
```

`packages/core/src/access-control.ts` (`grep -n "export function contextFetcher" packages/core/src/access-control.ts`):

```ts
export function contextFetcher(context: BrowserContext, deps?: NetDeps): AccessFetcher {
  return async (url) => {
    const cookies = await context.cookies(url).catch(() => []);
```

## Change

1. `preflight.ts`: move the header code out of `signIn` into two exported functions, and call them from `signIn` (behaviour there unchanged):

   ```ts
   /** The Role's own request headers: its `headers` and, with a token, `Authorization: Bearer <token>`. */
   export function roleRequestHeaders(credential: Partial<RoleCredential> | undefined): Record<string, string>

   /** Adds the Role's headers to every request to the checked site, never to a CDN, analytics or font host. No headers: nothing is added. */
   export async function routeRoleHeaders(context: BrowserContext, baseUrl: string, headers: Record<string, string>): Promise<void>
   ```

   The body of `routeRoleHeaders` is today's `context.route('**/*', ...)` block, unchanged (same-host or `isSameSite`, `route.fallback` with merged headers, `.catch(() => {})`). In `runPreFlight` (`grep -n "const roleHeaders = {" packages/core/src/preflight.ts`, the second hit) build the sign-in context's headers as `{ ...options.customHeaders, ...roleRequestHeaders(role) }` so there is one definition.
2. `orchestrator.ts`: import both. Add one local helper inside `runChecks`:

   ```ts
   const roleHeadersFor = (role: string) => roleRequestHeaders(options.profile?.roles?.find((r) => r.role === role));
   ```

   and call `await routeRoleHeaders(context, options.targetUrl, roleHeadersFor(role))` right after each context is made for a Role:
   - the saved-session check (after `createContext` at `:406`, with `roleCred.role`);
   - each test context (after `openPage` at `:714`, with `testCase.role`, before `blockChanges`/`watchSends` so their routes still run first);
   - each access-check Role context (after `createContext` at `:1492`, with `role`).
   Playwright runs routes last-registered first and `fallback` passes the request on, so the browser guard installed by `createContext` still sees every request.
3. Re-login: wrap the `signIn` call and the `storageState()` read in `try { ... } finally { await reloginContext.close().catch(() => {}); }` and delete the bare `close()` line. A throw from `signIn` then still closes the context and goes up as before.
4. `access-control.ts`: `contextFetcher(context: BrowserContext, deps?: NetDeps, headers: Record<string, string> = {})` sends `{ ...headers, ...(cookie ? { Cookie: cookie } : {}) }`. `runAccessChecks` only fetches addresses on the target's origin (`access-control.ts:120`), so the headers stay on the site. In `orchestrator.ts` pass `roleHeadersFor(role)` for each Role fetcher; the signed-out fetcher gets none.
5. Run `pnpm exec prettier --write` on the edited files, then `pnpm build`.

## Tests

New file `packages/core/tests/role-headers-every-context.test.ts` (unit tier, fake contexts as in `preflight-role-headers.test.ts`):

- `roleRequestHeaders({ role: 'api', username: '', token: 'tok-123', headers: { 'X-Team': 'red' } })` equals `{ 'X-Team': 'red', Authorization: 'Bearer tok-123' }`; `roleRequestHeaders(undefined)` is `{}`.
- `routeRoleHeaders(fakeContext, 'https://app.example.com', { Authorization: 'Bearer tok-123' })`: the handler adds the header for `https://app.example.com/x` and `https://www.app.example.com/x`, and calls `fallback()` with no headers for `https://cdn.other.net/a.js`. With `{}` it registers no route.
- "the saved-session check sends the Role's token": spy `BrowserManager.prototype.createContext` to return a fake context whose `route` (async) records its handler, whose `newPage` throws and whose `close` resolves; spy `PreFlightChecker.prototype.runPreFlight` to return `{ ok: false, error: 'stop', roleAuthResults: { api: false }, roleStorageStates: {}, ... }`. Run `new FlowTestOrchestrator().run({ targetUrl: 'https://app.example.com', productId: 'p', specTestCases: [], outputDir: tmp, profile: { name: 'p', productId: 'p', roles: [{ role: 'api', username: '', token: 'tok-123' }] }, preflight: { ok: true, url: 'https://app.example.com', roleAuthResults: { api: true }, roleStorageStates: { api: { cookies: [], origins: [] } } } })`. It rejects with `/Pre-flight check failed/` (the merged result keeps the first pre-flight's `error`, so do not match the text after the colon); the recorded handler, called with an on-site route, falls back with `Authorization: 'Bearer tok-123'`.

`packages/core/tests/access-control.test.ts`, in the `contextFetcher` block: `contextFetcher(fakeContext('alice'), deps, { Authorization: 'Bearer tok-123' })` connects once with both `Cookie: 'user=alice'` and `Authorization: 'Bearer tok-123'`.

`packages/core/tests/preflight-role-headers.test.ts` keeps passing unchanged (it checks `signIn`, which now calls the shared functions).

Run: `pnpm exec vitest run packages/core/tests/role-headers-every-context.test.ts packages/core/tests/preflight-role-headers.test.ts packages/core/tests/access-control.test.ts packages/core/tests/orchestrator-teardown.test.ts packages/core/tests/orchestrator-access-wiring.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -c "routeRoleHeaders(" packages/core/src/orchestrator.ts` prints 3.
- [ ] `grep -n "export function roleRequestHeaders\|export async function routeRoleHeaders" packages/core/src/preflight.ts` finds both.
- [ ] `grep -n -A3 "const reloginRes" packages/core/src/orchestrator.ts` sits inside a `try` whose `finally` closes `reloginContext`.
- [ ] The tests above and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M25, plus the re-login context leak found next to it (audit of 11 Nov 2026 on `d225418`).
- The validation contexts and the test contexts already get the run's custom headers through `createContext`; only the Role's own headers were missing.
- A real test of a token Role against a page that checks the header needs Chromium. T-336 adds orchestrator browser-tier tests; add a token Role case there if it is built after this ticket.
- Related: T-252 and T-267 edit `orchestrator.ts` (visual baselines); T-310 and T-309 also edit it.
