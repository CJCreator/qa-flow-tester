# T-357: Event replay says when it dropped events, and a reconnect keeps the live feed

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/session/run-events.ts`
- `packages/runner/src/server.ts`
- `packages/wizard/src/hooks/useRunnerStream.ts`
- `packages/wizard/src/App.tsx`
- `packages/runner/tests/run-events-replay.test.ts`
- `packages/wizard/tests/runner-stream-reset.test.ts` (new)

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-300, T-301, T-302, T-303, T-308, T-313, T-329, T-331 (all edit `server.ts`); T-362, T-363, T-365, T-369, T-371, T-372 (all edit `App.tsx`).

## Problem

When the page loses the event stream (a network drop, a laptop sleeping) it reconnects and asks only for the events after the last id it saw (`useRunnerStream.ts:42`, `resumeUrl`). The runner keeps only the newest 200 events (`run-events.ts:1-6`) and, if the page's id has fallen off that window, silently replays what remains: "the caller is not told about the gap" (`run-events.ts:25`, comment at `server.ts:1147-1148`). The page then shows a feed with a hole and no hint.

Worse, in the other direction: the server always sends `connected` first (`server.ts:1143-1146`), and the wizard answers every `connected` with `setFeed(initialFeed('product')); setScan(null); ...` (`App.tsx:314-319`). After a plain reconnect the runner replays only the missed events, so the page has just thrown away the problems, pages and testing start time it already held and only gets the last few events back.

A runner that restarted numbers its events from 1 again. A page holding id 500 asks for events after 500, gets nothing, and keeps the old process's feed.

## Current code

Branch from `main`.

`grep -n "since(" packages/runner/src/server.ts packages/runner/src/session/run-events.ts`:

```ts
            if (this.isMine(this.currentRunId))
              for (const { id, event } of this.session.events.since(lastEventIdOf(req, url) ?? 0))
                res.write(`id: ${id}\ndata: ${JSON.stringify({ ...event, replayed: true })}\n\n`);
```

`grep -n "case 'connected'" -A5 packages/wizard/src/App.tsx`:

```ts
        case 'connected':
          setFeed(initialFeed('product'));
          setScan(null);
```

## Change

1. `run-events.ts`: add `readonly firstId: number | null` to `RunEvents` and `DefaultRunEvents` (the id of the oldest retained event, `null` when none). Update the `since()` comment.
2. `server.ts`, stream route: read `after = lastEventIdOf(req, url)` once. Decide `resumed`: `after !== null && after <= this.session.events.lastId && (firstId === null || firstId <= after + 1)`. Send `{ type: 'connected', timestamp, head, resumed }` (`resumed` false when there was no id, the id is newer than anything this process issued (a restart), or events between the id and the oldest retained one are gone (truncated)). Replay `since(resumed ? after : 0)`. Keep `replayed: true` on replayed events.
3. `useRunnerStream.ts`: nothing about ids changes. Export a small pure helper `shouldResetFeed(event: { resumed?: boolean }): boolean` returning `event.resumed !== true`, with a comment (a fresh or non-resumable connection gets the whole retained log again; a resumed one only the gap).
4. `App.tsx` `case 'connected'`: reset the feed, `setScan(null)` and `planningStartedAt` only when `shouldResetFeed(event)`. Always call `void reconcile()`.
5. Wizard text types: if `RunnerEvent` in `packages/wizard/src/lib/translate.ts` does not allow a `resumed` field, it already has an index signature for other fields; check with `grep -n "interface RunnerEvent" -A6 packages/wizard/src/lib/translate.ts` and read the field with a narrow `typeof event.resumed === 'boolean'` instead of editing that file.
6. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- `run-events-replay.test.ts`: `firstId` is `null` before any event, the oldest retained id after a cap overflow, and `null` again after `clear()`.
- Add a loopback case in the same file or, if the runner tests have an SSE helper (`grep -rn "runner/stream" packages/runner/tests`), use it: connect with `lastEventId` equal to `head` and see `resumed: true` and only later events; connect with an id older than the window and see `resumed: false` and the whole retained log; connect with an id larger than `lastId` and see `resumed: false`.
- `packages/wizard/tests/runner-stream-reset.test.ts` (new, unit): `shouldResetFeed({})` and `shouldResetFeed({ resumed: false })` are true; `shouldResetFeed({ resumed: true })` is false.

Run: `pnpm exec vitest run packages/runner/tests/run-events-replay.test.ts packages/wizard/tests/runner-stream-reset.test.ts`, then the runner and wizard unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "resumed" packages/runner/src/server.ts packages/wizard/src/App.tsx` finds the field sent and read.
- [ ] `grep -n "firstId" packages/runner/src/session/run-events.ts` finds the getter.
- [ ] The tests above pass; `pnpm build` passes.

## Notes

- Audit findings L10 (part) and M41 (audit of 11 Nov 2026 on `d225418`).
- App.tsx is also edited by T-362, T-363, T-371 and T-372: build after T-362 and T-363, before T-371.
- Out of scope: the `clear()` at a new run start. The page resets its feed on the run's own start event, as today.
