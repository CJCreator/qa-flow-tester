# T-119: Re-sign-in during the scan works on a read-only site, and closes its context

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/discovery/discovery-agent.ts`

**Do not build in parallel with:** T-135 (also edits `discovery-agent.ts`).

## Problem

When a Role's session is lost during the scan, `reloginHandler` signs in again in a fresh context. It gets that
context from the local `newContext()` helper, which installs `blockChanges` when the site is read-only. Signing
in is a POST, so on a read-only site the sign-in request is aborted and re-sign-in can never succeed: the Role
is always reported as session-lost. The first sign-in (pre-flight) does not block changes, so this is the only
place the two disagree.

Second defect in the same lines: if `signIn` throws, `freshContext` is never closed.

## Current code

`packages/core/src/discovery/discovery-agent.ts:490-501` (branch `worktree-audit-cleanup`)

```ts
    const newContext = async (storageState?: string | StorageStateData) => {
      const context = await this.browserManager.createContext({
        baseUrl: options.targetUrl,
        storageState,
        customHeaders: options.customHeaders,
        userAgent: options.userAgent,
        tunnelAuth: options.tunnelAuth,
        headerHosts: options.headerHosts,
      });
      if (options.readOnly) await blockChanges(context);
      return context;
    };
```

`discovery-agent.ts:561-574`

```ts
      const reloginHandler = async (): Promise<boolean> => {
        try {
          const freshContext = await newContext();
          const outcome = await new PreFlightChecker().signIn(freshContext, options.targetUrl, role);
          const freshState = outcome.ok ? await freshContext.storageState().catch(() => null) : null;
          await freshContext.close().catch(() => {});
          if (!freshState) return false;
          // The whole session, not only its cookies: one restore path for every call site (LC-004).
          await restoreSession(roleContext, freshState);
          return true;
        } catch {
          return false;
        }
      };
```

## Change

Replace the whole `reloginHandler` with:

```ts
      const reloginHandler = async (): Promise<boolean> => {
        let freshContext: BrowserContext | undefined;
        try {
          // Not newContext(): on a read-only site that blocks the sign-in POST itself. Signing in is the one
          // request a read-only scan must send, exactly as pre-flight does.
          freshContext = await this.browserManager.createContext({
            baseUrl: options.targetUrl,
            customHeaders: options.customHeaders,
            userAgent: options.userAgent,
            tunnelAuth: options.tunnelAuth,
            headerHosts: options.headerHosts,
          });
          const outcome = await new PreFlightChecker().signIn(freshContext, options.targetUrl, role);
          const freshState = outcome.ok ? await freshContext.storageState().catch(() => null) : null;
          if (!freshState) return false;
          // The whole session, not only its cookies: one restore path for every call site (LC-004).
          await restoreSession(roleContext, freshState);
          return true;
        } catch {
          return false;
        } finally {
          await freshContext?.close().catch(() => {});
        }
      };
```

If `BrowserContext` is not already imported in this file, add it to the existing `playwright` type import
(`import type { ..., BrowserContext } from 'playwright';`).

## Tests

There is no unit harness for `DiscoveryAgent.discoverWithSession` (it drives Chromium). Do not add a browser
test. Verify by:

- `pnpm build`
- `pnpm exec vitest run packages/core/tests` (the existing discovery tests must still pass)
- Read the diff: `reloginHandler` no longer calls `newContext(`, and `close()` is in a `finally`.

## Done when

- [x] `reloginHandler` creates its context with `this.browserManager.createContext` and never calls `blockChanges`
- [x] The fresh context is closed on every path
- [x] `pnpm build` passes and the existing core tests pass

## Notes

`roleContext` (the context the Spider explores in) keeps `blockChanges` on a read-only site. Only the short-lived
sign-in context is exempt.
