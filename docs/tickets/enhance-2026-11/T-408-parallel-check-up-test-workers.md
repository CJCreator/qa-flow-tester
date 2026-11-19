# T-408: Parallel Check-up test workers (ADR 0048)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | L | core, runner | speed | todo |

**Files you may edit (no others):**
- `packages/core/src/orchestrator.ts`, `packages/core/src/browser.ts`
- `packages/runner/src/session/checkup-run.ts` (the option only)
- `docs/CONFIGURATION.md` (`RUNNER_TEST_WORKERS`)
- `docs/adr/0048-parallel-test-workers-in-the-check-up.md` (set the status to Accepted)
- `docs/PRODUCT_GUIDE.md` (Check-up step 4)
- tests in `packages/core/tests/`

**Depends on:** T-409 (orchestrator chain) and T-411 (the baseline).

## Problem

Every Test point runs one after another (`orchestrator.ts:648,667`). Neither the orchestrator nor the runner has a worker pool.

## Change

- **Pool:** N workers, each with its own isolated context per Test point, take items from one queue. `RUNNER_TEST_WORKERS` sets N: 4 locally and 1 on the hosted copy by default.
- **Roles:** all Test points of one Role go to the same worker, in Plan order.
- **Shared state:** `allFindings`, `results`, coverage, `vitalsMeasured` and the live events stay correct when updated from several workers. Order the results by Plan item, not by finish time.
- **Stopping:** a Stop ends every worker.

## Tests

- 12 Test points on 4 workers give the same results and findings as 1 worker.
- Role journeys never overlap.
- A Stop ends all workers.

## Done when

The tests pass. On the Check-up benchmark (T-411), run time falls at least 50% with 4 workers, and the flaky rate stays within 2 points of the baseline.
