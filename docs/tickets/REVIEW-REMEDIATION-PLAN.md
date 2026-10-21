| T-23 | Split large files by area | 8 | 19 | P3 | L | T-63 | later (class-size refactor deferred by decision until after /verify-all) |
# Review remediation plan

Source: every review run on this repo, combined into one plan. Sources (kept as evidence):
[APP_REVIEW.md](../APP_REVIEW.md) (correctness, reliability, growth, deployment, wizard UX, docs drift),
[SECURITY_REVIEW.md](../SECURITY_REVIEW.md) (S1–S12), [PERFORMANCE_ANALYSIS.md](../PERFORMANCE_ANALYSIS.md)
(performance rounds 1 and 2). Tickets T-41 to T-63 close the open items. This plan does not reopen T-30 to T-40;
where a built ticket left a gap in the code, the gap is a follow-up ticket here, and the built ticket is named.

## Rules for this plan

- Build only, then verify once. Tickets end `built`. Tests are written, not run, during build. Tests run in one
  `/verify-all` pass after every ticket here is `built`, the same rule as the Demo readiness plan. Exception: T-41
  runs first and records the baseline, because a verification pass needs a working test environment.
- Each ticket updates the tests its change affects and adds tests for new behaviour.
- Edits use the Edit tool on unique strings. Nothing rewrites a shared file with Write.
- Ids: review findings keep their source prefix so they can be traced. `SEC` (security), `COR` (correctness),
  `REL` (reliability), `GROW` (resource growth), `DEP` (deployment), `UX` (wizard), `DOC` (docs), `LAT` (response
  latency), `PERF` (performance rounds).
- A ticket is done when its acceptance criteria are checked off and its tests exist. Severity is the reviewer's
  rating; verified findings come first in each phase.

## Phases

| Phase | Theme | Tickets | Why this order |
|---|---|---|---|
| 0 | Test baseline | T-41, T-64 | A verification pass needs a test environment that works and a suite that passes before any change. |
| 1 | Security and data exposure | T-42, T-43, T-44, T-45, T-46 | Hosted beta exposes these to strangers. Fix before anything else ships. |
| 2 | Release verdict | T-47, T-48 | These decide "Ready to release" and must be right before the demo. |
| 3 | Run lifecycle and durable state | T-49, T-50 | Leaked browsers, stop races and lost schedules affect every run. |
| 4 | Deploy and hosting | T-51, T-52 | The deploy gate and container hardening decide what users run. |
| 5 | Performance | T-53 to T-59 | Speed after correctness. T-53 first, so every later change is measured. |
| 6 | Resource growth | T-60 | Disk and memory bounds, after the lifecycle fixes that create most of the growth. |
| 7 | Wizard UX | T-61, T-62 | Accessibility and copy, after the flows in T-36 and T-37 are settled. |
| 8 | Docs and contracts, then the file split | T-63, then T-23 | Last: docs describe settled behaviour once, and the file split moves code nobody else edits. |

## Build order and file ownership

Tickets are built in batches, numbered 1 to 19. The rules that keep them from conflicting:

1. A batch starts only when every earlier batch is built. Batch 1b (T-64) must pass before batch 2 starts, so later failures are new.
2. Tickets in one batch edit disjoint files (the table below is the check).
3. A ticket that edits a file another ticket also edits sits in a later batch.
4. Docs have one editor each (see the Docs rule below), so no two tickets edit the same doc.
5. A ticket that adds a setting names it in its acceptance criteria. T-63 documents every setting; no other ticket edits `docs/CONFIGURATION.md` or `.env.example`.

| Batch | Tickets | Files each ticket may edit |
|---|---|---|
| 1 | T-41 | `scripts/` (bootstrap), test setup, `docs/TESTING.md` |
| 1b | T-64 | the files each failing test points to (set during triage, recorded in T-64 before any edit); alone in its batch |
| 2 | T-42 | `packages/runner/src/server.ts` (benchmark handler, closed routes), `docs/API.md` |
| 2 | T-43 | `packages/core/src/safe-net.ts`, `packages/core/src/discovery/deterministic-spider.ts`, `packages/core/src/orchestrator.ts` (checkLink only), `packages/checkers/src/seo.ts`, `packages/checkers/src/security-depth.ts`, new ADR 0031 |
| 2 | T-44 | `packages/core/src/redact.ts`, `packages/checkers/src/security.ts` |
| 2 | T-46 | `packages/runner/src/session/checkup-run.ts` (cleanup in finally), `packages/runner/src/session/run-secrets.ts` (startup sweep), `packages/runner/src/session/checkup-session.ts`, `packages/runner/src/session/plan-store.ts` |
| 3 | T-45 | `redact.ts` (after T-44), `orchestrator.ts` (secret list, after T-43), `checkup-run.ts` (after T-46), `server.ts` status GET (after T-42), `packages/core/src/visual-capture.ts`, `packages/core/src/evidence.ts` |
| 4 | T-47 | `packages/core/src/finding-groups.ts`, `packages/core/src/scoring.ts`, `packages/types/src/verdict.ts`, `packages/types/src/problems.ts`, `packages/runner/src/checkup.ts` (exit code) |
| 4 | T-48 | `packages/core/src/plan/expand.ts`, `packages/checkers/src/refusal-rule.ts`, `packages/checkers/src/spec-conformance.ts`, `orchestrator.ts` (baseline capture, after T-45), ADR 0024 |
| 5 | T-49 | `orchestrator.ts` (run wrapper, after T-48), `checkup-run.ts`, `server.ts` (signals, unhandled rejection), `packages/runner/src/cli.ts`, `packages/core/src/browser.ts` (context leak), `routes/plan.ts` (approval) |
| 6 | T-50 | `packages/runner/src/scheduler.ts`, `packages/core/src/atomic-write.ts`, `server.ts` (scheduler handlers, after T-49), `checkup-run.ts` (save errors, after T-49), `plan-store.ts` (expiry, after T-46), `packages/runner/src/beta.ts` (folder removal) |
| 7 | T-51 | `render.yaml`, `.github/workflows/deploy.yml`, `ci.yml`, `tests.yml`, `templates/qa-check.yml`, `docs/DEPLOYMENT.md` |
| 8 | T-52 | `packages/runner/Dockerfile`, `browser.ts` (sandbox, after T-49), `server.ts` (`/healthz`, after T-50), `deploy.yml` (verify step only, after T-51), `DEPLOYMENT.md` (Docker lines only, after T-51), `orchestrator.ts` and `discovery-agent.ts` (URL log lines) |
| 9 | T-53 | `orchestrator.ts` (timing, after T-52), `packages/core/src/discovery/discovery-agent.ts` (timing, after T-52), report types |
| 10 | T-54 | `packages/core/src/navigate.ts`, `orchestrator.ts` (step wait and capture), `evidence.ts` (failure-only), `browser.ts` (`recordVideo`, after T-52), runner option in `checkup.ts` |
| 11 | T-55 | `orchestrator.ts` (once-per-page), `packages/checkers/src/seo.ts` (link cache, after T-43) |
| 12 | T-56 | `orchestrator.ts` (worker pool, after T-55) |
| 13 | T-57 | `orchestrator.ts` (`shouldRetry`, after T-56), `packages/core/src/retry-runner.ts` |
| 13 | T-58 | `server.ts` (progress endpoint, streams, status cache), `packages/runner/src/benchmarks.ts`, `packages/runner/src/session/report-store.ts`, `plan-store.ts` (index, after T-50), `routes/plan.ts` (validator, after T-49) |
| 14 | T-59 | `packages/wizard/src/App.tsx`, `hooks/useRunnerConnection.ts`, `hooks/useRunnerStream.ts`, `screens/BenchmarkScreen.tsx` (poll), `packages/wizard/vite.config.ts`, lazy-route imports |
| 15 | T-60 | `orchestrator.ts` (contexts, after T-57), `checkup-run.ts` (event publish, after T-50), `site-history.ts`, `site-memory.ts`, `discovery-agent.ts` (contexts, after T-53), `packages/core/src/competitive/safe-crawler.ts`, `server.ts` (dead constant, after T-58) |
| 16 | T-61 | `packages/wizard/src/lib/api.ts`, `App.tsx` (after T-59), `PlanReviewScreen.tsx`, `components/plan/PlanDocument.tsx`, `ReportScreen.tsx`, `BenchmarkScreen.tsx`, `ConfirmDialog.tsx`, `PastCheckupsScreen.tsx`, `CommandPalette.tsx`, `LandingScreen.tsx` (focus only), `TopBar.tsx` (mobile menu) |
| 17 | T-62 | the screens listed in T-62, after T-61 (same files, so it runs after) |
| 18 | T-63 | every doc not owned above: `docs/CONFIGURATION.md`, `.env.example`, `README.md` (including line 236, moved from T-42), `CONTRIBUTING.md`, `CONTEXT.md`, ADRs (except 0024 and 0031), `config-docs` test |
| 19 | T-23 | the file splits, last, after all code changes |

**Docs rule.** `docs/TESTING.md`: T-41. `docs/API.md`: T-42. `docs/DEPLOYMENT.md`: T-51, then T-52 (Docker lines). ADR 0024: T-48. ADR 0031: T-43 creates it. Every other doc: T-63.

The table gives each ticket's files. Tickets list only the files in their own row; a ticket that needs another file asks for a later batch.

## Decisions to take before the tickets that need them

1. **Hosted beta trust boundary (T-43, T-52):** keep the public beta, or restrict targets to hosts the visitor
   proves they own? The SSRF fix works either way; the proof rule changes the product.
2. **Chromium sandbox (T-52):** run as a non-root user with the sandbox on, or keep `--no-sandbox` and isolate
   the browser per host? Needs the hosting platform's answer.
3. **Screenshots and video (T-45, T-54):** mask sign-in fields, or offer a switch that turns off step screenshots
   and video for sensitive runs?
4. **Retry policy (T-57):** retry only transient failures (recommended), or keep a whole-point retry?
5. **Default screen sizes (T-54):** three, or two for a quick check?
6. **Persistent disk (T-51):** pay for a disk on Render, or document that beta data is temporary?

**Answers recorded (user):** 1 keep public beta, SSRF guard only. 2 keep `--no-sandbox`, isolate per host. 3 mask sign-in fields. 4 transient failures only. 5 three screen sizes. 6 document beta data as temporary. Tests: no test runs during the build. T-41 and T-64 verification runs are deferred to /verify-all. T-64 triage is read-only analysis, marked pending. Batch 1b is not a gate: batches 2 onward build now.

**Decisions after build (user):** T-44 3-character free-text rule dropped. T-46 sign-in cookies cleared on any stop once execution begins (plan kept only while awaiting review). T-47 empty run exits 1 even with failOn none. T-57 app-caused page crashes retried like browser crashes. T-58 LAT-14 is the PlanValidator rebuilt per edit; closed by the per-plan validator cache. T-23 class-size refactor deferred until after /verify-all. Unlimited page crawl rejected; 1000-page ceiling stays. Beta: GET /api/runner/spec-overrides closed as SEC-13 (ticket T-65).

## Mapping: review findings to tickets

| Source | Finding | Ticket | Built ticket it refines |
|---|---|---|---|
| SECURITY S1, S2 | API requests skip the address guard; sitemap host unchecked | T-43 | none |
| SECURITY S3–S6 | Redaction matching gaps | T-44 | none |
| SECURITY S7, S8, S9 | Screenshots, end-of-run scrub, role-only event redaction | T-45 | none |
| SECURITY S10 | Sign-in sessions left on disk | T-46 | none |
| SECURITY (API doc) | Beta comparison delete has no owner check | T-42 | T-34 (closedInBeta) |
| SECURITY S11, S12 | GET changes state; text formats list | T-45 | none |
| CORRECTNESS C1 | Per-page problem keys | T-47 | T-30 (spread rule) |
| CORRECTNESS C4 | Crash grade reads title | T-47 | T-30 (crash grade) |
| CORRECTNESS C5 | Nothing checked reads Ready | T-47 | T-30 (zero checks = null) |
| CORRECTNESS C2, C3, C6 | Probe-only Rejects; refusal baseline; native text | T-48 | T-32, T-33 |
| CORRECTNESS C7, C8, C9 | Journey cap; element dedupe by route; gate reference | T-47 | none |
| RELIABILITY REL-1, REL-2 | Browser leak on exit; stop frees slot early | T-49 | T-35 (start race) |
| RELIABILITY REL-3, REL-8 | No graceful shutdown; unhandled rejection | T-49 | none |
| RELIABILITY REL-4, REL-5 | Scheduler lost updates; missed runs | T-50 | T-35 (scheduler start) |
| RELIABILITY REL-6, REL-7 | Non-durable writes; swallowed save errors | T-50 | none |
| RELIABILITY REL-9, REL-10 | Approval race; rare-path leaks | T-49 | T-35 (approval) |
| GROWTH GROW-1 | Step files kept on passing points | T-54 | none |
| GROWTH GROW-2 | Browser leak on errors | T-49 | none |
| GROWTH GROW-3 | Beta per-visitor folders never deleted (removal T-50; ten-run cap T-60) | T-50, T-60 | none |
| GROWTH GROW-4, GROW-5 | Waiting plans never expire; site-history growth | T-60 | none |
| GROWTH GROW-6 to GROW-9 | Double event log; rare-throw contexts; answers; dead constant | T-60 | none |
| DEPLOYMENT DEP-1, DEP-4 | Render deploys without checks; gate is partial | T-51 | T-39 (ref) |
| DEPLOYMENT DEP-2 | No persistent disk | T-51 | none |
| DEPLOYMENT DEP-3 | Sandbox off; no USER | T-52 | none |
| DEPLOYMENT DEP-5 | Template floats on main | T-51 | T-39 (ref in workflow) |
| DEPLOYMENT DEP-6 | Target URLs logged with credentials | T-52 | none |
| DEPLOYMENT DEP-7, DEP-8, DEP-9 | Image pinning, healthz, verify timeout | T-52 | none |
| PERFORMANCE round 1 | Phases 0–5 | T-53 to T-57 | none |
| PERFORMANCE round 2 (LAT-1 to LAT-14) | Response latency | T-58, T-59 | none |
| WIZARD UX-1 | Raw technical text (surfaces T-36 did not reach) | T-61 | T-36 |
| WIZARD UX-14 | Silent history loss | T-36 (built: retry on failed poll) | T-36 |
| WIZARD UX-2, UX-3, UX-10, UX-11, UX-12 | Focus, dialog trap, invisible focus, shortcuts, Escape | T-61 | T-36 |
| WIZARD UX-4 | Avoid-list terms | T-62 | T-37a, T-37b |
| WIZARD UX-5 to UX-9, UX-13 to UX-20 | Gutter, landmarks, colour, labels, stale state | T-62 | T-36 |
| DOCS (ADR, CONTEXT, CONFIGURATION, README versions) | Drift not covered by T-38 | T-63 | T-38 |
| DOCS (API beta list, missing routes, README comparisons) | Drift in API and comparisons docs | T-42 | T-34 |

## Tickets

### T-41 Test baseline that runs

- **Phase:** 0 · **Batch:** 1 · **Priority:** P0 · **Size:** S · **Depends on:** none · **Status:** built (browser check and baseline folders; baseline run at /verify-all)
- **Goal:** `pnpm test` runs in a clean checkout on a machine that has run `pnpm bootstrap`, and its result is recorded.
- **Evidence (measured):**
  - Run 1 (environment as found): 75 of 234 files failed, 141 of 1736 tests. Almost all were browser launch errors: the repo's Playwright expects `chromium_headless_shell-1243`; the sandbox had `-1194`.
  - Run 2 (browser paths linked to the installed build, outside the repo): 9 of 234 files failed, 20 of 1736 tests; 1716 passed, 120 skipped. These 20 are not environment problems. They are listed in T-64.
  - `pnpm build` passes.
- **In scope:** `scripts/` bootstrap step that installs the browser build Playwright expects; test setup that creates the generated `.tmp-*` baseline folders before a test uses them; `docs/TESTING.md` section on the browser requirement and on the baseline counts above.
- **Out of scope:** changing the Playwright version; fixing the 20 failing tests (T-64).
- **Acceptance criteria:**
  - [ ] After `pnpm bootstrap` on a fresh checkout, the browser build in use matches the one Playwright expects.
  - [ ] No test fails with "Executable doesn't exist" on a bootstrapped machine.
  - [ ] Tests that use `.tmp-*` folders create them first and pass with the folders absent.
  - [ ] `docs/TESTING.md` records the baseline: 234 files, 1736 tests at baseline (9 files and 20 tests failing after the browser link; see T-64).
- **Tests:** the bootstrap script has a check; the baseline is recorded in docs/TESTING.md at build time, and its run is deferred to /verify-all.

### T-64 Clear the baseline failures

- **Phase:** 0 · **Batch:** 1b · **Priority:** P0 · **Size:** M · **Depends on:** T-41 · **Status:** built (read-only triage done; test verdicts confirmed by /verify-all)
- **Goal:** the full suite passes on the baseline, so every later batch can tell its own failures from old ones.
- **Evidence (measured, run 2 of T-41):** 9 files, 20 tests.
  - Wizard end-to-end (`packages/wizard/tests/wizard-e2e.test.ts`, 9 tests): the landing and first-visit tests find a "Keyboard shortcuts" button where the test expects none (`expected 1 to be +0`), and a first-visit assertion is `true` where `false` is expected. Built tickets T-36 and T-37 changed these screens; T-61 will change the shortcuts again. The rest (Go deeper, reuse approved plan, Past check-ups, Settings key, test run fails, scan and plan, report) need their first error read in triage.
  - Invoice flow, two tests: `url-first.test.ts` ("tests localhost fully when the owner box is ticked") finds no `POST /api/invoices` sent; `e2e-orchestrator.test.ts` expects the invoice test to Pass and gets Failed. The fixture now sends CSP and nosniff headers (T-40 note). Check this first.
  - Auth and crawl, three tests (`auth-crawl-e2e.test.ts`): custom headers on every request, and session expiry. Plus `discovery-agent-headers.test.ts` (headers reach sign-in, visitor and role crawls) and `e2e-discovery.test.ts`.
  - Runner, three more: `checkups.test.ts` (report kept in the run's own folder), `runner-server.test.ts` (POST run, SSE, finished report), `credentials-crawl.test.ts` (acts after sign-in, never on a Sensitive Action).
  - One verdict assertion in the report flow expects "Ready to release" and gets "Not ready yet". Check it against T-47's per-page problem keys (COR-1) before deciding which side is wrong.
- **In scope:** for each failing test, record in this ticket whether it is a stale expectation or a real defect, then fix it on that basis. A stale expectation is changed to the behaviour the built tickets chose, with the reason in the test. A real defect is fixed in the file the failure points to. Nothing is skipped, deleted or marked as todo to pass.
- **Out of scope:** new features; the remediation tickets (they own the behaviour, not these tests).
- **Acceptance criteria:**
  - [ ] Each of the 20 tests is listed here with its verdict (stale or real), its first error, and the file changed.
  - [ ] `pnpm test` passes on a bootstrapped machine, or the remaining failure is named here with its owner.
  - [ ] No test is skipped, deleted, or weakened to pass; any changed assertion says why in the test.
  - [ ] The invoice flow failure is explained (fixture change or code change), and the explanation is in this ticket.
- **Tests:** the 20 named tests; `pnpm test` in full.
- **Triage (read-only, pending /verify-all):** no test was run (user decision). Verdicts come from reading the test and the code it touches. No test was changed: none is proven stale, and none has a first error yet. Items: 19 tests plus the verdict assertion (the wizard "the report" entry, which has no hard-coded verdict). Totals: stale fixed 0, real 0 proven, unknown 20.
  - `packages/wizard/tests/wizard-e2e.test.ts` "opens on the landing page…": line 251 expects 0 "Keyboard shortcuts". Verdict unknown. Built code agrees with the test on a fresh server: `TopBar.tsx:172-199` shows the button only when `showDeveloperShortcuts`, set by `App.tsx:889` from `hasFinishedCheckup(recent)` (`lib/onboarding.ts:27-29`, `recent` starts null, `App.tsx:187` loads it). A count of 1 means `/api/runs` was non-empty: leftover data in `.tmp-wizard-e2e-data`, or the test order. Change: none until the first error is read.
  - `wizard-e2e.test.ts` "first visit: specs typed before the AI key…": the boolean "true where false expected" is one of lines 245, 249, 279, 296, 332, 336. Each matches built code on read: `EMPTY_FORM` owner false (`lib/form.ts:113`), access radios `NewCheckupScreen.tsx:1101-1141`, more-options `open` only when `hasNonDefaultOptions` (`lib/onboarding.ts:8-24`, `NewCheckupScreen.tsx:469-472`), start hint text `NewCheckupScreen.tsx:816-817`. Verdict unknown. Change: none until the line is known.
  - `wizard-e2e.test.ts` "scans, shows the plan…": not traced past line 379 (runRequests shape, `plan-wontrun`, download, intent switch). Verdict unknown.
  - `wizard-e2e.test.ts` "a test run that fails…": strings match built code: `App.tsx:360-361` ("Testing stopped before it finished", "Your plan is kept"), `translate.ts:146` ("Your site couldn’t be reached."). Verdict unknown.
  - `wizard-e2e.test.ts` "the report…" (verdict candidate): the file has no hard-coded "Ready to release". Line 577 compares the heading with `summary.stamp`, from `summarizeReport` (`lib/summary.ts:92-110`), which calls the same `releaseVerdict` as the runner's `report-store.ts:100`. A mismatch would mean the UI and the API read different data, or COR-1 (`finding-groups.ts`) changes the grade used by the gate. The verdict assertion's owner is not confirmed. Change: none until the first error is read.
  - `wizard-e2e.test.ts` "New check-up of this site reuses the approved plan…": button `ReportScreen.tsx:599`, sentence `ReportScreen.tsx:284`; regex at line 728 not checked against `formatDay`. Verdict unknown.
  - `wizard-e2e.test.ts` "Past check-ups…": labels match `PastCheckupsScreen.tsx:58, 65, 137, 148, 154`. The heading "(2 check-ups)" is not traced. Verdict unknown.
  - `wizard-e2e.test.ts` "Go deeper…": strings match `ReportScreen.tsx:602, 626, 651` and `App.tsx:608-612` ("or throw the scan away. AI requests already used stay used."). Verdict unknown.
  - `wizard-e2e.test.ts` "Settings: the key in use…": strings match `SettingsScreen.tsx:165, 221, 226, 230, 234, 273, 287`. Verdict unknown.
  - `packages/core/tests/e2e-orchestrator.test.ts` "TC-E2E-001" (invoice, expects Passed): the fixture CSP (`fixtures/test-app/server.js:37-40`) allows the inline `onsubmit` (`script-src-attr 'unsafe-inline'`), and the one inline script gets the per-response nonce (`server.js:42-43`, `1081`). On read the CSP does not block `handleSave` (`server.js:1071-1116`). The cause is not the CSP alone. Verdict unknown. Change: none until the first error is read.
  - `packages/runner/tests/url-first.test.ts` "tests localhost fully when the owner box is ticked" (expects `POST /api/invoices`): same flow as above. `sent` records non-GET requests (`url-first.test.ts:96-99`). Verdict unknown.
  - `packages/core/tests/auth-crawl-e2e.test.ts` "end-to-end: discovers with session…" (headers on all phases, lines 149-150): `headerHits` increments only when `x-qa-bypass-token` is sent (`server.js:48-51`). Verdict unknown.
  - `packages/core/tests/auth-crawl-e2e.test.ts` "regression: session expiry…" (line 322-323): wording matches code (`orchestrator.ts:629, 803, 811`). Not stale. Verdict unknown.
  - `packages/core/tests/auth-crawl-e2e.test.ts` "regression: custom headers propagate…" (line 582): not traced. Verdict unknown.
  - `packages/core/tests/discovery-agent-headers.test.ts` "customHeaders reach sign-in, visitor crawl, role crawl…" (line 59): not traced. Verdict unknown.
  - `packages/core/tests/e2e-discovery.test.ts` "should discover routes, synthesize flows…" (line 28): not traced. Verdict unknown.
  - `packages/runner/tests/checkups.test.ts` "keeps the report in the run’s own folder…" (line 294): the run folder is written by the orchestrator at `checkup-run.ts:432-446`, and `report-store.ts:97-120` writes `report.json` and `summary.json`. The top-level copies at `report-store.ts:121-122` swallow errors (`.catch(() => {})`), so the top-level expectations at lines 309-311 can fail silently. Verdict unknown; a real defect is possible there. Change if real: `report-store.ts`, not this test.
  - `packages/runner/tests/runner-server.test.ts` "accepts a POST /api/runner/run, streams events over SSE…" (line 97): not traced. Verdict unknown.
  - `packages/runner/tests/credentials-crawl.test.ts` "live host + consent + good details…" (line 144): not traced. Verdict unknown.
  - Real defect found while reading: `report-store.ts:121-122` drops copy errors for the top-level CI files, so a failed copy never reaches the caller.

### T-42 Beta: comparison delete and closed routes

- **Phase:** 1 · **Batch:** 2 · **Priority:** P0 · **Size:** S · **Depends on:** T-34 (built), T-41 · **Status:** built
- **Goal:** in hosted beta, one visitor cannot delete or change another visitor's comparison, and every write the docs
  call "closed in beta" is closed.
- **Evidence:** `packages/runner/src/server.ts:3441-3455` (`handleBenchmarkById`): `DELETE` calls `benchmarkStore().remove(id)`
  with no owner check. `closedInBeta` (`server.ts:1333-1340`) does not list the write routes `POST
  /api/runner/spec-override`, `POST /api/settings/defaults`, `POST /api/runs/<id>/triage` and `/accept-judgement`
  (the API doc says some are closed; the code is the source). The README (T-63) says comparisons are closed; they are not.
- **In scope:** `server.ts` `handleBenchmarkById`, `closedInBeta`; `docs/API.md` beta column.
- **Acceptance criteria:**
  - [ ] In beta, `DELETE /api/runner/benchmark/<id>` from a session that does not own the job returns 404 and removes nothing.
  - [ ] In beta, the owner's delete of a finished job works; a running job returns 409.
  - [ ] Every route in `closedInBeta` matches the list in `docs/API.md`, and a test compares the two lists.
  - [ ] `docs/API.md` lists `POST /api/runner/spec-override` and `GET /api/runner/spec-overrides`.
- **Tests:** extend `packages/runner/tests/` beta tests with two sessions; add a test that fails when the doc and the
  closed list differ.

### T-43 Address guard for every outbound request

- **Phase:** 1 · **Batch:** 2 · **Priority:** P0 · **Size:** M · **Depends on:** T-41 · **Status:** built (guarded fetch everywhere, incl. role sessions; short-circuit note in T-49)
- **Goal:** every request the runner makes to a host, including requests made through Playwright's API client, goes
  through the same public-address check the browser already has.
- **Evidence (verified):** a route guard that blocks `127.0.0.1` stops navigation but not `context.request` or
  `page.request` (repro in SECURITY_REVIEW S1). `robots.txt` `Sitemap:` lines are fetched with no host check
  (`discovery/deterministic-spider.ts:406-430`). Navigation Check requests use `page.request.get` with 10 redirects
  (`orchestrator.ts:204`). SEO link checks use `requestContext.fetch` (`checkers/src/seo.ts:397, 556`). Security checks
  use `request.fetch` (`checkers/src/security-depth.ts:48`).
- **In scope:** a shared outbound helper built on `safe-net.ts` `safeGet` (pinned address, each redirect checked);
  replace the call sites above; `discovery/deterministic-spider.ts` sitemap fetch restricted to the target's host unless
  the person allows it. ADR needed (see below).
- **Acceptance criteria:**
  - [ ] The repro from SECURITY_REVIEW S1 shows 0 server hits for `context.request`, `page.request`, HEAD and a redirected GET.
  - [ ] A `Sitemap:` line naming another host is ignored, with a logged reason.
  - [ ] A same-site link that redirects to `127.0.0.1` or `169.254.169.254` is not followed.
  - [ ] Navigation Check to an external link still works for public hosts (existing link-check tests pass).
  - [ ] No call site in `packages/checkers` or `packages/core` calls `request.fetch`, `page.request` or Node `fetch`
        directly on a page-derived URL (a test greps the source).
- **Tests:** unit tests for the helper with a fake resolver; the fixture-based redirect test; the source-grep test.
- **ADR needed:** ADR 0031, "Every outbound request uses the pinned, redirect-checked resolver."

### T-44 Redaction matching

- **Phase:** 1 · **Batch:** 2 · **Priority:** P1 · **Size:** M · **Depends on:** none · **Status:** built (3-character free-text rule dropped by decision; known credentials redacted at any length)
- **Goal:** a secret is hidden in every place it can appear: URL fragments and path segments, escaped and form-encoded
  text, and short values.
- **Evidence (verified by node test, SECURITY S3–S6):** `#access_token=` and `/reset/<token>` pass through
  (`packages/core/src/redact.ts:10`). `code`, `reset_token`, `X-Amz-Signature` are missing from `SECRET_PARAM_NAMES`
  (`packages/checkers/src/security.ts:5-6`). A password with `& " < ' ! * ( )` survives in HTML-escaped, JSON-escaped and
  form-encoded text (`redact.ts:31-34`). Values under 3 characters are never redacted (`redact.ts:24`).
- **In scope:** `redact.ts` (fragment and path forms, escaped variants, the form-encoding variant that
  `URLSearchParams` produces); `security.ts` parameter list with one source of truth; the length rule (decision in
  the ticket: redact any non-empty role credential, and keep the 3-character rule only for free text).
- **Acceptance criteria:**
  - [ ] A table test covers each form: `?p=`, `#access_token=`, `/reset/<token>`, `?code=`, `?X-Amz-Signature=`, and each escaped form of a password containing `&"<'!*()\`.
  - [ ] A two-character role password is hidden in every output file and event.
  - [ ] `SECRET_PARAM_NAMES` is defined once and imported by `redact.ts` and the security checker.
- **Tests:** a new `packages/core/tests/redact-forms.test.ts` table; extend `redaction.test.ts`.

### T-45 Redact on write, one secret list, screenshots and GET

- **Phase:** 1 · **Batch:** 3 · **Priority:** P1 · **Size:** M · **Depends on:** T-42, T-43, T-44, T-46 · **Status:** built (screenshots masked; cookie gap closed by T-49; video off for sign-in runs by T-54)
- **Goal:** secrets never reach disk or the wizard, even when a run stops; live events and the report use the same full
  secret list; screenshot and video exposure is a stated, switchable decision.
- **Evidence:** the text scrub runs once at end of run (`orchestrator.ts:1564`, `checkup-run.ts:578`), so a crash
  leaves plaintext (SEC S8). The orchestrator's redactor is built from roles only (`orchestrator.ts:350-352`); headers and
  tunnel auth are added only in the file pass (SEC S9). Screenshots and video are not scrubbed (`evidence.ts:100`,
  `browser.ts:194-200`, SEC S7). `GET /api/runner/status` begins a session (`server.ts:979`, SEC S11).
- **In scope:** one function that builds the full secret list (roles, headers, tunnel auth, session cookies) used by the
  orchestrator, checkup-run and routes; redact text evidence on write; the text-format list gains `.csv .xml .yml .yaml .svg .har` (SEC-12); `GET /api/runner/status`
  makes no write (the `begin()` call moves off the read path; caching is T-58); mask sign-in fields in screenshots (decision 3).
  Capture policy (failure-only screenshots, the video option) is owned by T-54.
- **Acceptance criteria:**
  - [ ] A stopped run leaves no plaintext secret in the evidence folder (test stops mid-step).
  - [ ] A custom header value that appears in a finding does not reach the SSE stream or `report.json`.
  - [ ] `GET /api/runner/status` makes no write (test checks the run state before and after).
  - [ ] `pnpm build` passes (exported types change).
- **Tests:** redaction tests for the stop case and the header case; a route test for read-only status.

### T-46 Sign-in sessions off disk

- **Phase:** 1 · **Batch:** 2 · **Priority:** P1 · **Size:** S · **Depends on:** none · **Status:** built (sign-in cleared on any exit once testing begins, by decision; approve-after-stop path not read)
- **Goal:** cookies and storage state for a signed-in role are deleted when the run ends, on every exit path.
- **Evidence:** the UI path stores sessions under `<outputDir>/auth` (`checkup-session.ts:68`, `run-secrets.ts:72-77`).
  The only removal is plan clear (`plan-store.ts:185-192`). The CI path deletes its temp folder. Exposure is local disk,
  not HTTP (the file routes refuse `auth`).
- **In scope:** `checkup-run.ts` finally block removes the run's auth folder; startup sweep (in `run-secrets.ts`, called from `checkup-session.ts`, never from `server.ts`) removes leftover `auth`
  folders older than the last run; plan reuse of a session is kept only while the plan is `awaiting-review`.
- **Acceptance criteria:**
  - [ ] After a finished UI run, no file under the output folder contains a cookie value (test checks the folder).
  - [ ] After a stopped run and after a failed run, the same holds.
  - [ ] A plan still waiting for review keeps its session; approving after restart still asks for sign-in if the session is gone.
- **Tests:** extend `consent-enforcement.test.ts` and `headers-propagation.test.ts` (the latter already checks cleanup for CI).

### T-47 Verdict correctness

- **Phase:** 2 · **Batch:** 4 · **Priority:** P0 · **Size:** M · **Depends on:** T-30 (built) · **Status:** built (empty run exits 1 even with failOn none, by decision)
- **Goal:** one problem spanning many pages counts as one problem; a crash is only a 5xx; a run with nothing checked
  never reads "Ready to release".
- **Evidence (read):**
  - COR-1: `packages/core/src/finding-groups.ts:20-22, 32` keys page findings by page, and no checker sets `issueKey`.
    `problems.ts:148-149`, `verdict.ts:97-103`, `scoring.ts:132` then count per page, so the spread rule (`scoring.ts:157`)
    never applies. Ten pages with one Minor give Findable 50 (grade D, "Not ready yet"); one problem across ten pages
    should give 93 (grade A, "Ready to release"). Also `scoring.ts:146-150` counts a Major per page.
  - COR-4: `scoring.ts:172-174` still matches `title.includes('uncaught exception')` and `'application crash'`. T-30's
    acceptance criterion says the crash grade comes from the structured field.
  - COR-5: `verdict.ts:127, 161` ignore coverage. `releaseVerdict([], undefined, undefined)` is ready.
    `enforceAllAreas` (`verdict.ts:33, 39`) is set and never read. `checkup.ts:369` exits 0 for an empty run.
- **In scope:** `finding-groups.ts` key (the problem key is the checker, the title and the element, without the page,
  with the affected pages kept as a set); `scoring.ts` crash grade from `is5xx` only; `verdict.ts` uses coverage and
  `enforceAllAreas`; `checkup.ts` exit code when nothing was checked.
- **Acceptance criteria:**
  - [ ] Ten pages with the same Minor produce one problem with ten pages; Standard gives 93 and grade A.
  - [ ] Two pages with the same Major give one Major problem; the area grade is not capped by a count of pages.
  - [ ] A step titled "Trigger uncaught exception" does not produce a crash grade; a real 5xx does.
  - [ ] An empty run (no checkers) is "Not ready yet" with "No checks ran" and exits non-zero.
  - [ ] `enforceAllAreas` is read by `releaseVerdict`, and the test for each gate covers it.
- **Tests:** `packages/core/tests/scoring.test.ts`, `packages/types` verdict tests, `packages/runner/tests` CLI test.

### T-48 Rejects and refusal rule

- **Phase:** 2 · **Batch:** 4 · **Priority:** P0 · **Size:** M · **Depends on:** T-33 (built), T-45 · **Status:** built (refusal baseline and probe-only fallback; severity wording conflict with ADR 0024, plan defect)
- **Goal:** every Rejects item is judged; an alert that is not about the refused value does not pass a form that accepted it.
- **Evidence (read):**
  - COR-2: `plan/expand.ts:140-143` makes a probe-only item with no submit click, and the baseline is captured only at
    the submit click (`orchestrator.ts:829-831`). `spec-conformance.ts:142` then skips the refusal block, so the
    `:invalid` probe never runs.
  - COR-3: `refusal-rule.ts:82-92` (`:invalid`, `aria-invalid`, `role="alert"`) take no baseline, while `:93-100` does.
    A permanent alert, or a success toast with `role="alert"`, passes as refused.
  - COR-6: `refusal-rule.ts:85` records `validationMessage` first, and `note()` keeps only it, so the Source's wording
    is compared with the browser's native text (`spec-conformance.ts:198-206`).
- **In scope:** `expand.ts` probe-only items capture the baseline; `refusal-rule.ts` takes the baseline for every signal
  and keeps the Source text and the alert text; ADR 0024 wording on `role="alert"`.
- **Acceptance criteria:**
  - [ ] A probe-only Rejects item produces a finding or a pass; it is never silent.
  - [ ] A form that accepts `min-1` with a permanent `role="alert"` on the page is a Blocker, not refused.
  - [ ] A novalidate form that shows the Source's sentence in an alert is not a "different wording" Major.
- **Tests:** `packages/checkers/tests/refusal-rule.test.ts`, `packages/core/tests/refusal-run.test.ts`; fixture pages for each case.
- **ADR needed:** amend ADR 0024 (alert text is a signal only when it appears after the submit).

### T-49 Run lifecycle: browsers, stop, shutdown

- **Phase:** 3 · **Batch:** 5 · **Priority:** P0 · **Size:** M · **Depends on:** T-35 (built), T-48 · **Status:** built (browsers closed on every exit; stop-then-start gate returns 409; SIGTERM timing unverified)
- **Goal:** every run closes its browsers on every exit; a stop finishes tearing down before the slot is free; the
  runner shuts down cleanly and does not crash on an unhandled rejection.
- **Evidence (read):**
  - REL-1 and GROW-2: `orchestrator.ts:573` runs the test loop with no `try/finally`. An abort is rethrown at `:1344`,
    skipping `browserManager.close()` at `:1414`. The pre-flight throw at `:482` also skips it. Each run has a new manager.
  - REL-2: `checkup-run.ts:1108, 1124-1125` free the slot without awaiting the old run (`server.ts:3002-3003`).
    After the orchestrator returns, `executeTesting` has no `current()` check before `setPhase('done')` at `:585-586`.
  - REL-3: no `SIGTERM`/`SIGINT` handler; `RunnerServer.stop()` (`server.ts:1249`) is never called. The Dockerfile uses
    exec-form `CMD`. Playwright installs its own SIGTERM listener while a browser is open (platform).
  - REL-8: `server.ts:1199-1204` calls `writeHead(500)` after headers may be sent; no `unhandledRejection` handler.
  - REL-9, REL-10: approval race (`routes/plan.ts:1175, 1183`); context leak in `browser.ts:221-224`; `plan-store.ts`
    ignores `readOnly`.
- **In scope:** `orchestrator.ts` `run()` wrapped so `browserManager.close()` always runs; `checkup-run.ts` stop awaits
  the run's promise before the slot frees; the post-run `current()` check; `cli.ts` and `server.ts` signal handlers that
  call `stop()`, flush state and exit; `unhandledRejection` logged and the request answered only if headers are unsent;
  approval serialised with `replacePlan`.
- **Acceptance criteria:**
  - [ ] A run stopped in the middle of a step closes every browser (process count is zero after the run returns).
  - [ ] A pre-flight failure closes every browser.
  - [ ] A stop followed at once by a new start: the new start waits for the old run's teardown, or returns 409, never overlaps.
  - [ ] `SIGTERM` during a run stops it, writes the state, removes the auth folder, and exits within 10 s.
  - [ ] A thrown error after headers are sent does not crash the process (test forces it).
  - [ ] A run started with `replacePlan` during an approval save does not clear the approved run's auth folder or drop its results (REL-9).
- **Tests:** `packages/core/tests/` abort tests; `packages/runner/tests/checkups.test.ts` stop tests; a signal test.

### T-50 Durable state: scheduler, writes, waiting plans

- **Phase:** 3 · **Batch:** 6 · **Priority:** P1 · **Size:** M · **Depends on:** T-46, T-49 · **Status:** built (scheduler queue, atomic writes, waiting-plan expiry, beta folder sweep, save errors; wiring done; run not verified)
- **Goal:** schedules, plans and history survive a crash or power loss; a write that fails is shown, not hidden.
- **Evidence (read):**
  - REL-4: `scheduler.ts:70` writes non-atomically; `loadSchedules` (`:63`) returns `[]` on any error; `tick` (`:127-138`)
    and the HTTP handlers (`server.ts:1110-1127, 3482`) have no lock, so a toggle can revert a tick's `nextRunAt` (a
    schedule fires twice) and a delete can be undone.
  - REL-5: `tick` advances `nextRunAt` before `runSchedule` (`:124-125`). A busy run records the occurrence as failed
    (`:130`) and never retries.
  - REL-6: `atomic-write.ts:21-22` has no `fsync` of file or directory.
  - REL-7: `checkup-run.ts:492, 509, 1122` swallow save errors with `.catch(() => {})`.
  - GROW-4, GROW-3: waiting plans never expire (`plan-store.ts:55-63`); per-visitor folders are never removed
    (`server.ts:1385-1387`, beta).
- **In scope:** `scheduler.ts` (one writer, a lock or a queue shared with HTTP handlers, a backup on a parse error and no
  silent `[]`); a due schedule retries once when busy; `atomic-write.ts` `fsync`; save errors surfaced to the wizard;
  waiting plans expire after a set time (default 30 days, configurable); beta session folders removed on expiry.
- **Acceptance criteria:**
  - [ ] Toggling a schedule during a tick leaves the toggled state and one run (test with a forced interleave).
  - [ ] A truncated `schedules.json` is kept as `.corrupt` and reported, never overwritten with `[]`.
  - [ ] A due schedule that finds a busy run retries on the next tick and is recorded once.
  - [ ] A failed plan save returns an error to the wizard with the sentence "Couldn't save the plan. Try again."
  - [ ] Waiting plans older than the limit are removed on start, and listed as expired (count in the log).
- **Tests:** `packages/runner/tests/scheduler*.test.ts`, `atomic-write` tests, plan-store tests.

### T-51 Deploy gate and publishing

- **Phase:** 4 · **Batch:** 7 · **Priority:** P0 · **Size:** M · **Depends on:** T-41 · **Status:** built
- **Goal:** nothing reaches a user-facing copy of the app, or a user's CI, unless the checks that matter passed on that
  commit.
- **Evidence (read):**
  - DEP-1: `render.yaml:15` sets `autoDeploy: true`, so Render builds every push to `main` without waiting for Actions
    (`deploy.yml:1-2` and `docs/DEPLOYMENT.md:20` say otherwise).
  - DEP-2: no `disks:` block; data at `/data` (`Dockerfile:38-39`) is lost on redeploy or spin-down on the free plan.
  - DEP-4: `tests.yml:54` excludes `wizard-e2e` and `auth-crawl-*`; `ci.yml:56, 68` skip tests on push; publish does
    not `needs` `audit` or `secret-scan`; `ci.yml:43` makes typecheck non-blocking.
  - DEP-5: `.github/workflows/qa-check.yml` checks out `ref: main` and receives `QA_AI_API_KEY`.
- **In scope:** `render.yaml` (checks gate, or `autoDeploy` off and a deploy triggered from the publish job); `deploy.yml`
  `needs` on audit and secret-scan; `ci.yml` typecheck blocking; `templates/qa-check.yml` pinned to `TOOL_REF` as the
  wizard generates it (T-39 set the generator, not the template); `docs/DEPLOYMENT.md` persistent-storage statement.
  Decision 6 for the disk.
- **Acceptance criteria:**
  - [ ] A commit with a failing unit test does not reach Render (the deploy runs after the checks, or waits for them).
  - [ ] `deploy.yml` publish job needs audit and secret-scan; a test in the workflow lint fails if removed.
  - [ ] Typecheck failure fails the PR check.
  - [ ] The template's checkout ref equals the wizard's `TOOL_REF` (T-39, decision 2), and a test asserts it.
  - [ ] Persistent storage is either attached (`disks:`) or the limit is stated in DEPLOYMENT.md's known risks.
- **Tests:** a workflow lint test (`actionlint` in CI, already present or added); the template test.

### T-52 Container hardening and health

- **Phase:** 4 · **Batch:** 8 · **Priority:** P1 · **Size:** M · **Depends on:** T-49, T-51 · **Status:** human (Docker image digest pin and docker run id check need a person; code built)
- **Goal:** the hosted container runs as a non-root user, reports health from real checks, and does not log credentials.
- **Evidence (read):**
  - DEP-3: `browser.ts:120-121` always passes `--no-sandbox`; the Dockerfile sets no `USER`.
  - DEP-7: `Dockerfile:3` pins the base image by tag; no `HEALTHCHECK`; Node version from the base image.
  - DEP-8: `server.ts:841-845` answers `/healthz` before any check.
  - DEP-9: `deploy.yml:122` verify loop can overrun the 15-minute job timeout.
  - DEP-6: `orchestrator.ts:377`, `discovery-agent.ts:503` log `targetUrl` with `user:pass@` (`checkup-run.ts:260-275`).
- **In scope:** Dockerfile (`USER`, digest pin, `HEALTHCHECK`, `.nvmrc` Node check); `/healthz` checks data folder
  writable and browser launchable (cached, so cheap); browser sandbox per decision 2; URL credentials stripped before any
  log line; verify loop bounded below the job timeout.
- **Acceptance criteria:**
  - [ ] The image runs as a non-root user (`docker run` test, human item if no Docker in CI).
  - [ ] `/healthz` returns non-200 when the data folder is read-only (test).
  - [ ] A target URL with credentials is logged without them (test on the log helper).
  - [ ] The verify step fails within 10 minutes (the loop is bounded by time, not count).
  - [ ] The sandbox setting matches decision 2; its name is listed for T-63 to document.
- **Tests:** `/healthz` test; log redaction test; workflow lint for the timeout.

### T-53 Performance: timing telemetry

- **Phase:** 5 · **Batch:** 9 · **Priority:** P1 · **Size:** S · **Depends on:** T-52 · **Status:** built (timing on under QA_DEBUG; discovery timing wired; not run)
- **Goal:** every phase of a run reports its time, so later performance changes are measured.
- **Source:** PERFORMANCE_ANALYSIS Phase 0.
- **In scope:** per-phase timing (discovery per crawl, planning, each test point with breakpoint, each checker, each
  navigation settle) emitted into the report as `timing` and into `debug-log`.
- **Acceptance criteria:**
  - [ ] A run on `fixtures/test-app` writes a `timing` section with every phase listed above.
  - [ ] Timing is off unless `QA_DEBUG` or a report flag is set, and the report has no timing when off.
  - [ ] The timing section is covered by the redaction table (no URL credentials).
- **Tests:** `packages/core/tests/` timing test on the fixture.

### T-54 Performance: fixed waits and failure-only evidence

- **Phase:** 5 · **Batch:** 10 · **Priority:** P1 · **Size:** M · **Depends on:** T-53, T-52 · **Status:** built (waits, failure-only capture, sign-in video off, recordVideo wired; fixture parity not run)
- **Goal:** a test point spends its time on the page, not on fixed waits; evidence is written for failures.
- **Source:** PERFORMANCE round 1 Phases 1 and 3.
- **Evidence:** `settlePage` waits the full 3 s when `networkidle` never fires (`navigate.ts:66-70`); 300 ms in
  `looksLikeLogin` (`navigate.ts:114`); 300 ms after each step (`orchestrator.ts:892`); full-page screenshot and DOM dump
  on every step (`orchestrator.ts:920`, `evidence.ts:100`); video on for every point (`browser.ts:194`, the runner never
  passes `recordVideo`).
- **In scope:** settle on `domcontentloaded` plus a short settle with a configurable cap; remove the unconditional step
  wait; screenshot and DOM dump on failure (and a viewport screenshot on pass if decision 3 says so); `recordVideo` a
  runner option, off in CI.
- **Acceptance criteria:**
  - [ ] Fixture run time drops by at least the fixed waits saved (timing from T-53 compared before and after).
  - [ ] Findings on the fixture are identical (diff of `findings.json` after dropping timing fields).
  - [ ] A failing step still has its screenshot and DOM dump.
  - [ ] A passing point writes no step screenshot unless decision 3 says so.
- **Tests:** existing evidence and navigation tests; a comparison test on the fixture.

### T-55 Performance: once per page, cached link checks

- **Phase:** 5 · **Batch:** 11 · **Priority:** P1 · **Size:** M · **Depends on:** T-54, T-43 · **Status:** built (link check once per page per run, parallel 4, three default sizes; fixture parity not run)
- **Goal:** width-independent checks run once per page per run; broken-link checks are cached and run in parallel.
- **Source:** PERFORMANCE round 1 Phase 2.
- **Evidence:** axe, performance probe and SEO link checks run at every test point (`orchestrator.ts:1056, 1102, 1122`);
  `checkBrokenLinks` is serial and uncached (`checkers/src/seo.ts:556`).
- **In scope:** extend the `keyboardChecked` pattern to the link check and the width-independent parts of SEO and
  security; run-wide link cache keyed by URL; a parallel limit of 4; the screen-size default per decision 5.
- **Acceptance criteria:**
  - [ ] A page visited at three sizes produces one link-check pass per run (test counts requests).
  - [ ] The same URL linked from two pages is requested once.
  - [ ] Findings on the fixture match the baseline.
- **Tests:** SEO checker tests; orchestrator test for the once-per-page rule.

### T-56 Performance: parallel test points

- **Phase:** 5 · **Batch:** 12 · **Priority:** P2 · **Size:** L · **Depends on:** T-55, T-49 · **Status:** built (worker pool and browser races fixed; default serial per decision; parallel parity checked by /verify-all)
- **Goal:** test points in different roles run side by side, with the same results as serial.
- **Source:** PERFORMANCE round 1 Phase 4.
- **In scope:** a bounded worker pool in `orchestrator.ts` (default 2); per-worker state for everything listed in
  PERFORMANCE Phase 4a; test-copy flows that write data keep their order; read-only runs parallelise.
- **Acceptance criteria:**
  - [ ] Findings and report counts on the fixture are identical with parallelism 1 and 2.
  - [ ] Two roles do not share a session (test checks cookie jars).
  - [ ] A test-copy flow with a write step is never reordered.
  - [ ] The run time with parallelism 2 is less than 70% of serial on the fixture (recorded in the ticket).
- **Tests:** orchestrator concurrency tests; the parity test.

### T-57 Performance: retry policy

- **Phase:** 5 · **Batch:** 13 · **Priority:** P2 · **Size:** S · **Depends on:** T-56; decision 4 · **Status:** built (transient-only: navigation timeout, net errors, browser crash; app-caused crash retried too, by decision; flaky-retry.test.ts first test to update)
- **Goal:** a real failure is reported once; a transient failure is retried.
- **Source:** PERFORMANCE round 1 Phase 5a.
- **In scope:** `orchestrator.ts` `shouldRetry` (`:984`): retry on navigation timeout and browser crash only;
  `retry-runner.ts` telemetry unchanged.
- **Acceptance criteria:**
  - [ ] A failed assertion runs once and is reported as Failed (test).
  - [ ] A navigation timeout is retried once and can show FLAKY_PASSED.
  - [ ] Decision 4 is recorded in `docs/adr` or the ticket.
- **Tests:** `packages/core/tests/flaky-retry.test.ts` updated.

### T-58 Response latency: runner endpoints

- **Phase:** 5 · **Batch:** 13 · **Priority:** P2 · **Size:** M · **Depends on:** T-49, T-50 · **Status:** built (LAT items by reading; LAT-14 undescribed in ticket; wizard poll switch goes to T-59)
- **Goal:** list and poll endpoints do not read every saved file, and evidence and text responses are small.
- **Source:** PERFORMANCE round 2 LAT-1 to LAT-8, LAT-14 (checked and fine items excluded).
- **Evidence:** benchmark poll returns the full job (`BenchmarkScreen.tsx:83`, `server.ts:3441-3455`); benchmark and
  run lists parse every file (`benchmarks.ts:46-56`, `report-store.ts:83-93`, `plan-store.ts:214-230`); evidence is read
  whole (`server.ts:1181, 2227, 2303, 3204`); no compression; status awaits plan load (`server.ts:979`); plan validator
  rebuilt per edit (`routes/plan.ts:266`).
- **In scope:** a progress endpoint for comparisons; an index file for benchmarks, runs and parked plans; `createReadStream`
  with `Range` and cache headers for evidence; gzip for text responses over 1 KB; cached "no plan" read in status (the write-side fix is T-45); validator
  built once per plan load.
- **Acceptance criteria:**
  - [ ] A comparison poll response is under 1 KB.
  - [ ] Listing 100 saved runs reads the index, not 100 files (test counts reads).
  - [ ] A video supports `Range` and returns 206 (test).
  - [ ] A JSON response over 1 KB has `Content-Encoding: gzip` when the client accepts it.
  - [ ] An idle status poll makes no file read (test counts reads).
- **Tests:** runner route tests; a read counter in the store tests.

### T-59 Response latency: wizard polling and bundle

- **Phase:** 5 · **Batch:** 14 · **Priority:** P2 · **Size:** M · **Depends on:** T-58 · **Status:** built (backoff, lazy routes, vendor chunk, progress poll, reconnect snapshot; bundle size not built)
- **Goal:** an idle wizard makes few requests, and the first load ships only the first screen.
- **Source:** PERFORMANCE round 2 LAT-9 to LAT-13.
- **Evidence:** `App.tsx:219` polls every 5 s during a run; `useRunnerConnection.ts:4` every 3 s; `useRunnerStream.ts:6`
  reconnects every 3 s with no backoff; replay sends up to 200 events (`server.ts:939-943`); one `App-*.js` of about 398 KB
  (`vite.config.ts` has no `manualChunks` or lazy routes).
- **In scope:** poll only while a run or a waiting plan is visible, back off when idle; stream reconnect with backoff
  (2, 4, 8, capped at 30 s); reconnect snapshot instead of full replay; `React.lazy` for Report, Plan Review and Benchmark
  screens; `manualChunks` for vendor code; `pnpm build` lists chunk sizes.
- **Acceptance criteria:**
  - [ ] An idle wizard makes at most one request per 30 s (test with fake timers).
  - [ ] The stream reconnect waits 2, 4, 8 s, then 30 s (test).
  - [ ] First-load JavaScript is smaller than before (build output recorded in the ticket).
  - [ ] Each lazy screen still loads and shows its heading (existing wizard tests).
- **Tests:** wizard hook tests; `wizard-e2e` run at verification.

### T-60 Resource growth: retention and bounds

- **Phase:** 6 · **Batch:** 15 · **Priority:** P2 · **Size:** M · **Depends on:** T-54, T-57, T-58, T-50 · **Status:** built (history and fingerprint caps, answer prune, single event publish, dead constant, context closes, visitor run cap on list, save and finish; not run)
- **Goal:** every folder and log has a bound, and each run event is recorded once.
- **Evidence (read):** GROW-1 is owned by T-54 (failure-only capture). GROW-3 per-visitor folders (`server.ts:1385-1387`). GROW-4 waiting plans (T-50 covers
  expiry). GROW-5 `site-history.json` grows per run (`site-history.ts:108-118`). GROW-6 each event published twice
  (`checkup-run.ts:397-400` and `server.ts:752-774`). GROW-7 contexts closed on rare throws (`orchestrator.ts:739-759`,
  `discovery-agent.ts:561-571`, `safe-crawler.ts:172-182`). GROW-8 answers accumulate (`site-memory.ts:306`). GROW-9
  dead constant `MAX_RUN_EVENTS = 5000` (`server.ts:269`).
- **In scope:** per-visitor folder kept to ten runs (removal on expiry is T-50); a cap or a summary for `site-history.json` (keep grades, cap findings per
  run); publish each event once; `finally` for the three contexts; prune stale answers on save; delete the dead constant.
- **Acceptance criteria:**
  - [ ] An event appears once in the replay log.
  - [ ] `site-history.json` after 50 runs is under a set size (documented in the ticket).
  - [ ] The three contexts are closed when the step throws (test).
- **Tests:** orchestrator and history tests.

### T-61 Wizard: errors, focus and accessibility

- **Phase:** 7 · **Batch:** 16 · **Priority:** P1 · **Size:** M · **Depends on:** T-59, T-36 (built) · **Status:** built (plainError, focus return, Tab trap, shortcut setting; path was api.ts; no Testing Library in repo; raw-error sites outside owned files go to T-62)
- **Goal:** users see plain sentences, focus is never lost, and dialogs behave as dialogs.
- **Evidence (read):** UX-1 raw technical text (`api.ts:6-8`; `App.tsx:464, 602, 708`; `BenchmarkScreen.tsx:251`;
  `PlanDocument.tsx:1441`; `ReportScreen.tsx:553, 1575, 1618`). UX-2 focus after dialog and delete (`ConfirmDialog.tsx:24-34,
  93-101`; `PastCheckupsScreen.tsx:69-73`). UX-3 command palette not modal (`CommandPalette.tsx:277-291`). UX-10 invisible
  focus (`LandingScreen.tsx:422`). UX-11 single-key shortcuts without an off switch (`PlanDocument.tsx:1944-1983`).
  UX-12 mobile menu Escape (`TopBar.tsx:235-242`).
- **In scope:** extend the error sentence map that T-36 added to `api.ts` to the surfaces T-36 did not reach (`PlanReviewScreen.tsx`, `PlanDocument.tsx`, `ReportScreen.tsx`, `BenchmarkScreen.tsx`); return focus to the opener on dialog close and
  after delete; a focus trap and focus return for the palette; keep the global focus ring; a setting to turn off the
  shortcuts; Escape closes the mobile menu.
- **Acceptance criteria:**
  - [ ] No `RunnerError` or raw `err.message` is rendered without going through the sentence map (grep test).
  - [ ] After Stop or Delete is confirmed, focus lands on the next logical control (test with Testing Library).
  - [ ] Tab stays inside the command palette while it is open.
  - [ ] Focus outline is visible on every focusable element (CSS test or visual check, human item if not automated).
  - [ ] Shortcut keys do nothing when the setting is off.
- **Tests:** wizard component tests; the grep test.

### T-62 Wizard: copy and small UX

- **Phase:** 7 · **Batch:** 17 · **Priority:** P2 · **Size:** M · **Depends on:** T-61, T-37b (built) · **Status:** built (avoid-list sweep, labels, gutter, disabled reasons, nested main; plan-sources-view.test.ts asserts old copy and needs an edit)
- **Goal:** UI text follows the glossary and small states are correct.
- **Evidence (read):** UX-4 avoid-list terms (`App.tsx:608, 611-612, 768`; `ScanningScreen.tsx:125, 137, 268`;
  `NewCheckupScreen.tsx:298, 881`; `ReportScreen.tsx:618`; `TopBar.tsx:270`; `DeveloperDetails.tsx:92, 163`;
  `SettingsScreen.tsx:914-915`; `VisualBaselinesScreen.tsx:186, 453`). UX-5 phone gutter (`LandingScreen.tsx:259`). UX-6
  nested main (`App.tsx:892`, `LandingScreen.tsx:288`). UX-7 colour-only meaning (`SiteMap.tsx:378-385`,
  `TopBar.tsx:66-70`). UX-8 unlabelled slider (`VisualBaselinesScreen.tsx:422-429`). UX-9 label in name
  (`PastCheckupsScreen.tsx:146`, `NewCheckupScreen.tsx:994-1000`). UX-13 stale address check
  (`NewCheckupScreen.tsx:139-145, 264-266`). UX-15 success message never shows (`ReportScreen.tsx:479, 494-502`). UX-16 late domain-proof response
  (`NewCheckupScreen.tsx:1178-1192`). UX-17 numeric inputs clamp each key (`NewCheckupScreen.tsx:724-729, 742-746`).
  UX-18 max pages commit on blur only (`:491-495`). UX-19 lost edit (`PlanReviewScreen.tsx:256` vs `258-270`).
  UX-20 disabled controls with no reason (`BenchmarkScreen.tsx:242`, `ReportScreen.tsx:650`, `KeyField.tsx:136`).
- **In scope:** the glossary terms in UI text per `CONTEXT.md` (or the glossary changed if the code term is right, decided
  in T-37a/b); the rest as listed. Already owned by T-37b (built; do not redo): "Specs", "Test again", "account", "competitor", "Failed to", "Jump to Specs". The silent history loss is T-36's retry (built).
- **Acceptance criteria:**
  - [ ] A grep of `packages/wizard/src` for every avoid-list term finds none in user-visible strings (test with an allow list).
  - [ ] Phone width (375 px) has a 16 px gutter on every screen (test or visual check).
  - [ ] Each disabled control has a reason in text next to it.
  - [ ] Clearing a number field is possible; Enter on Max pages uses the typed value.
  - [ ] A stale address check cannot start a run against the old address (test).
- **Tests:** wizard copy test; component tests per item.

### T-63 Docs and contracts residual

- **Phase:** 8 · **Batch:** 18 · **Priority:** P2 · **Size:** M · **Depends on:** T-60, T-62, T-38 (built) · **Status:** built (docs, ADRs, settings, index and comment done; Security label shown via aspectLabel; QA_DELAY_MS 0 means 0)
- **Goal:** the docs describe the code after the phases above; ADRs state their status.
- **Evidence (read):** `docs/CONFIGURATION.md` (`QA_DELAY_MS` 0 becomes 100 ms in `checkup.ts:195`; `PUBLIC_URL` use;
  missing `SMOKE_PORT`, `SKIP_BROWSER_CHECK`, `CI`; per-provider key order in `key-resolver.ts:100-125`; `QA_MAX_PAGES=0`).
  `README.md:88-89, 98, 178` (Node and pnpm versions; `vercel.json`
  contents). `README.md:236` (comparisons are closed in beta, after T-42) is in scope here. API routes and the beta list are T-42. `CONTRIBUTING.md:12, 23` (Node 22.9 vs engines `>=22`; local-only backlog file). `CONTEXT.md`
  lines 191–223 (retired Report Hub terms), line 41 ("Spec" for Product Context, used in code). ADRs: 0018 ("Secure" used as
  an area label, `scoring.ts:103`), 0008 (`HUB_API_URL` not implemented), 0005 (Fastify hub retired), 0002 (keychain
  tier missing), 0021 (CI writes an on-disk session), 0013 and 0015 cited but missing.
- **In scope:** every setting named by T-45 to T-54 goes into `docs/CONFIGURATION.md` and `.env.example`; fix each item in the docs; fix code only where the doc is right (`QA_DELAY_MS` 0 handling, `QA_MAX_PAGES=0`);
  mark retired ADRs `superseded`; write or un-cite 0013 and 0015.
- **Acceptance criteria:**
  - [ ] T-38's `process.env` test also covers `scripts/` (T-38's test reads `packages/*/src` only).
  - [ ] Every ADR cited in `docs/` and code exists.
  - [ ] Every ADR with a retired feature has a status line.
  - [ ] `CONTEXT.md` has no retired term in the glossary section that the code uses.
  - [ ] `README.md` and `CONTRIBUTING.md` give the same Node and pnpm versions as `package.json`.
- **Tests:** the config-docs test (exists, extend); an ADR link check.

## Ticket summary

| id | title | phase | batch | priority | size | depends on | status |
|---|---|---|---|---|---|---|---|
| T-41 | Test baseline that runs | 0 | 1 | P0 | S | none | built |
| T-64 | Clear the baseline failures | 0 | 1b | P0 | M | T-41 | built |
| T-42 | Beta: comparison delete and closed routes | 1 | 2 | P0 | S | T-34 (built), T-41 | built |
| T-43 | Address guard for every outbound request | 1 | 2 | P0 | M | T-41 | built |
| T-44 | Redaction matching | 1 | 2 | P1 | M | none | built |
| T-45 | Redact on write, one secret list, screenshots and GET | 1 | 3 | P1 | M | T-42, T-43, T-44, T-46 | built |
| T-46 | Sign-in sessions off disk | 1 | 2 | P1 | S | none | built |
| T-47 | Verdict correctness | 2 | 4 | P0 | M | T-30 (built) | built |
| T-48 | Rejects and refusal rule | 2 | 4 | P0 | M | T-33 (built), T-45 | built |
| T-49 | Run lifecycle: browsers, stop, shutdown | 3 | 5 | P0 | M | T-35 (built), T-48 | built |
| T-50 | Durable state: scheduler, writes, waiting plans | 3 | 6 | P1 | M | T-46, T-49 | built |
| T-51 | Deploy gate and publishing | 4 | 7 | P0 | M | T-41 | built |
| T-52 | Container hardening and health | 4 | 8 | P1 | M | T-49, T-51 | human |
| T-53 | Performance: timing telemetry | 5 | 9 | P1 | S | T-52 | built |
| T-54 | Performance: fixed waits and failure-only evidence | 5 | 10 | P1 | M | T-53, T-52 | built |
| T-55 | Performance: once per page, cached link checks | 5 | 11 | P1 | M | T-54, T-43 | built |
| T-56 | Performance: parallel test points | 5 | 12 | P2 | L | T-55, T-49 | built |
| T-57 | Performance: retry policy | 5 | 13 | P2 | S | T-56; decision 4 | built |
| T-58 | Response latency: runner endpoints | 5 | 13 | P2 | M | T-49, T-50 | built |
| T-59 | Response latency: wizard polling and bundle | 5 | 14 | P2 | M | T-58 | built |
| T-60 | Resource growth: retention and bounds | 6 | 15 | P2 | M | T-54, T-57, T-58, T-50 | built |
| T-61 | Wizard: errors, focus and accessibility | 7 | 16 | P1 | M | T-59, T-36 (built) | built |
| T-62 | Wizard: copy and small UX | 7 | 17 | P2 | M | T-61, T-37b (built) | built |
| T-63 | Docs and contracts residual | 8 | 18 | P2 | M | T-60, T-62, T-38 (built) | built |
| T-23 | Split large files by area | 8 | 19 | P3 | L | T-63 | later |
