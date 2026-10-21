# Why a check-up is slow: root causes and plan

Status: research only. No code changed, no tests run, no timings measured. Every cost below is read from the
code; the minutes are estimates to be confirmed by the first step in the plan (per-phase timing).

Scope: the time a check-up takes from start to Plan Review (discovery and planning) and from approval to report
(the run). Paths are relative to the repo root.

## Summary

A check-up does a lot of work that is serial, repeated, or waiting for no reason:

1. **Test points run one at a time.** Every Plan Item × role × screen size is a separate, awaited unit
   (`packages/core/src/orchestrator.ts:573`, `:595`, `:610`). Nothing overlaps.
2. **Three screen sizes by default.** The UI sends all three (`packages/runner/src/session/checkup-run.ts:663-667`,
   `ALL_SCREEN_SIZES`), so each planned test point runs three times.
3. **Every test point pays fixed waits.** A 3 s `networkidle` race that almost never resolves on a live site, a
   300 ms login probe, and a 300 ms wait after every step.
4. **Every step writes a full-page screenshot and a DOM dump**, passed or not (`orchestrator.ts:920`,
   `packages/core/src/evidence.ts:100`). Video is recorded for every test point (`browser.ts:194`; the runner never
   passes `recordVideo`, so it is always on).
5. **Heavy checks run on every test point**, not once per page: axe (`checkers/src/ux-quality.ts`, called at
   `orchestrator.ts:1056`), the performance probe, and the SEO broken-link checker.
6. **Broken-link checks are serial and uncached.** Up to five sequential HEAD/GET requests per page with a 3 s
   timeout each (`checkers/src/seo.ts:556`), repeated at every screen size and every role, with no run-wide memory
   (the site-root check is cached, these are not).
7. **A failed test point is run again from scratch** (`orchestrator.ts:980`, `maxRetries: 1`), so a real failure
   costs double.
8. **Discovery crawls the site once per role, one after another.** The visitor crawl, then one full crawl per role
   (`discovery/discovery-agent.ts:530-575`), each re-visiting the same pages.
9. **Public-site politeness is a fixed 2 s per page** on a shared clock (`discovery-agent.ts:160`, the spider's
   `waitForPacing`). A 200-page crawl is at least ~400 s before any work, and each role crawl pays it again.
10. **AI planning is limited to one request at a time** when the provider does not report its limit: a 3.1 s gap and
    concurrency 1 (`plan/ai-budget.ts:47`, `:71`). Planning overlaps the crawl (ADR 0020), but the crawl's pace
    then sets the planner's pace.

## Rough cost model (estimate, to be measured)

A single **test point** on a typical page, no failures, before any checker finds anything:

| Part                                            | Time             | Source                                   |
| ----------------------------------------------- | ---------------- | ---------------------------------------- |
| New context and page, navigate                  | 0.5–1 s          | `browser.ts:216`, `navigate.ts`          |
| Settle: `networkidle` raced with 3 s cap        | ~3 s             | `navigate.ts:66-70`                      |
| Login probe after load                          | 0.3 s            | `navigate.ts:114`                        |
| Each step: 300 ms wait, plus screenshot and DOM | 0.5–1.5 s / step | `orchestrator.ts:892`, `evidence.ts:100` |
| Performance probe                               | 1–2 s            | `performance.ts:412-414`                 |
| axe (UX), security, SEO (headless evaluate)     | 1–3 s            | `ux-quality.ts`, `seo.ts`                |
| Broken links, worst case (5 × 3 s)              | up to 15 s       | `seo.ts:556`                             |

So roughly **5–10 s per test point** on a fast site and **20+ s** when links are slow. Multiply by Plan Items ×
roles × 3 screen sizes, then double for any failing point (retry). A 40-item plan for two roles is about
40 × 2 × 3 = 240 test points, which is 20–40 minutes of strictly serial work before discovery.

Discovery on a public site: 200 pages × 2 s pacing ≈ 7 min per crawl. With the visitor and two roles, that is
three crawls, about 20 min before planning finishes.

## Plan to fix

Ordered by expected gain for the least risk. Each item has a check that proves it.

### Phase 0. Measure first (small, do it before anything else)

- Add per-phase timing to the run: discovery (per crawl), planning, each test point (with breakpoint), each checker,
  and each navigate settle. Emit it as a `timing` field in the report and in `debug-log`.
- Run one check-up on `fixtures/test-app` and one on a real public site. Record the top ten costs.
- **Done when:** the report shows where time goes, and this plan's estimates are confirmed or corrected.

### Phase 1. Stop paying fixed waits (low risk, large gain)

- **1a. Settle.** Replace the 3 s `networkidle` race in `settlePage` (`navigate.ts:70`) with
  `domcontentloaded` plus a short fixed settle (about 500 ms), and keep `networkidle` only as an early exit with a
  cap of ~1 s. Make the cap a setting, so slow sites can raise it (`RUNNER_STEP_TIMEOUT_MS` already exists for steps).
- **1b. Login probe.** Drop the 300 ms wait in `looksLikeLogin` (`navigate.ts:114`) when the page is already loaded.
- **1c. Step waits.** Remove the unconditional 300 ms wait after each step (`orchestrator.ts:892`); wait for the next
  step's element instead, which Playwright already does.
- **Check:** fixture run time before and after; the step and navigation tests still pass.

### Phase 2. Stop the repeated work (medium risk, large gain)

- **2a. Once per page, not per test point.** Extend the existing `keyboardChecked` / `reflowChecked` pattern
  (`orchestrator.ts:566-567`) to axe, the performance probe, and the SEO broken-link check: one run per `urlPath`
  per run. The axe result is width-sensitive, so keep it per width but skip repeats for the same width and page.
- **2b. Cache broken-link results run-wide** (keyed by URL, as `site-root.ts:47` does), and check them in parallel
  with a limit of 4 instead of one at a time (`seo.ts:556`).
- **2c. Screen sizes.** Default the CLI and the UI to two sizes for a quick check (`375px`, `1440px`), or keep
  three and run only the layout checks at the mobile width. This is a product choice; present it to the person.
  Measure the finding-count difference before changing the default.
- **Check:** same findings on the fixture (diff `findings.json`), fewer test points, shorter run time.

### Phase 3. Stop capturing what nobody reads (medium risk, medium gain)

- **3a. Evidence on failure.** Take the full-page screenshot and DOM dump only when a step fails, or take a viewport
  screenshot on pass (`evidence.ts:100`, `orchestrator.ts:920`). The evidence for a passing step is rarely read.
- **3b. Video.** Expose `recordVideo` to the runner and to `checkup.ts` (today it is always on for runner runs), and
  turn it off by default in CI. Video is kept only for failures (`orchestrator.ts:1380-1392`), so a pass pays the
  encoding cost for nothing.
- **Check:** evidence for failing steps still present; report renders; run time drops.

### Phase 4. Run in parallel (higher risk, largest gain)

- **4a. Parallel test points across roles.** Test points in different roles touch different sessions, so they can
  run side by side (a worker pool with a limit, default 2). Keep one flow's steps in order, and keep one role's
  points in order if they share a session. The orchestrator state that must become per-worker or be made safe:
  `results`, `allFindings`, `vitalsMeasured`, `keyboardChecked`, `reflowChecked`, `speedSamples`, `siteWide`,
  `marketingLog`, `roleStates`, `SendGuard`, the checker memory (`security-depth.ts:18`), and the evidence folder
  naming (already per point).
- **4b. Keep writes safe.** Test Copy runs write data; those flows must keep their order. Read-only runs can
  parallelise freely. Gate 4a on the flow's kind and on `options.readOnly`.
- **4c. Discovery: share the visitor crawl.** Role crawls re-visit pages the visitor already recorded. Reuse the
  visitor's page facts for role-independent pages and crawl only what a role adds (`discovery-agent.ts:547-575`).
  Run role crawls in parallel when the sites allow it (separate contexts already exist).
- **Check:** same findings and report counts on the fixture with parallelism on and off; a test that two roles do
  not interfere with each other's session.

### Phase 5. Retry and planning policy (product decisions, present them to the person)

- **5a. Retry only what can be transient.** A whole-point retry (`orchestrator.ts:984`) doubles the cost of every real
  failure. Retry on navigation timeouts and browser crashes only; a failed assertion is reported once. Trade-off: fewer
  "flaky passed" results.
- **5b. Missing elements.** `locateElement` (`browser.ts:277`) walks a long fallback chain of `count()` calls, and each
  step waits up to 4 s per try (`orchestrator.ts:819-824`). The planning doc records about 35 s per try
  (`docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md:76`; not re-measured here). Check the chain once, then fail fast if
  nothing matches, instead of re-running it on each try.
- **5c. Planner rate limit.** Without a reported limit the planner runs one request at a time with a 3.1 s gap
  (`ai-budget.ts:47`, `:71`). Let the person set the provider's concurrency in settings, and default it to 2 for
  providers that report a limit. Document the trade-off against rate-limit errors (`RATE_LIMIT_WAITS_MS`,
  `ai-budget.ts:83`).
- **5d. Crawl pacing.** The 2 s per page on public sites (`discovery-agent.ts:160`) is politeness, not a bug.
  Keep it, but make it a visible setting so the person can see the cost before starting.

## What I ruled out

- **The browser is not relaunched per test.** `BrowserManager.launch` reuses the instance (`browser.ts:100-127`).
  Each test point gets a new context, which is cheap next to a launch.
- **Source-map checks are already deduplicated** run-wide (`security-depth.ts`, `siteWide` memo).
- **The site-root audit is cached** per origin (`site-root.ts:47`).
- **The planner is pipelined** by default when an AI key is set (`discovery-agent.ts:452-462`); the sequential
  `planPagesAndMenus` loop (`ai-planner.ts:881`) is only the fallback.
- **Repeat performance loads** happen once per page per run and only when the first loads look slow
  (`performance.ts:440`). Not a main cost, but a candidate to cut in Phase 2.

## Open questions for the person

1. Keep three screen sizes as the default, or two for a quick check (Phase 2c)?
2. Is retrying a failed test point worth doubling its cost (Phase 5a)?
3. Which AI provider and plan do most check-ups use? That sets the planner concurrency default (Phase 5c).

## Round 2: slow responses (runner HTTP, SSE and wizard)

Scope: how long the runner takes to answer the wizard and the wizard's own waiting. Same method: read the code,
estimate, confirm in Phase 0. Sizes are per response unless noted. Nothing here is measured yet.

### Findings

| #   | Where                                                                                                                     | What is slow                                                                                                                   | Why it scales                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | `packages/wizard/src/screens/BenchmarkScreen.tsx:7`, `:83`                                                                | Comparison polls every 1.5 s, and each poll returns the whole job                                                              | Each response carries the full `result`, not a progress summary                                                                      |
| R2  | `packages/runner/src/benchmarks.ts:46-56`                                                                                 | Benchmark list parses every saved job file (results included), then drops the results                                          | Cost grows with comparison history, on every list call                                                                               |
| R3  | `packages/runner/src/session/report-store.ts:83-93`                                                                       | Past check-ups list reads `summary.json` of every run folder                                                                   | No index; a directory scan plus one file read per run                                                                                |
| R4  | `packages/runner/src/session/report-store.ts:154`                                                                         | Report fetch parses the whole `report.json` each time                                                                          | Only the latest report is cached in memory                                                                                           |
| R5  | `packages/runner/src/server.ts:1181`, `:2227`, `:2303`, `:3204`                                                           | Evidence files (screenshots, videos) are read fully into memory and sent without streaming, `Range` or caching headers         | A video of a test point can be several MB; the browser cannot seek, and the whole file is held in memory per request                 |
| R6  | `packages/runner/src/server.ts` (no compression anywhere)                                                                 | No gzip on JSON, HTML or text responses                                                                                        | `report.html` embeds up to 6 MB of base64 screenshots (`packages/core/src/html-report.ts:621`); plan and report JSON go uncompressed |
| R7  | `packages/runner/src/server.ts:979`, `packages/runner/src/session/plan-store.ts:161-175`                                  | Status is polled every 3 s and 5 s; each poll awaits `plan.current()`, which reads the plan file from disk when none is cached | Cheap when there is no plan; a file read per poll otherwise                                                                          |
| R8  | `packages/runner/src/session/plan-store.ts:214-230`                                                                       | New check-up screen parses every parked plan file in full                                                                      | Cost grows with the number of parked plans, and each file holds every page                                                           |
| R9  | `packages/wizard/src/App.tsx:219`, `hooks/useRunnerConnection.ts:4` (3 s), `hooks/useRunnerStream.ts:6`                   | Fixed-interval polling with no backoff; the stream reconnects every 3 s on failure                                             | Constant background load on the runner, even when idle or down                                                                       |
| R10 | `packages/runner/src/server.ts:939-943`, `session/run-events.ts` (cap 200)                                                | A reconnecting page gets up to 200 replayed events, each with its full payload                                                 | Every reload or reconnect mid-run re-sends the run so far                                                                            |
| R11 | `packages/wizard/src/**` (single `App-*.js`, about 398 KB minified), `vite.config.ts` (no `manualChunks`, no lazy routes) | Report, plan review and benchmark code ship in the first load                                                                  | Every screen pays for every other screen's code on the first visit                                                                   |
| R12 | `packages/core/src/preflight.ts:187`                                                                                      | A fixed 4 s wait before the second try of the address check                                                                    | Every first attempt that fails pays 4 s, even on a transient error                                                                   |
| R13 | `packages/core/src/ai/openrouter.ts:184-190`, `runner/src/server.ts:2610`, `:2728`, `:3059`                               | Saving the key or changing the model runs key validation, then the model list, one after the other, with no cache              | Two sequential network round-trips on every AI settings change                                                                       |
| R14 | `packages/runner/src/routes/plan.ts:266`                                                                                  | Every plan edit builds a `PlanValidator` over all pages                                                                        | Cost grows with the number of pages in the plan                                                                                      |

Checked and fine: no synchronous file I/O on request paths (the one `existsSync` is in export code,
`plan/playwright-export.ts:422`); the SSE event log is capped (`MAX_RUN_EVENTS = 200`); plan toggles are
batched behind a 300 ms debounce (`PlanReviewScreen.tsx:194`); the AI visual review is not in the test loop.

### Phase 6. Make responses small and cheap (plan)

- **6a. Progress without the result (R1).** Add `GET /api/runner/benchmark/:id/progress` returning status and
  counts only. Poll that while running, and fetch the full job once at the end. Poll every 3 s instead of 1.5 s.
  - **Check:** a comparison run shows the same progress; the poll response is a few hundred bytes.
- **6b. Index saved records (R2, R3, R8).** Keep a small `index.json` (or per-folder summary sidecar) for
  benchmarks, runs and parked plans, updated on write. List calls read the index, not every file.
  - **Check:** list latency with 100 saved runs, before and after.
- **6c. Stream evidence (R5).** Serve files with `createReadStream`, honour `Range` for video, and send
  `Cache-Control: private, max-age=…` and an `ETag`. Evidence is immutable once written.
  - **Check:** a video seeks in the browser; a second request returns 304.
- **6d. Compress text (R6).** Gzip or brotli for `application/json`, `text/*` and `application/javascript`
  responses over about 1 KB. Leave images alone. Keep the 6 MB image budget but lower it for the in-app report
  (serve screenshots as links there, embed only in the exported file).
  - **Check:** `Content-Encoding` present; report view transfer size down.
- **6e. Stop re-reading the plan (R7).** Cache the "no plan" result for the status poll and clear it on
  save/clear, so an idle poll does no disk work.
  - **Check:** idle status poll causes no `readFile` (count in debug log).
- **6f. Back off the wizard's polling (R9).** Poll every 3 s only while a run or a waiting plan is visible; back
  off to 10–30 s when idle; reconnect the stream with exponential backoff (2 s, 4 s, 8 s, capped at 30 s).
  - **Check:** idle wizard makes at most one request per 30 s.
- **6g. Lighter reconnect replay (R10).** On reconnect, send a snapshot (current phase, counts, latest step) and only
  events after the client's last id. Keep the 200-event log for old clients.
  - **Check:** reconnect mid-run sends a few KB, not the whole log.
- **6h. Split the wizard bundle (R11).** Lazy-load `ReportScreen`, `PlanReviewScreen` and `BenchmarkScreen`
  (`React.lazy` plus `Suspense`), and add `manualChunks` for vendor code. Report the gzip size per chunk in
  `pnpm build`.
  - **Check:** first-load JS size drops; each screen still loads; build output lists chunk sizes.
- **6i. Fast first retry (R12).** Retry the address check after 500 ms, and only on a network error. Keep the
  4 s wait for a server that answers 5xx.
  - **Check:** a transient network error recovers in about 1 s; the fixture still passes preflight.
- **6j. Cache the model list (R13).** Cache `GET /models` for 10 minutes per key (in memory, never on disk), and
  run key validation and the list in parallel when the cache is cold.
  - **Check:** second settings change makes no OpenRouter call.
- **6k. Validate only what changed (R14).** Build the `PlanValidator` once per plan load and reuse it for each
  edit, or validate only the flows in the PATCH.
  - **Check:** plan edit time on a 200-page plan stays flat.

### Open items for round 2

1. Confirm whether the report files (`report.html`, `issues.html`, `report.json`) are written before or after the
   wizard receives `RUN_COMPLETED`. The finishing step in `server.ts` (around line 2400-2440) is awaited; if it
   runs before completion is announced, a large report delays "done" by the time it takes to render.
2. Measure R1 and R5 first with a real comparison and a real video. They may matter more than the estimates here.
