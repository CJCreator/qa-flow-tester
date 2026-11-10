# T-113: Role sign-in headers stay on the checked site

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | core | security | built |

**Files you may edit (no others):**
- `packages/core/src/preflight.ts`
- `packages/core/tests/preflight-role-headers.test.ts` (new)

**Do not build in parallel with:** T-135 (also edits `preflight.ts`).

## Problem

`PreFlightChecker.signIn` calls `context.setExtraHTTPHeaders(roleHeaders)`. Playwright then sends the Role's
`Authorization: Bearer <token>` and custom headers with **every** request the page makes, including requests
to other hosts (CDN, analytics, fonts). The rest of the tool scopes secret headers to the site's own host
(`browser.ts`, the "Scoped headers route").

Scenario: a Role has `token: 'abc'`. The sign-in page loads `https://www.google-analytics.com/analytics.js`.
That request carries `Authorization: Bearer abc`.

## Current code

`packages/core/src/preflight.ts:246-253` (branch `worktree-audit-cleanup`)

```ts
    // Apply per-role headers and localStorage initialization if specified
    const roleHeaders = {
      ...credential.headers,
      ...(credential.token ? { Authorization: `Bearer ${credential.token}` } : {}),
    };
    if (Object.keys(roleHeaders).length > 0) {
      await context.setExtraHTTPHeaders(roleHeaders).catch(() => {});
    }
```

## Change

1. At the top of `packages/core/src/preflight.ts`, add the import (skip if `isSameSite` is already imported):

```ts
import { isSameSite } from './same-site.js';
```

2. Replace the `if (Object.keys(roleHeaders).length > 0) { ... }` block with:

```ts
    if (Object.keys(roleHeaders).length > 0) {
      // Only the checked site gets the Role's headers: never a CDN, analytics or font host.
      const siteHost = new URL(baseUrl).host.toLowerCase();
      await context
        .route('**/*', async (route) => {
          let onSite = false;
          try {
            const host = new URL(route.request().url()).host.toLowerCase();
            onSite = host === siteHost || isSameSite(host, siteHost);
          } catch {
            onSite = false;
          }
          if (!onSite) return route.fallback();
          return route.fallback({ headers: { ...route.request().headers(), ...roleHeaders } });
        })
        .catch(() => {});
    }
```

Use `route.fallback`, never `route.continue`: the request guard and `blockChanges` routes must still run.

3. Leave the `localStorageEntries` block below it unchanged.

## Tests

Add `packages/core/tests/preflight-role-headers.test.ts`. No browser: pass a fake context.

- Build a fake `BrowserContext` whose `route(pattern, handler)` stores `handler`, whose
  `setExtraHTTPHeaders` is a `vi.fn()`, and whose `newPage` rejects with `new Error('stop')` (the sign-in then
  returns a failed result; that is fine, the route is registered before the page opens).
- Call `new PreFlightChecker().signIn(fakeContext, 'https://app.example.com', { role: 'member', token: 'abc', headers: { 'X-Team': 'red' } })`
  inside `try/catch` (ignore the outcome).
- Assert `setExtraHTTPHeaders` was **not** called.
- Call the stored handler with a fake route for `https://app.example.com/login`
  (`request: () => ({ url: () => 'https://app.example.com/login', headers: () => ({ accept: '*/*' }) })`,
  `fallback: vi.fn()`). Expect `fallback` called with
  `{ headers: { accept: '*/*', 'X-Team': 'red', Authorization: 'Bearer abc' } }`.
- Call it again with `https://www.google-analytics.com/analytics.js`. Expect `fallback` called with no argument.
- A third case: `https://cdn.app.example.com/x.js` gets the headers (same site).

If the `PreFlightChecker` constructor or the `signIn` argument order differs, read the signature at
`preflight.ts:220-228` and match it. Cast the fakes with `as unknown as BrowserContext`.

Command: `pnpm exec vitest run packages/core/tests/preflight-role-headers.test.ts`, then `pnpm build`.

## Done when

- [x] `setExtraHTTPHeaders` no longer appears in `packages/core/src/preflight.ts`
- [x] The new test passes
- [x] `pnpm build` passes

## Notes

- `runPreFlight` (same file, about line 690) already scopes the same headers through `createContext({ customHeaders })`.
  Do not change it.
- The orchestrator's re-sign-in (`orchestrator.ts`, about line 771) calls `signIn` on a context created without
  the Role's headers; this change is what gives it scoped headers.
