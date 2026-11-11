# T-258: One copy each of `resolveTargetUrl`, `signInAccount`, `hasCompleteSignIn` and `ensurePlanLoaded`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | duplication | todo |

**Files you may edit (no others):**

- `packages/runner/src/server.ts`
- `packages/runner/src/routes/plan.ts`
- `packages/runner/tests/session-helpers.test.ts` (new)

**Do not build in parallel with:** T-255, T-259, T-260, T-261, T-265, T-267 (all edit `server.ts`, about 3,900 lines); T-256, T-260 (edit `routes/plan.ts`).

## Problem

T-110 removed most duplicated helpers from `server.ts` but left four that exist twice. I compared each pair line by line: they behave the same today, so they can merge with no change in behaviour. The copies can drift apart.

| Helper | Copies | Difference |
|---|---|---|
| `resolveTargetUrl` | `server.ts` (private method) and `session/checkup-run.ts` (exported function) | The method reads `this.hostAliases` and `this.localhostAlias`; the function takes them as arguments. Same body. |
| `signInAccount` | `server.ts` (private method) and `session/checkup-run.ts` (exported) | Same body: `signin:${host.toLowerCase()}:${role}`. |
| `hasCompleteSignIn` | `routes/plan.ts` (private) and `session/checkup-run.ts` (exported) | Same body. |
| `ensurePlanLoaded` | `server.ts` (private method) and `routes/plan.ts` (exported function over a session) | The method reads `this.phase`, which is `this.session.run.phase`. Same logic. |

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "resolveTargetUrl\|signInAccount\|hasCompleteSignIn\|ensurePlanLoaded" packages/runner/src/server.ts packages/runner/src/routes/plan.ts`.

`session/checkup-run.ts` (the copy to keep; `session/checkup-session.ts` re-exports everything in it with `export * from './checkup-run.js'`):

```ts
export function signInAccount(host: string, role: string): string {
  return `signin:${host.toLowerCase()}:${role}`;
}

export function resolveTargetUrl(
  targetUrl: string,
  hostAliases: Record<string, string> = {},
  localhostAlias?: string
): string {
```

`server.ts`:

```ts
  private resolveTargetUrl(targetUrl: string): string {
    try {
      const u = new URL(targetUrl);
      const alias = this.hostAliases[u.hostname.toLowerCase()];
      ...
  }
```

```ts
  private signInAccount(host: string, role: string): string {
    return `signin:${host.toLowerCase()}:${role}`;
  }
```

```ts
  private async ensurePlanLoaded(): Promise<StoredPlanRecord | null> {
    const record = await this.session.plan.current();
    // Never marked awaiting review while an audit or benchmark holds the slot (DEC-002): begin() refuses then.
    if (record && this.phase === 'idle' && this.session.run.begin(record.plan.runId, record.plan.targetUrl)) {
      this.session.run.setPhase('awaiting-review');
    }
    return record;
  }
```

`routes/plan.ts`:

```ts
function hasCompleteSignIn(roles?: Array<{ username?: string; password?: string }>): boolean {
  return (roles ?? []).some((r) => !!r.username && !!r.password);
}
```

and the exported `export async function ensurePlanLoaded(session: CheckupSession)` with the same body using `session.run.phase`. `routes/index.ts` re-exports it (`export * from './plan.js'`), and `server.ts` already imports other names from `./routes/index.js`.

## Change

1. `routes/plan.ts`: delete the local `hasCompleteSignIn` function. Add `hasCompleteSignIn` to the existing `import { redactedMessage } from '../session/checkup-run.js';` line: `import { redactedMessage, hasCompleteSignIn } from '../session/checkup-run.js';`.

2. `server.ts`, `resolveTargetUrl`: delete the private method (with its doc comment). Add `resolveTargetUrl` and `signInAccount` to the names imported from `./session/checkup-session.js` (the list that already holds `LOOPBACK_HOSTS`). Replace each call:
   - `this.resolveTargetUrl(x)` becomes `resolveTargetUrl(x, this.hostAliases, this.localhostAlias)` (three calls: `grep -n "this.resolveTargetUrl" packages/runner/src/server.ts`; one is the arrow `(address) => this.resolveTargetUrl(address)`, which becomes `(address) => resolveTargetUrl(address, this.hostAliases, this.localhostAlias)`).
   - `this.signInAccount(a, b)` becomes `signInAccount(a, b)` (about eight calls). Delete the private method.

3. `server.ts`, `ensurePlanLoaded`: delete the private method. Add `ensurePlanLoaded` to the names imported from `./routes/index.js`. Replace the two calls `await this.ensurePlanLoaded();` with `await ensurePlanLoaded(this.session);`.

4. After the edits, check `LOOPBACK_HOSTS` is still used in `server.ts` (line near `isLoopbackBindHost` uses it); keep it if so. Run `pnpm exec eslint packages/runner/src/server.ts packages/runner/src/routes/plan.ts 2>&1 | grep "never used"` and drop unused imports. Then `pnpm exec prettier --write` on the two files and `pnpm build`.

## Tests

Add `packages/runner/tests/session-helpers.test.ts` (unit):

```ts
import { describe, it, expect } from 'vitest';
import { resolveTargetUrl, signInAccount, hasCompleteSignIn } from '../src/session/checkup-session.js';
```

- `'resolveTargetUrl maps a host alias'`: `resolveTargetUrl('http://shop.test:3000/a', { 'shop.test': 'host.docker.internal' })` toBe `'http://host.docker.internal:3000/a'`.
- `'resolveTargetUrl maps localhost to the host machine when told to'`: `resolveTargetUrl('http://localhost:3050/', {}, 'host.docker.internal')` toBe `'http://host.docker.internal:3050/'`.
- `'resolveTargetUrl leaves other addresses and bad input as typed'`: `resolveTargetUrl('https://example.com/x')` toBe `'https://example.com/x'`; `resolveTargetUrl('not a url')` toBe `'not a url'`.
- `'signInAccount lower-cases the host'`: `signInAccount('Shop.Test:3000', 'admin')` toBe `'signin:shop.test:3000:admin'`.
- `'hasCompleteSignIn needs a username and a password on one role'`: false for `undefined`, `[]`, `[{ username: 'a' }]`, `[{ username: 'a' }, { password: 'b' }]`; true for `[{ username: 'a', password: 'b' }]`.

Run: `pnpm exec vitest run packages/runner/tests/session-helpers.test.ts packages/runner/tests/plan-routes.test.ts packages/runner/tests/reapproval-roles.test.ts packages/runner/tests/remembered-signins.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "private resolveTargetUrl\|private signInAccount\|private async ensurePlanLoaded\|^function hasCompleteSignIn" packages/runner/src/server.ts packages/runner/src/routes/plan.ts` prints nothing.
- [ ] The listed tests pass and `pnpm build` passes.

## Notes

- `addTokens`, `isInside`, the cookie readers and the https checks are not here: see T-259 (identical copies), T-260 and T-261 (copies that differ in behaviour).
- `hostAliases` keys in the server are already lower-cased in its constructor; the function lower-cases the host it looks up. Do not change either.
