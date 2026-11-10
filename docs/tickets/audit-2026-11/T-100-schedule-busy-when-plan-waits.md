# T-100: A due schedule waits while a Plan is awaiting review

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`
- `packages/runner/tests/scheduler-busy-lock.test.ts`

**Do not build in parallel with:** T-91, T-92, T-94, T-96, T-97, T-99, T-106, T-108, T-110, T-112 (all edit `server.ts`).

## Problem

`runSchedule` treats the runner as busy only while a Check-up is scanning or testing, or while a benchmark or Website Audit holds the slot. A Plan awaiting review is not counted.

Scenario A: the owner is reviewing a Plan for `shop.example`. A schedule for `blog.example` comes due. The scheduled Check-up starts and quietly sets the owner's waiting Plan aside.

Scenario B: the schedule is for the same host. The start is refused with `ERR_PLAN_WAITING`, `runSchedule` returns `false`, and the schedule is recorded as failed instead of being retried.

## Current code

`packages/runner/src/server.ts` (branch `worktree-audit-cleanup`; find with `grep -n "private async runSchedule" packages/runner/src/server.ts`)

```ts
  private async runSchedule(schedule: CheckupSchedule): Promise<RunOutcome> {
    if (this.checkupStartRefused || this.runStartDone) return 'busy';
```

`this.phase` is a getter on the same class and returns the run phase (`'idle' | 'scanning' | 'awaiting-review' | 'testing' | 'done' | 'failed'`).

## Change

Replace the first line of the method body with:

```ts
    // A Plan awaiting review is the owner's work in progress: a schedule never sets it aside, it retries later.
    if (this.checkupStartRefused || this.runStartDone || this.phase === 'awaiting-review') return 'busy';
```

## Tests

Edit `packages/runner/tests/scheduler-busy-lock.test.ts`. Read the existing tests first: they show how a `'busy'` outcome keeps `nextRunAt` and sets a retry.

If the file tests `RunnerServer.runSchedule` (search for `runSchedule`), add a test `'a Plan awaiting review makes a due schedule busy'`: set the server's run phase to `'awaiting-review'` through `server.session.run.setPhase('awaiting-review')`, call the scheduler tick the same way the neighbouring test does, and expect the outcome the neighbouring "busy" test expects (the schedule is not marked failed and is retried).

If the file only tests `SchedulerManager` with a fake `run` callback, add no test and say so in your notes.

Run: `pnpm exec vitest run packages/runner/tests/scheduler-busy-lock.test.ts packages/runner/tests/scheduler.test.ts`, then `pnpm build`.

## Done when

- [ ] `runSchedule` returns `'busy'` when the phase is `awaiting-review`.
- [ ] Both scheduler test files and `pnpm build` pass.

## Notes

- `'busy'` means "retry soon" (R5); `false` means "failed". Do not change the catch block.
