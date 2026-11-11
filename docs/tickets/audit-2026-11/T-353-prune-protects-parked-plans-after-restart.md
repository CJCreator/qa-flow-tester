# T-353: Pruning keeps a waiting Plan's run folder after a restart

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/session/report-store.ts`
- `packages/runner/src/session/checkup-session.ts`
- `packages/runner/tests/prune-keeps-waiting-plans.test.ts` (new)

**Do not build in parallel with:** T-352, T-359 (all edit `report-store.ts`).

## Problem

A waiting Plan (one kept aside while its owner is away) keeps its run folder: screenshots and `product-context.md` that the Plan needs when it is approved later. When a finished run is kept, `prune()` deletes every run folder that has no `summary.json` and is not "protected". The protected ids come from `this.plan.parked` (`session/checkup-session.ts:41`), which is the in-memory map of waiting Plans.

That map is filled from disk only inside `DefaultPlanStore.waiting()` (`session/plan-store.ts:229-245`, flag `parkedScanned`), and the only caller is `routes/plan.ts:1208`. After a restart nobody has called it yet. So the first Check-up that finishes sees an empty map, and `prune()` (`session/report-store.ts:140-152`) deletes the folders of every waiting Plan. The Plan file still exists, but its screenshots are gone.

## Current code

Branch from `main`.

`grep -n "parked" packages/runner/src/session/checkup-session.ts`:

```ts
    this.report = new DefaultReportStore(paths, () => {
      const active = this.run.runId ? [this.run.runId] : [];
      const parked = [...this.plan.parked.values()].map((r) => r.plan.runId);
      return [...active, ...parked];
    });
```

`grep -n "getProtectedRunIds" packages/runner/src/session/report-store.ts` (lines 40, 47-49, 147):

```ts
  private readonly getProtectedRunIds?: () => string[];
  ...
    const protectedIds = new Set(this.getProtectedRunIds ? this.getProtectedRunIds() : []);
```

## Change

1. `report-store.ts`: change the type of `getProtectedRunIds` (field and constructor parameter) to `() => string[] | Promise<string[]>`. In `prune()` use `new Set(this.getProtectedRunIds ? await this.getProtectedRunIds() : [])`. Compute it once, before the `fs.readdir` loop.
2. `checkup-session.ts`: make the callback `async` and read the waiting Plans from disk first:

```ts
    this.report = new DefaultReportStore(paths, async () => {
      const active = this.run.runId ? [this.run.runId] : [];
      const parked = (await this.plan.waiting()).map((w) => w.record.plan.runId);
      return [...active, ...parked];
    });
```

   `waiting()` reads the folder once and then answers from memory, so this costs one directory read per process.
3. Leave `plan-store.ts` as it is: `waiting()` already drops expired files, which is the right time to stop protecting them.
4. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

New file `packages/runner/tests/prune-keeps-waiting-plans.test.ts` (unit tier; temp folder, same setup as `store-indexes.test.ts`):

- Write a waiting-Plan file at `<dataDir>/waiting-plans/<host>.json` (record shape as in `store-indexes.test.ts`, `runId: 'run-waiting'`) and a run folder `<outputDir>/runs/run-waiting/shot.png` with no `summary.json`. Build a **new** `createCheckupSession(...)` (nothing parked in memory, as after a restart). Call `session.report.prune('other.test')`. Assert the folder `runs/run-waiting` still exists.
- Same setup with an unrelated unfinished folder `runs/run-stale` (no Plan file): assert it is deleted.
- An expired waiting-Plan file (older than the TTL, see `WAITING_PLAN_TTL_MS` in `plan-store.ts`; set its mtime with `fs.utimes`): its folder is deleted, and the file is gone.

Run: `pnpm exec vitest run packages/runner/tests/prune-keeps-waiting-plans.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "await this.getProtectedRunIds" packages/runner/src/session/report-store.ts` finds the call.
- [ ] `grep -n "plan.waiting()" packages/runner/src/session/checkup-session.ts` finds the callback.
- [ ] The new tests and the runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding H13 (audit of 11 Nov 2026 on `d225418`).
- T-359 also edits `report-store.ts` (atomic writes, global cap): build it after this one.
- Out of scope: the "current" Plan awaiting review is already protected through `run.runId`.
