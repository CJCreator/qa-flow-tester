# T-230: Test that the finished-run event reaches `onEvent` as the logged object

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | test gap | todo |

**Files you may edit (no others):**
- `packages/runner/tests/checkup-run-on-event.test.ts` (new)

**Do not build in parallel with:** nothing.

## Problem

T-103 made `createCheckupRun` pass one object to both the event log and `deps.onEvent` when a run completes, with the report left out. The behaviour is in the code but no test covers it, so a later edit can bring back two different objects (the stream then cannot find the id the log gave the event).

## Current code

Branch from `main`. `packages/runner/src/session/checkup-run.ts`:

```ts
  const broadcast = (event: OrchestratorEvent | Record<string, unknown>): void => {
    // RUN_COMPLETED is logged and streamed without its report (the page fetches that). One object for both,
    // so the stream finds the id the log gave it.
    const logged: OrchestratorEvent | Record<string, unknown> =
      event.type === 'RUN_COMPLETED' ? { type: event.type, runId: (event as { runId?: string }).runId } : event;
    session.events.publish(logged as Record<string, unknown>);
    if (deps.onEvent) deps.onEvent(logged);
  };

  const forwardRunEvent = (event: OrchestratorEvent): void => {
    if (event.type === 'RUN_COMPLETED') session.report.set(event.report);
    broadcast(event);
  };
```

`RunDeps.onEvent` is declared at about line 139 of the same file.

Two existing tests already build a run with fake dependencies and drive it to the end. Read both before writing anything, and copy their setup:

- `packages/runner/tests/checkup-run-teardown.test.ts`
- `packages/runner/tests/checkup-run-save-failure.test.ts`

## Change

Create `packages/runner/tests/checkup-run-on-event.test.ts` with one `describe('createCheckupRun onEvent')` and these tests. Build the session and the run the way the two files above do, adding `onEvent` to the deps to collect events into an array, and capture what `session.events.publish` receives (spy on it or read the event log, whichever those files already do).

1. `'RUN_COMPLETED reaches onEvent as the object that was published'`: run to completion. Find the `RUN_COMPLETED` entry in the collected `onEvent` events and the one given to `publish`. Assert they are the same object with `toBe` (identity, not `toEqual`).
2. `'RUN_COMPLETED is sent without its report'`: assert that object has `type` and `runId` and no `report` key (`expect(event).not.toHaveProperty('report')`), and that the report is still stored on the session (read it the way the existing tests read the report).
3. `'other events pass through unchanged'`: pick any non-completion event the run emits and assert the object given to `onEvent` is the same object given to `publish`.

Do not change any source file. If the run cannot be driven to `RUN_COMPLETED` with the fakes those tests use, set the ticket to `blocked` and say which dependency is missing.

## Tests

`pnpm exec vitest run packages/runner/tests/checkup-run-on-event.test.ts`, then `pnpm typecheck`.

## Done when

- [ ] The new file has the three tests and they pass.
- [ ] `pnpm typecheck` passes.
- [ ] No file under `packages/runner/src` changed (`git status --short packages/runner/src` prints nothing).

## Notes

- The new file needs no entry in `vitest.workspace.ts`: files not listed in `BROWSER_TESTS` are unit tests.
- Unit tier rule: no Chromium and no external network. Use the fakes, not a real browser.
