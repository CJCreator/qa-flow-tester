# T-120: A Test that re-signs in is retried properly, never counted as passed or flaky

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/orchestrator.ts`

**Do not build in parallel with:** T-124, T-127, T-136 (all edit `orchestrator.ts`).

## Problem

Inside one attempt of a Test, when the start page bounces to sign-in, the orchestrator signs the Role in again
and throws `StepsFailed('Session refreshed, retrying point')` so the attempt is retried. Three things are wrong:

1. **Passed without running.** At the throw, `testPointPassed` is still `true` and `stepError` is unset. A
   Navigation Check (`kind === 'link'`) has `maxRetries: 0`, so there is no retry. The outcome is FAILED, but the
   code after the retry loop reads `testPointPassed` (true) and runs the page checks on the sign-in page: the
   Test can be reported Passed although no step ran.
2. **Stale session on the retry.** `const storageState = roleStorageStates[testCase.role];` is read once, before
   the attempts. After a successful re-sign-in, `roleStorageStates[testCase.role]` is updated, but the retry
   reopens the page with the old value. It only works by luck when the old value was the same file path.
3. **Counted as flaky.** When the retry passes, the Test is recorded as "failed at first, passed on a clean
   attempt", which lowers the Works grade, although nothing about the app was flaky: the session had expired.

## Current code

`packages/core/src/orchestrator.ts:663` (branch `worktree-audit-cleanup`)

```ts
        const storageState = roleStorageStates[testCase.role];
```

`orchestrator.ts:709-720`

```ts
            ({ context, page } = await this.browserManager.openPage({
              engine: options.browserEngine ?? 'chromium',
              headless: options.headless ?? true,
              viewport: BREAKPOINT_VIEWPORTS[bp],
              tunnelAuth: options.tunnelAuth,
              baseUrl: options.targetUrl,
              storageState,
              recordVideoDir: recordVideo ? testCaseEvidenceDir : undefined,
```

`orchestrator.ts:793-803`

```ts
                  if (reloginRes.ok) {
                    roleStorageStates[testCase.role] = statePath;
                    if (reloginState) {
                      await restoreSession(page.context(), reloginState).catch(() => {
                        debugLog('auth', 'restoring the refreshed session into the live page failed', {
                          role: testCase.role,
                        });
                      });
                    }
                    throw new StepsFailed('Session refreshed, retrying point');
                  }
```

The retry wrapper (about line 1013) is called with:

```ts
            maxRetries: testCase.kind === 'link' ? 0 : Math.max(0, Math.floor(options.flakyReruns ?? 3)),
```

## Change

1. **Fresh session on every attempt.** In the `openPage({...})` call, replace the property `storageState,` with:

```ts
              // Read per attempt: a re-sign-in in the last attempt changed it.
              storageState: roleStorageStates[testCase.role],
```

   Then check whether the `const storageState = ...` at line 663 is still used anywhere else in the function
   (search for `storageState` between line 663 and the end of the breakpoint loop). If it has no other reader,
   delete that line. If it has one, leave it.

2. **Mark the attempt failed before the throw.** Directly above
   `throw new StepsFailed('Session refreshed, retrying point');` add:

```ts
                    testPointPassed = false;
                    stepError = 'The session had expired; signed in again.';
                    sessionRefreshed = true;
```

   and change the throw to `throw new StepsFailed(stepError);`.

3. **Declare the flag.** Next to `let testPointPassed = true;` (line 668) add:

```ts
        // Set when an attempt ended only because the Role was signed in again: that retry is not flakiness.
        let sessionRefreshed = false;
```

   Do **not** reset it in the per-attempt reset block (the block that sets `testPointPassed = true;
   stepError = undefined;` at about line 703): it must survive into the retry.

4. **One retry for a Navigation Check after a re-sign-in.** Change the `maxRetries` line to:

```ts
            // A link check is one request, never repeated at a site we don't own, except once after the
            // Role was signed in again (the first try never reached the link).
            maxRetries: testCase.kind === 'link' ? 1 : Math.max(0, Math.floor(options.flakyReruns ?? 3)),
```

   and change `shouldRetry` (two lines below) so a link check retries only for that reason:

```ts
            shouldRetry: (err) =>
              !isAbortError(err) &&
              !(err instanceof SignInFailedError) &&
              !sendGuard?.hasSentAny() &&
              (testCase.kind !== 'link' || sessionRefreshed),
```

5. **Not flaky.** Find where the attempt outcome is turned into the flaky record: search for `FLAKY_PASSED` in
   the function (there is one comparison `attemptResult.outcome === 'FLAKY_PASSED'` or an assignment of a
   `flaky` field on the result). Wrap the condition so it is false when `sessionRefreshed` is true, for example
   `attemptResult.outcome === 'FLAKY_PASSED' && !sessionRefreshed`. Where the result's `outcome` itself is
   stored, store `'PASSED'` instead of `'FLAKY_PASSED'` when `sessionRefreshed` is true.

## Tests

The attempt loop has no unit harness (it opens Chromium). Do not add a browser test. Verify by:

- `pnpm build`
- `pnpm exec vitest run packages/core/tests/orchestrator-teardown.test.ts packages/core/tests/orchestrator-access-wiring.test.ts`
- `pnpm exec vitest run packages/core/tests` (whole core unit tier must stay green)

Write in the PR description which of the five steps you made and the line numbers after the change.

## Done when

- [x] `openPage` reads `roleStorageStates[testCase.role]` at call time
- [x] `testPointPassed` is `false` and `stepError` is set whenever the "session refreshed" throw happens
- [x] A Navigation Check gets exactly one retry, and only after a re-sign-in
- [x] A Test that passed after a re-sign-in is not recorded as flaky
- [x] `pnpm build` and the core unit tests pass

## Notes

- Do not change the "session lost" branch below the throw (`sessionLostRoles.add(...)`).
- `SignInFailedError` is already excluded from retries (commit `9e66824`); keep that.
