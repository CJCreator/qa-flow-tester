# T-372: The wizard's run events go through a tested reducer

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | wizard | test gap | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/run-events.ts` (new)
- `packages/wizard/src/App.tsx`
- `packages/wizard/src/screens/PlanReviewScreen.tsx`
- `packages/wizard/tests/run-events.test.ts` (new)

**Do not build in parallel with:** T-357, T-362, T-363, T-365, T-369, T-371 (all edit `App.tsx`).

## Problem

What a person sees during a Check-up is decided in `App.tsx`: `onEvent` (`App.tsx:305-442`) turns each runner event into state changes, address moves and follow-up requests, and `stopFailed`, `stopScan`, `stopTesting` and `approve` (`App.tsx:461-469`, `:665-778`) handle the answers to Stop and Approve. All of it is inline in a component of about 1,030 lines, and none of it is tested: unit coverage of `App.tsx`, `PlanReviewScreen.tsx` and `TestingScreen.tsx` was 0% on the 11 Nov run. The wizard's tests render static markup only (23 of 24 `.tsx` test files use `react-dom/server`; there is no jsdom or Testing Library), so they cannot drive App's handlers.

Mistakes here are invisible until someone runs a real Check-up: T-363 (a successful finish reported as "Nothing was stopped") and T-357 (a reconnect wiping the feed) are both in this code. The feed text already follows the tested pattern: `reduceFeed` in `lib/translate.ts` is pure and covered by `tests/translate.test.ts`.

## Current code

Branch from `main`, after T-357, T-363 and T-371 are built (all three edit this code).

`grep -n "const onEvent = useCallback" -A20 packages/wizard/src/App.tsx` shows the shape: one `switch (event.type)` that calls `setFeed`, `setScan`, `setStatus`, `setPlanNotice`, `setPlanUpdate`, `planningStartedAt.current = ...`, `navigate(..., { replace: true })`, `getPlan()`, `reconcile()`, `refreshRecent()`, `sendCounterEvent(...)` and `epoch.current++`, with `live = event.replayed !== true` and `onCheckAddress()` deciding whether the person is moved.

`PlanNotice` and `PlanUpdateState` are declared in `screens/PlanReviewScreen.tsx:28-47`.

## Change

1. New file `packages/wizard/src/lib/run-events.ts`. Move `PlanUpdateState` and `PlanNotice` here unchanged. In `PlanReviewScreen.tsx` replace their declarations with `export type { PlanNotice, PlanUpdateState } from '../lib/run-events';` and import them as types where the screen uses them (a `lib/` module must not import a screen, see the comment at `ScanningScreen.tsx:7-8`).
2. In `run-events.ts`, describe what one event does, without doing it:

```ts
/** Something App must do after an event: requests and moves stay in App, the decision is made here. */
export type RunEffect =
  | { kind: 'reconcile' }
  | { kind: 'load-plan'; after: 'ready' | 'update' }
  | { kind: 'navigate'; to: string } // with { replace: true }: a move the person did not make
  | { kind: 'go'; to: string } // a plain navigate(to): a move the person asked for (after Stop)
  | { kind: 'refresh-recent' }
  | { kind: 'count-completed' }
  | { kind: 'bump-epoch' };

/** The state changes and effects of one runner event. Each updater is applied with React's functional setState. */
export interface RunStep {
  feed?: (feed: FeedState) => FeedState;
  scan?: (scan: ScanProgress | null) => ScanProgress | null;
  status?: (status: RunnerStatus | null) => RunnerStatus | null;
  planUpdate?: (update: PlanUpdateState) => PlanUpdateState;
  planNotice?: PlanNotice | null;
  /** The new value of the planning start time, when it changes. */
  planningStartedAt?: number | null;
  effects: RunEffect[];
}

export function runEventStep(
  event: RunnerEvent,
  where: { onCheckAddress: boolean; planningStartedAt: number | null; now: number }
): RunStep;
```

   Move each `case` of `onEvent` into `runEventStep` as it stands after T-357 and T-363, keeping every text and every rule (`live` from `event.replayed`, time from `event.timestamp` or `where.now`, `isScanProgress`, the planning time-left estimate, the `askingSince` rule). Address moves become `navigate` effects with `PATHS.plan`, `PATHS.testing` or `PATHS.report(runId)`.
3. Also in `run-events.ts`, two pure helpers for the answers App handles:
   - `approveFailure(err: unknown): { error: string; needsSignIn: boolean | string[] }`: today's `catch` of `approve` (`App.tsx:752-767`): `ERR_SIGN_IN_REQUIRED` gives `SIGN_IN_AGAIN_TEXT` and the role list (or `true`), `ERR_HEADERS_NOT_SAVED` with names gives `headersNotice(...)`, any other `RunnerError` its message, anything else "The plan couldn’t be approved. Try again.".
   - `testingStoppedStep(reply: StopReply): RunStep`: what `stopTesting` does after a discard that worked (`App.tsx:716-732`; the `getPlan().then(setPlan)` there becomes the `load-plan` effect): with `planKept`, phase `awaiting-review`, the "Testing stopped. Your plan is kept." notice, `load-plan` and a move to `PATHS.plan`; without, phase `idle`, `isRunning: false` and `{ kind: 'go', to: PATHS.new }` (today's plain `navigate(PATHS.new)`). Reuse `StopReply` and `stopProblem` from `lib/stop-result.ts` (T-363).
4. `App.tsx`:
   - `onEvent` becomes: build `where`, call `runEventStep`, then `applyStep(step)`. `applyStep` is a small function in App that calls each setter whose updater is present, sets `planningStartedAt.current`, and runs each effect (`reconcile()`, `getPlan()` with today's `.then`/`.catch` for `'ready'` and `'update'`, `navigate(to, { replace: true })` for `navigate` and `navigate(to)` for `go`, `refreshRecent()`, `sendCounterEvent(COUNTER_EVENTS.completedCheckup)`, `epoch.current++`).
   - `approve`'s `catch` calls `approveFailure(err)` and sets the two states.
   - `stopTesting` uses `testingStoppedStep(result)` through `applyStep`.
   - No visible behaviour changes. The `useCallback` dependency list stays `[reconcile, refreshRecent]` plus whatever `applyStep` needs.
5. `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/wizard/tests/run-events.test.ts` (unit). Apply each returned updater to a small sample state (`initialFeed('product')`, a `RunnerStatus` with `phase: 'scanning'`), then assert on the result and on `effects`:

- `connected`: the effects contain `reconcile`; the feed and scan reset follow T-357's rule (a fresh connection resets, a resumed one does not).
- `DISCOVERY_PROGRESS` in `planning`: the first event sets `planningStartedAt` to its timestamp; a later one with `done: 2, total: 4` 10 s after the start gives `secondsLeft` 10; an `asking` event with the same `what` keeps `askingSince`.
- A `DISCOVERY_PROGRESS` that is not scan progress gives no change and no effects.
- `PLAN_READY`, live, on a Check-up address: status phase `awaiting-review` with `hasPlan: true`; effects `load-plan` (`ready`) and `navigate` to `/check/plan`. The same event with `replayed: true`: `load-plan` only. With `changedSinceApproval`: the "The site has changed since you approved its plan" notice.
- `PLAN_READY` live but not on a Check-up address: no `navigate`.
- `TESTING_STARTED`: the feed's `testingStartedAt` is the event time; live: phase `testing`, `navigate` to `/check/testing`.
- `RUN_COMPLETED` live with `runId: 'run-1'` on a Check-up address: phase `done`, `isRunning: false`, `reportRunId: 'run-1'`; effects `count-completed`, `refresh-recent`, `navigate` to `/reports/run-1`. Replayed: the feed changes, nothing else.
- `RUN_FAILED` live with `planKept`: `bump-epoch`, the "Testing stopped before it finished" notice, phase `awaiting-review`, `navigate` to `/check/plan`. Without `planKept`: phase `failed`, `isRunning: false`.
- `RUN_ABORTED` live: effect `reconcile`.
- `PLAN_UPDATE_STARTED` then `PLAN_UPDATE_FAILED`: `running` true then false, `seq` counts up, the failure text is set.
- `approveFailure`: the four branches above.
- `testingStoppedStep`: with and without `planKept`.
- Source check: `src/App.tsx` contains `runEventStep(` and no longer contains `case 'PLAN_READY':`.

Run: `pnpm exec vitest run packages/wizard/tests/run-events.test.ts packages/wizard/tests/translate.test.ts packages/wizard/tests/sources-screens.test.tsx packages/wizard/tests/plan-review-approve.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "case '" packages/wizard/src/App.tsx` finds no runner event names.
- [ ] `grep -n "export function runEventStep\|export function approveFailure\|export function testingStoppedStep" packages/wizard/src/lib/run-events.ts` finds all three.
- [ ] The new test and the wizard unit tests pass; `pnpm build` passes.
- [ ] By hand: one full Check-up (scan, Plan Review, approve, testing, report) moves through the same screens as before.

## Notes

- Audit finding M16 (wizard part) (audit of 11 Nov 2026 on `d225418`). The core part is T-336.
- Not in scope: a DOM test library for the wizard. Pure steps keep the unit tier free of jsdom.
- `App.tsx` is also edited by T-357, T-362, T-363, T-365, T-369 and T-371; this ticket goes last of them, since it moves the code they change.
