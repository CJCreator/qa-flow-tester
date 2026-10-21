# App review: consolidated findings

Status: review complete across all areas. Nothing fixed yet. Items are for later resolution. Each has a location,
a status, and a fix direction.

Status key:

- **verified**: reproduced by a run, a test, or a direct script.
- **read**: traced by reading the code path end to end. Not executed.
- **reported**: found by a reviewer and not yet checked by a second read or a test. Confirm before fixing.
- **platform**: depends on how a hosting platform or OS behaves. Confirm on the platform.

Security and redaction findings are in [SECURITY_REVIEW.md](SECURITY_REVIEW.md) (S1–S12). Performance findings
are in [PERFORMANCE_ANALYSIS.md](PERFORMANCE_ANALYSIS.md). Items here cross-reference them where they overlap.

## 1. Test health and build

- **Build:** `pnpm build` passes (exit 0).
- **Test suite, first run:** 75 of 234 files failed; 141 of 1736 tests failed; 1475 passed; 120 skipped.
- **Cause, verified:** the repo's Playwright expects Chromium build 1243 (`chromium_headless_shell-1243`), but the
  environment has build 1194 installed. Most failures are browser-launch errors (`browserType.launch: Executable
doesn't exist`), with knock-on failures: sign-in reports "unreachable", and tests read `close` or `title` of an
  undefined browser or page.
- **Status:** a rerun with the expected browser paths linked to the installed binaries is in progress. The result
  decides whether the remaining failures are real. Record the outcome here before resolving anything.
- **Missing fixtures, verified:** several tests expect generated baselines under `.tmp-visual-compat/` and
  `.tmp-e2e-qa-report/`. Those folders are generated output and are absent in a fresh checkout. The test
  setup should create them, not rely on a previous run.

## 2. Correctness of core paths

Reviewed: verdict, grades, scoring, refusal rule, Rejects planning, dedupe, retry, expansion cap.

### High

- **C1. One problem per page counts as many problems.** `packages/core/src/finding-groups.ts:20-22, 32` keys
  page-level findings as `checker|title|page:/x`, and no checker sets `issueKey`. The same finding on ten pages
  gives ten problems (`problems.ts:148-149`, `verdict.ts:97-103`, `scoring.ts:132`). The spread rule
  (`scoring.ts:157`) therefore never applies. Example: ten pages with a Minor "missing meta description" give
  Findable 50 and grade D, which breaches the standard gate ("Not ready yet"). The intended result is one
  problem across ten pages: score 93, grade A, "Ready to release". Also, a Major problem on two pages gives
  `majorCount` 2 and caps the grade at C instead of B (`scoring.ts:146-150`). **read**, traced end to end.
  Confirm with a test before fixing.
- **C2. Probe-only Rejects items are never judged.** `plan/expand.ts:140-143` removes the submit click for the
  probe answer and sets `probeOnly`. The refusal baseline is captured only at the submit click
  (`orchestrator.ts:829-831`), and `spec-conformance.ts:142` requires it, so the `:invalid` probe
  (`refusal-rule.ts:82`) never runs. The item produces no finding either way. **read**, traced.

### Medium

- **C3. The refusal rule can pass a value the app accepted.** `refusal-rule.ts:82-92` (`:invalid`, `aria-invalid`,
  `role="alert"`) takes no baseline. The error-text check at `:93-100` does compare to baseline, so the omission
  is inconsistent. A permanent `role="alert"` notice, or a footer alert on a form that accepts the value, passes as
  refused. A success toast with `role="alert"` on an edit form does the same. ADR 0024 lists `role="alert"` as a
  signal, so its wording also needs tightening. **read**.
- **C4. Crash grade reads the title text, not `is5xx`.** `scoring.ts:170-174` matches "uncaught exception" and
  "application crash" in the finding title. ADR 0029 says the crash grade must read the structured `is5xx` field.
  A step planned as "Trigger uncaught exception" grades Works as F. **read**.
- **C5. A run with nothing checked reads "Ready to release".** `verdict.ts:127, 161`: `ready` ignores coverage.
  `releaseVerdict([], undefined, undefined)` returns ready with "No problems found.". A run where every checker is
  absent gives null grades (`scoring.ts:178-180`), and `checkup.ts:369` then exits 0. ADR 0029 says an unchecked
  area is never a pass. `enforceAllAreas` (`verdict.ts:33, 39`) is set in the strict and standard gates but never
  read. **read**.
- **C6. Native validation text shadows Source wording.** `refusal-rule.ts:85` records `validationMessage` first,
  and `note()` keeps only the first text, so the alert text at `:92` is dropped. Example: the Source says
  "Email is required", and a `novalidate` form shows that text in an alert. The result is a Major "refused with
  different wording" (`spec-conformance.ts:198-206`). The browser behaviour is from knowledge of the platform.
  **platform**.

### Low

- **C7. Journey Rejects and Limits escape the Test cap.** `expand.ts:263` drops only `kind === 'page-test'`.
  Nothing currently assigns those intents to a journey, so this is latent. **read**.
- **C8. Element dedupe ignores the route.** `finding-groups.ts:18-20` keys element findings as `element:<selector>`
  with no page. The same selector and title on `/a` and `/b` merge into one finding. ADR 0004 includes the route in
  the identity. The test at `finding-groups.test.ts:44-63` covers shared header elements only. **read**.
- **C9. Nit:** `verdict.ts:94` compares `gate !== DEFAULT_RELEASE_GATES.standard` by reference, so a stored copy
  gets the custom-gate wording. **read**.

### Checked and correct

- Dismissed (Intended, False Positive) findings and unconfirmed AI guesses are excluded from counts and grades
  (`problems.ts:179-181`, `verdict.ts:103`, `scoring.ts:112-118`). `ai-review` is excluded
  (`verdict.ts:96`, `scoring.ts:145`).
- Strict, standard and lenient thresholds match ADR 0029. The overall grade is capped at the worst area and is null
  when no area is checked (`scoring.ts:220-228`).
- The grade scale boundaries (`scoring.ts:40-70`) match the documented scale.
- Retry: attempt counting, FLAKY vs PASSED, `shouldRetry` blocks a resend after a send, baseline and findings reset
  per attempt (`orchestrator.ts:669-676, 986`). Flaky penalty of −3 (`scoring.ts:162-164`).
- `fingerprint.ts` matches the ADR 0004 formula. `expandPlan` cap loop is correct (`expand.ts:261-269`).
- Not examined by the reviewer: ADR 0003 safety filters, and ADR 0025 probe behaviour.

## 3. Reliability and recovery

### High

- **R1. Stop and failed runs leak Chromium.** `orchestrator.ts:573` runs the test loop in `run()` with no
  `try/finally`. An abort inside a test point is rethrown (`:1344`), which skips `this.browserManager.close()`
  (`:1414`). The pre-flight failure at `:482` also skips it. Each run creates a new `BrowserManager`, so leaked
  browsers accumulate until the runner exits. Contrast `discovery-agent.ts:355-356`, which closes in `finally`.
  **read**, traced end to end.
- **R2. Stop frees the run slot before the old run has stopped.** `checkup-run.ts:1108` bumps the generation,
  `:1124-1125` set `isRunning=false` and `phase=idle`, and nothing awaits `currentRunPromise`. `server.ts:3002-3003`
  returns immediately, so a new run can start while the old orchestrator is still tearing down (two browsers, one
  shared site memory). After the orchestrator returns, `executeTesting` has no `current()` check between `:546`
  and `:585`. If a stop lands there, the old run can set `done` and `isRunning=false`, freeing the slot while a
  newer run is in discovery. **read**.

### Medium

- **R3. No graceful shutdown.** No runner source handles `SIGTERM`, `SIGINT`, `unhandledRejection` or
  `uncaughtException`. `RunnerServer.stop()` (`server.ts:1249`) is never called from `cli.ts`. The Dockerfile uses
  exec-form `CMD`, so Node is PID 1 and ignores SIGTERM without a handler. A stop during a run can cut off a report
  mid-write, and sign-in cookies in the auth folder are not removed on exit. Playwright 1.63 installs its own
  SIGTERM listener while a browser is open, which closes browsers but does not exit. **read** and **platform**.
- **R4. Scheduler data loss and lost updates.** `scheduler.ts:70` writes `schedules.json` non-atomically.
  `loadSchedules` (`:63`) returns `[]` on any read or parse error, and there is no backup. After a truncated file,
  `addSchedule` (`:86`) writes only the new entry. `tick`'s re-read (`:133`) can hit a concurrent write, get `[]`,
  and then write `[]` (`:138`). The HTTP add, toggle and delete handlers (`server.ts:1110-1127, 3482`) have no lock
  against `tick`. A toggle can revert `nextRunAt` after a tick advances it, so a schedule fires twice. A delete
  racing a tick can be undone. **read**.
- **R5. Missed scheduled runs.** `tick` advances `nextRunAt` before starting (`:124-125`). If `runSchedule` returns
  false because a run is busy (`server.ts:1220`), the occurrence is recorded as failed (`:130`) and never retried.
  **read**.
- **R6. Writes are not durable.** `atomic-write.ts:21-22` uses temp file plus rename, which is correct against a
  process kill. There is no `fsync` on the file or the directory, so a power loss can leave a zero-length target. The
  waiting plan is then lost, though a `.corrupt` copy is kept. Temp files left by a kill are never cleaned.
  **read**, **platform**.
- **R7. Save errors are swallowed.** `checkup-run.ts:492, 509, 1122` and similar sites use `.catch(() => {})` on
  `session.plan.save`. A failed write (for example a full disk) leaves the plan in memory only, and it disappears
  after a restart with no error shown. **read**.
- **R8. Unhandled rejection path.** `server.ts:1199-1204` always calls `res.writeHead(500)`. If headers are already
  sent (SSE at `:934-947`, or a later throw), that throws `ERR_HTTP_HEADERS_SENT` inside the async listener. With no
  `unhandledRejection` handler, Node 22 crashes the whole runner, including a live check-up. The reviewer found no
  concrete throw after `writeHead`, so this is latent. **read**.

### Low

- **R9. Approval race.** `routes/plan.ts:1175` (save) and `:1183` (generation bump). A `POST /api/runner/run` with
  `replacePlan` during the approval save can run `clear()` (which deletes the approved run's auth folder) and
  `begin()`. The window is milliseconds. **read**.
- **R10. Small leaks on rare paths.** `browser.ts:221-224`: if `setupContext` throws after `newContext` succeeded,
  the context leaks. `plan-store.ts:161-174` ignores `readOnly`, so an older runner can overwrite a plan with a newer
  `schemaVersion`. `browser.ts:246-247` leaves a 3 s timer uncleared. **read**.

### Checked and correct

- Run start guards: `starting` is set before the first await (`checkup-run.ts` `start()`). `handleTriggerRun` sets
  `runStartDone` synchronously (`server.ts:2770-2797`). Approvals are serialised by a WeakSet (`plan.ts` around
  `:910`). No path for two concurrent starts was found.
- Waiting plans survive a restart (`server.ts:3137-3145`, `plan-store.ts:214`).
- `writeJsonAtomic` removes its temp file on error.
- `openPage` restart (`browser.ts:216-242`) runs only from `orchestrator.ts:677`, sequentially.
- The scheduler tick has a reentrancy guard and a catch-all, and its timer is `unref`'d and cleared by `stop()`.

## 4. Resource growth and memory

### Medium

- **M1. Passing test points keep screenshots and DOM snapshots.** `evidence.ts:93-112` writes a full-page PNG and
  `page.content()` for every step. `orchestrator.ts:1378-1393` deletes only videos, and only for passing points.
  Nothing removes the step files. Disk use grows per run as test points × steps × (screenshot + HTML). Retention is
  10 runs per host (`report-store.ts:7, 127-138`), so disk is bounded per host, not across hosts. **read**.
- **M2. Chromium left running after some error exits.** Same root as R1. Pre-flight sign-in launches Chromium through
  the same manager, so the leak applies when sign-in roles are set. A failed run leaves one browser process,
  roughly 100–300 MB, until the runner exits. **read**.
- **M3. Beta: per-visitor folders are never deleted.** `server.ts:1385-1387` creates `dataDir/sessions/<id>` for each
  visitor session. `beta.ts:18, 53-64` cap and expire only the in-memory sessions, not these folders. Each can hold up
  to 10 benchmark JSON files plus site memory and history. The rate limit (20 new sessions per 10 minutes per
  address, `beta.ts:76-78`) makes growth unbounded over time. Beta only. **read**.
- **M4. Waiting plans never expire.** `plan-store.ts:55-63` writes `waiting-plans/<host>.json`, removed only by
  `unpark` (`:241`). Each file holds the full plan and `contextDocuments` text (`:38`). Growth is per distinct host
  parked and never resumed. **read**.

### Low

- **M5. `site-history.json` grows with every run.** `site-history.ts:108-118` keeps every run's grades and every open
  finding fingerprint, by design (comment at `:105-107`). The whole file is re-read and rewritten each run. Linear in
  findings per run. **read**.
- **M6. Each run event is logged twice.** `checkup-run.ts:397-400` publishes, then calls `deps.onEvent`. That reaches
  `recordRunEvent` (`server.ts:752-774`), which publishes again. The 200-entry replay log (`run-events.ts:1`) holds
  about 100 real events, and a reconnecting page replays duplicates. **read**.
- **M7. Some contexts are not closed on rare throws.** `orchestrator.ts:739-759` closes `reloginContext` only on the
  normal path. `discovery-agent.ts:561-571` has the same problem for `freshContext`, but `discover()` closes the
  browser in a `finally`, which bounds it. `competitive/safe-crawler.ts:172-182` leaks only if `newContext` or
  `newPage` throws. **read**.
- **M8. Answers accumulate.** `site-memory.ts:306` merges answers and never removes stale keys. Keys are per page or
  selector, so the map grows with site churn. **read**.
- **M9. Dead constant.** `server.ts:269` defines `MAX_RUN_EVENTS = 5000`, unused. The real cap is 200
  (`run-events.ts:1`). Misleading only. **read**.

### Checked and bounded

- Benchmark jobs are removed 60 s after completion (`server.ts:3384, 3421`), and the disk copy is capped at 10
  (`benchmarks.ts`).
- Retention runs in `keep()` (`report-store.ts:127-138`, called from `checkup-run.ts:581, 618`). Unfinished run
  folders are swept on the next `keep()`, except the active and parked IDs.
- SSE clients are removed on request close and shutdown (`server.ts:944-948, 756-763, 1253`). The reviewer did not
  confirm that `req` `close` fires on client disconnect. Check `res` `close` as well.
- `lastReport`, `speedSamples`, `vitalsMeasured`, `siteWide` and `keyboardChecked` are bounded.
- Video cleanup (`orchestrator.ts:157-169`, `:660-669`) is correct, including the retry path.
- Discovery and plan-route browsers are closed in `finally`.

## 5. Deployment and operations

Reviewed: `.github/workflows`, `render.yaml`, `vercel.json`, the Dockerfile, the start and smoke scripts, and
`docs/DEPLOYMENT.md`.

### High

- **D1. Failing tests do not stop the Render deploy.** `render.yaml:15` sets `autoDeploy: true`. Render builds on every
  push to `main` without waiting for GitHub Actions. `deploy.yml:1-2` says both sites rebuild only after tests pass,
  and `docs/DEPLOYMENT.md:20` says Render "builds from this repo itself". A commit that breaks a test goes live on
  Render within minutes, while the Actions run goes red and Vercel keeps the old build. **read** and **platform**.
  Fix: wait for checks on Render (verify the blueprint option), or turn off `autoDeploy` and trigger the Render
  deploy from the publish job.
- **D2. No persistent disk for the data folder on Render.** `Dockerfile:38-39` sets `RUNNER_DATA_DIR=/data` and
  `RUNNER_OUTPUT_DIR=/data/reports`. Saved settings, site memory, approved plans and reports go there. `render.yaml`
  has no `disks:` block, and `docs/DEPLOYMENT.md:63-67` does not mention the risk. Every redeploy, restart or
  free-plan spin-down may wipe the data. **read** and **platform**. Fix: add a disk, or document the limit.
- **D3. Chromium always runs with the sandbox off.** `browser.ts:120-121` passes `--no-sandbox` and
  `--disable-setuid-sandbox` unconditionally. Beta lets strangers choose the target URL. A renderer exploit from a
  hostile site gives code execution inside the Node process, which holds other visitors' AI keys and the
  `RUNNER_ACCESS_TOKEN`. The Dockerfile sets no `USER`. **read**. Fix: run as a non-root user, and isolate the
  browser where the platform allows.
- **D4. The deploy gate covers less than its comments say.** `tests.yml:54` excludes `wizard-e2e` and
  `auth-crawl-*`. `ci.yml:56` and `:68` skip test jobs on push. So on a push to `main`, those do not run.
  `deploy.yml:71-72` says nothing reaches publish without passing them. `wizard-e2e` runs only nightly
  (`e2e-nightly.yml:17`) and gates nothing. `audit` and `secret-scan` run on push, but the publish job does not
  `needs` them, so a high advisory or a leaked secret still publishes. `ci.yml:43` sets `continue-on-error: true` on
  typecheck, so a type error never fails a PR. **read**.

### Medium

- **D5. The user-facing template floats on `main`.** `.github/workflows/qa-check.yml` checks out `ref: main`, and the
  job receives `QA_AI_API_KEY`. Every push to `main` changes what users' CI runs. `docs/DEPLOYMENT.md:55` says the
  wizard pins `TOOL_REF`, but this copy does not. Not yet read: `templates/qa-check.yml`. **read**.
- **D6. Target URLs are logged raw.** `orchestrator.ts:377` and `discovery-agent.ts:503` log `options.targetUrl`.
  `checkup-run.ts:260-275` (`resolveTargetUrl`) keeps `user:pass@` as typed. A URL with credentials appears in the
  Render or Actions logs. Conditional on a user typing credentials into the URL. **read**.
- **D7. Dockerfile reproducibility and hardening.** `Dockerfile:3` pins `playwright:v1.63.0-noble` by tag, not by
  digest. Node comes from the base image, not `.nvmrc` (22), and that was not checked. No `HEALTHCHECK`, no `USER`.
  **read**.
- **D8. `/healthz` checks nothing.** `server.ts:841-845` returns `ok` before the host check, the access check, and any
  data-folder or browser check. It proves only that the listener is up. The verify step (`deploy.yml:131`) relies on
  it, so the verify step cannot tell which commit is serving. **read**.
- **D9. The verify loop can overrun its timeout.** `deploy.yml:122` loops 60 times. Each pass can take about 30 s
  (curl plus sleep). The job timeout is 15 minutes (`deploy.yml:108`), so the job can be killed without the
  `::error::` annotation. **read** by arithmetic.

### Checked and fine

- `deploy.yml` publish `needs: [build-and-smoke, test]`, so a red test skips publish. Vercel is pushed only after
  tests pass. The verify step runs after publish.
- Playwright version: the Dockerfile tag matches the workspace override (1.63.0).
- `--frozen-lockfile` is used everywhere. `.dockerignore` excludes `node_modules`, `dist`, `.git`, `.env` and key files.
- `RUNNER_ACCESS_TOKEN` is `sync: false`. `cli.ts` refuses a non-loopback bind without it.
- Vercel `version.json` carries the commit SHA, so the verify comparison holds.
- `start.mjs` and `smoke.mjs` are sound. `smoke` inherits `RUNNER_ACCESS_TOKEN`, so a developer with it set sees 401 locally.

## 6. Wizard UX and accessibility

Source review only. Nothing was run in a browser, so 375 px layout and focus behaviour are not verified live.

### Medium

- **W1. Raw technical text reaches users.** `api.ts:6-8` promises plain sentences, but runner 500s pass the raw
  redacted exception (`server.ts:1204`), and `RunnerError.message` renders as is (`App.tsx:464, 602, 708`,
  `NewCheckupScreen.tsx:168`). A benchmark failure renders `job.error` ("The comparison couldn't finish: …",
  `BenchmarkScreen.tsx:251`, `server.ts:3414`). Non-`RunnerError` messages render raw at `PlanReviewScreen.tsx:158,
169`, `PlanDocument.tsx:1441`, `ReportScreen.tsx:553, 1575, 1618`. **read**.
- **W2. Focus is lost after dialogs.** `ConfirmDialog.tsx:24-34, 93-101` unmounts on close, and nothing returns focus
  to the opener (`App.tsx:606-633`, stop scan and stop testing). After Delete in `PastCheckupsScreen.tsx:69-73` the
  row is removed and focus drops to `body`. Keyboard and screen-reader users lose their place. **read**.
- **W3. The command palette is not a modal.** `CommandPalette.tsx:277-291` sets `role="dialog"` and `aria-modal="true"`
  with no Tab trap and no focus return. Tab moves into the page behind it. **read**.
- **W4. Avoid-list terms in UI text.** `CONTEXT.md` avoids "scan" in UI text, but the UI says "Scanning", "Stop
  scanning?" (`App.tsx:608`), "Scan progress" (`ScanningScreen.tsx:137`), "scanned" (`NewCheckupScreen.tsx:298`),
  and "scans and plans" (`ReportScreen.tsx:618`). Other terms: "RUNNING" (`ScanningScreen.tsx:125`), "Run ID"
  (`DeveloperDetails.tsx:92, 163`), "Next run" and "Last run" (`SettingsScreen.tsx:914-915`), "Search test case"
  (`VisualBaselinesScreen.tsx:186`), "pixel comparisons" (`VisualBaselinesScreen.tsx:453`). "Account" in
  `SettingsScreen.tsx:37` means the AI provider account, not a Role, so it is fine. **read**. Fix the copy or the
  glossary.
- **W5. Phone gutter.** `LandingScreen.tsx:259` header uses `px-3` (12 px) at phone width, against the 16 px rule in
  `CLAUDE.md`. **read**.

### Low–medium

- **W6. Nested `main` landmarks.** `App.tsx:892` wraps `LandingScreen`'s own `main` (`LandingScreen.tsx:288`). **read**.
- **W7. Colour-only meaning.** `SiteMap.tsx:378-385`: journey identity is an unlabelled coloured dot in map view, and
  the legend (`234-252`) covers status only. `TopBar.tsx:66-70`: "a check-up is in progress" is a pulsing dot whose
  text exists only in an `aria-label`. **read**.
- **W8. Unlabelled slider.** `VisualBaselinesScreen.tsx:422-429`. **read**.
- **W9. Label in name (WCAG 2.5.3).** `PastCheckupsScreen.tsx:146`: visible "New check-up of this site", but the
  `aria-label` is "New check-up of {host}". `NewCheckupScreen.tsx:994-1000`: visible "Add files", `aria-label` "Add
  documents (.md, .txt or .docx)". **read**.
- **W10. Invisible focus.** `LandingScreen.tsx:422` uses `focus:outline-none` on a `tabIndex=0` scroll region,
  overriding the global ring (`index.css:17-19`). **read**.
- **W11. Single-key shortcuts** (`j`, `k`, `g`, `G`, Space, Enter) fire from `body` focus in `PlanDocument.tsx:1944-1983`,
  with no way to turn them off (WCAG 2.1.4). **read**.
- **W12. Mobile menu does not close on Escape.** `TopBar.tsx:235-242`. The More menu does (`133-149`). **read**.
- **W13. Stale address check.** `NewCheckupScreen.tsx:139-145`: an invalid new address keeps the previous "ok" for
  600 ms. Start or Enter then calls `start()` with `check.url` (`264-266`), the old address. **read**.
- **W14. Silent history loss.** `BenchmarkScreen.tsx:47, 50-57` with `api.ts:902-908`: `listBenchmarks` returns `[]` on
  any error, so the history disappears with no message. **read**.
- **W15. Success message never shows.** `ReportScreen.tsx:494-502` sets "All the screens are looked over now.", but the
  component returns `null` once `remaining` is 0 (`:479`). **read**.
- **W16. Late domain-proof response.** `NewCheckupScreen.tsx:1178-1192`: `DomainProofPanel` has no cancel on URL
  change, so a late response can overwrite newer state. It also says "isn't verified yet" while checking. **read**.

### Low

- **W17. Numeric inputs clamp each keystroke.** `NewCheckupScreen.tsx:724-729, 742-746`: the field cannot be cleared.
  Typing "2" after clearing gives "22", which clamps to 5. **read**.
- **W18. Max pages commits only on blur.** `NewCheckupScreen.tsx:491-495`, but Enter submits the form with the stale
  value (`:340-346`). **read**.
- **W19. Lost edit on quick second change.** `PlanReviewScreen.tsx:256` `addJourney` uses render-time `plan.flows`,
  while reorder and rename use `latest.current` (`:258-270`). A quick second edit can drop a change. **read**.
- **W20. Disabled controls with no reason.** `BenchmarkScreen.tsx:242`, `ReportScreen.tsx:650`, `KeyField.tsx:136`. **read**.

### Checked and fine

- Loading, empty and error states exist on all eight screens.
- Each screen moves focus to its `h1`. The skip link is present (`App.tsx:882-887`).
- Escape closes the confirm dialog, the command palette, the More menu and the landing menu.
- A global `:focus-visible` outline is defined (`index.css:17-19`).
- Status uses `role="alert"` and `role="status"`. Progress bars carry values. Grades and verdicts carry letters or words.
- Icon-only controls have names, and images have alt text.
- Stale-state guards are in place (`App.tsx` epoch checks, `useRunnerStream` cleanup, `useRunnerConnection`).

## 7. Docs and code drift

### Configuration (`docs/CONFIGURATION.md`)

- `QA_DELAY_MS` says 0 to 2000 ms. The code (`checkup.ts:195`, `Number(rawDelay) || 100`) turns 0 into 100 ms.
  Fix the code to keep 0.
- `PUBLIC_URL` is documented as used for origin checks. It is only read for absolute canonical and sitemap links
  (`ui-static.ts:76`). Origin checks use `RUNNER_ALLOWED_ORIGINS` and `RENDER_EXTERNAL_URL` (`cli.ts:12`). Fix the doc.
- The doc says it lists every setting the code reads, but it omits `SMOKE_PORT` (`scripts/smoke.mjs:11`),
  `SKIP_BROWSER_CHECK` (`scripts/start.mjs:82`, `smoke.mjs:17`) and `CI` (`scripts/start.mjs:20`). Add rows or narrow the claim.
- Key order is described as one global order. The code is per provider (`key-resolver.ts:100-125`): an env
  `ANTHROPIC` key beats a keychain `OPENAI` key. Fix the doc wording.
- `QA_MAX_PAGES=0` gives 50 (`checkup.ts:240`), not the documented clamp to 1.

### API (`docs/API.md`)

- **Beta closed routes are under-documented.** `server.ts:1333-1340` closes more than the doc lists: `POST
/api/runner/spec-override`, `POST /api/settings/defaults`, and `POST /api/runs/<id>/triage` and
  `/accept-judgement`.
- **Missing routes:** `POST /api/runner/spec-override` (`server.ts:1133`) and `GET /api/runner/spec-overrides`
  (`:1137`).
- **Beta comparison delete is open.** `DELETE /api/runner/benchmark/<id>` is not closed in beta, and
  `handleBenchmarkById` (`server.ts:3441-3455`) deletes by id with no owner check. This is an access-control issue,
  not only a doc issue. Also listed in the security review. **read**. Fix: close it in beta or enforce ownership.

### README and CONTRIBUTING

- `README.md:88-89` says "Node v20.x or v22.x" and "pnpm v9+". `:98` says 22.9+ and pnpm 11. The package engines are
  `>=22` and `packageManager` is `pnpm@11.10.0`. Align the doc.
- `README.md:236` says deleting comparisons is closed in beta. It is not (see above).
- `README.md:178` says `vercel.json` sets the install and build commands. It sets only `buildCommand` and
  `outputDirectory`.
- `CONTRIBUTING.md:12` requires Node 22.9. Nothing enforces 22.9. `CONTRIBUTING.md:23` points to
  `.claude/work/backlog.md`, which is git-ignored and absent from a clone. Say it is local only.

### Context and terms (`CONTEXT.md`)

- Lines 191–223 describe a Report Hub with no code references. `docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md:16` and
  `CHANGELOG.md:78, 89` say it was retired. Mark these retired or remove them.
- Line 41 says Product Context should not be called "Spec". The API and code use "spec" for it
  (`/api/runner/spec-override`, `plan/spec-plan.ts`, `specTestCases`). Update the avoid-list or rename.
- The UI-text avoid-list conflicts are listed under W4.

### Architecture and testing

- `docs/ARCHITECTURE.md`: every cited path and function exists. No drift.
- `docs/TESTING.md` and `docs/DEPLOYMENT.md`: commands, flags, job names and settings check out. No drift.

### ADRs

Checked for existence and consistency: 0002, 0003, 0004, 0005, 0008, 0010, 0014, 0017, 0018, 0019, 0020, 0021, 0022,
0024, 0027, 0028, 0029. Consistent: 0014, 0017, 0019, 0020, 0022, 0024, 0027, 0028, 0029.

- **ADR 0018 forbids "Secure" in the product**, but the code uses it as an area label (`scoring.ts:103`,
  `html-report.ts:52`, `site-history.ts:80`, `orchestrator.ts:232`). Amend the ADR or rename the area.
- **ADR 0008** mentions `HUB_API_URL` forwarding `/api/v1/*`. No such code exists, and the variable is on the
  retired list (`packages/runner/tests/config-docs.test.ts:14`). Mark it superseded.
- **ADR 0005** (a Fastify hub in `packages/hub`) has no status and no `packages/hub`. The Report Hub was retired.
  Mark it superseded.
- **ADR 0002** omits the OS keychain tier (`key-resolver.ts`). Amend it.
- **ADR 0021** says saved sessions are memory-only. The CI check-up writes its signed-in session to an on-disk
  temp folder (`checkup.ts:421-425`), and `CONFIGURATION.md` and `ARCHITECTURE.md` describe that as intended. Amend
  the ADR to cover the runner's own sign-in, and keep the CI behaviour documented.
- **ADR 0013 and ADR 0015** are cited (`E2E_PLATFORM_IMPLEMENTATION_PLAN.md:237, 534, 724`, `GAP_ANALYSIS.md:63`) but
  do not exist. Write them, or mark the citing docs as undecided.

## 8. Items to add to the security review

These came from the other reviews and belong in `SECURITY_REVIEW.md`:

- Beta comparison delete has no ownership check (section 7, API).
- Target URLs with credentials are logged raw (D6).
- Chromium runs with the sandbox off (D3).
- The qa-check template floats on `main` and receives the AI key (D5).
- Cross-run state on Stop (R2) is a data-isolation issue as well as a reliability one.

## 9. Suggested order to resolve

1. Confirm the test failures are environment-only (section 1). Record the result. Fix any real regressions first.
2. C1 and C2, the verdict and probe-only defects. They change release outcomes.
3. The deploy gate (D1, D4) and the beta comparison delete. These are the costliest if they go wrong.
4. R1 and R2 (leaked browsers, stop and slot ordering), then R3 (graceful shutdown).
5. The remaining correctness items (C3–C9) with tests.
6. Resource growth (M1–M4), then the data-durability items (R4–R7).
7. D2 (persistent disk), D3 (sandbox), D5 (template pin).
8. Wizard UX (W1–W5 first), then the rest.
9. Docs drift, after the code decisions above are settled, so the docs are written once.
