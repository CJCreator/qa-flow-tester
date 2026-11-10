# T-97: Past check-ups shows the new verdict after a report is reviewed

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | built |

**Files you may edit (no others):**
- `packages/runner/src/session/report-store.ts`
- `packages/runner/src/server.ts`
- `packages/runner/tests/store-indexes.test.ts`

**Do not build in parallel with:** T-91, T-92, T-94, T-96, T-99, T-100, T-106, T-108, T-110, T-112 (all edit `server.ts`).

## Problem

`ReportStore.list()` caches the run index and rebuilds it only when the modification time of the `runs/` folder changes. `saveReviewedReport` rewrites `runs/<id>/summary.json` after triage, an accepted judgement or the visual review. Rewriting a file inside a run folder does not change the `runs/` folder's time.

Scenario: a Check-up ends "Not ready". The owner marks its only Blocker as intended; the report now says "Ready". `GET /api/runs` (Past check-ups) still says "Not ready" until another Check-up is added or removed.

## Current code

`packages/runner/src/session/report-store.ts:45` and `:86-105` (branch `worktree-audit-cleanup`)

```ts
  private runIndex: { rootMtimeMs: number; byName: Map<string, RunSummary> } | null = null;
```

```ts
  async list(): Promise<RunSummary[]> {
    const root = path.join(this.paths.outputDir, 'runs');
    const rootMtimeMs = await fs.stat(root).then(
      (s) => s.mtimeMs,
      () => -1
    );
    if (!this.runIndex || this.runIndex.rootMtimeMs !== rootMtimeMs) {
```

`packages/runner/src/server.ts`, end of `saveReviewedReport` (find with `grep -n "private async saveReviewedReport" packages/runner/src/server.ts`)

```ts
    await fs
      .writeFile(
        summaryFile,
        JSON.stringify(
          { ...summary, ready: verdict.ready, stamp: verdict.stamp, reason: verdict.reason, counts: verdict.counts },
          null,
          2
        ),
        'utf8'
      )
      .catch(() => {});
  }
```

## Change

1. In `report-store.ts`, add to the `ReportStore` interface, after the `list(): Promise<RunSummary[]>;` line:

```ts
  /** Forget the cached run index: call after a run's summary.json is rewritten in place. */
  invalidate(): void;
```

2. In the class in the same file, add this method directly above `async list()`:

```ts
  invalidate(): void {
    this.runIndex = null;
  }
```

3. In `server.ts`, in `saveReviewedReport`, add after the final `.catch(() => {});` and before the closing `}` of the method:

```ts
    // The summary changed in place; the folder's time did not, so the cached index would stay stale.
    this.session.report.invalidate();
```

4. If the build reports another class that implements `ReportStore` (a test double), add the same `invalidate(): void {}` there.

## Tests

Edit `packages/runner/tests/store-indexes.test.ts`. Copy the setup of the existing test that calls `list()` on the report store with run folders on disk. Add:

- Name: `'invalidate() makes list() re-read a summary rewritten in place'`.
- Steps: write `runs/<id>/summary.json` with `ready: false`; `await store.list()`; overwrite the same file with `ready: true`; `await store.list()` and expect the entry still has `ready: false` only if the folder time did not change (do not assert this step); call `store.invalidate()`; `await store.list()`.
- Expect: the entry has `ready: true`.

Run: `pnpm exec vitest run packages/runner/tests/store-indexes.test.ts`, then `pnpm build`.

## Done when

- [x] `ReportStore` has `invalidate()`.
- [x] `saveReviewedReport` calls it after writing the summary.
- [x] New test and `pnpm build` pass.

## Notes

- Out of scope: changing the cache key.
