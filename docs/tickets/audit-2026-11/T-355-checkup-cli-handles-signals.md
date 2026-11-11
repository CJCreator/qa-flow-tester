# T-355: The CI check-up handles SIGINT and SIGTERM, and shutdown fits Cloud Run's grace period

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/checkup.ts`
- `packages/runner/src/shutdown.ts`
- `packages/runner/src/session/checkup-run.ts`
- `packages/runner/tests/shutdown.test.ts`
- `packages/runner/tests/checkup-run-teardown.test.ts`
- `packages/runner/tests/checkup-signals.test.ts` (new)

**Do not build in parallel with:** T-356 (edits `checkup.ts`); T-296, T-308, T-312, T-313, T-331, T-358, T-360 (all edit `checkup-run.ts`); T-358 (edits `checkup-run-teardown.test.ts`).

## Problem

The command-line Check-up (`checkup.ts`) makes a working folder with `fs.mkdtemp` (`checkup.ts:484`). The folder holds the sign-in sessions (cookies). It is removed only in the `finally` at `checkup.ts:563-567`. There is no `process.on('SIGINT' | 'SIGTERM')` in the file, so when a CI job is cancelled or the person presses Ctrl+C, the process dies without running the `finally`: the Chromium run is not stopped and the session cookies stay in the temp folder. `cli.ts:69-76` already has the right pattern with `createShutdown`.

Second (suspected: confirm against the Cloud Run docs, which give a container about 10 s after SIGTERM): `createShutdown` waits up to `graceMs = 15000` (`shutdown.ts:17`) and `waitForTeardown` in `checkup-run.ts:379` waits up to `TEARDOWN_WAIT_MS = 20_000`. Both are longer than the platform's grace, so a stopping hosted runner is killed before it saves the waiting Plan.

## Current code

Branch from `main`.

`grep -n "graceMs" packages/runner/src/shutdown.ts`: `const graceMs = deps.graceMs ?? 15000;`
`grep -n "TEARDOWN_WAIT_MS" packages/runner/src/session/checkup-run.ts`: `const TEARDOWN_WAIT_MS = 20_000;`
In `stopRun` (`checkup-run.ts`, `grep -n "await waitForTeardown" ...`, around 1142-1164) the Plan is saved (`session.plan.save(record!)`) only after `await waitForTeardown()`.

## Change

1. `shutdown.ts`: default `graceMs` to `8000` and say why in the comment (Cloud Run's SIGTERM grace is about 10 s).
2. `checkup-run.ts`: `TEARDOWN_WAIT_MS = 6_000` (it must stay below the shutdown grace). In `stopRun`, decide `planKept` and save the waiting Plan **before** `await waitForTeardown()`: read `session.plan.currentRecord`, the phase and `runId` first, save, then wait. Keep the rest of the order (generation bump, abort, wait, events) unchanged. What a stop does when `planKept` is false does not change.
3. `checkup.ts`: add and export `installCheckupSignalHandlers(shutdown, proc = process)` that registers `SIGINT` and `SIGTERM` listeners calling `shutdown(reason, 2)` and returns a function that removes them. In `runCheckup`, after `createCheckupRun(session)`, build a `createShutdown` (from `./shutdown.js`) with `shutdown: async () => { await checkupRun.stop(); await fs.rm(workDir, { recursive: true, force: true }).catch(() => {}); }`, `exit: (c) => process.exit(c)`, `log: console.error`, and install the handlers. Call the disposer in the `finally`.
4. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- `shutdown.test.ts`: with fake timers and a `shutdown` that never resolves, `exit` is called after 8000 ms (the default) and not before.
- `checkup-run-teardown.test.ts` (lines 82-96): the "20 second cap" case becomes a 6 second cap (`advanceTimersByTimeAsync(5_999)` then `(1)`; rename the test and its comment). Add: a stop on a run in the `testing` phase with a current Plan record saves the waiting Plan before the teardown wait ends (assert `session.plan.save` is called while the run is still held).
- New `checkup-signals.test.ts`: with a fake `EventEmitter` as `proc`, emitting `SIGTERM` calls `shutdown('SIGTERM', 2)` once; after the disposer runs, emitting again calls nothing.

Run: `pnpm exec vitest run packages/runner/tests/shutdown.test.ts packages/runner/tests/checkup-signals.test.ts`, then the runner unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "SIGTERM" packages/runner/src/checkup.ts` finds the handler.
- [ ] `grep -n "8000" packages/runner/src/shutdown.ts` and `grep -n "TEARDOWN_WAIT_MS =" packages/runner/src/session/checkup-run.ts` show the shorter waits.
- [ ] The tests above pass; `pnpm build` passes.

## Notes

- Audit finding M33 (part) (audit of 11 Nov 2026 on `d225418`).
- T-358 (force-close the old browser on teardown timeout) and T-360 also edit `checkup-run.ts`: build them one after another. T-356 edits `checkup.ts`: it builds after this one.
- If the Cloud Run grace period is confirmed to be longer than 10 s for this deploy, keep the waits but still keep them below it.
