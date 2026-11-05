# Website Audit reliability plan: an audit that reads the real site, in parallel, and says what went wrong

Written 2026-11-05 from `main` at `a6017fa`. **Reworked the same day against `main` at `5bef5e9`**, after:
- the wizard redesign (#56, [ADR 0041](../adr/0041-two-area-navigation.md));
- the tunnel fix (`feaa7f9`, with its formatting fix in #57);
- local addresses (#58).

Planning only. Decisions: [ADR 0042](../adr/0042-website-audit-reliability-and-access.md) (reliability and access) and [ADR 0043](../adr/0043-parallel-page-fetching-in-the-website-audit.md) (parallel fetch). Terms: [`CONTEXT.md`](../../CONTEXT.md), including **Interstitial Page**.

## Why audits looked broken

The Website Audit never crashed. It finished `done` with wrong or empty content and hid the cause. The status column says what `main` does now.

| # | Finding | Evidence (main at `5bef5e9`) | Sev | Status |
|---|---|---|---|---|
| A1 | A dev-tunnel audit recorded Microsoft's tunnel warning page as the whole site: 1 page, 0 links | the owner's saved audits; `core/src/audit/crawl/interstitial.ts` | blocker | **fixed** in `feaa7f9`: 19 of 24 pages now |
| A2 | Local and LAN addresses were refused, which pushed the owner to a tunnel | `ERR_PRIVATE_ADDRESS`; `runner/src/server.ts` `AuditWiring.localRun` | blocker | **fixed** in #58: a local runner audits `localhost` |
| A3 | Every AI step fails and the reason is thrown away. The OpenRouter key answered `401 API key expired`; the UI says "The AI did not answer"; the preview answers 502 | `core/src/audit/ai/assessment.ts:234`, `ai/page-recommendation.ts:257`, `audit/preview/generate.ts:97`; `pipeline.ts:307-322` notes only a missing key | major | open: T-81, T-84 |
| A4 | Speed is never measured: the keyless PageSpeed Insights quota answers 429 | `core/src/audit/ai/pagespeed.ts` | major | open: T-82 |
| A5 | Crawl failures share one generic message and are not logged | `runner/src/routes/audit-crawl.ts:318` (`AUDIT_CRAWL_FAILED`); the blocked start page has its own sentence but borrows `ERR_INVALID_REQUEST` | major | **partly fixed**: T-79, T-80, T-85 |
| A6 | A home page answering 4xx or 5xx, including bot-blocking sites, is refused before a browser tries | `core/src/audit/crawl/reachability.ts:102` | major | open: T-80 |
| A7 | Fetching is serial (one request per host, 500 ms gap), AI notes run one at a time, and the defaults are 200 pages and depth 8 | `core/src/host-pacer.ts`; `discovery/deterministic-spider.ts:352`; `ai/assessment.ts:84`; `types/src/discovery.ts:26-29` | major | **partly fixed**: audit page limit 30 s, crawl limit 60 min (`feaa7f9`); parallel work in T-79, T-80, T-81 |
| A8 | The hosted copy closes every audit row, and the redesign also hides Website Audits from its navigation | `.github/workflows/deploy.yml:160` (`RUNNER_BETA=1`); `runner/src/routes/route.ts:181`; `wizard/src/components/AreaNav.tsx:52-55`, `TopBar.tsx:121` | major (hosted) | open: T-86 |
| A9 | A runner restart leaves a version `running`; the stream then answers 404 and the wizard hangs | `runner/src/session/audit-run.ts:83` (in memory, last 20 runs) | minor | open: T-85 |
| A10 | Progress shows a stepper and three counts, with no per-page view; the stream replays only the last event | `wizard/src/screens/audit/start/AuditProgress.tsx:40-50, 86-130`; `types/src/website-audit.ts:955` | minor | open: T-79, T-85, T-87 |
| A11 | Audit Documents are built only on export, so nothing is "ready" when the audit ends | `core/src/audit/documents/generate.ts:101` | minor | open: T-83, T-84, T-88 |
| A12 | No automated test covers the real crawl-to-documents path (ADR 0040) | `docs/TESTING.md` | minor | open: T-89 |
| A13 | A short outage of the host (a dev server or tunnel dropping) fails every remaining page within about 100 ms; one run lost 13 of 21 pages | the spider retries a network error at once (`core/src/navigate.ts:205-208`) | major | open: T-80 |
| A14 | A runner bound to an IPv6 address (`RUNNER_HOST=::1`) answers every request with 500 `Invalid URL` | `runner/src/server.ts:1035` builds `http://${host}:${port}` without brackets | minor | open: T-90 |

**Owner actions, outside the code:**
- Renew the OpenRouter key in Audit settings (A3).
- Optionally, add a free PageSpeed Insights key (A4); T-82 removes the need for it.
- For the fullest results, audit a production build: a dev server behind a tunnel loads the same page in anywhere from 0.65 s to 24 s.

## The target flow

1. **Start.** The person gives a website address and presses Start. The redesign's collapsed **"Limits (optional)"** panel holds:
   - max pages (50) and max depth (5);
   - include and exclude paths;
   - the estimate "about N AI requests".
2. **Check address.**
   - Private addresses are allowed on a local runner (done).
   - A 4xx or 5xx home page goes to the browser before any refusal.
   - An Interstitial Page fails the audit with "This site blocks automated visitors".
   - The AI pre-flight shows "AI: ready", "AI: key expired" or "AI: no key".
3. **Find and check pages.**
   - Up to 3 pages are open at once, dropping to 1 on a Crawl-delay or a 429/503.
   - A failing page is retried once, after a wait.
   - A short outage pauses the crawl instead of failing every remaining page.
   - Each page appears in the live page list: queued, loading, recorded, retrying, or skipped with its reason.
4. **Measure speed** on the Sample Pages: PageSpeed Insights when it answers, otherwise lab timing in the audit's own browser, labelled as such.
5. **AI notes** on every recorded page, 4 at a time. With no working key, the reason is stated and template text is used.
6. **Write documents.** The 5 Audit Documents, the Pitch Glimpse and the Owner Audit are written in parallel in Markdown and HTML, then stored.
7. **Ready.** The redesigned results workspace opens with:
   - the notes banner: AI, speed, "only 1 page read", "the site stopped answering";
   - the summary with "Fix first";
   - a new "Audit Documents ready" section;
   - then the existing sections, with Skipped Pages grouped by reason.

A failed page never stops the audit. A failed AI step or document is listed with its reason. A failed crawl ends with a specific code and a log line.

## Waves and parallel safety

Each ticket lists the files it may change. Two tickets in the same wave never share a file. Builders work in separate worktrees, commit only their own paths, and never run `git stash`, `reset` or `checkout` on shared work. Run `pnpm build` after touching `packages/types`, and run the ticket's tests and `pnpm format:check` before marking it `built`.

| Wave | Tickets | Why this order |
|---|---|---|
| 1 | T-79 | Every other ticket compiles against the new contract |
| 2 | T-80, T-81, T-82, T-83, T-87, T-88, T-90 | Core modules, wizard screens and the runner's IPv6 bug, against the contract only |
| 3 | T-84, T-85 | Wire the core modules into the pipeline and the runner |
| 4 | T-86, T-89 | Hosted access (shares `server.ts` with T-85); end-to-end checks |

---

## T-79: Website Audit contract

Findings: A3, A5, A7, A9, A10, A11, A13. Priority P0, size M, wave 1, depends on nothing.

**Files:** `packages/types/src/website-audit.ts`, `packages/types/src/browser.ts`, `packages/types/tests/website-audit.test.ts`, and any test that pins the old 200 and 8 defaults (`grep -rn "200 pages\|defaultPages\|8 links deep" packages/*/tests`), for the default values only.

**Scope:**
- `AuditStage` adds `'writing-documents'`, between `'ranking'` and `'saving'`.
- `AuditProgressEvent` adds:
  - `{ type: 'page'; auditId; version; path; state: 'queued' | 'loading' | 'recorded' | 'retrying' | 'skipped'; reason?: SkippedReason; ai?: 'waiting' | 'done' | 'not-done' }`. Paths are redacted, as `currentPath` is.
  - `{ type: 'status'; auditId; version; ai: AuditAiStatus; speed: 'pagespeed-insights' | 'this-tool' | 'not-measured' }`.
  - `{ type: 'snapshot'; auditId; version; stage; counts; pages: AuditPageState[]; ai?; speed? }`, sent first on every stream connect.
- `AuditAiStatus`: `'ready' | 'no-key' | 'key-expired' | 'quota' | 'timeout' | 'provider-error'`.
- `AUDIT_ERROR_CODES` adds `ERR_SITE_BLOCKED`, `ERR_DNS`, `ERR_BROWSER_LAUNCH` and `ERR_PIPELINE`, each with a status comment.
- The `ERR_RUN_IN_PROGRESS` reply carries `running: { kind: 'checkup' | 'audit'; href: string }`.
- Speed `source` adds `'this-tool'`.
- `AuditVersion` adds `stoppedReason?: 'tool-restarted' | 'stopped-by-user'` and `documents?: StoredAuditDocument[]`.
- Result notes add `ai-status`, `only-one-page`, `speed-source` and `site-stopped-answering`.
- `AUDIT_LIMIT_DEFAULTS = { pages: 50, depth: 5, hostedMaxPages: 200, fetchInFlight: 3, aiInFlight: 4 }`. `validateAuditStartBody` fills a Website Audit's defaults from it. `CRAWL_LIMIT_BOUNDS` and the Check-up are untouched.

**Tests:** the new union members; codes are unique; `validateAuditStartBody` defaults are 50 and 5. Run `pnpm build`.

---

## T-80: The crawl: specific errors, 3 pages at a time, rides out an outage

Findings: A5, A6, A7, A13. Priority P0, size L, wave 2, depends on T-79. ADR 0042, ADR 0043.

Already on `main`, so not part of this ticket:
- the tunnel skip headers;
- the Interstitial Page check of the start page (`interstitial.ts`);
- private addresses on a local runner;
- the 30 s page limit and the 60 min crawl limit;
- the test seams `deps.launchBrowser` and `deps.browserManager`.

**Files:** `packages/core/src/audit/crawl/crawl.ts`, `crawl/reachability.ts`, `crawl/interstitial.ts`, `packages/core/src/host-pacer.ts`, `packages/core/src/discovery/deterministic-spider.ts`, `packages/core/src/navigate.ts`, and their tests under `packages/core/tests/`:
- `audit-reachability`, `audit-interstitial`;
- `host-pacer.test.ts`;
- the new `navigate-retry.test.ts` and `audit-crawl-retry.test.ts`.

**Scope:**
- **Home page answering 4xx or 5xx:** `checkAuditAddress` no longer refuses it. The crawl's real-browser load of the start page decides:
  - an Interstitial Page fails with `ERR_SITE_BLOCKED`;
  - a page that still answers 4xx or 5xx in the browser fails with `ERR_UNREACHABLE`, and the message carries the status.
- **Typed errors:**
  - `AuditCrawlBlockedError` carries `ERR_SITE_BLOCKED`;
  - a DNS failure is `ERR_DNS`;
  - a failed `chromium.launch` is `ERR_BROWSER_LAUNCH`;
  - `classifyInterstitial` also names an empty body (`'empty'`).
- **`HostPacer` `maxInFlight`:** default 1; the audit passes 3. It falls back to 1 on a robots Crawl-delay or a 429/503, and honours `Retry-After` (cap 60 s). A repeat 429 or 503 doubles the gap (cap 10 s). The 500 ms gap between starts stays.
- **Retries:**
  - one retry for a timeout, a 5xx or a network error;
  - a network error waits 5 s first, through a new `navigate` option `retryDelayMs` whose default stays 0.
  - After the retry, the page is a Skipped Page: `timeout`, `http-error` or `did-not-load`. Its status code or wait time is kept for T-84.
- **Outage:**
  - after 3 network failures in a row, pause fetching and check the start address every 10 s for up to 60 s;
  - carry on when it answers, and re-queue the failed pages once;
  - otherwise finish with what was read, and report `stoppedAnsweringAfter` (pages read) in the crawl result.
- **Progress:** per-page progress uses the existing `onProgress` callback, as `page` events in T-79's shape.

**Tests (unit):**
- the pacer: in-flight cap, Crawl-delay fallback, `Retry-After`, the default of 1 unchanged;
- reachability: 403 passes to the crawl, and DNS failure gives `ERR_DNS`;
- the retry and outage logic, with a fake loader and a fake clock;
- `navigate` with `retryDelayMs`.

**Risk:** `host-pacer.ts`, `deterministic-spider.ts` and `navigate.ts` are shared with the Check-up. Every new option defaults to today's behaviour.

---

## T-81: AI notes on every page, in parallel, with the real reason

Findings: A3, A7. Priority P0, size M, wave 2, depends on T-79. ADR 0042.

**Files:** `packages/core/src/audit/ai/assessment.ts`, `ai/page-recommendation.ts`, `ai/stage-ai.ts`, `ai/preflight.ts` (new), `ai/index.ts`, `packages/core/src/audit/preview/generate.ts`, `preview/template.ts` (new), and tests under `packages/core/tests/`: `audit-assessment`, `audit-ai-flow`, the preview test, and the new `audit-ai-preflight.test.ts`.

**Scope:**
- **`classifyAiError(err) → AuditAiStatus`:**
  - 401 and 403 are `key-expired`; 429 is `quota`; an abort or timeout is `timeout`; anything else is `provider-error`.
  - The provider message is kept, redacted and trimmed to 200 characters.
  - It replaces the bare "failed" at `assessment.ts:234` and `page-recommendation.ts:257`.
- **Every page, in parallel:** the assessment takes any list of pages and runs them through a pool (`aiInFlight`, default 4) with an injectable limiter. A per-page callback reports `ai: 'done' | 'not-done'`. The site-wide note runs once, after the pages.
- **`preflightAuditAi(resolve)`:** one minimal request, then `AuditAiStatus`. No key gives `no-key`, without a request.
- **Preview:** `preview/template.ts` is filled from findings and Page Content, with 0018 wording, and is used when AI is not ready or fails. AI rewrites the template when it works. No more 502 for an AI failure (`generate.ts:97`).

**Tests:** classification of 401, 403, 429, abort and 500; never more than 4 requests in flight; the pre-flight paths; the preview falls back to template text.

---

## T-82: Speed without a PageSpeed key

Findings: A4. Priority P1, size M, wave 2, depends on T-79. ADR 0042 (amends 0035).

**Files:** `packages/core/src/audit/speed/browser-timing.ts` (new), `packages/core/src/audit/ai/pagespeed.ts`, `packages/core/src/audit/pipeline/page-recorder.ts`, and tests under `packages/core/tests/`: the pagespeed test and the new `audit-browser-timing.test.ts`.

**Scope:**
- `browser-timing.ts` measures the Sample Pages in the audit's Chromium with the Check-up's lab profile (`LAB_THROTTLING` and the helpers in `packages/checkers/src/performance.ts`). It collects LCP, CLS, FCP, TTFB and load time, labelled `source: 'this-tool'`, `method: 'lab'`, one run.
- `page-recorder.ts` takes the timing while the Sample Page is open, with one throttled reload of that page only.
- `pagespeed.ts` reports why PageSpeed Insights did not measure (`no-key`, `quota`, `error`), so the pipeline can choose (T-84).

**Tests (unit):** metric shaping from recorded performance entries. The real-browser check is in T-89.

---

## T-83: Audit Documents written when the audit ends

Findings: A11. Priority P1, size M, wave 2, depends on T-79. ADR 0042.

**Files:** `packages/core/src/audit/documents/write-all.ts` (new), `documents/index.ts`, `packages/core/src/audit/store/audit-store.ts`, `store/keys.ts`, and tests under `packages/core/tests/`: the new `audit-doc-write-all.test.ts` and the `audit-store-*` test for the new methods.

**Scope:**
- **`writeAllDocuments(result, settings, store)`:**
  - writes the 5 Audit Documents (`generateAuditDocuments`), the Pitch Glimpse and the Owner Audit;
  - renders Markdown and HTML in parallel (`Promise.allSettled`), in the audit's language;
  - stores each output, and records each failure as `not-written` with a reason.
  - PDF and Word stay on export.
- **The store** gets `saveAuditDocument` and `readAuditDocument`, keyed under the version, on both backends.

**Tests:** all 7 written from `helpers/audit-doc-fixture.ts`; one renderer throwing leaves the rest written; a store round trip on the local backend.

---

## T-87: Start screen and live progress (on the redesigned screens)

Findings: A5 (wording), A8 (tab note), A10. Priority P0, size L, wave 2, depends on T-79.

The redesign (#56) re-skinned these screens:
- `Page`, `PageHeader width="form"`, and the shared `Disclosure` from `src/components/ui`;
- a collapsed "Limits (optional)" panel (`AuditStartScreen.tsx:133-204`);
- a 7-step stepper from `AUDIT_STAGE_LABELS` (`AuditProgress.tsx:13-21, 86-111`);
- three counters (`:113-126`) and a "Reading …" line (`:128-130`);
- the "See the results" link to `PATHS.auditVersion` (`AuditStartScreen.tsx:230-237`).

This ticket builds on all of that and replaces none of it.

**Files:** `packages/wizard/src/screens/audit/start/AuditStartScreen.tsx`, `start/AuditProgress.tsx`, `start/audit-start-api.ts`, `start/audit-start-form.ts`, `start/LivePageList.tsx` (new), `start/AuditStatusChips.tsx` (new), and tests under `packages/wizard/tests/`:
- `audit-start-screen.test.tsx`, whose progress tests are at `:142-220`;
- `audit-start-form.test.ts`;
- the new `audit-progress.test.tsx`.

**Scope:**
- **"Limits (optional)" stays** as the collapsed panel; it is the decision's "More options".
  - Its hint shows the new defaults ("50 pages · 5 links deep").
  - It adds "This audit will make about N AI requests", where N is the pages + 1.
- **The stepper gains** "Write documents" (`writing-documents`) and a final "Ready" step, still from `AUDIT_STAGE_LABELS`.
- **`LivePageList`** sits under the counters:
  - one row per page, with its state, the Skipped Page reason in plain words, and the AI state;
  - elapsed time;
  - a Stop button that calls the shared `POST /api/runner/stop` (`runner/src/server.ts`, which aborts the `AuditRun`).
- **`AuditStatusChips`:**
  - "AI: ready", "AI: key expired: update in Audit settings", or "AI: no key: template text";
  - "Speed: PageSpeed Insights", "Speed: measured by this tool", or "Speed: not measured".
- **`applyAuditEvent`** (`AuditProgress.tsx:40-50`) handles `snapshot`, `page` and `status`, so the list rebuilds on every reconnect.
- "Keep this tab open until the audit finishes" shows while the audit runs.
- **Refusal texts** in `audit-start-api.ts:24-29`:
  - `ERR_SITE_BLOCKED`, `ERR_DNS`, `ERR_BROWSER_LAUNCH` and `ERR_PIPELINE`;
  - `ERR_RUN_IN_PROGRESS` gets "A Check-up / Website Audit is running" with a link to it.
- The wording keeps the redesign's banned-word test (`audit-start-screen.test.tsx:222`).

**Tests:**
- the panel hint and the estimate;
- the reducer, from a scripted sequence (snapshot, page, status, done) to rows, counters and chips;
- each new code's text;
- the busy link;
- the Stop call.

---

## T-88: Results landing (on the redesigned workspace)

Findings: A3, A4, A11 (shown). Priority P1, size M, wave 2, depends on T-79.

The redesign made the results a sectioned workspace: `Page width="workspace"`, `AuditTabs` (Results, Documents, Download, Versions, Share, Helpers), and a section index (`RESULT_SECTIONS`, `AnalysisScreen.tsx:341-352`). It already has:
- `NotesBanner` (`AuditSummary.tsx:61-84`);
- `AuditSummary`, with a "Fix first" list (`fixFirst`, `analysis-text.ts`);
- an inline flat `SkippedPages` (`AnalysisScreen.tsx:131-160`, `SKIP_REASON_TEXT` at `:32-47`).

This ticket extends those parts.

**Files:** `packages/wizard/src/screens/audit/results/AnalysisScreen.tsx`, `results/AuditSummary.tsx`, `results/analysis-text.ts`, `results/analysis-client.ts`, `results/DocumentsReady.tsx` (new), `results/SkippedPagesView.tsx` (new), and tests under `packages/wizard/tests/`: `audit-analysis-screen`, `audit-analysis-summary`, `audit-analysis-views`, and the new `audit-documents-ready.test.tsx`.

**Scope:**
- **`NotesBanner`** shows:
  - the AI status with its reason, linking to Audit settings for any AI reason (not only the `/AI key/` match at `:64`);
  - the speed source;
  - "Only 1 page was read";
  - "The site stopped answering after N pages".
- **"Fix first"** remains the top-findings list; there is no separate top-5 block. The summary stays "not a grade for the website" (ADR 0033).
- **"Audit Documents ready" (`DocumentsReady.tsx`):**
  - a new entry in `RESULT_SECTIONS`, placed after the summary;
  - each of the 7 documents with its state;
  - "Open" goes to `PATHS.auditReview`;
  - "Download all" goes to the existing Download tab's bundle export (`ExportDocumentsScreen.tsx`);
  - a `not-written` document shows its reason.
- **`SkippedPagesView.tsx`:** the inline `SkippedPages` moves here and is grouped by reason. Site-caused pages link to their finding.

**Tests:** a fixture result with and without AI, with a not-written document, and with grouped Skipped Pages; the section index lists the new section; no ADR 0018 words.

---

## T-90: A runner bound to an IPv6 address

Findings: A14. Priority P2, size S, wave 2, depends on nothing.

**Files:** `packages/runner/src/server.ts`, `packages/runner/src/cli.ts`, `packages/runner/tests/cli-bind-host.test.ts`.

**Scope:** wherever the runner builds a URL from its bind host (`server.ts:1035` request parsing, the listen URL, and the "Open … in your browser" line), an IPv6 host is written in brackets: `http://[::1]:3124`.

**Tests:** a request to a runner bound to `::1` parses; the printed URL is bracketed.

---

## T-84: Pipeline wiring

Findings: A3, A4, A7, A11, A13, plus Skipped Page findings. Priority P0, size M, wave 3, depends on T-79, T-80, T-81, T-82, T-83.

**Files:** `packages/core/src/audit/pipeline/pipeline.ts`, `pipeline/index.ts`, `pipeline/skipped-findings.ts` (new), and tests under `packages/core/tests/`: `audit-pipeline`, `audit-analyse-site`, and the new `audit-skipped-findings.test.ts`.

**Scope:**
- **AI:** every recorded page goes to the T-81 pool, with per-page `ai` progress. The `ai-status` note records the status and its reason (today only a missing key is noted, `pipeline.ts:307-322`).
- **Speed:** when PSI did not measure, use the T-82 timing. Add a `speed-source` note.
- **`skipped-findings.ts`:** site-caused Skipped Pages (`http-error` with its status, `timeout` with its wait) become findings in 0018 wording. Tool-caused ones stay "not checked".
- **Notes:**
  - `only-one-page`, when 1 page was recorded but more same-site links or sitemap entries were seen;
  - `site-stopped-answering`, from T-80's `stoppedAnsweringAfter`.
- **New `writing-documents` stage:** calls `writeAllDocuments` (T-83) after ranking and before saving. A document failure never fails the pipeline. Only a save failure throws, with the code `ERR_PIPELINE`.

**Tests:** the pipeline with fake stages: every page goes to AI; the speed fallback is chosen; Skipped Page findings; both notes; documents written; a document failure still ends `done`.

---

## T-85: Runner: specific errors, logs, recovery

Findings: A5, A9, A10, A11. Priority P0, size M, wave 3, depends on T-79, T-80, T-81, T-83. Local addresses are already on `main` (#58), so they are not part of this ticket.

**Files:** `packages/runner/src/routes/audit-crawl.ts`, `routes/audit-rerun.ts`, `routes/audit-export.ts`, `session/audit-run.ts`, `session/run-slot.ts`, `packages/runner/src/audit-log.ts` (new), `packages/runner/src/server.ts`, and tests under `packages/runner/tests/`: `audit-crawl-route`, `audit-documents-flow`, and the new `audit-run-recovery.test.ts`. Also `docs/API.md`.

**Scope:**
- **Before the crawl:** `preflightAuditAi` sends a `status` event.
- **Errors:**
  - the crawl error codes map 1:1 to replies and `failed` events;
  - `AuditCrawlBlockedError` moves from `ERR_INVALID_REQUEST` to `ERR_SITE_BLOCKED` (`audit-crawl.ts:~312`);
  - `AUDIT_CRAWL_FAILED` stays only for truly unknown failures.
- **`audit-log.ts`:** one structured line per failure (code, stage, message, redacted address) to stderr, which Cloud Logging collects.
- **`AuditRuns`:**
  - keeps a page-state map per run;
  - the stream sends `snapshot` first on connect;
  - a run no longer in memory answers its stored version's status as one event and ends, instead of a 404.
- **On start-up** (`server.ts`, next to `createAuditStore`): versions still `running` become `stopped` with `stoppedReason: 'tool-restarted'`.
- **Busy:** `ERR_RUN_IN_PROGRESS` names the running kind and its href.
- **Export:** stored Markdown and HTML (T-83) are served when present; otherwise they are generated as today.
- `docs/API.md` describes the new events and codes.

**Tests:** each error code end to end; the snapshot on connect; the stored status for an unknown run; recovery; the busy reply.

---

## T-86: Hosted audits for the signed-in owner

Findings: A8. Priority P1, size M, wave 4, depends on T-85 (shares `server.ts`). Status after build: `human` (one GitHub variable to set).

**Files:**
- runner: `packages/runner/src/routes/route.ts`, `packages/runner/src/helpers/helper-access.ts`, `helpers/helper-session.ts`, `packages/runner/src/server.ts` (owner on beta; `auditOwner` in `/api/runner/status`);
- wizard: `packages/wizard/src/screens/audit/BetaAuditNotice.tsx`, `packages/wizard/src/App.tsx`, `packages/wizard/src/components/AreaNav.tsx`, `packages/wizard/src/components/TopBar.tsx`;
- deploy: `.github/workflows/deploy.yml`, `docs/CONFIGURATION.md`, `docs/DEPLOYMENT.md`;
- tests: `packages/runner/tests/adr-0037-0015.test.ts`, `route-access.test.ts`, `helper-access.test.ts`, and `packages/wizard/tests/audit-nav.test.tsx`.

**Scope:**
- **Owner on a beta copy:** whoever holds the access key, or a Google sign-in (the existing Helper sign-in) whose email is in `AUDIT_OWNER_EMAILS`. Such a caller passes `owner` audit rows on the beta copy. Everyone else is refused as today.
- **`AUDIT_DAILY_LIMIT`:** audit starts per owner email per UTC day. Unset means unlimited. Reaching it answers `ERR_BETA_LIMIT`.
- **Wizard:**
  - `/api/runner/status` gains `auditOwner`;
  - `showsBetaAuditNotice` (`BetaAuditNotice.tsx:38-41`) and the beta-hidden Website Audits area (`TopBar.tsx:121`, `AreaNav.tsx:52-68`, the `beta` props in `App.tsx`) show the area to an owner;
  - the notice gets a "Sign in with Google" action that reuses `HelperSignInScreen` and `firebase-sign-in.ts`.
- **`deploy.yml`:** passes `AUDIT_OWNER_EMAILS` from a GitHub variable. CPU stays request-based.

**Tests:** an allow-listed email is allowed and another is refused; Helper grants are unchanged; the limit; the notice and the area are shown or hidden.

**Human step:** set the repository variable `AUDIT_OWNER_EMAILS` to the owner's Google email, then deploy.

---

## T-89: Proving the audit works

Findings: A12. Priority P1, size M, wave 4, depends on T-84, T-85, T-87, T-88.

**Files:** `packages/core/tests/audit-crawl-browser.test.ts` (new), `packages/runner/tests/audit-flow-browser.test.ts` (new), `vitest.workspace.ts` (add both to the browser list), `scripts/smoke-audit.mjs` (new), root `package.json` (the `smoke:audit` script), `docs/TESTING.md`.

**Scope:**
- **Browser tier** (ADR 0040: `context.route().fulfill()` pages only), through the existing `deps.browserManager` and `deps.launchBrowser` seams:
  - a 12-page site is recorded in full, with at most 3 pages in flight;
  - a robots Crawl-delay drops it to 1 in flight;
  - a 503-then-200 page is retried and recorded;
  - a 500 page becomes a Skipped Page and a finding;
  - a run of network failures pauses the crawl, which then resumes;
  - a challenge page that never clears gives `ERR_SITE_BLOCKED`;
  - the runner flow from start to stored documents.
- **`pnpm smoke:audit <url> [--pages N]`:** starts an audit on a running runner, then prints:
  - each stage with its time;
  - pages recorded, and pages skipped by reason;
  - the AI status, the speed source, and the documents written.
  It exits non-zero on `failed`, or on `done` with an `only-one-page` note.
- **`docs/TESTING.md`**, "Website Audit by hand":
  - `example.com`;
  - `htmx.org` (`--pages 10`);
  - a Vite dev server on `localhost`, which listens on `::1` only;
  - a dev tunnel;
  - a bot-protected site, expected to give the blocked message;
  - with and without a working AI key;
  - the hosted copy, signed in.

**Tests:** both browser files pass under `pnpm test:browser`; `pnpm test` stays browser-free.
