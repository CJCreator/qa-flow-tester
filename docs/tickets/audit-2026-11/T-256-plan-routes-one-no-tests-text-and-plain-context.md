# T-256: Plan routes use one "nothing to test" text and a plain context check

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | duplication | todo |

**Files you may edit (no others):**

- `packages/runner/src/routes/plan.ts`
- `packages/runner/tests/plan-routes.test.ts`

**Do not build in parallel with:** T-258 (edits `routes/plan.ts`: `hasCompleteSignIn`), T-260 (edits `routes/plan.ts`: `addTokens`).

## Problem

Two leftovers in `routes/plan.ts`:

1. `NO_TESTS_FALLBACK` is a copy of `NO_TESTS_REASON`, which `@qa/core` already exports (`packages/core/src/plan/build.ts`). If the core wording changes, the approve reply would keep the old text.
2. `toPlanContext` has a second branch that builds a plan context from the server. The server always hands the plan rows a context that already has `session` (it spreads `planRouteContext(...)` into every handler context), so the branch never runs. It also calls `(server as any).executeTesting?.(...)`, a method `RunnerServer` does not have, so if it ever ran, approving a plan would silently run nothing.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "NO_TESTS_FALLBACK\|function toPlanContext" packages/runner/src/routes/plan.ts`.

`packages/core/src/plan/build.ts` (exported from `@qa/core`):

```ts
export const NO_TESTS_REASON =
  'Nothing to test: the scan found no page or journey to check. Add a page or a journey, or choose another address.';
```

`packages/runner/src/routes/plan.ts`:

```ts
const NO_TESTS_FALLBACK =
  'Nothing to test: the scan found no page or journey to check. Add a page or a journey, or choose another address.';
```

```ts
if (specTestCases.length === 0) {
  sendJson(res, 409, {
    error: noTests ?? NO_TESTS_FALLBACK,
    code: 'ERR_NO_TESTS',
    noTests: noTests ?? NO_TESTS_FALLBACK,
  });
  return;
}
```

```ts
function toPlanContext(c: RouteContext): PlanRouteContext {
  const anyC = c as any;
  if (anyC.session) {
    return anyC as PlanRouteContext;
  }
  const server = c.server;
  return {
    session: server.session,
    req: c.req,
    ...
    onApproved: (record, specTestCases, notRun, generation) => {
      (server as any).executeTesting?.(record, specTestCases, notRun, generation);
    },
  };
}
```

(The `...` stands for the other fields, all built with `(server as any).something?.()`.)

## Change

1. Add `NO_TESTS_REASON,` to the `@qa/core` import list at the top of `plan.ts` (keep the list's order style; the names are not sorted).

2. Delete the `const NO_TESTS_FALLBACK = ...` statement (both lines). In the 409 reply replace both `NO_TESTS_FALLBACK` with `NO_TESTS_REASON`:

```ts
      error: noTests ?? NO_TESTS_REASON,
      code: 'ERR_NO_TESTS',
      noTests: noTests ?? NO_TESTS_REASON,
```

3. Replace the whole `toPlanContext` function with:

```ts
/**
 * The dispatcher hands every plan row a context that already carries the plan pieces (`planRouteContext` in
 * server.ts is spread into it). A context without a session is a wiring mistake: say so, do not guess.
 */
function toPlanContext(c: RouteContext): PlanRouteContext {
  if (!(c as Partial<PlanRouteContext>).session) {
    throw new Error('The plan routes need the runner session in their context.');
  }
  return c as unknown as PlanRouteContext;
}
```

4. Run `pnpm exec eslint packages/runner/src/routes/plan.ts 2>&1 | grep "never used"` and remove any import that is now unused. Then `pnpm exec prettier --write packages/runner/src/routes/plan.ts` and `pnpm build`.

## Tests

Edit `packages/runner/tests/plan-routes.test.ts`. Import `planRoutes` with `import { planRoutes } from '../src/routes/index.js';` and `NO_TESTS_REASON` to the existing `from '@qa/core'` import (it already imports `CREDENTIAL_PLACEHOLDERS`).

Add to the second `describe` (the one with `session` set up in `beforeEach`):

- Name: `'approve with nothing to test answers 409 with the core wording'`. Steps: `const record = makeStoredPlan(); record.context.draft = undefined; record.plan.testCases = [];` then `await session.plan.save(record)` and call `approvePlan` the same way the neighbouring test `'approve keeps the Plan sizes when none sent is valid'` does (body `{}`). Expect `res.statusCode` 409, `res.json().code` `'ERR_NO_TESTS'`, `res.json().noTests` `NO_TESTS_REASON`. If `approvePlan` answers something else before it reaches the empty-tests check, note the status in the ticket and keep the test only if you can reach the check by changing the record; otherwise drop this test and say so.
- Name: `'a plan row refuses a context without a session'`. Steps: `const row = planRoutes[0];` call `row.handle({ server: undefined as never, req: createMockRequest(undefined, {}, 'GET'), res: new MockResponse() as unknown as http.ServerResponse, url: new URL('http://localhost/api/runner/plan') })` inside `expect(...).toThrow(/runner session/)` (the throw is synchronous because `toPlanContext` runs before the handler's first await; if `handle` returns a promise instead, use `await expect(Promise.resolve().then(() => row.handle(...))).rejects.toThrow(/runner session/)`).

Run: `pnpm exec vitest run packages/runner/tests/plan-routes.test.ts packages/runner/tests/route-table.test.ts packages/runner/tests/route-access.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "NO_TESTS_FALLBACK\|(server as any)" packages/runner/src/routes/plan.ts` prints nothing.
- [ ] `grep -c "NO_TESTS_REASON" packages/runner/src/routes/plan.ts` shows 3 (import and two uses).
- [ ] The three test files pass and `pnpm build` passes.

## Notes

- Do not change `PlanRouteContext` or any handler signature: tests call `getPlan`, `approvePlan` and the others directly with a hand-made context.
- The text of the 409 reply does not change (same sentence), so no wizard change.
