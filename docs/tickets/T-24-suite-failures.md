# T-24: Diagnose and fix the 5 failing suite tests

## Goal
Make the full non-browser suite green so G1, G2 and the Wave 0 gaps can close.

## Gaps covered
G1 (remaining part), unblocks T-01 and the Wave 0 gap rows.

## In scope
- Diagnose why these fail, including on commit d19bc8c (before Wave 0), so the cause is not Wave 0:
  - `packages/core/tests/e2e-orchestrator.test.ts`: a `.webm` file remains for a passed test point (expected none).
  - `packages/runner/tests/runner-server.test.ts`: a run never reports finished within about 30 s, then later runs get 409.
- Candidate causes to check, not assume: Windows file locks making `fs.rm` of the video fail silently (`orchestrator.ts` around line 940), slow runs against the test timeout, a run left active by an earlier test.
- Fix the cause in source or in test setup/cleanup. Record the finding.

## Out of scope
Skipping, deleting or weakening any test; loosening safety filters, read-only default, host confinement or redaction; `wizard-e2e`.

## Acceptance criteria
- [ ] The root cause of each failure is written in this ticket's notes with evidence.
- [ ] The complete non-browser suite exits 0 (run by /verify-all), twice in a row.
- [ ] No test is skipped, weakened or deleted; any test change only fixes setup or cleanup and is listed.
- [ ] If the fix is a timeout change, it is justified with measured run times.
- [ ] The Wave 0 gap rows (G1, G2, G3, G5, G33, G34, G36, G37, G39) are closed after this passes.

## Dependencies
none (Wave 0 committed)

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/core/tests/e2e-orchestrator.test.ts packages/runner/tests/runner-server.test.ts
pnpm exec vitest run --exclude "**/wizard-e2e.test.ts" --reporter=dot
```
Test runs are deferred (DEFER_TESTS) until the wave's /verify-all; the developer may run only these two files when diagnosing, after the lock is lifted for that step.

## Risks
Environmental (this Windows machine only) versus real. If it only fails locally, CI result decides; say so plainly.

## Status
todo (wave 1)

## Notes
Developer round 1 (no tests run, DEFER_TESTS; causes from code reading and git, not yet measured).

### Core: leftover `.webm` (`e2e-orchestrator.test.ts:122-123`)
- Hypothesis, not a Windows lock: `PerformanceChecker.measureVitals` (`packages/checkers/src/performance.ts`) opens a probe tab with `page.context().newPage()`. Video is recorded per context, so the probe tab writes its own `.webm` into the point folder. The orchestrator `finally` removed only `page.video()` of the main page.
- Not Wave 0: `git log -S"newPage()"` on performance.ts -> `afc20ab`; `git show d19bc8c:` shows the probe (line 349) and `wantsRepeatLoads` (361) already present. Cause predates Wave 0. Not run on a d19bc8c worktree.
- Fix: `removeVideosExcept(dir, keep?)` in `packages/core/src/orchestrator.ts`, called after `context.close()` in the `finally` (keep = failed point's main video) and on retry discard. Scoped to the per-point folder, `.webm` only, errors swallowed.
- Windows-only: no, by code reading (no lock involved). CI decides. Lock check not measured.

### Runner: 4 failing tests (`runner-server.test.ts`)
- Hypothesis: test 3 is slow, not hung (default 3 breakpoints x ~8 pages x checks + throttled repeat loads vs 30 s poll cap, under suite load; url-first test took 136 s in the same log). Run stays active, so tests at 146, 269, 329 get 409 (one run at a time, ADR 0008): 1 root + 3 cascades. Not measured.
- Fix now: `afterEach` in the test file stops a run left active (after the test body; failing test stays failed).
- NOT done (needs measurement): poll cap (60 x 500 ms) and test timeout (45000) unchanged. Follow-up for verify round: measure idle-machine run time, then set cap and timeout to ~2x and cite numbers here.

### Test-file edits (setup/cleanup only)
- `packages/runner/tests/runner-server.test.ts`: import `afterEach`; add one `afterEach` (stop active run, bounded 10 s wait). No assertion changed.
- New `packages/core/tests/video-cleanup.test.ts` (additive unit test for the helper).

### Verify round 1 fix (runner-server.test.ts, measured, file run alone, idle machine)
- Cause 1 (cascade, real): `POST /api/runner/stop` during testing keeps the approved plan: phase `awaiting-review`, `isRunning` stays true (`server.ts` handleAbortRun, planKept). My afterEach waited for `isRunning=false` after one stop, never got it, hit its 10 s hook timeout, and the next test got 409. Fix: afterEach stops up to 3 times (second stop discards the plan), hook timeout 30 s.
- Cause 2 (slow, not hung): runs finish, just slowly. Measured: SSE test 19-24 s; pause/approve test 114-119 s; sign-in test 197-201 s (scan 15 s + approved run ~186 s); skipReview test 119-123 s. Old caps: 30 s, 150 s, 120 s, 75 s -> "expected true to be false" at the poll cap.
- Caps set to about 2x measured: SSE poll 90x500 ms (45 s), timeout 60 s; sign-in poll 700x500 ms (350 s), timeout 420 s; skipReview poll 480x500 ms (240 s), timeout 270 s. Pause test unchanged (150 s cap, 240 s timeout).
- Result: file alone, 7/7 pass (t24r4: 19 s, 119 s, 197 s, 123 s). No assertion changed.
- Open: why a 375px approved run takes 100-190 s while a default run takes 20 s is not diagnosed.
