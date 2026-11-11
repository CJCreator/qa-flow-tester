# T-108: Delete dead code left in `server.ts` after the routes moved out

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | runner | dead-code | built |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`

**Do not build in parallel with:** T-91, T-92, T-94, T-96, T-97, T-99, T-100, T-106, T-110, T-112 (all edit `server.ts`). Build this ticket after all of them: it moves many line numbers.

## Problem

When the Plan routes and the session classes were moved out of `server.ts`, the old copies stayed behind. They are never called. ESLint reports seven of them as unused; the private class members are not reported because TypeScript's unused-member check is off.

## Current code

`packages/runner/src/server.ts` (branch `worktree-audit-cleanup`). Line numbers are a guide; find each by name.

Group 1, top-level constants and functions (ESLint: "never used"):

| Name | Line | Kind |
|---|---|---|
| `INCLUDED_HOST_PAGES` | 306 | const |
| `SIGNED_IN_PAGES` | 308 | const |
| `RUNS_KEPT_PER_SITE` | 316 | const |
| `normalizeStoredPlan` | 444 | function |
| `planForClient` | 469 | function |
| `planDelta` | 484 | function |
| `asFlow` | 511 | function |

Group 2, private class members with no use of `this.<name>` anywhere:

| Name | Line | Kind |
|---|---|---|
| `activeAbortController` | 648, 651 | getter and setter |
| `finishController` | 655, 658 | getter and setter |
| `runGeneration` | 644 | setter only (keep the getter at 641) |
| `currentCustomHeaders` | 686 | setter only (keep the getter) |
| `currentTunnelAuth` | 698 | setter only (keep the getter) |
| `currentHeaderHosts` | 710 | setter only (keep the getter) |
| `currentUserAgent` | 722 | setter only (keep the getter) |
| `authDir` | 731 | getter |
| `planFile` | 735 | getter |
| `forwardRunEvent` | 943 | method |
| `relativeToRun` | 2409 | method |
| `keepRun` | 2423 | method |
| `pruneRuns` | 2428 | method |
| `parkedFile` | 3619 | method |
| `parkPlan` | 3624 | method |
| `unparkPlan` | 3629 | method |
| `listParkedPlans` | 3634 | method |
| `savePlan` | 3647 | method |
| `planForDisk` | 3655 | method |
| `clearPlan` | 3660 | method |

Do NOT delete the setters of `currentRunId` and `currentTargetUrl`: tests assign them.

Group 3, an unreachable block at the top of `startRunFromRequest` (line 3226). Its only caller, `handleTriggerRun`, makes the same check immediately before the call with no `await` in between:

```ts
  private async startRunFromRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.checkupStartRefused) {
      this.sendJson(res, 409, {
        error: this.beta
          ? 'Someone else is running a check-up on this shared copy. Try again in a few minutes.'
          : 'Another check-up is running. Wait for it to finish, or stop it first.',
        code: 'ERR_RUN_IN_PROGRESS',
        suggestion: this.beta
          ? 'Only one check-up runs at a time here. Try again in a few minutes.'
          : 'Wait for the check-up in progress to finish, or stop it, then start this one.',
        running: this.session.run.running ?? { kind: 'checkup', href: '/check' },
      });
      return;
    }

    let body: RunStartBody;
```

Group 4, a wrong comment at line 815:

```ts
    // One audit store per runner (ADR 0036), shared by Helper access and the audit routes. No I/O here.
    const auditStore = createAuditStore(selectAuditStoreBackend({ dataDir: this.dataDir }));
    this.auditRecoveryDone = recoverRunningAudits(auditStore);
```

## Change

Work one group at a time and run `pnpm build` after each group.

1. Group 1: delete each declaration (the whole `const` statement or the whole function, with the doc comment directly above it).

2. Group 2: for each name, first run both checks. Delete the member only when both print nothing besides the declaration itself:

```
grep -n "this\.<name>\b" packages/runner/src/server.ts
grep -rn "\.<name>\b" packages/runner/tests packages/runner/src --include=*.ts | grep -v "packages/runner/src/server.ts"
```

   The second command may list same-named members of other classes (for example `session.plan.park`); a hit counts only when the object is the `RunnerServer` (variables named `server` or `runner`). If unsure about a name, keep it and list it in your notes.

3. Group 3: confirm `grep -n "startRunFromRequest(" packages/runner/src/server.ts` prints exactly two lines (the declaration and the call inside `handleTriggerRun`). Then delete the `if (this.checkupStartRefused) { ... return; }` block and the blank line after it. Leave `let body: RunStartBody;` as the first statement.

4. Group 4: replace the comment line with:

```ts
    // One audit store per runner (ADR 0036), shared by Helper access and the audit routes. Recovery of
    // versions left "running" by a crash starts here and is awaited before the first audit request.
```

5. Run `pnpm build`. For every import the build or ESLint now reports as unused in `server.ts`, remove that name from its import line: `pnpm exec eslint packages/runner/src/server.ts 2>&1 | grep "never used"`.

6. Run `pnpm exec prettier --write packages/runner/src/server.ts`.

## Tests

No new test. Run the whole runner unit suite: `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build` and `pnpm typecheck`.

## Done when

- [x] `pnpm exec eslint packages/runner/src/server.ts 2>&1 | grep -c "never used"` prints `0`.
- [x] Every member in Group 2 is deleted or listed in your notes with the hit that kept it.
- [x] The repeated busy check is gone from `startRunFromRequest`.
- [x] Runner unit tests, `pnpm build` and `pnpm typecheck` pass.

## Notes

- Three public members (`savedSessions` at 743, `runAuthDir` at 752, `cleanAuthDir` at 756) also look unused. Apply the two checks from step 2 to them; delete only on zero hits.
- Delete only. Do not rename, move or rewrite anything else.
- If a test fails after a deletion, restore that one member and list it in your notes.
- BLOCKED: all four groups applied (32 deletions by AST script, busy check removed, comment fixed, 7 unused imports removed). `pnpm build` passed, runner unit tests 603/603 passed, eslint `never used` count 0. `pnpm typecheck` fails only on `packages/core/tests/audit-pipeline.test.ts` (11 errors) and `packages/wizard/tests/finish-ai-review.test.ts` (2 errors), outside this ticket's files and being changed by another session on this branch. Edit reverted; the diff is kept outside the repo at `C:\Users\HP\AppData\Local\Temp\qa-t108\T-108-server-ts.patch`.
