# Check-up speed-up plan

Updated 2026-11-18. Branch `feat/checkup-speed`. Governing record: [ADR 0046](../adr/0046-parallel-test-execution-on-a-test-copy.md).

## Goal
150 Check-up tests on a Test Copy: from about 90 minutes to under 20 minutes, on the owner's laptop (4 cores, 8 threads, 15.8 GB RAM).

## Baseline
Not measured yet. The timed run is pending (see Pending). The 90 minute figure is the owner's estimate, not a measurement. Until the timed run exists, no speed-up claim is made.

## Findings
Marked observed (read in code or seen in output), inferred (follows from code, not run), assumed (not checked).

| # | Finding | Where | Status |
|---|---|---|---|
| 1 | The Testing loop runs Plan Items one at a time, each in its own browser page. | `packages/core/src/orchestrator.ts`, `runChecks` tests loop | observed |
| 2 | Role crawls run one Role after another. | `packages/core/src/discovery-agent.ts` | observed |
| 3 | Each crawl fetches 2 pages at a time. | crawl concurrency setting in discovery | observed |
| 4 | Planning is paced at about 3.1 s per OpenRouter request. | planning provider call path | observed |
| 5 | Test navigations are not paced by `HostPacer`; the orchestrator passes no pacer. | `orchestrator.ts`, `packages/core/src/host-pacer.ts` | observed |
| 6 | There was no per-stage timing before this work, so where the 90 minutes goes is unknown. | whole run | observed |
| 7 | Testing dominates the 90 minutes. | derived from 150 tests, serial | inferred |
| 8 | The laptop can hold up to 10 lanes of Chromium contexts in 15.8 GB. | hardware | assumed |
| 9 | qa.mysleepreport.com tolerates N concurrent requests without 429/503. | target host | assumed |

## Done so far
| Commit | What |
|---|---|
| 7f4a7ea | Timing: per-stage `QA_DEBUG=timing` log lines |
| ad26047 | ADR 0046 written (Proposed) |
| 5556cd0 | Refactor: per-test body of the Testing loop moved into `runTestCase` |
| c396a9e | Testing: optional parallel Role lanes on a Test Copy (`parallelRoles`, default 1) |
| 3ad11a3 | ADR 0046 marked accepted by owner approval |

## Pending in this wave
1. Pacing for Test Copy navigations: pass a `HostPacer` with `maxInFlight = N` to Testing-stage navigations and checker fetches, only when `testCopy` is true. A 429 or 503 drops that host to 1 in flight for the rest of the run. Crawl-delay forces 1.
2. `parallelRoles` plumbing: type in `packages/types`, `--parallel-roles <n>` in `packages/runner/src/checkup.ts`, `QA_PARALLEL_ROLES` env/config, runner request body. Clamp to 1..10, default 1. Non-Test-Copy runs always get 1.
3. Wizard field "Parallel requests" (Test Copy only), bound 1..10, default 1. Use terms from `CONTEXT.md`. Import single modules from `@qa/types/src/...`.
4. ADR 0046 amendment: done 2026-11-18 (bound 1..10, one knob, back-off, pacing, site-wide accepted, open items settled).
5. Timed run: the owner runs it in the wizard against qa.mysleepreport.com with `QA_DEBUG=timing`. The agent reads the output and records stage times in Baseline.

## Decisions log
| Date | Decision |
|---|---|
| 2026-11-18 | Back-off: a 429 or 503 from a Test Copy host drops it to one in flight for the rest of the run (same as ADR 0043). |
| 2026-11-18 | N bound is 1 to 10. |
| 2026-11-18 | Default stays 1. |
| 2026-11-18 | N is set by config (`QA_PARALLEL_ROLES`, `--parallel-roles`) and by a wizard field. |
| 2026-11-18 | Plumbing covers CLI and wizard; the wizard field shows for a Test Copy only. |
| 2026-11-18 | Timed run is done by the owner in the wizard on qa.mysleepreport.com. |
| 2026-11-18 | Push the branch and open a draft PR. |
| 2026-11-18 | Site-wide findings: accepted that attribution to a page can differ between runs with lanes on. Documented. |
| 2026-11-18 | Pacing: yes, Test Copy navigations and checker fetches go through the host pacer at N per host. |
| 2026-11-18 | Next wave, only if the run is slow: parallel read-only tests within a Role. |

## Risks
- Site-wide nondeterminism: with lanes on, a site-wide finding may be attributed to a different page between runs. Accepted; compare fingerprints, not page attribution, when checking parity.
- Browser relaunch race: lanes sharing one browser may race when a crashed browser is relaunched. Needs a test in `test-lanes-browser`.
- Role lanes cap the speed-up at Roles + 1: with R Roles, lanes beyond R add nothing until tests inside a Role run in parallel (next wave).
- Production address is not a Test Copy: a run against it gets N = 1 whatever the setting. Confirm the runner passes the `testCopy` decision into the orchestrator option (ADR 0046, Gate).
- Memory: many Chromium contexts on 15.8 GB. Watch RSS during the timed run.
- Target host load: the Test Copy may throttle; back-off then removes the gain.

## Acceptance criteria
- Timed run of 150 tests on the laptop takes 20 minutes or less.
- Verdict and finding fingerprints match the serial baseline run (N = 1) on the same Test Copy.
- Unit suite green (`pnpm test`).
- Browser suites `orchestrator-run-paths` and `test-lanes-browser` green (`pnpm test:browser`).
- `pnpm build` green after the types change.

## Next wave
Only if the timed run is above 20 minutes: run read-only tests in parallel within a Role. Needs its own ADR amendment and a safety review of which tests count as read-only.
