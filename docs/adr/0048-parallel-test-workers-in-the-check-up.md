# 0048: Parallel Test Workers in the Check-up, and One Retry

Status: Accepted, 2026-11-19 (built: see docs/tickets/INDEX.md). Proposed 2026-11-19 (owner's answers in a grilling session, 2026-11-19; technical sign-off items 9 and 10).

## Context
- The Check-up runs every Test one after another. Its loop is `for (const testCase of testCasesToRun)` with `for (const bp of sizesFor(testCase))` inside (`packages/core/src/orchestrator.ts:648,667`).
- A failed Test runs up to 4 times (`flakyReruns ?? 3`, `orchestrator.ts:1086`; `retry-runner.ts:57`), although the guide says once.
- Video is recorded for every Test point (`recordVideo ?? true`, `:594`).

## Decision
- **Workers:** a pool of N isolated browser contexts takes Test points from one queue. N is 4 on the local runner and 1 on the hosted copy, set by `RUNNER_TEST_WORKERS`.
- **Roles:** all journeys of one Role run on the same worker, in Plan order. Sign-in state and created records then never race.
- **Retry:** a failed Test is retried once, in a clean context. Passing on the retry gives Flaky Passed.
- **Video** is recorded only on the retry attempt.
- Live events, the Report and the verdict do not change. Findings are merged after all workers finish.

## Consequences
- Run time drops by about the number of workers when there are no Roles. T-411 measures it.
- Fewer flaky Tests are recovered, which shows as a slightly higher Failed count. The guide already describes one retry.
- Tests that share server-side data across Roles may interfere. The Plan's Role grouping limits this.
