# T-352: Stored Plans, summaries and benchmark jobs are checked when read

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | types | bug | todo |

**Files you may edit (no others):**

- `packages/types/src/stored-plan.ts` (new)
- `packages/types/src/index.ts`
- `packages/types/tests/stored-plan.test.ts` (new)
- `packages/runner/src/session/plan-store.ts`
- `packages/runner/src/session/report-store.ts`
- `packages/runner/src/benchmarks.ts`
- `packages/runner/src/routes/plan.ts`
- `packages/runner/tests/stored-data-guards.test.ts` (new)

**Do not build in parallel with:** T-312 (edits `plan-store.ts`); T-353, T-359 (all edit `report-store.ts`); T-359 (edits `benchmarks.ts`); T-240, T-256, T-258, T-260 (all edit `plan.ts`).

## Problem

The runner writes Plans, run summaries, reports and benchmark jobs to disk and reads them back as `JSON.parse(...) as SomeType`. Nothing checks the shape. A file that is cut short, edited by hand, or written by an older version passes the cast and fails later, far from the cause. The clearest case is a saved Plan: `normalizePlanIntents` and `normalizeStoredPlan` call `.map` on `plan.planPages[].tests` and `draft.plan.pages[].tests` (`packages/types/src/intent.ts:37-43`, `packages/runner/src/session/plan-store.ts:113-130`). A saved page with no `tests` throws a `TypeError` inside `current()`, which the Plan routes do not catch: the wizard gets a 500 and the person cannot open or discard their waiting Plan.

The other reads that trust the file: `report-store.ts:98` (`summary.json` as `RunSummary`), `:159` and `:168` (`report.json`), and `benchmarks.ts:41` (`BenchmarkJob`). A broken `summary.json` in the list shows a run with missing fields that the wizard then renders. The Plan PATCH route checks only that `flows` and `testCases` are arrays (`routes/plan.ts:238-300`), not what is inside them. `validateAuditStartBody` in `packages/types/src/website-audit.ts:190` is the pattern for a small hand-written, browser-safe checker (no new dependency; a search of `packages/types/src` for `zod` finds nothing).

## Current code

Branch from `main`.

`packages/runner/src/session/plan-store.ts` (`grep -n "readJsonSafe<StoredPlanRecord>" packages/runner/src/session/plan-store.ts`), three reads (`:174`, `:238`, `:266`), for example:

```ts
    const res = await readJsonSafe<StoredPlanRecord>(this.file, { currentVersion: 1 });
    if (!res.data) return null;
    const record = this.normalize(res.data);
```

`packages/runner/src/benchmarks.ts`:

```ts
      return JSON.parse(await fs.readFile(this.file(id), 'utf8')) as BenchmarkJob;
```

`packages/runner/src/session/report-store.ts` (`grep -n "JSON.parse" packages/runner/src/session/report-store.ts`): the three casts above.

## Change

1. New `packages/types/src/stored-plan.ts` (no Node imports; it is browser-safe like the rest of the package). Export small guards that return `true` only for the shape the code reads:
   - `isStoredPlanShape(x: unknown): boolean`: an object with `plan` (an object with string `runId` and `targetUrl`, array `pages`, array `flows`, array `questions`; when `planPages` is present, an array whose items each have an array `tests`) and `context` (an object with string `targetUrl` and `runId`; when `context.draft.plan` is present, `pages` is an array and each page has an array `tests`).
   - `isRunSummary(x: unknown): x is RunSummary`: strings `runId`, `targetUrl`, `host`, `timestamp`, `stamp`; a number `durationMs`; a boolean `ready`; `counts` an object of numbers for the four severities.
   - `isBenchmarkJob(x: unknown): x is BenchmarkJob`: strings `id`, `status` (one of `running`, `done`, `failed`), `stage`, `startedAt`.
   - `isReleaseReportShape(x: unknown): boolean`: an object with string `runId` and an array `findings`.
   - `planPatchProblem(body: unknown): string | null`: a plain-words problem (or null) when `flows` or `testCases` is not an array of objects that each have a string `id` and an array `steps`, or `items` is not an array of `{ id: string, skipped: boolean }`, or `screenSizes` is not an array of strings.
   Keep each guard under 30 lines and keep them lenient about extra fields (new versions add fields).
2. `packages/types/src/index.ts`: add `export * from './stored-plan.js';`. Do not add it to `browser.ts` (the wizard does not read stored files).
3. `plan-store.ts`: at the three reads, treat data that fails `isStoredPlanShape` as unreadable: for `current()` return `null`; in the parked scan skip the file; in the host read leave `record` null. Log one line with the file name (never the content): `[qa] ignoring unreadable saved Plan <file>`. Normalising is then safe.
4. `report-store.ts`: `list()` skips a `summary.json` that fails `isRunSummary`; `read()` and the `lastReport` load return `null` when the parsed value fails `isReleaseReportShape`. `benchmarks.ts` `get()` returns `null` when the parsed value fails `isBenchmarkJob`.
5. `routes/plan.ts` `patchPlan`: after the body is read, call `planPatchProblem(body)`; when it returns text, answer `400` with `{ error: <text> }` before any change is made.
6. Run `pnpm exec prettier --write` on the touched files, then `pnpm build` (types first).

## Tests

- New `packages/types/tests/stored-plan.test.ts` (unit): for each guard, one valid example is accepted; a missing array (`planPages[0].tests` absent, `flows` a string) is refused; extra unknown fields are accepted; `null`, a string and an array are refused. `planPatchProblem` returns null for a good body and text for `{ testCases: [{}] }`.
- New `packages/runner/tests/stored-data-guards.test.ts` (unit, temp folder, no Chromium): a `PlanStore` over a temp data dir whose `.qa-plan.json` has a saved page with no `tests` returns `null` from `current()` and does not throw; a good file still loads. A `ReportStore` over a temp output dir lists only the run whose `summary.json` is complete and skips one with `{}`; `read()` of a run whose `report.json` is `[]` is `null`. A `BenchmarkStore` `get()` of a file holding `{}` is `null`.
- `packages/runner/tests/plan-routes.test.ts` stays green; add one case: PATCH with `{ testCases: [{}] }` answers 400.

Run: `pnpm exec vitest run packages/types/tests/stored-plan.test.ts packages/runner/tests/stored-data-guards.test.ts packages/runner/tests/plan-routes.test.ts`, then the types and runner unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "as BenchmarkJob\|as RunSummary" packages/runner/src` finds nothing.
- [ ] A saved Plan with a page lacking `tests` does not throw; `current()` is `null` (test).
- [ ] A PATCH with a malformed `testCases` item answers 400 (test).
- [ ] `grep -n "stored-plan" packages/types/src/index.ts` finds the export and `browser.ts` does not list it.
- [ ] The new tests, the types and runner unit tests and `pnpm build` pass.

## Notes

- Audit finding M28 (audit of 11 Nov 2026 on `d225418`).
- The guards check only what the code reads. A full schema library is a larger decision and is not part of this ticket.
- An unreadable saved Plan is ignored, not deleted: the file stays on disk for a person to look at.
- Related: T-353 (pruning parked Plans), T-354 (the schedule store refuses an unreadable file), T-359 (atomic run writes).
