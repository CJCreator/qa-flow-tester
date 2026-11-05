# Website Audit reliability plan: an audit that reads the real site, in parallel, and says what went wrong

Written 2026-11-05 from `main` at `a6017fa`, after a grilling session with the owner and a live diagnosis. Planning only: no code changed. Decisions: [ADR 0041](../adr/0041-parallel-page-fetching-in-the-website-audit.md) (parallel fetch) and [ADR 0042](../adr/0042-website-audit-reliability-and-access.md) (reliability and access). Terms: [`CONTEXT.md`](../../CONTEXT.md), including the new **Interstitial Page**.

## Why audits look broken

The Website Audit does not crash. Every route, screen and document format works on `example.com` and `htmx.org`: start 202, stream through all 7 stages, the 5 Audit Documents plus the Pitch Glimpse and Owner Audit in md, html, pdf, docx and zip, in English and Tamil, with no console errors. It still produces wrong or empty results, and it hides why:

| # | Finding | Evidence | Sev |
|---|---|---|---|
| A1 | A dev-tunnel audit records Microsoft's tunnel warning page as the whole site: 1 page, 0 links, findings about the warning page | the owner's two saved audits of `*.devtunnels.ms`; `core/src/audit/crawl/crawl.ts:271-277` sends no `X-Tunnel-Skip-AntiPhishing-Page`; `core/src/browser.ts:88-94` (the Check-up) does | blocker |
| A2 | Local and LAN addresses are refused, which pushes the owner to a tunnel | `ERR_PRIVATE_ADDRESS`, `core/src/audit/crawl/reachability.ts:95`; ADR 0033 Q-22 | blocker |
| A3 | Every AI step fails and the reason is thrown away. The keychain OpenRouter key answers `401 API key expired`; the UI says only "The AI did not answer"; the preview answers 502 | `core/src/audit/ai/assessment.ts:234-236`, `ai/page-recommendation.ts:257-259`, `audit/preview/generate.ts:97-99`; `pipeline.ts:493` notes only a missing key | major |
| A4 | Speed is never measured: the keyless PageSpeed Insights quota answers 429 | every page `speed.lab/field.reason: 'quota'`; `core/src/audit/ai/pagespeed.ts` | major |
| A5 | Any crawl exception becomes `ERR_UNREACHABLE` ("could not be read to the end"); nothing is logged | `runner/src/routes/audit-crawl.ts:289-312`; no logger in `audit-crawl.ts`, `audit-rerun.ts`, `pipeline.ts`, `crawl.ts` | major |
| A6 | A home page answering 4xx or 5xx, including bot-blocking sites, is refused before a browser tries | `core/src/audit/crawl/reachability.ts` (`safeGet`, 10 s) | major |
| A7 | Fetching is serial: one request per host, 500 ms gap; AI notes run one at a time; defaults are 200 pages and depth 8 | `core/src/host-pacer.ts`; `discovery/deterministic-spider.ts:350`; `ai/assessment.ts:84`; `types/src/discovery.ts:23` | major |
| A8 | The hosted copy closes every audit row (`RUNNER_BETA=1`); `BetaAuditNotice` replaces the screens | `.github/workflows/deploy.yml:160`; `runner/src/routes/route.ts:181`; ADR 0037 D-004 | major (hosted) |
| A9 | A runner restart leaves a version `running`; the stream then answers 404 and the wizard hangs on "Reconnecting…" | `runner/src/session/audit-run.ts` (in-memory, last 20 runs) | minor |
| A10 | The progress screen shows only a stage and counts, with no per-page view; the stream replays only the last event | `wizard/src/screens/audit/start/AuditProgress.tsx`; `AuditProgressEvent`, `types/src/website-audit.ts:955` | minor |
| A11 | Audit Documents are built only on export, so nothing is "ready" when the audit ends | `core/src/audit/documents/generate.ts:101`; `runner/src/routes/audit-export.ts` | minor |
| A12 | No automated test covers the real crawl to documents path (ADR 0040) | `docs/TESTING.md` | minor |

**Owner actions, outside the code:** renew the OpenRouter key in Website Audit settings (A3). Optionally add a free PageSpeed Insights API key (A4); T-82 removes the need for it.

## The target flow

1. **Start.** The person gives a website address and presses Start. "More options" (collapsed) holds max pages (50), max depth (5), include and exclude paths, and an estimate: "about N AI requests".
2. **Check address.** Private addresses are allowed on a local runner. On a 4xx or 5xx home page, the tool tries a real browser before refusing. An Interstitial Page is retried with skip headers, and if it is still in the way the audit fails with "This site blocks automated visitors". The AI pre-flight shows "AI: ready", "AI: key expired" or "AI: no key".
3. **Find and check pages.** Up to 3 pages are open at once. The tool drops to one at a time on a Crawl-delay or a 429/503, and retries a failing page once. Each page appears in the live page list: queued, loading, recorded, retrying, or skipped with its reason.
4. **Measure speed** on the Sample Pages: PageSpeed Insights when it answers, otherwise lab timing in the audit's own browser, labelled as such.
5. **AI notes** on every recorded page, 4 at a time. With no working key, the notes are not done, the reason is stated, and template text is used.
6. **Write documents.** All 5 Audit Documents, the Pitch Glimpse and the Owner Audit are written in parallel in Markdown and HTML and stored.
7. **Ready.** The results open with:
   - a plain-language summary: what was checked and what was not, area grades and counts, with no site-wide pass or fail (ADR 0033);
   - notes on AI, speed and "only 1 page read";
   - the top findings;
   - "Audit Documents ready" (open each, or download all as a zip);
   - the Skipped Pages.

Failures along the way: a failed page never stops the audit. A failed AI step or document is listed with its reason. A failed crawl ends with a specific code and a log line.

## Waves and parallel safety

Each ticket lists the files it may change. Two tickets in the same wave never share a file. Builders run in separate worktrees, commit only their own paths, and never run `git stash`, `reset` or `checkout` on shared work. Run `pnpm build` after touching `packages/types`, and run the ticket's tests before marking it `built` (`.claude/work/DEFER_TESTS` is absent).

| Wave | Tickets | Why this order |
|---|---|---|
| 1 | T-79 | Every other ticket compiles against the new contract |
| 2 | T-80, T-81, T-82, T-83, T-87, T-88 | Core modules and wizard screens, against the contract only |
| 3 | T-84, T-85 | Wire the core modules into the pipeline and the runner |
| 4 | T-86, T-89 | Hosted access (shares `server.ts` with T-85); end-to-end verification |

---

## T-79: Website Audit contract

Findings: A3, A5, A7, A9, A10, A11. Priority P0, size M, wave 1, depends on nothing.

**Files:** `packages/types/src/website-audit.ts`, `packages/types/src/browser.ts`, `packages/types/tests/website-audit.test.ts`.

**Scope:**
- `AuditStage` adds `'writing-documents'`, between `'ranking'` and `'saving'`.
- `AuditProgressEvent` adds:
  - `{ type: 'page'; auditId; version; path; state: 'queued' | 'loading' | 'recorded' | 'retrying' | 'skipped'; reason?: SkippedReason; ai?: 'waiting' | 'done' | 'not-done' }`. Paths are redacted, as `currentPath` is.
  - `{ type: 'status'; auditId; version; ai: AuditAiStatus; speed: 'pagespeed-insights' | 'this-tool' | 'not-measured' }`.
  - `{ type: 'snapshot'; auditId; version; stage; counts; pages: AuditPageState[]; ai?; speed? }`, sent first on every stream connect.
- `AuditAiStatus`: `'ready' | 'no-key' | 'key-expired' | 'quota' | 'timeout' | 'provider-error'`. The reason type for a not-done assessment uses the same failure values.
- `AUDIT_ERROR_CODES` adds `ERR_SITE_BLOCKED`, `ERR_DNS`, `ERR_BROWSER_LAUNCH` and `ERR_PIPELINE`, each with a status comment as the existing ones have.
- The `ERR_RUN_IN_PROGRESS` reply carries `running: { kind: 'checkup' | 'audit'; href: string }`.
- Speed `source` adds `'this-tool'`.
- `AuditVersion` adds `stoppedReason?: 'tool-restarted' | 'stopped-by-user'` and `documents?: StoredAuditDocument[]` (kind, language, format, `written` or `not-written` with reason).
- Result notes add the kinds `ai-status`, `only-one-page` and `speed-source`.
- `AUDIT_LIMIT_DEFAULTS = { pages: 50, depth: 5, hostedMaxPages: 200, fetchInFlight: 3, aiInFlight: 4 }`. `CRAWL_LIMIT_BOUNDS` is untouched, so the Check-up does not change.

**Tests:** the contract test covers the new union members, the codes being unique, and the defaults lying within `CRAWL_LIMIT_BOUNDS`. Run `pnpm build`.

---

## T-80: The crawl reads the real site, 3 pages at a time

Findings: A1, A2, A5, A6, A7. Priority P0, size L, wave 2, depends on T-79. ADR 0041, ADR 0042.

**Files:** `packages/core/src/audit/crawl/crawl.ts`, `crawl/reachability.ts`, `crawl/interstitial.ts` (new), `crawl/index.ts`, `packages/core/src/host-pacer.ts`, `packages/core/src/discovery/deterministic-spider.ts`, `packages/core/src/safe-net.ts` (only if the private-address option the Check-up uses does not reach the audit path), and their tests under `packages/core/tests/` (`audit-reachability`, `audit-crawl-limits`, the host-pacer test, and the new `audit-interstitial.test.ts`).

**Scope:**
- The audit's Chromium context always sends `X-Tunnel-Skip-AntiPhishing-Page: true` and `ngrok-skip-browser-warning: 1`.
- `interstitial.ts` is a pure classifier, `(status, title, bodyText, url) → null | 'tunnel-warning' | 'bot-challenge' | 'empty'`, using known markers: devtunnels, ngrok, Cloudflare-style "checking your browser", `cf-chl`, and an empty body. When the start page is an Interstitial Page, one retry in the real browser follows. Still interstitial means the crawl throws `ERR_SITE_BLOCKED`.
- `reachability.ts`: a 4xx or 5xx home page triggers a real-browser load, and only a failed load refuses. DNS failure is `ERR_DNS`.
- `allowPrivateAddresses` option (default false) on `checkAuditAddress` and `runAuditCrawl`. The runner sets it (T-85). It must cover the address check, `pinSiteHosts` and the `--host-resolver-rules` pinning.
- Typed errors: an `AuditCrawlError` with a code (`ERR_SITE_BLOCKED`, `ERR_DNS`, `ERR_BROWSER_LAUNCH` when `chromium.launch` fails, `ERR_UNREACHABLE`), so the runner stops guessing.
- `HostPacer` gets `maxInFlight` (default 1; the audit passes 3). It falls back to 1 on a robots Crawl-delay or a 429/503. It honours `Retry-After` (cap 60 s), and a repeat 429/503 doubles the gap (cap 10 s). The 500 ms gap between starts stays.
- The spider retries a page once on a timeout, a 5xx or a network error, then records a Skipped Page `timeout`, `http-error` or `did-not-load`, keeping the status code or wait time for T-84.
- Per-page progress goes through the existing progress callback as `page` events (T-79 shape): queued when the frontier takes the page, then loading, then recorded, retrying or skipped.
- Audit defaults come from `AUDIT_LIMIT_DEFAULTS`.
- A test seam: `runAuditCrawl` accepts an injected browser or context factory, so T-89 can serve pages with `context.route()`.

**Tests (unit tier):**
- the interstitial classifier on stored HTML strings: the devtunnels page text from A1, an ngrok page, a challenge page, a normal page;
- the pacer: in-flight cap, Crawl-delay fallback, `Retry-After`, the default of 1 unchanged;
- reachability with a fake fetch: 403 then browser OK, DNS failure, private address allowed only with the option;
- the retry-once logic with a fake loader.

**Risk:** `host-pacer.ts`, `deterministic-spider.ts` and `safe-net.ts` are shared with the Check-up. Every new option defaults to today's behaviour.

---

## T-81: AI notes on every page, in parallel, with the real reason

Findings: A3, A7. Priority P0, size M, wave 2, depends on T-79. ADR 0042.

**Files:** `packages/core/src/audit/ai/assessment.ts`, `ai/page-recommendation.ts`, `ai/stage-ai.ts`, `ai/preflight.ts` (new), `ai/index.ts`, `packages/core/src/audit/preview/generate.ts`, `preview/template.ts` (new), and tests under `packages/core/tests/`: `audit-assessment`, `audit-ai-flow`, the preview test, and the new `audit-ai-preflight.test.ts`.

**Scope:**
- `classifyAiError(err) → AuditAiStatus`: 401/403 is `key-expired`, 429 is `quota`, an abort or timeout is `timeout`, anything else is `provider-error`. The provider message is kept, redacted and trimmed to 200 characters. `assessment.ts` and `page-recommendation.ts` record the class and message instead of a bare "failed".
- The assessment takes any list of pages (no more Sample Pages only) and runs them through a pool, `aiInFlight` (default 4), with an injectable limiter. A per-page callback reports `ai: 'done' | 'not-done'` for the progress events. The site-wide note runs once, after the pages.
- `preflightAuditAi(resolve)`: one minimal request through the resolved provider, then `AuditAiStatus`. No key gives `no-key`, without a request.
- The preview uses `preview/template.ts` (filled from findings and Page Content, with 0018 wording) when AI is not ready or fails. AI rewrites the template when it works. No 502 for an AI failure.

**Tests:** error classification for 401, 403, 429, abort and 500; the pool never exceeds 4 in flight (a fake provider counts); the pre-flight paths; the preview falls back to template text when the fake provider throws.

---

## T-82: Speed without a PageSpeed key

Findings: A4. Priority P1, size M, wave 2, depends on T-79. ADR 0042 (amends 0035).

**Files:** `packages/core/src/audit/speed/browser-timing.ts` (new), `packages/core/src/audit/ai/pagespeed.ts`, `packages/core/src/audit/pipeline/page-recorder.ts`, and tests under `packages/core/tests/`: the pagespeed test and the new `audit-browser-timing.test.ts`.

**Scope:**
- `browser-timing.ts` measures the Sample Pages in the audit's Chromium with the Check-up's lab profile (`LAB_THROTTLING` and the CLS/median helpers in `packages/checkers/src/performance.ts`). It collects LCP, CLS, FCP, TTFB and load time. Values carry `source: 'this-tool'`, `method: 'lab'` and one run.
- `page-recorder.ts` takes the timing while the Sample Page is open in its pacer turn, and adds one throttled reload of that page only.
- `pagespeed.ts` reports why PageSpeed Insights did not measure (`no-key`, `quota`, `error`), so the pipeline can choose (T-84). PSI stays first when it answers.

**Tests (unit):** metric shaping from recorded performance entries. A real-browser check goes to the browser tier in T-89.

---

## T-83: Audit Documents written when the audit ends

Findings: A11. Priority P1, size M, wave 2, depends on T-79. ADR 0042.

**Files:** `packages/core/src/audit/documents/write-all.ts` (new), `documents/index.ts`, `packages/core/src/audit/store/audit-store.ts`, `store/keys.ts`, and tests under `packages/core/tests/`: the new `audit-doc-write-all.test.ts` and the `audit-store-*` test for the new methods.

**Scope:**
- `writeAllDocuments(result, settings, store)`: the 5 Audit Documents (`generateAuditDocuments`), the Pitch Glimpse and the Owner Audit, rendered to Markdown and HTML in parallel (`Promise.allSettled`), in the audit's language. Each output is stored, and each failure is recorded as `not-written` with a reason. PDF and Word stay on export.
- The store gets `saveAuditDocument(auditId, version, doc)` and `readAuditDocument(...)`, with keys under the version, on both the local and the GCS backends through the existing backend interface.

**Tests:** all 7 written with a fixture result (`helpers/audit-doc-fixture.ts`); one renderer throwing leaves the others written and records `not-written`; a store round trip on the local backend.

---

## T-87: Start screen and live progress

Findings: A10, A5 (wording), A8 (tab note). Priority P0, size L, wave 2, depends on T-79.

**Files:** `packages/wizard/src/screens/audit/start/AuditStartScreen.tsx`, `start/AuditProgress.tsx`, `start/audit-start-api.ts`, `start/audit-start-form.ts`, `start/LivePageList.tsx` (new), `start/AuditStatusChips.tsx` (new), and tests under `packages/wizard/tests/`: `audit-start-screen`, `audit-start-form`, and the new `audit-progress.test.tsx`.

**Scope:**
- The form is one website address field plus Start. "More options" (collapsed) holds max pages (default 50), max depth (5), include and exclude paths, and "This audit will make about N AI requests" (recorded pages + 1).
- A stepper with Check address, Find pages, Check pages, Measure speed, AI notes, Write documents and Ready, mapped from `AuditStage`.
- `LivePageList`: one row per page with its state, the Skipped Page reason in plain words, and the AI state. Counters (found, recorded, skipped), elapsed time, and a Stop button that calls the shared `POST /api/runner/stop` (`runner/src/server.ts:1542`; confirm it aborts the audit's `AuditRun` controller, `session/audit-run.ts:78`).
- `AuditStatusChips`: "AI: ready / key expired: update in Website Audit settings / no key: template text", and "Speed: PageSpeed Insights / measured by this tool / not measured".
- The page list is rebuilt from the `snapshot` event on every (re)connect. "Keep this tab open until the audit finishes" stays visible while it runs.
- Refusal texts for `ERR_SITE_BLOCKED`, `ERR_DNS`, `ERR_BROWSER_LAUNCH` and `ERR_PIPELINE`. `ERR_RUN_IN_PROGRESS` shows "A Check-up / Website Audit is running" with a link to it.
- Wording follows `CONTEXT.md`: Website Audit, Skipped Page and Interstitial Page; never "scan" or "run".

**Tests:** the form defaults and the collapsed options; the reducer from a scripted event sequence (snapshot, page events, status, done) to rows, counters and chips; each new error code's text; the busy link.

---

## T-88: Results landing

Findings: A3, A4, A11 (shown). Priority P1, size M, wave 2, depends on T-79.

**Files:** `packages/wizard/src/screens/audit/results/AnalysisScreen.tsx`, `results/AuditSummary.tsx`, `results/analysis-client.ts`, `results/analysis-text.ts`, `results/DocumentsReady.tsx` (new), `results/SkippedPagesView.tsx` (new), and tests under `packages/wizard/tests/`: `audit-analysis-*` and the new `audit-documents-ready.test.tsx`.

**Scope:**
- **Top:** a plain-language summary of what was checked and what was not, area grades and counts. No site-wide pass or fail, and no "Ready to release" (ADR 0033, 0018).
- **Notes banner:** AI status with its reason and a link to settings; the speed source; "Only 1 page was read".
- **Top 5 findings**, linking to the full list.
- **"Audit Documents ready":** each of the 7 with its state. "Open" goes to the review screen. "Download all" uses the existing bundle export. A `not-written` document shows its reason.
- **Skipped Pages,** grouped by reason. Site-caused ones link to their finding.

**Tests:** rendering with a fixture result: with and without AI, with a not-written document, with Skipped Pages; no ADR 0018 word appears.

---

## T-84: Pipeline wiring

Findings: A3, A4, A7, A11, plus Skipped Page findings. Priority P0, size M, wave 3, depends on T-79, T-81, T-82, T-83.

**Files:** `packages/core/src/audit/pipeline/pipeline.ts`, `pipeline/index.ts`, `pipeline/skipped-findings.ts` (new), and tests under `packages/core/tests/`: `audit-pipeline`, `audit-analyse-site`, and the new `audit-skipped-findings.test.ts`.

**Scope:**
- **AI:** the assessment gets every recorded page (T-81 pool). Per-page `ai` progress is passed out. The note records the AI status and reason; today a note exists only when there is no key (`pipeline.ts:493`).
- **Speed:** when PSI reports not measured, use the T-82 timing for that Sample Page. Add a `speed-source` note.
- **`skipped-findings.ts`:** site-caused Skipped Pages (`http-error` with its status, `timeout` with its wait) become findings with 0018 wording. Tool-caused ones stay "not checked".
- **`only-one-page` note** when 1 page was recorded and the crawl saw more same-site links or sitemap entries.
- **New `writing-documents` stage** calls `writeAllDocuments` (T-83) after ranking and before saving. Document failures never fail the pipeline.
- Stage failures stay "not done". Only a save failure throws, now with the code `ERR_PIPELINE`.

**Tests:** the pipeline with fake stages: every page goes to AI; the speed fallback is chosen; Skipped Page findings appear; the `only-one-page` note; documents written; a document failure still ends `done`.

---

## T-85: Runner: specific errors, logs, recovery, local addresses

Findings: A2, A5, A9, A10, A11. Priority P0, size M, wave 3, depends on T-79, T-80, T-81, T-83.

**Files:** `packages/runner/src/routes/audit-crawl.ts`, `routes/audit-rerun.ts`, `routes/audit-export.ts`, `session/audit-run.ts`, `session/run-slot.ts`, `packages/runner/src/audit-log.ts` (new), `packages/runner/src/server.ts`, and tests under `packages/runner/tests/`: `audit-crawl-route`, `audit-documents-flow`, and the new `audit-run-recovery.test.ts`. Also `docs/API.md`.

**Scope:**
- **Before the crawl:** `preflightAuditAi` sends a `status` event. `allowPrivateAddresses = !beta && the runner is bound to a loopback host`, passed to T-80's options.
- **Errors:** `AuditCrawlError` codes map 1:1 to replies and `failed` events, with no more `ERR_UNREACHABLE` for everything. `audit-log.ts` writes one structured line per failure (code, stage, message, redacted address) to stderr, which Cloud Logging collects.
- **`AuditRuns`:** keeps a page-state map per run. The stream sends `snapshot` first on connect. For a run that is no longer in memory, it answers the stored version's status as one event and ends, instead of a 404.
- **On start-up** (`server.ts`, next to `createAuditStore`): versions still `running` become `stopped` with `stoppedReason: 'tool-restarted'`.
- **Busy:** `ERR_RUN_IN_PROGRESS` names the running kind and its href (from `run-slot.ts`).
- **Export:** stored Markdown and HTML (T-83) are served when present; otherwise they are generated as today.
- `docs/API.md` describes the new events and codes.

**Tests:** the route with fake crawl and pipeline: each error code end to end; the snapshot on connect; a stored status for an unknown run; recovery marks running as stopped; private allowed only when local; the busy reply.

---

## T-86: Hosted audits for the signed-in owner

Findings: A8. Priority P1, size M, wave 4, depends on T-85 (shares `server.ts`). Status after build: `human` (set the GitHub variable).

**Files:** `packages/runner/src/routes/route.ts`, `packages/runner/src/helpers/helper-access.ts`, `helpers/helper-session.ts`, `packages/runner/src/server.ts`, `packages/wizard/src/screens/audit/BetaAuditNotice.tsx`, `packages/wizard/src/App.tsx`, `.github/workflows/deploy.yml`, `docs/CONFIGURATION.md`, `docs/DEPLOYMENT.md`, and tests: `packages/runner/tests/adr-0037-0015*`, the route-access test, and the wizard beta-notice test.

**Scope:**
- **Owner on a beta copy:** whoever holds the access key, or a Google sign-in (the existing Helper sign-in) whose email is in `AUDIT_OWNER_EMAILS` (comma-separated). Such a caller passes `owner` audit rows on the beta copy. Everyone else is refused as today.
- **`AUDIT_DAILY_LIMIT`:** audit starts per owner email per UTC day. Unset means unlimited. Reaching the limit answers `ERR_BETA_LIMIT`.
- **Wizard:** `BetaAuditNotice` shows only to callers who are not owners, with a "Sign in with Google" action. The owner gets the normal screens.
- **`deploy.yml`:** passes `AUDIT_OWNER_EMAILS` from a GitHub variable. CPU stays request-based.

**Tests:** authorization: allow-listed email allowed, other email refused, Helper grants unchanged, limit reached; the wizard notice shown or hidden.

**Human step:** set the repository variable `AUDIT_OWNER_EMAILS` to the owner's Google email, then deploy.

---

## T-89: Proving the audit works

Findings: A12. Priority P1, size M, wave 4, depends on T-84, T-85, T-87, T-88.

**Files:** `packages/core/tests/audit-crawl-browser.test.ts` (new), `packages/runner/tests/audit-flow-browser.test.ts` (new), `vitest.workspace.ts` (add both to the browser list), `scripts/smoke-audit.mjs` (new), root `package.json` (`smoke:audit` script), `docs/TESTING.md`.

**Scope:**
- **Browser tier** (ADR 0040: `context.route().fulfill()` pages only, no fabricated server):
  - a 12-page site through the injected context: the crawl records all of them, at most 3 in flight;
  - robots Crawl-delay drops to 1 in flight;
  - a 503-then-200 page is retried and recorded;
  - a 500 page becomes a Skipped Page `http-error` and a finding;
  - a devtunnels warning page as the start page leads to the skip-header retry, then the real page;
  - a challenge page that never clears gives `ERR_SITE_BLOCKED`;
  - the runner flow from start through the stream (snapshot, page events, done) to the stored documents.
- **`pnpm smoke:audit <url> [--pages N]`:** starts a run against a running runner and prints each stage with its time, pages recorded and skipped by reason, AI status, speed source and documents written. It exits non-zero on `failed`, or on `done` with an `only-one-page` note.
- **`docs/TESTING.md`:** a "Website Audit by hand" checklist:
  - `example.com`
  - `htmx.org` (`--pages 10`)
  - a local dev server on `localhost`
  - a dev tunnel
  - a bot-protected site, expected to give the blocked message
  - with and without a working AI key
  - the hosted copy signed in

**Tests:** the two browser files pass under `pnpm test:browser`. `pnpm test` stays browser-free.
