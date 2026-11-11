# T-359: Run reports are written atomically, and run storage has a global cap

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/session/report-store.ts`
- `packages/runner/src/benchmarks.ts`
- `packages/runner/tests/report-store-retention.test.ts` (new)
- `packages/runner/tests/benchmarks-atomic.test.ts` (new)

**Do not build in parallel with:** T-352, T-353 (all edit `report-store.ts`); T-352 (edits `benchmarks.ts`).

## Problem

`report.json` and `summary.json` of a finished run are written with a plain `fs.writeFile` (`session/report-store.ts:111`, `:132`). A crash or a stop of the container in the middle of the write leaves a half-written file. For `summary.json` that is worse than it sounds: `list()` (`report-store.ts:86-106`) treats a run with an unreadable summary as "not finished", and `prune()` then deletes the whole run folder. The benchmark store has the same plain write (`benchmarks.ts:35`). `writeJsonAtomic` (`packages/core/src/atomic-write.ts:47`) already exists and the schedule and plan stores use it.

Retention is only "10 newest runs per site" (`RUNS_KEPT_PER_SITE`, `report-store.ts:7`, used at `:141-143`). A copy that is used against many addresses keeps ten runs for each of them without limit, with screenshots, on a 2 GiB instance whose data lives in `/tmp` (memory-backed on Cloud Run).

## Current code

Branch from `main`.

`grep -n "writeFile" packages/runner/src/session/report-store.ts packages/runner/src/benchmarks.ts`:

```ts
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report), 'utf8');
    await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    await fs.writeFile(this.file(job.id), JSON.stringify(job, null, 2), 'utf8');
```

`prune(host)` (`report-store.ts:140-152`) removes runs past ten for one host, then unfinished folders.

## Change

1. `report-store.ts`: import `writeJsonAtomic` from `@qa/core`. Write `report.json` and `summary.json` with it. Write `report.json` first and `summary.json` last, as today: the summary is the "finished" marker. (`writeJsonAtomic` indents the JSON, so `report.json` gets larger; accept that, or note the size change in the commit.)
2. `benchmarks.ts` `save()`: use `writeJsonAtomic(this.file(job.id), job)`.
3. `report-store.ts`: add a global cap to `prune(host)`, after the per-host step and before the unfinished-folder sweep:
   - `export const RUN_RETENTION_DAYS_DEFAULT = 30;` and a reader `runRetentionDays(env = process.env)` for `RUNNER_RUN_RETENTION_DAYS` (a whole number 1..365, anything else uses the default).
   - `export const MAX_RUNS_TOTAL = 100;` Delete finished runs older than the retention days, then, if more than `MAX_RUNS_TOTAL` remain, delete the oldest until it is `MAX_RUNS_TOTAL`. Never delete the newest run of any host, a protected run id (`getProtectedRunIds`, see T-353) or the run that was just kept.
   - Invalidate `runIndex` after any deletion (`this.runIndex = null`).
4. Document `RUNNER_RUN_RETENTION_DAYS` where the other runner variables are described: that edit is in `docs/CONFIGURATION.md`, which is **not** in this ticket's Files; put a one-line note in the pull request description instead, or ask for a docs follow-up.
5. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- New `report-store-retention.test.ts` (unit, temp folder, as in `store-indexes.test.ts`): build 3 hosts with `summary.json` files and old timestamps; with `RUNNER_RUN_RETENTION_DAYS=7` old runs go and the newest run of each host stays. With more than `MAX_RUNS_TOTAL` runs the oldest go first. A protected run id survives. A bad env value uses the default.
- `keep()` leaves no `*.tmp-*` file behind and `summary.json` parses (read it back). Mock `fs.rename` (or the `writeJsonAtomic` import) to throw once and assert the old `summary.json` content is still intact.
- New `benchmarks-atomic.test.ts`: `save()` then `get()` round trip; a failing write leaves the previous job file readable.

Run: `pnpm exec vitest run packages/runner/tests/report-store-retention.test.ts packages/runner/tests/benchmarks-atomic.test.ts packages/runner/tests/store-indexes.test.ts`, then the runner unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "fs.writeFile" packages/runner/src/session/report-store.ts packages/runner/src/benchmarks.ts` finds nothing.
- [ ] `grep -n "RUNNER_RUN_RETENTION_DAYS" packages/runner/src/session/report-store.ts` finds the reader.
- [ ] The tests above pass; `pnpm build` passes.

## Notes

- Audit finding M35 (audit of 11 Nov 2026 on `d225418`).
- Builds after T-353 (same file `report-store.ts`).
- Website Audit data lives in the audit store (ADR 0036) with its own deletion; it is not touched here.
