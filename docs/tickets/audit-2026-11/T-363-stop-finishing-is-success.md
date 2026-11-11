# T-363: "Stop and plan" and "Make a report" treat a finishing run as stopped

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | bug | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/stop-result.ts` (new)
- `packages/wizard/src/App.tsx`
- `packages/wizard/tests/stop-result.test.ts` (new)

**Do not build in parallel with:** T-357, T-362, T-365, T-369, T-371, T-372 (all edit `App.tsx`).

## Problem

Stopping a Check-up offers two ways to keep the work so far: "Stop and plan what’s found" on the scan (`App.tsx:665-692`) and "Make a report from what’s done" while testing (`App.tsx:694-733`). Both call `stopFailed(await abortRun(true))` (`App.tsx:682`, `App.tsx:711`).

For a finish request the runner does not abort. It asks the run to finish and answers `{ aborted: false, finishing: true }` (`packages/runner/src/session/checkup-run.ts:1122-1131`, `packages/runner/src/server.ts:3307-3309`). `stopFailed` looks only at `aborted` (`App.tsx:461-469`), so every successful finish shows the red notice "The check-up wasn’t stopped. Nothing was stopped. The check-up may have already finished." (`App.tsx:1009-1022`) while the plan or the partial report arrives a moment later. The person is told the opposite of what happened.

## Current code

Branch from `main`.

`grep -n "const stopFailed" -A9 packages/wizard/src/App.tsx`:

```ts
  /** A stop that did not stop anything says so, beside the thing that was stopped. */
  const stopFailed = (result: { aborted: boolean; error?: string }): boolean => {
    if (result.aborted) {
      setStopError(null);
      return false;
    }
    setStopError(result.error ?? 'Nothing was stopped. The check-up may have already finished.');
    void reconcile();
    return true;
  };
```

`packages/wizard/src/api.ts:480-482` already types the reply: `Promise<{ aborted: boolean; planKept?: boolean; finishing?: boolean; error?: string }>`.

## Change

1. New file `packages/wizard/src/lib/stop-result.ts`:

```ts
/** What POST /api/runner/abort answered, as api.ts abortRun returns it. */
export interface StopReply {
  aborted: boolean;
  /** The run was asked to finish with the work so far: the plan or the partial report follows. */
  finishing?: boolean;
  planKept?: boolean;
  error?: string;
}

export const NOTHING_STOPPED = 'Nothing was stopped. The check-up may have already finished.';

/** The message for a stop that did nothing, or null when it worked: stopped, or finishing with the work so far. */
export function stopProblem(reply: StopReply): string | null {
  if (reply.aborted || reply.finishing) return null;
  return reply.error ?? NOTHING_STOPPED;
}
```

2. `App.tsx`: import `stopProblem, type StopReply` from `'./lib/stop-result'` and replace the body of `stopFailed`:

```ts
  const stopFailed = (result: StopReply): boolean => {
    const problem = stopProblem(result);
    setStopError(problem);
    if (problem === null) return false;
    void reconcile();
    return true;
  };
```

   Keep the notice title "The check-up wasn’t stopped" (`tests/sources-screens.test.tsx:298-302` pins it). The progress line already says "Finishing: …" from the `RUN_FINISHING` event (`lib/translate.ts:314-321`), so no new text is needed.
3. `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/wizard/tests/stop-result.test.ts` (unit):

- `{ aborted: true }` gives `null`.
- `{ aborted: false, finishing: true }` gives `null` (the case this ticket fixes).
- `{ aborted: false }` gives `NOTHING_STOPPED`.
- `{ aborted: false, error: 'Release check-up couldn’t stop the check-up. Try again.' }` gives that text.
- `{ aborted: false, planKept: true }` gives `NOTHING_STOPPED` (a stop with a plan waiting stops nothing; unchanged behaviour).
- Source check: `src/App.tsx` contains `stopProblem(result)` and no longer contains `if (result.aborted) {`.

Run: `pnpm exec vitest run packages/wizard/tests/stop-result.test.ts packages/wizard/tests/sources-screens.test.tsx`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "stopProblem" packages/wizard/src/App.tsx` finds the call in `stopFailed`.
- [ ] The new test and the wizard unit tests pass; `pnpm build` passes.
- [ ] By hand: during a scan, Stop, then "Stop and plan what’s found": no red notice, the plan arrives.

## Notes

- Audit finding M42 (audit of 11 Nov 2026 on `d225418`).
- `App.tsx` is also edited by T-357, T-362, T-365, T-369, T-371 and T-372. T-372 later moves stop handling into a tested module and reuses `stopProblem`.
- Out of scope: showing "Finishing…" on the scan screen, which reads scan progress, not the feed. A separate small ticket if wanted.
