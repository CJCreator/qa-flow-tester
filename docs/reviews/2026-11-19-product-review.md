# QA Flow Tester: product and codebase review

Date: 2026-11-19. Commit reviewed: `b23682c` on `main`. Read-only review; no code changed.
Labels: **[V]** Verified in code or docs (cited), **[I]** Inferred from verified facts, **[H]** Hypothesis (with a test that would confirm it).

## 1. Executive summary

1. **Hosted Website Audit is closed to everyone, the owner included.** The GitHub variable `AUDIT_OWNER_EMAILS` is not set. Without it, every audit screen shows "This shared copy has no Website Audits of its own" (`BetaAuditNotice.tsx:37-40`, `gh variable list`, T-86 still `human`). Setting one variable fixes it. [V]
2. **"Alternatives and enhanced version" is partly built, but hard to find and narrow.** There is an AI improved-homepage preview for the **homepage only**, behind a tab labelled **Share**, and that tab is hidden on the Documents and Download screens. A per-Section rewrite needs approval one Section at a time. Nothing offers alternatives, a before and after view, or more than one page. [V]
3. **The count mismatch is a defect, not a misunderstanding.** "Found so far: N problems" groups by **title** over only the **50 most recent raw findings**. The report groups by `issueKey`/`problemKey` and removes dismissed, AI, "to confirm" and suppressed findings. It also adds access-check findings that the live count never saw. [V]
4. **The real cap on large sites is not only the "200 pages" setting.** Sitemap seeding stops at **200 URLs** whatever `maxPages` is. URLs with numeric IDs are limited to **25 per URL pattern**. The hosted copy refuses audits over 200 pages, and an unfinished audit cannot be resumed. [V]
5. **Speed:** Check-up tests run strictly one after another. A failed test runs up to **4 times**, although the guide says "retried once". In a Website Audit, each Sample Page's axe scan, throttled reload and phone screenshot run inside one of only 3 crawl slots. After the crawl, the AI stages run one after another and send **one AI call per recorded page**. [V]
6. **Highest-value actions:** set `AUDIT_OWNER_EMAILS`; compute the live count with the same function as the report; lift the sitemap seed cap; move Sample Page work off the crawl slots and overlap the post-crawl stages; add a top-level "Improved version" view; add Check-up test workers.

## 2. Evidence base

**Read:**

- Docs: `docs/PRODUCT_GUIDE.md` (all); `CONTEXT.md` (Website Audit terms); `SECURITY.md:20-30`; `docs/API.md:25,129`; `docs/ARCHITECTURE.md:45`; `docs/CONFIGURATION.md` (limit and env rows); `docs/DEPLOYMENT.md` (Cloud Run rows); `docs/tickets/INDEX.md`; `WEBSITE-AUDIT-RELIABILITY-PLAN.md` (T-86); ADR 0043 and 0045.
- Code:
  - `packages/types/src/{discovery,website-audit,verdict,problems}.ts`
  - `packages/core/src/{orchestrator,retry-runner,finding-groups,suppressions,host-pacer,navigate,step-budget}.ts`
  - `discovery/{deterministic-spider,frontier}.ts`, `plan/{sampling,ai-budget}.ts`
  - `audit/{crawl,pipeline,ai,preview,documents,speed,store}`
  - `checkers/src/performance.ts`
  - runner: `routes/{index,audit-crawl,audit-export,audit-ai}.ts`, `session/checkup-run.ts`, `cli.ts`, `security-headers.ts`, `egress-proxy.ts`
  - wizard: `TestingScreen.tsx`, `lib/translate.ts`, `ReportScreen.tsx`, `lib/summary.ts`, `screens/audit/**`, `App.tsx`, `router.ts`
- Infrastructure: `.github/workflows/deploy.yml`, plus GitHub repo variable **names** (no values).

**Missing evidence or not reviewed:**

- No timings from real runs. Every speed gain below is an estimate until the benchmark in section 6 runs.
- I don't know which area (Check-up or Website Audit) or which setup (hosted or local) produced the owner's complaints. This changes the root cause of problems 2 to 4 (see section 8).
- Not reviewed:
  - Safety Filter and Domain Allowlist enforcement (`discovery/safety-filter.ts`, `guard.ts`)
  - ADR 0018 text
  - which count each export prints in `reporter.ts`, `html-report.ts` and `issues-document.ts` (only their calls to `releaseVerdict` were checked)
  - whether the AI Request Budget is a hard stop (no enforcement code found by name)
  - Cloud Run memory under load

## 3. Findings for problems 1 to 4

### Problem 1: Speed

**Evidence**

_Website Audit:_

- Page loads and pacing:
  - `AUDIT_FETCH_IN_FLIGHT = 3`, `AUDIT_MIN_GAP_MS = 500`, `AUDIT_PAGE_TIMEOUT_MS = 30_000`, `AUDIT_MAX_CRAWL_MS = 60 * 60 * 1000` (`audit/crawl/crawl.ts:69,52,59,64`). [V]
  - The spider's worker count is capped at 5 regardless: `Math.max(1, Math.min(5, options.concurrency ?? 2))` (`deterministic-spider.ts:411`). [V]
  - A robots Crawl-delay or a 429/503 drops the host to 1 page in flight (`host-pacer.ts:80-101`). [V]
  - Each navigation then settles for up to 3 s, plus up to 2 s on pages with no links (`navigate.ts:102,132,187`). [V]
- Sample Page work:
  - Each Sample Page's work runs inside the crawl worker, one step after another (`audit/pipeline/page-recorder.ts`, awaited at `crawl.ts:478-483`): read the page, run axe, a **throttled reload** for timing (`speed/browser-timing.ts:292`, 1.6 Mbps and 4× CPU slowdown per `performance.ts:58-63`), then a phone-width screenshot (`phone-layout.ts:52-79`). [V]
  - Sample Pages are 3 per Layout Group with no total cap (`plan/sampling.ts:5`). [V]
- After the crawl, these stages run one after another: PageSpeed Insights (`pipeline.ts:509`), `assessPages` (`:636`), `assessSite` (`:679`), `recommendPages` (`:720`). [V]
  - `assessPages` sends one AI call per recorded page (all pages, not only samples), 4 at a time (`AUDIT_AI_IN_FLIGHT = 4`, `assessment.ts:101`). An answer that fails to parse is asked again once (`:245-262`). [V]
  - One AI call may take up to 120 s (`ai/timeout.ts:7`). PageSpeed Insights runs on up to 20 pages, 4 at a time, at up to 90 s each (`pagespeed.ts:22-28`). [V]
- Exports: each PDF launches a new Chromium (`render-pdf.ts:34`; `bundle.ts:37` "Each call starts its own browser"), at most 2 at a time (`audit-export.ts:56`). [V]
- Hosted CPU: ADR 0043:6 says the hosted audit "only gets CPU while the progress stream is open (Cloud Run CPU throttling)". `deploy.yml:193-196` runs 1 CPU, 2 GiB and one instance, and has no `--no-cpu-throttling` flag. [V] An audit therefore stalls when the user closes the tab. [I]

_Check-up:_

- The run is one sequential loop: `tests: for (const testCase of testCasesToRun)`, with `for (const bp of sizesFor(testCase))` inside it (`orchestrator.ts:648,667`). Neither the orchestrator nor the runner has a worker pool. [V]
- Each test point opens a new context with video on by default (`recordVideo = options.recordVideo ?? true`, `:594`). [V]
- Retries: `maxRetries: … options.flakyReruns ?? 3` (`:1086`), and `while (attempts <= maxRetries)` (`retry-runner.ts:57`), so a failing test can run 4 times. No runner caller sets `flakyReruns`; only tests do. [V]
- The speed check makes 3 throttled loads per page, plus 2 more when the page is slow (`performance.ts:70-71`). [V]

**Root cause [I]:**

- Website Audit: crawl time is set by the 500 ms gap and 3 slots, and Sample Page lab work occupies those slots. After the crawl, four AI and speed stages run back to back, each 4 at a time.
- Check-up: work grows as Plan Items × screen sizes × up to 4 attempts, with no parallel workers.

**Impact [I]:**

- Website Audit, rough estimate at 200 pages: the crawl takes at least 100 s at the pacer ceiling. `assessPages` at about 15 s per call, 4 at a time, adds about 12 minutes. That 15 s is an assumption; measure it.
- Check-up: run time grows linearly with tests.

**Fix:** section 6.

### Problem 2: Count mismatch

**Evidence: every place a count is made**

| Where                            | What it counts                                                                                                                                                | Cite                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `FINDINGS_UPDATED.totalFindings` | Raw `allFindings.length`, one per test point × screen size. Includes advisory, AI, needs-confirmation and "could not run" findings.                           | `orchestrator.ts:1537-1548` [V]               |
| Wizard reducer                   | Keeps `totalFindings`. `found` keeps only the **50 newest** raw findings: `[...found.reverse(), ...state.found].slice(0, FOUND_KEPT)` with `FOUND_KEPT = 50`. | `translate.ts:69,298,303` [V]                 |
| **What the user sees live**      | "Found so far: {problems.length} problems". Problems are grouped by `plainTitleText(f.title).toLowerCase()` over those 50.                                    | `TestingScreen.tsx:93-112,244` [V]            |
| Per-page badge on the site map   | Raw +1 per finding per event                                                                                                                                  | `translate.ts:287`, `SiteMap.tsx:84` [V]      |
| Access-check findings            | Pushed **after** the last live event                                                                                                                          | `orchestrator.ts:1585` [V]                    |
| Final merge                      | `mergeDuplicateFindings` by `issueKey` or `checker                                                                                                            | title                                         | where` | `orchestrator.ts:1642`, `finding-groups.ts:37` [V] |
| Suppressions                     | Rules saved from earlier runs mark findings Intended or False Positive                                                                                        | `suppressions.ts:59-71` [V]                   |
| Verdict                          | Drops advisory and `ai-review` findings, then drops `toConfirm`. `total: active.length`. Also reports `findings` (merged findings behind the problems)        | `verdict.ts:118,126,225-227` [V]              |
| Report screen                    | Shows both numbers: "{findings} behind the {total} problems the verdict counts"                                                                               | `ReportScreen.tsx:549-553` [V]                |
| Website Audit saved count        | `findings: findings.length`, raw per rule × page, shown as "N findings"                                                                                       | `pipeline.ts:925`, `saved-api.ts:269-275` [V] |
| Website Audit list and grades    | The list groups findings (`FindingsList.tsx:32,98`). Grades use `issueKey: f.rule`, so 30 pages with one rule count as one problem                            | `grades.ts:56` [V]                            |

**Root cause (Check-up) [V].** The live number and the final number use different definitions:

- The live number groups by title only, so two checkers reporting the same title become one line. The final count can split those, or merge differently through `problemKey`.
- The live number sees only the newest 50 raw findings. On a large run, older titles drop out, so the live number can **go down** and understates the total.
- The live number still includes dismissed, advisory, AI and to-confirm findings, and findings that suppression rules will remove.
- The live number never includes access-check findings.

**Website Audit:** there is no live finding count [I, the stage emitter has no count]. The mismatch the owner sees is the raw "N findings" in Saved audits against the grouped Findings list and Findings document. Section edits and removed pages also change the document after review (`documents/edits.ts:280`). [V]

**Impact:** users stop trusting the report. Severity: Major.

**Fix: one definition and one function.**

- **Canonical count = Problems that count:** findings grouped by `groupIntoProblems`, excluding dismissed (Intended or False Positive), advisory and AI findings, and `toConfirm`.
- **Single source of truth:** a pure function `countSummary(findings)` in `packages/types` that returns `{raw, merged, problems, dismissed, advisory, toConfirm}`. `releaseVerdict` already calculates most of these.
  - The orchestrator calls it after each test point and sends the summary in `FINDINGS_UPDATED`. The `latest` payload then needs to carry `issueKey`, `advisory`, `needsConfirmation` and `triageStatus`.
  - Drop `FOUND_KEPT` from the count. Keep it only to limit the list shown.
- **UI: show how raw findings become the final number**, live and on the report: "142 raw findings → 61 merged (same problem on several pages or sizes) → 9 dismissed, 4 AI notes, 3 to confirm → **45 problems that count**". Use the same steps for audits: "312 findings on 180 pages → 41 rules".
- **Success criterion:** at the end of a run, the last live "problems that count" equals the report's `verdict.total` exactly, plus any access-check delta shown as its own labelled line. Enforce this with a unit test that feeds the same findings to both paths.

### Problem 3: Page cap

**Evidence, every limit**

| Limit                      | Value                                                                                                                   | Cite                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Check-up default / bounds  | 200 pages (range 1 to 1000), depth 8 (max 100)                                                                          | `discovery.ts:23-34` [V]                                    |
| Website Audit default      | 50 pages, depth 5                                                                                                       | `website-audit.ts:72-78` [V]                                |
| Hosted audit cap           | 200. The start is **refused** with 400; a re-run is **clamped silently**                                                | `routes/index.ts:154`, `audit-crawl.ts:334-335,517-521` [V] |
| **Sitemap seed**           | **200 URLs**, at most 25 sitemap files, fetched one at a time                                                           | `deterministic-spider.ts:640,657,663` [V]                   |
| **Per-pattern trap limit** | 25 per URL pattern. A pattern replaces only digits, UUIDs and hex tokens of 6+ characters. The audit passes no override | `frontier.ts:83-89,109`, `crawl.ts:407-427` [V]             |
| Crawl time                 | 60 min for an audit. If `QA_CRAWL_MAX_MINUTES` is set, it replaces this budget                                          | `crawl.ts:64,418` [V]                                       |
| PageSpeed Insights         | 20 pages; the rest use browser timing                                                                                   | `pagespeed.ts:28` [V]                                       |
| Broken-link requests       | 100                                                                                                                     | `analyse-site.ts:100` [V, from investigator]                |
| Coverage route rows        | 500                                                                                                                     | `crawl.ts:74` [V]                                           |
| Cloud Run                  | 1 CPU, 2 GiB, 1 instance, timeout 3600 s; data in `/tmp` (held in memory)                                               | `deploy.yml:193-196` [V]                                    |
| Resume                     | None. On restart, running versions are marked `tool-restarted`                                                          | `ARCHITECTURE.md:45` [V]                                    |

**What actually limits large sites:**

- _Hosted copy:_ the 400 refusal above 200 pages [V].
- _Local runner, with `maxPages` raised to 1000:_
  - The sitemap seeding stops at 200 URLs. Any URL beyond that is reached only by following links, and URLs never queued appear nowhere, not even as Skipped Pages (the one place this happens silently). [V]
  - Numeric-ID catalogues stop at 25 pages per pattern. Readable slugs such as `/product/blue-shirt` are not grouped by the frontier. [V]
  - Then the 60-minute budget. On a host with Crawl-delay it is reached sooner, since such a host gets 1 page in flight. [I]

**Fix (design for large sites):** keep the rule that every page not recorded is a Skipped Page with a reason.

1. **Sitemap first.** Seed up to `maxPages` (not a fixed 200), fetch sitemap files 4 at a time, and record URLs over the limit as Skipped Pages, reason `page-limit`. Success: a 1000-URL sitemap gives `recorded + skipped == sitemap URLs`.
2. **Template-first sampling.** The audit already reads Page Content from every page and groups pages into Layout Groups with `itemShape` (`sampling.ts`), which also recognises slugs. Proposed changes:
   - Group catalogue pages with `itemShape` and read only _N_ per group in full.
   - List the others as "covered by template: seen in sitemap, not opened".
   - Report coverage per section: "/blog: 412 in sitemap, 40 read, 3 tested".
3. **Checkpointing and resuming.** Save the frontier and the recorded pages to the audit store every _k_ pages. `recoverRunningAudits` then offers **Resume** where it now marks the version `tool-restarted`.
4. **Background jobs on the hosted copy.** Use `--no-cpu-throttling` (always-on CPU) or a Cloud Run Job per audit, so closing the tab does not stall the audit. Raise `hostedMaxPages` only after the benchmark shows memory headroom.
5. **Per-section audits.** The existing `includePaths` field already supports this. Add a "split this site into sections" helper that queues one audit per top-level path.
6. **Paged results.** The Findings list and the Skipped Pages list need paging past about 500 rows (`MAX_ROUTES` already cuts telemetry rows).
7. **Hosted form.** The wizard bound is a fixed 1000 (`audit-start-form.ts:30-38`). Show the runner's actual cap before the user submits.

### Problem 4: Website Audit

**Guide against code**

| Guide claim                               | Code                                                                                                                                                                                                                                  | Status                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Website Audit can start at `/audits/new`  | On the hosted copy, every audit route shows the beta notice unless `auditOwner` is true (`BetaAuditNotice.tsx:37-40`). `auditOwner` requires `AUDIT_OWNER_EMAILS` (`API.md:129`), which is **not** among the repo variables           | **Blocker on the hosted copy** [V]                     |
| Six areas, graded by deterministic checks | `grades.ts:29-31`: `search-ranking` and `marketing` **both** map to `Findable`                                                                                                                                                        | Drift [V]                                              |
| "Website preview"                         | AI **improved-homepage** preview, homepage only, at most 8 findings (`preview/prompt.ts:2,52`), on the **Share** tab. That tab is hidden on Documents and Download (`ReviewDocumentsScreen.tsx:753`, `ExportDocumentsScreen.tsx:432`) | Hard to find [V]                                       |
| Languages chosen per export               | Fixed labels per language (`documents/labels/*.ts`). Page Content and findings are not translated. AI notes follow the language chosen at start                                                                                       | Drift: the guide implies the content is translated [I] |
| Not in the guide                          | Section rewrite after approval (`ai/rewrite.ts`, `RewriteReview.tsx`); per-page redesign or repair recommendation (`ai/page-recommendation.ts`)                                                                                       | Docs gap [V]                                           |
| Retry once before Skipped Page            | `navigate.ts:186` `retries ?? 1`, plus a busy-host retry after 5 s                                                                                                                                                                    | Consistent [V]                                         |

**Root cause:**

- [V] The hosted copy refuses to show Website Audits at all.
- [H] The owner may be on the hosted copy. Test: sign in on the hosted copy and open `/audits/new`. If the beta notice appears, this is the cause.
- [V] The "enhanced version" exists for one page only and sits under an unrelated label. "Alternatives" does not exist.

**Fix:** set the variable (S), rename and move the preview (S), and build section 5.

## 4. Other issues

| ID  | Area           | Sev.       | Evidence                                                                                                                                                                            | Recommendation                                                                                                                    |
| --- | -------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Hosted audits  | Blocker    | `AUDIT_OWNER_EMAILS` is unset; the beta notice shows on every audit route [V]                                                                                                       | Set the repo variable and redeploy. Success: the owner reaches `/audits/new` on the hosted copy                                   |
| O2  | Reliability    | Major      | `cli.ts:79-82`: `unhandledRejection` → `shutdown(…, 1)`. On the shared copy, one visitor's bug stops every run [V]                                                                  | Log the rejection, fail only the affected run, and keep the server up. Success: an injected rejection leaves `/api/status` at 200 |
| O3  | UX, W20        | Major      | About 90 `disabled=` sites, about 9 with `aria-describedby`. Examples: `PlanDocument.tsx:629,973`, `ExportDocumentsScreen.tsx:278,308,337` [I, count from investigator; examples V] | Add a shared `DisabledReason` component and a lint rule. Success: every disabled button has a reason line                         |
| O4  | Docs drift     | Minor      | Guide:116 says Save key has "No reason line yet", but `KeyField.tsx:154-160` has one [I]                                                                                            | Update the W20 note                                                                                                               |
| O5  | Docs drift     | Minor      | Guide:27 says a failed flow "is retried once"; the code allows up to 3 retries [V]                                                                                                  | Choose one. Retrying once halves the worst-case cost of a failure                                                                 |
| O6  | Docs drift     | Minor      | Guide:27 says "Workers use isolated browser contexts", but no parallel workers exist [V]                                                                                            | Reword, or build workers (section 6)                                                                                              |
| O7  | Hosted runtime | Major      | No `--no-cpu-throttling`; ADR 0043:6 says CPU is given only while the stream is open [V/I]                                                                                          | Always-on CPU, or a Cloud Run Job per audit                                                                                       |
| O8  | Security       | Minor      | `orchestrator.ts:383` `redactor.files(...).catch(() => {})`: a redaction failure is silent, and unredacted evidence stays on disk [V]                                               | Log the failure, record a "Could not verify: redaction" note, and delete the unredacted evidence                                  |
| O9  | Security       | Minor      | `security-headers.ts:41-46` omits `X-Content-Type-Options` and `Referrer-Policy` by default [I]                                                                                     | Set them globally                                                                                                                 |
| O10 | Security       | Minor      | The egress proxy accepts any port, and its plain-http path has no timeout (`egress-proxy.ts:44,~134`) [I]                                                                           | Allow only 80/443 (plus the configured ports) and add an idle timeout                                                             |
| O11 | Security       | Minor      | `redact.ts` has no patterns for key shapes such as `sk-…`, `AIza…`, `ghp_` [I]                                                                                                      | Add patterns, and a test that feeds a fake key through an error                                                                   |
| O12 | Security       | Suggestion | Chromium on local runs is unguarded, which ADR 0045:22 makes deliberate ("the owner's own network and risk"). SECURITY.md does not state it [V]                                     | State it in SECURITY.md                                                                                                           |
| O13 | Security       | Suggestion | `server.ts:250` checks length before `timingSafeEqual`, which leaks the key's length [I]                                                                                            | Hash both sides first                                                                                                             |
| O14 | Reliability    | Minor      | `scheduler.ts:297` `.catch(() => {})` hides scheduler failures [I]                                                                                                                  | Log them                                                                                                                          |
| O15 | Limits         | Minor      | A hosted re-run clamps silently, while a hosted start refuses (`audit-crawl.ts:334` against `:517`) [V]                                                                             | Use the same rule for both and say so                                                                                             |
| O16 | Counting       | Minor      | Saved "N findings" is raw; grades and the list group by rule [V]                                                                                                                    | Show "N findings · R rules"                                                                                                       |
| O17 | Docs drift     | Minor      | `CONFIGURATION.md:87` lists `TEST_MOCK_AI`, which no code reads [V]                                                                                                                 | Remove the row                                                                                                                    |
| O18 | Tests          | Suggestion | No test imports `audit/pipeline/grades.ts`, `documents/write-all.ts`, `preview/prompt.ts`, `cli.ts` or `safe-scan.ts` [I, heuristic]                                                | Add unit tests, starting with `grades.ts` and the live/final count parity                                                         |
| O19 | Translation    | Minor      | 10 of the 12 languages carry the beta label; only labels are translated (`website-audit.ts:33-49`) [V/I]                                                                            | Say so on the export screen: "Labels in Hindi; findings stay in English"                                                          |
| O20 | Robots         | Suggestion | A robots.txt 5xx or timeout is read as allow-all (`competitive/robots.ts:113-116`) [I]                                                                                              | Treat a 5xx as disallow                                                                                                           |

## 5. Proposed design: the enhanced version and alternatives

**Name:** "Improved version" (needs a CONTEXT.md entry and an ADR). It is a view of one audit version, built from existing outputs. It never touches the live site.

**Inputs (all exist):**

- Page Content per Section
- Findings with IDs, rule, impact and effort
- Layout Groups and Sample Pages
- the 1440 px screenshot and the phone screenshot (`phone-layout.ts`)
- `page-recommendation.ts` (redesign or repair per page)
- the Improvement Roadmap
- user edits (overlay)
- the chosen language
- optionally, a Benchmark run against the user's chosen competitor

**Outputs:**

1. **Improved pages.**
   - What: the existing preview pipeline (`preview/generate.ts`, sanitizer, claim-word stripping, menu links kept), run per Layout Group on one Sample Page each, not only the homepage.
   - Cost: one AI call per group.
2. **Before and after.** The stored screenshot beside the improved page, at 1440 and 375 px. Each change carries a marker linking to the finding ID it addresses.
3. **Alternatives per top finding.**
   - What: two or three options with effort and trade-off. For example: "Move the call to action above the fold (S)" against "Split the page into two sections (M)".
   - Fallback: rule-based options for each `rule` when there is no AI key (`decidedBy: 'rule'`, the pattern already used).
4. **Suggested copy.** Rewrite drafts for the Sections linked to top findings, produced in one batch. Each still needs approval (`rewrite.ts` overlap check kept).
5. **Structure alternative.** A proposed page tree from `hierarchy.ts`, with orphan and deep pages flagged.
6. **Roadmap link.** Each improvement maps to a Roadmap row.

**Constraints:**

- Every AI statement cites a finding ID or a Section ID, gives no score, and states only what was seen (ADR 0018). `findClaimWords` already exists.
- No browser actions on the site beyond the existing GET-only crawl; no forms are sent.
- Output is in the language chosen at start, and is exportable in `bundle` as static HTML.
- AI calls use the user's key and count against the AI Request Budget, with an estimate shown before starting.

**Fit:**

- A new `audit/improve/` module that reuses the preview's prompt, sanitizer and template.
- A route `POST /api/audits/:id/improve`.
- A top-level **Improved version** tab next to Results and Documents (the Share tab returns to sharing only).

**V1 (S/M):**

- Move the preview to its own tab, visible on every audit screen and with an AI-key reason line when disabled.
- Add before and after for the homepage.
- Add rule-based alternatives for the top 5 findings.
- Success criteria:
  - In a task test, users can find the improved version without help in 9 of 10 attempts.
  - Every change marker resolves to a finding ID.

**V2 (M):** improved pages for each Layout Group; batched copy suggestions; export in the bundle.

**V3 (L):** structure alternative; competitor comparison (audit a second public site and compare Page Content structure; read-only, in the spirit of Safe Interaction Mode).

## 6. Performance plan

| #   | Change                                                                                                                                                     | Expected effect [I]                                                         | Trade-off and accuracy risk                                                                    | Measure                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| P1  | Move Sample Page lab work (axe, throttled reload, phone screenshot) from the crawl worker to its own queue of 2                                            | Crawl slots stay free, so the crawl gets faster when there are many samples | More memory. No accuracy risk if the throttling stays the same                                 | Crawl wall time; pages per minute             |
| P2  | Skip the browser reload for pages PageSpeed Insights will measure (first 20)                                                                               | Up to 20 fewer throttled reloads                                            | Browser timing is lost as a cross-check; keep it when PSI fails                                | Lab-stage time; % of pages with a speed value |
| P3  | Overlap post-crawl stages: start `assessPages` as each page is recorded (a streaming queue), and run PSI alongside it                                      | The AI stage mostly hides behind the crawl                                  | `assessSite` still has to wait for the last page                                               | Total minus crawl time                        |
| P4  | Send several small pages in one `assessPages` call, with adaptive AI concurrency up to the provider's reported limit (`ai-budget.ts` already reads limits) | Fewer calls and less waiting                                                | Bigger prompts: risk of mixed-up page citations; check every finding cites the right `urlPath` | AI calls per page; citation errors            |
| P5  | Adaptive fetch concurrency: start at 3 and raise to 5 while there are no 429s or slowdowns (the pacer already falls back)                                  | 1.3 to 1.6× faster crawl on sturdy hosts                                    | Politeness (ADR 0043) and bot blocks; keep robots Crawl-delay                                  | 429 rate; crawl time                          |
| P6  | Check-up test workers: N isolated contexts (default 2 hosted, 4 local) over test points                                                                    | Close to N× faster                                                          | Shared-state tests on the same account may interfere; keep a role's journeys on one worker     | Run time; flaky rate against baseline         |
| P7  | Retries 3 → 1 (as the guide says); record video only on retry                                                                                              | Up to 2 fewer attempts per failure, plus less video encoding                | Fewer flaky tests recovered                                                                    | Flaky Passed count; run time                  |
| P8  | Incremental re-run: skip unchanged pages (ETag, Last-Modified or content hash) and reuse their findings and AI notes                                       | Re-runs mostly cost changed pages only                                      | Stale results if dynamic content changes without the hash changing                             | Re-run time; finding diff                     |
| P9  | One shared Chromium for PDF export                                                                                                                         | Bundle export no longer pays a browser launch per PDF                       | Little                                                                                         | Export time                                   |

**Benchmark method:**

- **Sites:** 3 real public sites the owner controls or is allowed to crawl, at about 50, about 300 and about 1000 pages. This follows `docs/TESTING.md`, which uses no fixture sites.
- **Baseline:** `b23682c`, 3 runs per site, median.
- **Metrics:**
  - wall time per stage. Stage timestamps should be added to `stages` if they are not stored.
  - pages recorded and skipped, with the reason
  - AI calls and tokens
  - 429 count
  - peak RSS
- **Accuracy guard:** the set of `(rule, urlPath)` findings, and the problem keys, must overlap the baseline by at least 0.95 (Jaccard).
- **Targets:**
  - Website Audit total time −40% at 300 pages.
  - Check-up −50% with 2 workers.
  - No rise in 429s.

## 7. Prioritized roadmap

| When  | Item                                                                                  | Effort | Success measure                                                      |
| ----- | ------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| Now   | O1: set `AUDIT_OWNER_EMAILS`                                                          | S      | The owner runs an audit on the hosted copy                           |
| Now   | Live count = report count (`countSummary`, labelled steps)                            | S      | Parity unit test passes; the final live count equals `verdict.total` |
| Now   | Sitemap seed up to `maxPages`; skipped sitemap URLs listed                            | S      | `recorded + skipped == sitemap URLs`                                 |
| Now   | Preview on its own "Improved version" tab                                             | S      | The tab is visible on all audit screens                              |
| Now   | O2 (do not stop on a rejection), O8 (redaction logging), O5 and O6 guide fixes        | S      | Tests and docs updated                                               |
| Next  | P1, P2, P3 (audit pipeline)                                                           | M      | −40% audit time on the 300-page site                                 |
| Next  | P6, P7 (Check-up workers, retries)                                                    | M      | −50% Check-up time; flaky rate within ±2 points                      |
| Next  | Always-on CPU or Cloud Run Job for audits; checkpoint and resume                      | M      | An audit survives closing the tab and a restart                      |
| Next  | Enhanced version V1                                                                   | M      | Section 5 criteria                                                   |
| Next  | O3 (W20 everywhere)                                                                   | M      | 0 disabled buttons without a reason                                  |
| Later | Template-first sampling and per-section coverage; paged results; raise the hosted cap | L      | A 5000-URL site gives full coverage accounting in 60 min or less     |
| Later | Enhanced version V2 and V3; P8 incremental re-runs                                    | L      | Re-run time ≤ 30% of a first run                                     |

## 8. Risks, assumptions and open questions

**Assumptions:**

- The owner's complaints come from real runs on recent `main`. If they used an older build, some causes may differ.
- The speed figures are estimates; only the benchmark settles them.

**Risks:**

- Higher concurrency against third-party sites can trigger blocks (ADR 0042 Interstitial).
- 2 GiB on one instance limits the hosted copy before page count does. [I]
- AI batching can mix up citations, so it needs the citation check.

**Questions for the owner:**

1. Where did problems 2 to 4 happen: Check-up or Website Audit, hosted or local? This decides whether O1 alone explains "Website Audit does not work".
2. Which number did you compare: "Found so far" against the report headline, or Saved audits "N findings" against the Findings document?
3. Can the hosted runner use always-on CPU (higher cost), or should audits move to Cloud Run Jobs? This bears on the $0-hosting goal.
4. For the enhanced version, is the homepage plus one page per template enough, or do you expect every page?
5. Retries: should a failed test be retried once, as the guide says, or 3 times, as the code does?

## Safety Filter and Domain Allowlist (T-397, 2026-11-19)

Read-only review. Paths are relative to `packages/core/src`. The failing test for each gap is written in its ticket (T-421 to T-428), not here. The Benchmark code outside `competitive/safe-crawler.ts` was not reviewed.

### A. Sensitive Action

- **A1. The check is a text match made while the Plan is built.** `discovery/safety-filter.ts:12` `isSensitive` is called from `plan/ai-planner.ts:298`, `plan/spec-plan.ts:459`, the Spider and `live-site.ts:130`.
  - The Check-up run never calls it: `orchestrator.ts:920-928` runs `locator.click()` straight from the Plan.
  - `sendGuard` (`send-guard.ts:46`) is passive: "never routes or blocks anything".
  - Nothing pauses a click at run time.
- **A2. The run-time protection is `blockChanges`** (`live-site.ts:95`), which aborts POST, PUT, PATCH and DELETE. It applies only when the run is read-only (`orchestrator.ts:774`; `discovery-agent.ts:487, 634`). On a Test Copy nothing blocks.
- **A3. Other paths.**
  - `form.submit` and `requestSubmit` are neutralised only in `competitive/safe-crawler.ts:116-119`.
  - The Spider's exploring click (`discovery/deterministic-spider.ts:1385`) is not under `guardPage`.
  - `guardPage` (`discovery/guard.ts:31`) is used only in `interactive-states.ts:60` and `crud-facts.ts:102`. It is page-level, so popups are not covered.
  - The delete probe tests the constant `isSensitive('Delete', '')` (`deterministic-spider.ts:1446-1452`), not the element's own label.

### B. Domain Allowlist (`headerHosts`, `browser.ts:18`)

- It is checked by `onSiteAddress` (`same-site.ts:19`; `orchestrator.ts:785, 979`: the start page and navigate steps) and by `hostAllowed` (`browser.ts:196-213`), which only decides where secret headers go and blocks nothing.
- The Spider uses `isSameSiteOrLoopback` (`deterministic-spider.ts:425`).
  - An off-site page after `goto` is recorded as `off-site-redirect` (`:1089-1108`), but only after it has loaded.
  - After a click, an off-site page is only not enqueued (`:1392`).
  - There is no popup handling. Subresources and iframes are unfiltered.
- `competitive/safe-crawler.ts:187-223` is the strongest: it aborts changing requests and off-host navigation. It uses `page.route`, so popups are not covered.

### Gaps and tickets

| Ticket | Priority | Gap                                                                                |
| ------ | -------- | ---------------------------------------------------------------------------------- |
| T-421  | P1       | A click-time Sensitive Action gate in the Check-up run                             |
| T-422  | P1       | `form.submit`, `requestSubmit` and Enter protection in Test runs                   |
| T-423  | P2       | The Spider's exploring click under `guardPage`                                     |
| T-424  | P1       | A host allowlist on subrequests, iframes and redirects in the Spider and Test runs |
| T-425  | P2       | Popups covered by context-level routes                                             |
| T-426  | P2       | An off-site click navigation is undone and recorded                                |
| T-427  | P2       | GET side effects (`/logout?confirm`, `/delete?id=1`)                               |
| T-428  | P2       | The delete probe uses the real element label and `forbiddenActions`                |
