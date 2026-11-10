# T-98: Stop waits for testing started by Plan approval, and does nothing after a Check-up ended

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**
- `packages/runner/src/session/checkup-run.ts`
- `packages/runner/tests/checkup-run-teardown.test.ts`

**Do not build in parallel with:** T-103, T-109 (edit `checkup-run.ts`).

## Problem

Two defects in the stop path of a Check-up.

A. Testing that starts from Plan approval calls `executeTesting` from the plan routes. That promise is never stored in `currentRunPromise`. `stopRun` waits on `currentRunPromise`, which is the old, already settled scan promise. So a stop during that testing frees the slot while the orchestrator is still tearing down. This breaks the rule in the code: "The slot stays held (isRunning) until the aborted run has torn down".

B. `stopRun` returns early only when the phase is `idle`. After a Check-up ended in `done` or `failed`, a stop request answers `aborted: true`, broadcasts `RUN_ABORTED`, and replaces the stored error with "Run was manually stopped by user.", which hides the real failure reason.

## Current code

`packages/runner/src/session/checkup-run.ts` (branch `worktree-audit-cleanup`)

Line 978, last entry of the object returned by the factory:

```ts
    executeTesting,
  };
```

Lines 1120-1122, inside `stopRun`:

```ts
      if (!session.run.isRunning && session.run.phase === 'idle') {
        return { aborted: false };
      }
```

`currentRunPromise` is declared at line 386: `let currentRunPromise: Promise<void> | null = null;`

## Change

1. Replace `executeTesting,` in the returned object with:

```ts
    // Tracked like a run started here, so a stop waits for its teardown before freeing the slot.
    executeTesting: (...args: Parameters<typeof executeTesting>) => {
      const run = executeTesting(...args);
      currentRunPromise = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
```

2. Replace the three lines in `stopRun` with:

```ts
      // Nothing is running (idle, or a Check-up that already ended): leave its result and error as they are.
      if (!session.run.isRunning) {
        return { aborted: false };
      }
```

Do not move this check: the `input?.finish` branch above it and the `awaiting-review` branch below it stay in the same order. A Plan awaiting review has `isRunning` true, so it still reaches the `awaiting-review` branch.

## Tests

Edit `packages/runner/tests/checkup-run-teardown.test.ts`. Copy the setup of an existing test there that creates the Check-up run and calls `stop()`.

Add:

1. `'a stop after a Check-up ended is not an abort'`: set the session's run phase to `'failed'` (which sets `isRunning` false) and set an error with `session.report.setError('Site unreachable', 'ERR_UNREACHABLE')`. Call `stop()`. Expect the result `{ aborted: false }`, and `session.report.error()` still `{ message: 'Site unreachable', code: 'ERR_UNREACHABLE' }`.

2. `'a stop waits for testing started through executeTesting'`: only if the existing tests in the file already drive `executeTesting` with a fake orchestrator. If they do not, skip this second test and say so in your notes.

Run: `pnpm exec vitest run packages/runner/tests/checkup-run-teardown.test.ts packages/runner/tests/checkup-run-save-failure.test.ts`, then `pnpm build`.

## Done when

- [ ] `executeTesting` in the returned object records its promise in `currentRunPromise`.
- [ ] `stopRun` returns `{ aborted: false }` whenever `isRunning` is false.
- [ ] Test 1 passes; both test files and `pnpm build` pass.

## Notes

- If `Parameters<typeof executeTesting>` fails to compile because `executeTesting` is declared after the object, move nothing: use the explicit parameter list copied from its declaration at line 414.
- Out of scope: the audit stop path.
