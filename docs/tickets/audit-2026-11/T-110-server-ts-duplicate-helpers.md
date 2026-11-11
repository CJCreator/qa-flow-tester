# T-110: Remove duplicated helpers from `server.ts`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | runner | inconsistency | built |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`

**Do not build in parallel with:** T-91, T-92, T-94, T-96, T-97, T-99, T-100, T-106, T-108, T-112 (all edit `server.ts`).

## Problem

`server.ts` carries its own copies of helpers that the session modules export, and repeats one block three times. Copies drift: a fix made in one place is missed in the others.

## Current code

`packages/runner/src/server.ts` (branch `worktree-audit-cleanup`)

A. Line 198, identical to the exported `isRunId` in `packages/runner/src/session/report-store.ts:9`:

```ts
function isRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) && !value.includes('..');
}
```

B. Line 500, identical to the exported `hostOfAddress` in `packages/runner/src/session/plan-store.ts:105`:

```ts
function hostOfAddress(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}
```

C. The same "add or update one remembered sign-in" block three times, at lines 2052-2068, 2206-2221 and 2285-2301. Each one is:

```ts
          const idx = existingSignIns.findIndex((s) => s.role === role.role);
          const entry = {
            role: role.role,
            username: role.username,
            loginPath: role.loginPath,
            usernameSelector: role.usernameSelector,
            passwordSelector: role.passwordSelector,
            submitSelector: role.submitSelector,
            postLoginSelector: role.postLoginSelector,
            postLoginUrl: role.postLoginUrl,
          };
          if (idx >= 0) {
            existingSignIns[idx] = { ...existingSignIns[idx], ...entry };
          } else {
            existingSignIns.push(entry);
          }
```

The list is named `existingSignIns` (first block), `existing` (second) and `currentSignIns` (third). The Role is named `role`, `credential` and `role`.

## Change

Run `pnpm build` after each step.

1. Delete the local `isRunId` (with any doc comment directly above it). Add `import { isRunId } from './session/report-store.js';` next to the other `./session/...` imports. If `server.ts` already imports from `./session/report-store.js`, add the name to that import instead.

2. Delete the local `hostOfAddress`. Add `hostOfAddress` to the import from `./session/plan-store.js` (create the import if needed).

3. Add this helper next to the other top-level helpers (for example where `hostOfAddress` was):

```ts
type RememberedSignIn = NonNullable<SiteMemory['signIns']>[number];

/** Adds a Role's sign-in details to the remembered list, or updates the entry for that Role. Never the password. */
function upsertSignIn(
  list: RememberedSignIn[],
  role: Pick<
    RoleCredential,
    | 'role'
    | 'username'
    | 'loginPath'
    | 'usernameSelector'
    | 'passwordSelector'
    | 'submitSelector'
    | 'postLoginSelector'
    | 'postLoginUrl'
  >
): void {
  const entry = {
    role: role.role,
    username: role.username,
    loginPath: role.loginPath,
    usernameSelector: role.usernameSelector,
    passwordSelector: role.passwordSelector,
    submitSelector: role.submitSelector,
    postLoginSelector: role.postLoginSelector,
    postLoginUrl: role.postLoginUrl,
  };
  const idx = list.findIndex((s) => s.role === role.role);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
}
```

   `SiteMemory` and `RoleCredential` are types. If `server.ts` does not import one of them yet, add it as a type import from the module that already supplies `saveSiteMemory` (for `SiteMemory`) and from `@qa/types` (for `RoleCredential`).

4. Replace each of the three blocks with one call:

   - first block: `upsertSignIn(existingSignIns, role);`
   - second block: `upsertSignIn(existing, credential);`
   - third block: `upsertSignIn(currentSignIns, role);`

   Replace only the lines from `const idx = ...` to the closing `}` of the `if/else`. Keep everything around them (the `saveSecret` calls, `notSaved.push`, `continue`, the assignments to `memory.signIns`).

5. Run `pnpm exec prettier --write packages/runner/src/server.ts`.

## Tests

No new test: behaviour is unchanged. Run the suites that cover remembered sign-ins and run ids:

`pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build` and `pnpm typecheck`.

## Done when

- [x] `grep -n "^function isRunId\|^function hostOfAddress" packages/runner/src/server.ts` prints nothing.
- [x] `grep -c "upsertSignIn(" packages/runner/src/server.ts` prints `4` (one declaration, three calls).
- [x] Runner unit tests, `pnpm build` and `pnpm typecheck` pass.

## Notes

- If the type of the entry does not match `RememberedSignIn` (build error), type `list` as `Array<Record<string, unknown> & { role: string }>` is NOT acceptable; instead copy the element type the three call sites already use and say so in your notes.
- Not in this ticket (they differ in signature or behaviour and need an owner review): the private methods `resolveTargetUrl`, `ensurePlanLoaded`, `signInAccount`; `addTokens` (server.ts vs routes/plan.ts); `hasCompleteSignIn`; `isInside` (server.ts vs ui-static.ts); the three cookie parsers; the three https checks.
- BLOCKED: the edit applied cleanly and `pnpm build` and runner unit tests (603/603) passed, but `pnpm typecheck` fails on files this ticket does not touch: `packages/core/tests/audit-pipeline.test.ts` (12 errors, e.g. `(916,28): TS2322`, `(957,43): TS2552 Cannot find name 'rawPage'`) and `packages/wizard/tests/finish-ai-review.test.ts` (2 errors). Those files are being changed by another session on this branch. Edit reverted; the diff is kept outside the repo at `C:\Users\HP\AppData\Local\Temp\T-110-server-ts.patch`.
