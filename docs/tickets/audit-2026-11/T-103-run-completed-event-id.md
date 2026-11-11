# T-103: RUN_COMPLETED keeps its event id on the live stream

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | bug | built |

**Files you may edit (no others):**
- `packages/runner/src/session/checkup-run.ts`
- `packages/runner/tests/run-events-replay.test.ts`

**Do not build in parallel with:** T-98, T-109 (edit `checkup-run.ts`).

## Problem

Each run event gets an id when the session logs it, and the SSE stream sends `id: <n>` so a page that reconnects resumes after the last event it saw. The stream looks the id up by object identity (`session.events.idOf(event)`).

For `RUN_COMPLETED` the session logs a new, smaller object (`{ type, runId }`) but passes the original event to the stream. The lookup finds nothing, so the live frame has no `id:`.

Scenario: a Check-up finishes; the page receives `RUN_COMPLETED` without an id. Its connection drops and reconnects with the previous id, and `RUN_COMPLETED` is replayed.

## Current code

`packages/runner/src/session/checkup-run.ts:400-403` (branch `worktree-audit-cleanup`)

```ts
  const broadcast = (event: OrchestratorEvent | Record<string, unknown>): void => {
    session.events.publish(event.type === 'RUN_COMPLETED' ? { type: event.type, runId: (event as any).runId } : event);
    if (deps.onEvent) deps.onEvent(event);
  };
```

`packages/runner/src/server.ts` (read only, do not edit), `streamRunnerEvent`:

```ts
    const id = typeof event === 'object' && event ? this.session.events.idOf(event) : undefined;
    const payload = `${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(event)}\n\n`;
```

## Change

Replace `broadcast` with:

```ts
  const broadcast = (event: OrchestratorEvent | Record<string, unknown>): void => {
    // RUN_COMPLETED is logged and streamed without its report (the page fetches that). One object for both,
    // so the stream finds the id the log gave it.
    const logged: OrchestratorEvent | Record<string, unknown> =
      event.type === 'RUN_COMPLETED' ? { type: event.type, runId: (event as { runId?: string }).runId } : event;
    session.events.publish(logged as Record<string, unknown>);
    if (deps.onEvent) deps.onEvent(logged);
  };
```

Check what `deps.onEvent` receivers need: `grep -n "onEvent" packages/runner/src/server.ts packages/runner/src/session/checkup-run.ts`. In `server.ts` the receiver is `(event) => this.streamRunnerEvent(event)`. If any receiver reads `event.report`, stop and set the ticket to `blocked`.

`forwardRunEvent` (just below) already stores the report with `session.report.set(event.report)` before it calls `broadcast`; leave it.

## Tests

Edit `packages/runner/tests/run-events-replay.test.ts`. Copy the setup of an existing test that publishes events and reads ids.

If the file builds the Check-up run with an `onEvent` dep, add `'RUN_COMPLETED reaches onEvent as the logged object'`: capture the argument of `onEvent` for a `RUN_COMPLETED` broadcast and expect `session.events.idOf(captured)` to be a number, and `captured` to have no `report` key.

If the file tests only `DefaultRunEvents`, add no test and say so in your notes.

Run: `pnpm exec vitest run packages/runner/tests/run-events-replay.test.ts packages/runner/tests/status-and-run-events.test.ts`, then `pnpm build`.

## Done when

- [x] `onEvent` receives the same object that was published.
- [x] Both test files and `pnpm build` pass.

## Notes

- This also removes the `any` cast on that line.
- The wizard reads the report from `GET /api/runner/report`, not from the event (confirm with `grep -rn "RUN_COMPLETED" packages/wizard/src | head`). If the wizard reads `event.report`, stop and set `blocked`.
