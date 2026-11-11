# T-358: When a stopped run does not tear down in time, its browser is closed before the slot is freed

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | runner | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/browser.ts`
- `packages/core/src/orchestrator.ts`
- `packages/core/src/discovery/discovery-agent.ts`
- `packages/runner/src/session/checkup-run.ts`
- `packages/core/tests/browser-abandon.test.ts` (new)
- `packages/runner/tests/checkup-run-teardown.test.ts`

**Do not build in parallel with:** T-251, T-307, T-308, T-312 (all edit `browser.ts`); T-296, T-308, T-312, T-313, T-331, T-355, T-360 (all edit `checkup-run.ts`); T-247, T-252, T-309, T-310, T-312, T-316, T-318, T-329, T-342 (all edit `orchestrator.ts`); T-240, T-312, T-332 (all edit `discovery-agent.ts`); T-355 (edits `checkup-run-teardown.test.ts`).

## Problem

Stop aborts the run and waits for it to tear down (`waitForTeardown`, `session/checkup-run.ts:1099-1114`). If the run is stuck, the wait gives up after `TEARDOWN_WAIT_MS`, logs "freeing the slot" and resolves. `stopRun` then sets `isRunning` false, the slot is free, and a new Check-up can start (`checkup-run.ts` around 1142-1164). Nothing was done to the old run: its orchestrator may still be driving Chromium. That breaks the one-run-at-a-time rule (DEC-002) and puts two Chromiums on a 2 GiB instance.

`BrowserManager.close()` (`core/src/browser.ts:248-266`) already gives up on a browser after 3 s, and leaves it alone. And nothing stops a stuck run from opening a new context after the slot is free: `createContext` does not know the run was abandoned.

## Current code

Branch from `main`.

`grep -n "TEARDOWN_WAIT_MS\|freeing the slot" packages/runner/src/session/checkup-run.ts`:

```ts
        console.warn('[Release check-up] The stopped check-up did not finish tearing down in time; freeing the slot.');
        resolve();
```

`grep -n "new FlowTestOrchestrator\|new DiscoveryAgent" packages/runner/src/session/checkup-run.ts` (lines 444 and 821): the two places a run owns a browser. Each class has a private `browserManager` (`orchestrator.ts:329`, `discovery-agent.ts:331`).

## Change

1. `core/src/browser.ts`: add to `BrowserManager` a flag and a method:
   - `abandon(): Promise<void>`: sets `this.abandoned = true`, then closes every browser in `this.browsers` without the 3 s race (call `b.close()` and await it with a short cap of 2 s), and clears the map.
   - `launch()` and `createContext()` throw `abortError()` (from `./abort.js`) when `this.abandoned`.
   - Playwright's public API gives no process handle for `chromium.launch()`. If `close()` itself hangs, the Chromium process can outlive this call: note that residual risk in the doc comment and in the ticket Notes; do not reach into private Playwright fields.
2. `orchestrator.ts` and `discovery-agent.ts`: add `async forceClose(): Promise<void> { await this.browserManager.abandon(); }` with a doc comment ("the run was abandoned: close the browser and refuse new ones").
3. `checkup-run.ts`: keep `let forceCloseCurrent: (() => Promise<void>) | null = null`. Set it right after the two `new ...` lines (to `() => orchestrator.forceClose()` and `() => agent.forceClose()`), clear it when the run ends. In `waitForTeardown`, when the cap wins the race, call `await forceCloseCurrent?.().catch(() => {})` **before** resolving, and change the log text to say the browser was closed.
4. Run `pnpm exec prettier --write` on the touched files, then `pnpm build` (core exported API changed).

## Tests

- New `packages/core/tests/browser-abandon.test.ts` (unit, no Chromium): after `abandon()`, `launch()` and `createContext()` reject with an abort error. `abandon()` on a manager with a fake browser (inject through the `browsers` map using a cast) calls the fake's `close()` once and resolves even when `close()` never settles (fake timers).
- `checkup-run-teardown.test.ts`: in the "frees the slot after the cap" case, give the run a `forceCloseCurrent` through the injected `prepareAI` or a new injectable hook (add a `registerForceClose` dependency in `createCheckupRun` deps if no other way) and assert it is called exactly once, and only after the cap.

Run: `pnpm exec vitest run packages/core/tests/browser-abandon.test.ts packages/runner/tests/checkup-run-teardown.test.ts`, then the core and runner unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "abandon" packages/core/src/browser.ts` finds the method and the two guards.
- [ ] `grep -n "forceClose" packages/runner/src/session/checkup-run.ts packages/core/src/orchestrator.ts packages/core/src/discovery/discovery-agent.ts` finds the wiring.
- [ ] The tests above pass; `pnpm build` passes.

## Notes

- Audit finding M34 (audit of 11 Nov 2026 on `d225418`).
- T-355 and T-360 also edit `checkup-run.ts`; T-307 and T-312 edit `core/src/browser.ts`; T-336 tests the orchestrator. Build these one after another.
- Not done here: killing the Chromium process itself (no public Playwright handle). If a future Playwright version exposes one, use it in `abandon()`.
