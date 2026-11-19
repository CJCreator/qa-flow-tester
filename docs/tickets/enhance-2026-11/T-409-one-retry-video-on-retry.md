# T-409: One retry; video only on the retry

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | speed | todo |

**Files you may edit (no others):** `packages/core/src/orchestrator.ts` (the retry and video options only), `packages/core/tests/orchestrator-run-paths.test.ts`.

**Depends on:** T-389 (orchestrator chain).

## Problem

- A failed Test can run 4 times. The orchestrator sets `maxRetries: … options.flakyReruns ?? 3` (`orchestrator.ts:1086`), and the retry runner loops `while (attempts <= maxRetries)` (`retry-runner.ts:57`). No runner caller sets `flakyReruns`. The guide says a failed flow is retried once.
- Every Test point records video (`recordVideo ?? true`, `:594`).

## Change

- Change the default to `flakyReruns ?? 1`.
- Record video only on a retry attempt. `recordVideo: 'always'` remains available as an opt-in.

## Tests

- A Test that always fails makes 2 attempts.
- The first attempt records no video, and the retry does.

## Done when

The tests pass, and the Check-up benchmark shows the change in run time.
