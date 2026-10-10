# REPORT: URL + test credentials -> crawl -> issues

Status: DONE with caveats (see Risks, Not tested). Branch `feat/e2e-url-credentials-crawl`, 19 commits on `efd62a9`, 35 files, +1867/-60. Nothing pushed.

## Summary
Most of the feature already existed (wizard URL + sign-in, spider, planner, orchestrator, issues document). This branch closes the gaps: with test credentials the run now does full testing on a live (non-Test-Copy) App on the person's own machine (ADR 0022), a failed sign-in stops before any crawl or test, the report states crawl coverage, and the headless check-up accepts credentials from env vars.

## Spec and assumptions
Spec: `spec.md`. Decision (asked and answered): credentials = consent, amending ADR 0014. Added by recommendation: local-only (shared online copy ignores consent), per run, never saved to site memory, `owner: true` must be explicit. Assumptions: one role per run, works without an AI key, "all issues" = what existing checkers detect.

## Changes (commits)
| Step | Commit |
|---|---|
| ADR 0022, 0014 note, CONTEXT.md | 55b1a1c |
| Types: `pageCoverage` | 9bfcec0 |
| Fail fast on sign-in failure | 068e868, fail-closed fix 4d78f00 |
| Crawl page coverage | b609195 |
| Server consent rule (`resolveReadOnly`) | 934c982, truth table 71a3c32 |
| Issues document coverage section | 32493f3 |
| Wizard fields + consent notice | 94dac14, leak/stale fixes 015f729, approve re-enter 409 ee29d58 |
| Headless env credentials | b7fb0a5, session outside report folder d64801c |
| Orchestrator fails run on sign-in failure; coverage on first write | 0a02fd7 |
| Approve enforcement, explicit owner, no consent in memory | 754f71f |
| AC5 headless == API issues test | c6336ad |
| QA_CHECKUP_PORT read at start | 6fcfbdd |
| Docs | c144161; format 0c57a6a |

## Tests (acceptance criteria)
| AC | Result | Evidence |
|---|---|---|
| AC1 fixture, issues found | PASS (via benchmark) | `pnpm benchmark --sites fixture --no-ai`: exit 0, planted defects 6 of 6, gated thresholds held. This is the existing benchmark path, not the wizard with URL-only input. |
| AC2 wrong password stops before crawl | PASS | require-sign-in.test.ts, credentials-crawl.test.ts (no crawl events), also 5xx/dropped home page -> 'unreachable' |
| AC3 coverage matches visited | PASS | page-coverage.test.ts, credentials-crawl.test.ts (reached = site map pages) |
| AC4 password absent from output | PASS for run/data folders, SSE, console, checkup summary and errors (text files only) | credentials-crawl, checkup-credentials, consent-enforcement |
| AC5 headless == API issues | PASS | checkup-vs-api.test.ts (fingerprints equal, non-empty) |
| AC6 non-test host behavior | PASS, except beta over HTTP | consent-rule.test.ts truth table (incl. beta); the beta end-to-end case only proves refusal because beta rejects the private test target |
| AC7 no regressions, build/lint | PASS with caveat | build 0 errors, lint 0 errors (52 pre-existing-style warnings); failing files re-run serially all pass; wizard-e2e not verified; `format:check` red at base too |

Stages: install OK, lint OK, type-check (build) OK, unit/integration OK (targeted, serial), smoke (`pnpm start` health 200) OK, wizard-e2e NOT RUN/NOT TESTED (needs Chromium; 9 failures at baseline too).

## Regression results
See `impact.md`. Parallel full runs on this machine are load-flaky (13, 23, 24 failures from the same code family); every failing file passes when re-run serially.

## Review findings
Fresh-context review found 6 blocking issues, all fixed and tested: fail-open sign-in check; consent not enforced on approve/resume/specTestCases; consent bypassing the production confirmation (test-copy mark leaking into site memory); stale consent after host change; session cookies written into the uploaded report folder; page coverage missing from issues.md on the no-AI path. Non-blocking fixed: explicit owner, no owner write under consent, scrub on start error, vacuous tests tightened. Not fixed: see Risks.

## Risks
1. Safety (accepted by you): sign-in details do not prove ownership. With consent the all-changes block is off; GET-based deletes and POST mutations rely on the Safety Filter word check only.
2. Approve after a restart: re-entered role is always `member`; that form has no component test.
3. Beta consent rejection is proven by the rule's unit test, not an end-to-end run.
4. Spider: after a socket drop on one page the next page also failed in a stub test; not investigated on real sites. A "finish now" abort drops the unvisited queue from coverage (commented, not reported).
5. `checkups.test.ts` and the check-up default share port 3601.
6. A live production site was never run; only the fixture and stub shops.

## Run commands
- `pnpm bootstrap` once, then `pnpm build`, `pnpm start` -> http://localhost:3001 (type URL + username + password, accept the notice).
- Headless: `QA_TARGET_URL=<url> QA_USERNAME=<user> QA_PASSWORD=<pw> node packages/runner/dist/checkup.js` (set the values in your shell, never in files).
- Targeted tests: `pnpm exec vitest run --no-file-parallelism <files>`.
- Benchmark: `pnpm benchmark --sites fixture --no-ai`.
