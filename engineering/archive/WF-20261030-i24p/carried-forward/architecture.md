# Architecture

> Maintained by AI-EOS (architecture-analyst). Describes the system **as built**, then recommendations.
> Recommendations that change architecture are proposals until approved and recorded in `decisions.md`.
> Task ARCHAN-001 (2026-10-30). Scope: the parts of the system that REQ-001 to REQ-045 (`engineering/requirements.md`,
> sourced from `Requirements.txt` FR-1 to FR-33) would touch. Built from code; docs and ADRs are used only for intent
> and are cited where they disagree with code.

## Context

QA Flow Tester ("Release check-up") is a self-hosted pnpm/TypeScript monorepo. One Node process (the runner) serves the
React wizard and an HTTP + SSE API on one port, crawls an App with Playwright, has an AI Planner write the Plan, waits for
Plan Review, runs the Plan, grades findings deterministically and writes reports (`docs/ARCHITECTURE.md:20-34`).

- Users today: teams without QA staff checking their own Apps (`docs/PRD.md:15`).
- Requested addition: audit public third-party websites, produce documents and a "pitch glimpse", track outreach
  (requirements.md "Business objective"). Positioning is open question Q-01.
- External systems: AI Providers (Anthropic, OpenAI, Gemini, OpenRouter; `packages/core/src/ai/ai-provider.ts:40-58`),
  the audited site, the OS keychain (`packages/core/src/ai/key-resolver.ts:23-40`), Google Cloud Run (hosted copy,
  `.github/workflows/deploy.yml:127-131`), GitHub Actions (CI route, ADR 0012).
- Not used today: any external page-speed or search-data API (no call found; speed is a test-browser measurement,
  `packages/checkers/src/performance.ts:131,385`), any database, any identity provider.

## Components and module boundaries

| Component | Responsibility | Owns data | Interfaces | Evidence |
|---|---|---|---|---|
| `@qa/types` | Shared types and pure logic: `Finding`, `ReleaseReport`, Plan types, `releaseVerdict`, check-up API shapes, fingerprints. No Node built-ins anywhere in `src/` today. | None (schemas only) | Barrel `index.ts`; browser-safe entry `browser.ts` for the wizard | `packages/types/src/index.ts`, `packages/types/src/browser.ts:1-17`, `packages/types/src/checkup-api.ts:24-128`, `packages/types/src/evidence-finding.ts:48-116`, `packages/types/package.json` (no deps) |
| `@qa/checkers` | Deterministic per-page audits. No shared interface: each is a class with `checkPage(page, context): Promise<Finding[]>` (or `check`/`audit`). Cross-page state is only a `siteWide` Set used to report a site problem once. Cannot import `@qa/core`. | None | Classes exported from `index.ts`; `CheckerType` union | `packages/checkers/src/index.ts:1-16`, `seo.ts:50-59,68-70`, `marketing.ts:269-270`, `performance.ts:127-131`, `aeo.ts:27-28`, `packages/types/src/test-case.ts:5-14`; deps in `packages/checkers/package.json` |
| `@qa/core` discovery | Deterministic Spider (crawl, sitemap seeding, robots, pacing, depth, concurrency), Discovery Agent (per role, merge), Safety Filter, preflight reachability | Crawl facts (`PageInventoryItem`, `RouteTelemetry`) | `CrawlOptions`, `SpiderResult` | `packages/core/src/discovery/deterministic-spider.ts:59-123,310-337,404-440`, `discovery-agent.ts:160-161,470-480`, `packages/core/src/preflight.ts:116-182`, `packages/types/src/discovery.ts:63-93` |
| `@qa/core` plan | AI Planner, budget, expansion, Playwright export, zip writer | Plan under construction | `plan/build.ts`, `plan/ai-budget.ts` | `packages/core/src/plan/*`, `ai-budget.ts` (BudgetSpentError, CapSpentError), `plan/zip.ts:1-4` (string-only `ZipEntry`) |
| `@qa/core` orchestrator | Runs each Test with Playwright and calls the checkers on page-level Plan Items | Run results, evidence files | `FlowTestOrchestrator.run(RunOptions)` | `packages/core/src/orchestrator.ts:343-354` (checker instances), `:1125-1162` (performance, SEO per page), `:584` (marketing log) |
| `@qa/core` AI | `AIProvider` adapter (BYOK, ADR 0002), key resolver, visual review (advisory, capped) | Keys via OS keychain or plaintext fallback file | `AIProvider.generateText/complete`, `AIStage` | `packages/core/src/ai/ai-provider.ts:3-58`, `key-resolver.ts:42-75`, `visual-review.ts:63,86-88`, `packages/types/src/ai.ts:10` |
| `@qa/core` judge and report | Scoring (six areas A-F), ranked recommendations with effort and impact, report writers | Report files in the run folder | `scoreToGrade`, `generateRankedRecommendations`, `ReportGenerator.generate`, `html-report.ts` | `packages/core/src/scoring.ts:15-60`, `recommendations.ts:72`, `packages/types/src/aspects.ts:3,61-75`, `packages/core/src/reporter.ts:51-76`, `html-report.ts:37`, `packages/types/src/verdict.ts` |
| `@qa/core` safe public scan and benchmark | Read-only website scan (Safe Interaction Mode) and Competitive Benchmark | Benchmark jobs | `runSafeWebsiteScan`, `SafePublicCrawler.scan` | `packages/core/src/safe-scan.ts:9-31`, `packages/core/src/competitive/safe-crawler.ts:162,167,225-226` |
| `@qa/core` outbound guard | Pinned, redirect-checked GET (`safeGet`), public-address resolution, browser request guard | None | `safeGet`, `resolvePublic`, `makeRequestGuard` | `packages/core/src/safe-net.ts:115,146,228`; only caller of `safeGet` outside the module: `discovery/docs-fetch.ts:38` |
| `@qa/runner` transport | `node:http` server: gate order (health, Host allowlist, Origin, access key, beta session/closed routes/scope), route table for Plan routes, `if` chain for the rest, static wizard | Access token, beta sessions (memory) | HTTP + SSE (`docs/API.md`) | `packages/runner/src/server.ts:845-922` (gates), `:933-1204` (chain), `packages/runner/src/routes/index.ts:9` (only `planRoutes`), `packages/runner/src/beta.ts:1-30,250-262` |
| `@qa/runner` Check-up Session | Run slot, Plan under review, report, events, run secrets; run start branches (`safe-public` vs product) | Run folders, site memory, history | `session/checkup-session.ts`, `CheckupRun.start` | `packages/runner/src/session/checkup-run.ts:76-90,603-626`, `report-store.ts:7,34,44,65,86,94-95` |
| `@qa/runner` other | AI settings (provider, one text and one vision model), benchmarks store, scheduler, CI entry `checkup.ts` | `.qa-ai-models.json` (path only inspected, not contents), benchmark JSON files | `AiSettings` | `packages/runner/src/server.ts:295-312,679,2461-2476`, `packages/runner/src/benchmarks.ts` (`KEEP = 10`, `BenchmarkStore`) |
| `@qa/wizard` | Vite + React UI. History-API router; runner client `api.ts`. Always starts `mode: 'product'`. No i18n framework found. | Browser state only | `src/api.ts`, `src/lib/router.ts` | `packages/wizard/src/lib/router.ts:24-34`, `packages/wizard/src/api.ts:397-404`, `packages/wizard/package.json` |
| Hosting | Cloud Run `qa-check-up`: 2 GiB, 1 CPU, min 0, max 1 instance, 3600 s timeout, `RUNNER_BETA=1`, data in `/tmp/qa-data`, access token from Secret Manager | Ephemeral `/tmp` | Deploy workflow, `scripts/deploy-cloud-run.mjs` | `.github/workflows/deploy.yml:127-131`, `scripts/deploy-cloud-run.mjs:62-66`, `packages/runner/Dockerfile` (base `mcr.microsoft.com/playwright:v1.63.0-noble`, no extra fonts installed) |

## Service relationships

```mermaid
flowchart LR
  subgraph Browser
    W[wizard - React/Vite]
  end
  subgraph Runner process
    T[transport server.ts + routes/]
    S[Check-up Session session/]
    B[benchmarks.ts]
  end
  subgraph core[@qa/core]
    D[discovery: spider, agent, preflight, robots]
    P[plan: AI Planner, budget, export, zip]
    O[orchestrator]
    J[scoring, recommendations]
    R[reporter, html-report, issues-document, findings-contract]
    A[ai: AIProvider, key resolver, visual review]
    N[safe-net: safeGet, request guard]
    SS[safe-scan + competitive/safe-crawler]
  end
  C[@qa/checkers]
  TY[@qa/types]
  W -- HTTP + SSE --> T
  W -. imports browser-safe types .-> TY
  T --> S
  T --> B
  S --> D & P & O & SS & R
  B --> SS
  O --> C
  SS --> C
  O --> J --> R
  P --> A
  D --> N
  C --> TY
  core --> TY
  A -- HTTPS --> AIP[(AI Providers)]
  D -- Playwright --> SITE[(Audited site)]
  O -- Playwright --> SITE
  S --> FS[(data dir + output dir: files)]
  KC[(OS keychain)] --- A
```

Layering holds: `checkers` imports only `types` (0 files under `packages/checkers/src` import `@qa/core`), `core`
imports `checkers` and `types`, `runner` imports `core` and `types`, the wizard imports `types` only. No cycle found.
Build order follows it (`docs/ARCHITECTURE.md:18`; root `package.json` `site-build` builds `types` before the wizard).

## API contracts

| Contract | Producer | Consumers | Format / schema | Versioning | Evidence |
|---|---|---|---|---|---|
| `POST /api/runner/run` | runner | wizard, `checkup.ts` | `RunStartBody`: `targetUrl`, `owner`, `mode: 'product' \| 'safe-public'`, `maxPages` (1-1000, default 200), `crawlConcurrency` (1-5), `crawlDelayMs`, `searchChecks`, `visibility`, `aiCap`, `testCap`... No `maxDepth`, include or exclude paths. Reply 202 `{ runId }`; 409 `ERR_PLAN_WAITING`; 429 `ERR_BETA_LIMIT` | Declared once in `@qa/types` (ADR 0027); no version field | `packages/types/src/checkup-api.ts:24-141`, `docs/API.md:41` |
| `GET /api/runner/stream` | runner | wizard | SSE of `OrchestratorEvent` (redacted) | None | `docs/API.md:42`, `packages/core/src/orchestrator.ts:356-362` |
| Plan Review routes (`GET/PATCH /api/runner/plan`, `/approve`, `/replan`, ...) | runner route table | wizard | `PlanPatchBody` | `@qa/types` | `packages/runner/src/routes/plan.ts:1286-1358`, `packages/types/src/checkup-api.ts:143-170` |
| Past check-ups `GET/DELETE /api/runs/<runId>` (+ `/triage`, `/download/<file>`) | runner | wizard | `RunSummary` list; files by name | None | `docs/API.md:103`, `packages/runner/src/server.ts:933-937` |
| `findings.json` | `ReportGenerator` | wizard, CI, coding agents, suppressions | `schemaVersion: 1`, `Finding[]` with `fingerprint`; additive fields are not a bump | ADR 0017 policy | `docs/adr/0017-findings-contract.md`, `packages/core/src/reporter.ts:48-57`, `docs/findings.schema.json` |
| Report files | `ReportGenerator`, `html-report.ts` | people, agents | `report.md`, `report.html`, `fix-these.md`, `known-findings.json`, `AGENTS.snippet.md`, `issues.md`, `issues.html`; HTML hard-codes `<html lang="en">` and system font stacks | Files added freely (ADR 0017) | `packages/core/src/reporter.ts:51-76`, `html-report.ts:330,349`, `issues-html.ts:8,102` |
| `AIProvider` | core | planner, visual review | `generateText(messages, options)`, optional `complete` with usage; `AIStage` = planning, repair, journeys, visual-review, interpret, other | None | `packages/core/src/ai/ai-provider.ts:3-8`, `packages/types/src/ai.ts:10-23` |
| AI settings `/api/ai/*` | runner | wizard | `AiSettings { provider, text, vision, chosenBy }` | None | `packages/runner/src/server.ts:295-302` |
| Benchmark `/api/runner/benchmark(s)` | runner | wizard Benchmark screen | `BenchmarkJob` JSON per file, last 10 kept | None | `packages/runner/src/benchmarks.ts`, `docs/API.md` "Benchmarks and schedules" |

## Data model

- **Storage is files only.** No database, no migrations framework.
  - Run folders: `<RUNNER_OUTPUT_DIR>/runs/<runId>/` with `report.json`, `summary.json` and report files; Past check-ups
    lists them with `readdir`; 10 runs kept per site host (`packages/runner/src/session/report-store.ts:7,34,48-59,65,86,94-95`).
  - Site memory: `<RUNNER_DATA_DIR>/sites/<host>.json` (`SiteMemory`, `schemaVersion` 0/1; owner flag, remembered sign-in
    names, pages, approved Plan) (`packages/core/src/site-memory.ts:61-101`).
  - Site history: `<host>.history.json`, every run appended (`packages/core/src/site-history.ts:26,105`).
  - Benchmarks: one JSON per job, 10 kept (`packages/runner/src/benchmarks.ts`).
- **Keys:** OS keychain; plaintext `.qa-keys.json` (mode 0600) only when no keychain exists; beta keeps keys in process
  memory per visitor session (`key-resolver.ts:61-75`, `beta.ts:1-30,250-262`).
- **Ownership and tenancy:** data is keyed by site host, not by person. The only per-person scoping is the beta visitor
  session (cookie, 24 h, at most 50 sessions, in memory) and in-memory run ownership (`beta.ts` `SESSION_HOURS`,
  `MAX_SESSIONS`; `server.ts:1280-1310` `betaScope`). There are no accounts.
- **Hosted copy:** `/tmp/qa-data` on one Cloud Run instance, wiped on redeploy and scale-to-zero (ADR 0032; deploy.yml:128-130).
- **Page facts captured today** (`PageInventoryItem`): path, title, interactive elements (with `landmark`
  header/nav/footer), links, forms count, layout group, small screenshot, content key. Not captured: body text, heading
  outline, images and alt, meta description, sections, language, CMS (`packages/types/src/discovery.ts:63-93`). Those are
  read inside checkers at run time and surface only as findings.
- **Report model:** `ReleaseReport` carries `scanMode` (`full | read-only | safe-public`), `pages`, `siteMap`, `grades`,
  `marketing`, `recommendations`, `aiUsage`, `notChecked` (`packages/types/src/run-report.ts:96-158`).

## Cross-cutting concerns

| Concern | Current approach | Evidence | Gap for these requirements |
|---|---|---|---|
| Authentication | Loopback-only Host by default; on a non-loopback host a single shared access key (`?access=` then HttpOnly cookie); beta visitor cookie sessions | `server.ts:800-827,845-872`, ADR 0012 amendment 2026-10-17 | No user identity. REQ-033 (helpers) and any per-person saved Apps on the hosted copy need sign-in to the tool itself. |
| Authorization | Beta scope: a visitor sees only their own run and plan; some writes closed in beta | `server.ts:902-922,1280-1346` | No per-App access control (REQ-033). |
| Validation | Run body checked in session (`checkAiCap`, `checkCrawlDelayMs`); docx and context limits; PATCH validates values | `checkup-run.ts:834`, `docs/API.md:38` | New inputs (depth, include/exclude, language, document choice) need the same treatment. |
| Safety boundary | Read-only unless Test Copy plus owner (ADR 0030, 0014, 0022); Safety Filter; `RISKY_TO_CLICK`; Safe Interaction Mode for public scans | `checkup-run.ts:76-83`, `deterministic-spider.ts:125-130`, ADR 0007, ADR 0030 | Audits of third-party sites must stay read-only by construction. REQ-030 rewrites must never act on a live site. |
| Outbound requests | ADR 0031 says every page-derived request goes through `safeGet`. Code: only `docs-fetch.ts` does. Spider fetches `robots.txt` `Sitemap:` lines and sitemaps with Playwright's request API and no host check before the fetch; SEO broken-link check does HEAD then GET via Playwright's request API; `SecurityDepthChecker` falls back to `defaultFetch(page)` when no fetch function is passed; the source-grep test ADR 0031 names does not exist | `deterministic-spider.ts:409,428`, `seo.ts:547-557`, `security-depth.ts:43-54,146`, `safe-net.ts:146`, `docs/adr/0031-...md` (added in docs commit `dcba888` with no code) | Contradiction between an accepted ADR and code, on the exact path an "audit any public URL" feature exercises. See R-01. |
| Pacing (politeness) | Crawl: 2000 ms between page loads on non-private hosts, 100 ms default otherwise, shared across up to 2 workers; robots.txt honoured for public hosts with token `QA-Benchmarking-Bot`; `Crawl-delay` not parsed; unreachable robots.txt means allow all; robots fetched with plain `fetch` | `discovery-agent.ts:160-161,470-480`, `deterministic-spider.ts:310-311,479-483`, `competitive/robots.ts:48-55` | Run phase has no inter-request pacing (sequential Tests, 3 throttled repeat loads per page for speed, up to 5 link fetches per page). ADR 0015 (pacing) is Deferred. |
| Claim wording | ADR 0018; verdict via one function (ADR 0029); AI findings advisory | `packages/types/src/verdict.ts`, `visual-review.ts:86-88`, `aspects.ts:3` (area label "Secure", known gap) | Pitch and owner documents are persuasive by nature (REQ-019, REQ-025). |
| Redaction | `Redactor` over events and run files | `orchestrator.ts:358-361`, `checkup-run.ts:577` | Extracted page text and NAP contact details (REQ-009, REQ-015) are new personal-data classes in reports. |
| Logging / audit | `console` logs; Route Telemetry per crawled route; AI token use per stage | `CONTEXT.md:187-189`, `ai-budget.ts:105,278` | No audit trail of who did what (needed only if accounts arrive). |
| Configuration | Env vars (`RUNNER_*`, `QA_*`), saved defaults, site memory | `docs/CONFIGURATION.md` (not read in this task), deploy.yml:130 | New external API keys need a place in the BYOK resolver, not env-only. |
| i18n | English-only UI and reports; `lang="en"` hard-coded; system fonts | `html-report.ts:330,349`, `issues-html.ts:102`; no i18n library in `packages/wizard/package.json` | REQ-013, REQ-019, REQ-022, REQ-025, REQ-044 need language on documents and fonts that render Tamil. |

## Scalability and performance

- **One run slot per runner** (`docs/ARCHITECTURE.md:55`), and the hosted runner is one instance (`--max-instances 1`).
  An audit would share the slot with Check-ups and benchmarks.
- **Hot paths:** crawl (Playwright, 2 workers), run phase (one browser per Test, page-level checkers), throttled speed
  loads (3 per page at phone width, `orchestrator.ts:1137-1141`), AI planning (about 8-12 requests for a 30-page site,
  ADR 0009 Consequences) plus visual review (up to 20 calls, `server.ts:312`).
- **Unbounded or growing work the requirements add:** per-page AI assessment in six areas plus a site-wide one
  (REQ-016) is at least one request per page; full text and sections per page (REQ-008, REQ-009) enlarge `report.json`,
  SSE payloads and the 2 GiB container's memory; external API calls per page (REQ-012) multiply by page count.
- **Report size:** `report.json` is written whole (`report-store.ts:65`); no streaming or pagination of pages.

## Where each requirement group would land

Legend: **types** = `@qa/types` shape (browser-safe if the wizard needs it), **checker** = `@qa/checkers` class,
**core** = `@qa/core` module, **route** = runner route-table row (ADR 0027 pattern), **screen** = wizard screen or panel.

| Group | REQs | Exists today | Would land in | ADRs that constrain or need a new decision |
|---|---|---|---|---|
| Input and crawl limits | 001, 002 | Reachability check with `start-4xx` (`preflight.ts:116-182`); `maxPages` 1-1000 in API; spider has `maxDepth` (default 8) but the API does not expose it; no include or exclude | types (`RunStartBody` fields), core (spider frontier filter, new Skipped Page reason such as `excluded`), screen (new check-up form) | CONTEXT.md Skipped Page list (add a reason). Q-22 public-only rule must not remove Test Copy addresses on a local run. |
| Crawl, sitemap, robots, pacing, sign-in and payment skip | 003, 004, 005, 006, 034, 035, 036 | JS rendering (Playwright), sitemap and `Sitemap:` seeding, robots for public hosts, Sign-in Wall, pacing defaults | core (spider: `payment` skip reason, `Crawl-delay`, run-phase pacing), types (Skipped Page reason) | **ADR 0015** must be accepted for REQ-035. **ADR 0031** code must exist before third-party auditing on the hosted copy (R-01). ADR 0007 Safe Interaction Mode and 0003 Safety Filter apply. |
| Structure and content extraction | 007, 008, 009, 010, 013, 037 | Links with landmark header/nav/footer; layout groups; phone-width look per Layout Group; `lang` attribute check (`seo.ts:205`) | new core module (page content extractor run in the spider's page evaluation or a read-only pass after it), types (page content, section, link region, language, technology), checker for CMS/framework if rule-based | Additive fields in `ReleaseReport` follow ADR 0017 (additive is not a bump). Glossary: "navigation map" and "sitemap" map to App Flow plus page hierarchy (`CONTEXT.md:31-33`). |
| Content and marketing checks | 014, 015, 038 | Missing title, description, H1, skipped levels, missing alt, OpenGraph, broken links (5 per page), lang; marketing: Twitter card, share image, CTA, contact, privacy, analytics, social links, pricing, reviews, email capture, cookie notice; Organization/LocalBusiness schema (`seo.ts:96-569`, `marketing.ts:73-203`, `aeo.ts:98-110`) | extend existing checkers; **new site-level stage in core** for cross-page duplicates (titles, descriptions, content) because checkers are per page and `siteWide` only de-duplicates reporting; extend `MarketingReview` (`aspects.ts:16-33`) to the ten FR-15 signals including NAP and click-to-call | ADR 0018 wording; ADR 0029 (AI and advisory findings never change grades). |
| External data | 012, 042, 043 | None. `PageSpeedSample` type exists for test-browser speed (`aspects.ts:94-105`) | new core module (external data adapter with its own key in the BYOK resolver), types (source and measurement method on each value) | **New ADR**: a new external system receiving audited URLs; key storage per ADR 0002; ADR 0018 "say how a number was measured"; not page-derived, so ADR 0031 does not cover it. |
| AI assessment, keys, models | 011, 016, 039, 040, 041 | BYOK with four providers; keychain first; two model slots (text, vision); AI Request Budget and cap; advisory AI findings | core (new `AIStage` values such as assessment, documents, rewrite; prompts), runner (`AiSettings` from two slots to a per-stage map), screen (Settings) | **ADR 0002** amendment for REQ-040 (plaintext fallback file) and per-task models. ADR 0009/0011/0029: AI output advisory, never in grades or verdict. REQ-041 checked by a scan of repo, image and bundle. |
| Ranking | 017, 045, 026 | `generateRankedRecommendations` gives effort, impact, quick-win or bigger-change per problem (`recommendations.ts:72`, `aspects.ts:61-75`) | core (extend with section citation once sections exist; per-page redesign or repair; roadmap output) | Glossary: "Plan" is taken (`CONTEXT.md:67-69`); FR-26 needs another name (Q-18). |
| Documents and export | 018, 019, 021, 022, 024, 025, 027 | Markdown and HTML reports, `findings.json` v1, `fix-these.md` and `AGENTS.snippet.md` for coding agents, download route per run, string-only zip writer, Playwright export | new core document module beside `reporter.ts`; PDF by printing the self-contained HTML with the Chromium already in the image (no new dependency); Word needs a dependency or a hand-written OOXML writer (zip writer is string-only today); runner download rows; screen (document picker, language) | ADR 0017 for any change to `findings.json`; ADR 0021 rules for self-contained HTML (no external font, script or link: fonts must be embedded as `data:`); ADR 0018 for pitch and owner wording; ADR 0016 redaction status (no "safe to share" claim). |
| Review and edit before export | 020 | Edits exist only before the run (Plan Review `PATCH /api/runner/plan`); after the run only triage (intended, false positive) | new routes (route table) and a session or report-store operation storing an edit overlay beside `report.json`; screen | ADR 0027 (route table, session owns state not policy). Keeping originals (Q-25) protects fingerprints (ADR 0017). |
| Saved Apps, history, re-run | 028, 023 | Past check-ups (10 per host), site history, "Test again", Waiting Plan; all files; hosted copy ephemeral | local: extend site memory and report store (retention, per-App notes); hosted: needs persistent storage | **ADR 0032** (`/tmp`, one instance) must be amended or superseded for hosted persistence. |
| Hosting | 029 | `pnpm start` locally; Cloud Run hosted beta | nothing new if Q-06 is answered "as today" | ADR 0008, 0012, 0032. |
| Accounts and helpers | 033 | None | new identity layer, per-App authorization, tenant-partitioned storage: a new subsystem | Supersedes the "shared team server" rejection in **ADR 0008** and the in-memory single-instance basis of **ADR 0032** and ADR 0012's "online copy has no accounts". |
| Rewrite | 030 | None | core (AI stage, export-only output) | ADR 0030 and 0007: never on a live site. |
| Pricing | 031 | None | out of architecture scope until Q-05; product billing would need accounts and a payment provider | Conflicts with recorded direction; not assessed further. |
| Languages | 032, 044 | English only | document templates with `lang` and fonts; AI prompts per language; UI i18n only if Q-13 says so | None existing; fonts and container image (R-07). |

## Positioning options (Q-01): evidence and trade-offs

Recommend only; the decision belongs to the developer (an ADR either way).

**Option 1: a mode of the Check-up** (for example a purpose flag on `RunStartBody`, reusing discovery, Plan Review, run,
grades and Past check-ups).
- For: one engine, one report store, one history; read-only for non-owners is already enforced
  (`checkup-run.ts:76-83`); ADR 0010 "one app" intact; content checks benefit owners too.
- Against: the Check-up is built around a Plan and a release verdict (`docs/ARCHITECTURE.md:20-34`, ADR 0029). A "Ready
  to release" stamp on someone else's site is meaningless and a claim-wording risk (ADR 0018). Plan Review and the AI
  Planner add AI cost (ADR 0009: about 8-12 requests per 30 pages) before any audit AI runs. The glossary defines App as
  something "its team releases on its own" (`CONTEXT.md:7-9`), which an audited third-party site is not. The report
  model would carry pitch-only fields every Check-up ignores.

**Option 2: a separate entry point on the shared engine** (own wizard screen, own runner routes and store, reusing spider,
checkers, AI adapter and report writers).
- Precedents in code: the Competitive Benchmark (`benchmarks.ts`, own store and screen, read-only crawl with robots and
  2000 ms pacing at `routes/plan.ts:631-632`) and the API-only `mode: 'safe-public'` path that skips Plan and verdict
  (`checkup-run.ts:603-626`, `safe-scan.ts`).
- For: no change to Check-up semantics or verdict; read-only by construction; own glossary term; skips Plan Review;
  can grow documents, shortlist and roadmap without touching the release flow.
- Against: a second flow in one app (ADR 0010 rejected two apps, not two entry points; Benchmark is the precedent).
  Risk of drift between how the orchestrator calls checkers and how the audit path does: today the safe crawler runs
  only bug-detection and UX checks (`safe-crawler.ts:225-226`), and the wizard never sends `safe-public`
  (`api.ts:402`). Shares the single run slot.

**Option 3: a separate product** (new app or package using `@qa/core` and `@qa/checkers` as libraries).
- For: own positioning, pricing (FR-31), accounts, storage and legal posture (outreach, third-party content) without
  bending the QA product's ADRs (0008, 0012, 0032) or direction.
- Against: highest cost. Packages are `private: true` workspace packages and not designed as a library API
  (`orchestrator.ts` 1661 lines, `server.ts` 3609 lines). Duplicate deploy, auth and storage work.

**Positioning-neutral first step (recommended regardless of Q-01):** build the shared capabilities in `@qa/core` and
`@qa/types` as additive engine work that also serves owners: content extraction and sections, site-level duplicate
checks, CMS detection, crawl limits and pacing, the ADR 0031 fixes, per-task models, document generator with language
support. Decide the entry point before any pitch-only work (REQ-019, 023 to 025, 027, 031, 033). If the pitch rows stay,
Option 2 has the lowest cost given the Benchmark and `safe-public` precedents.

## Architectural risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | ADR 0031 is Accepted but not in code: sitemap and `Sitemap:` fetches, the SEO broken-link check and the security-depth fallback use Playwright's request API, which the browser guard does not see. An audit of arbitrary public URLs on the shared hosted copy exercises exactly these paths (redirect or sitemap to private or metadata addresses). | High | High | Implement T-43 as written in ADR 0031 (route through `safeGet`, add the source-grep test) before any third-party audit feature ships on the hosted copy. |
| R-02 | Saved Apps, history and shortlist (REQ-028, REQ-023) cannot survive on the hosted copy: `/tmp` is wiped on redeploy and scale-to-zero, one instance only (ADR 0032). | High | High | Local-first for saved Apps; hosted persistence only through an approved storage decision (bucket mount, managed document store), with cost against the $0 direction. |
| R-03 | Helper accounts (REQ-033) need identity, per-App authorization and tenant-partitioned data; today data is keyed by host and the only scoping is in-memory beta sessions. Leak between people is likely if bolted on. | Medium | High | Defer until Q-01 and Q-06; design as its own subsystem through an ADR superseding the relevant parts of 0008 and 0032. |
| R-04 | REQ-040 "keys stored encrypted": the plaintext `.qa-keys.json` fallback is used wherever no keychain exists (headless Linux, including a local Docker run with a mounted data folder). | Medium | High | Amend ADR 0002: refuse to persist without a keychain, or encrypt the fallback with a key that does not sit beside it. Hosted beta (memory only) already meets it. |
| R-05 | Load on third-party sites: run phase is unpaced; 3 throttled repeat loads per page; up to 5 link fetches per page; `Crawl-delay` ignored; robots.txt unreachable means allow all. ADR 0015 is Deferred. | Medium | Medium | Accept ADR 0015 with per-host limits covering crawl and run phase and honouring `Crawl-delay`; identify the crawler token honestly (today `QA-Benchmarking-Bot`). |
| R-06 | External API quotas and keys (REQ-012, 042, 043): calls scale with pages; a shared hosted key would be exhausted by strangers; free-tier limits not verified in this task. | Medium | Medium | Per-site or sampled calls (Layout Group samples), BYOK for the data API, "not measured" on failure (ADR 0018). |
| R-07 | Tamil (and later Indic) output: reports hard-code `lang="en"` and system fonts; fonts in the Playwright base image were not verified; ADR 0021 forbids external fonts in self-contained HTML; Word export needs a dependency. | High | Medium | Embed an OFL font (for example Noto Sans Tamil) as a `data:` URI in document HTML, set `lang` per document, print PDF with the bundled Chromium; test glyph coverage in the container. |
| R-08 | AI cost per page (REQ-016): six areas per page plus site-wide, on top of planning; free OpenRouter tier is about 50 requests a day (ADR 0009 Consequences). | High | Medium | Assess per Layout Group sample, batch areas in one request, extend the AI Request Budget estimate and cap to the new stage. |
| R-09 | Glossary collisions: "Plan" (FR-26), "project" (FR-28, FR-33; _Avoid_ for App), "sitemap" (FR-20; _Avoid_ for App Flow), "Requirement" (CONTEXT term for Product Context items vs engineering REQ IDs), App definition ("its team releases"), whether an audit is a Check-up. | High | Medium | Settle terms in CONTEXT.md before code (Q-01, Q-18). |
| R-10 | Pitch and owner documents drift into claims (ADR 0018) or reuse the release verdict (ADR 0029) on third-party sites. | Medium | High | No verdict stamp in audit documents; reuse ADR 0018 word list as a test on generated documents (REQ-016 AC-2 pattern). |
| R-11 | Personal data: NAP, notes, outcomes, extracted text and screenshots of third-party sites stored in files with no retention rule, and sent to the AI Provider. Redaction (ADR 0016) does not target business contact data. | Medium | High | Retention and delete-per-App (Q-30) before storing; keep page text out of `fix-these.md`-style agent outputs (ADR 0017 text-safety rules). |
| R-12 | Report size and memory: per-page text and sections in `report.json` (written whole) and SSE, on a 2 GiB single instance. | Medium | Medium | Store content per page in separate files referenced from the report; cap text per page. |
| R-13 | Single run slot: audits, Check-ups and benchmarks block one another, locally and hosted. | Medium | Medium | Accept for now; a queue is out of scope (ADR 0008). |
| R-14 | Adding routes to the 3609-line `server.ts` `if` chain instead of the route table. | Low | Medium | New routes go in `routes/*.ts` per ADR 0027. |

## Recommendations

| ID | Recommendation | Rationale | Requires approval (P2) | Status |
|---|---|---|---|---|
| REC-01 | Implement ADR 0031 in code (spider sitemap fetches, SEO link check GET via `safeGet`, no Playwright request-API fallback in checkers, source-grep test) before any third-party audit work. | Accepted decision not in code; affects the hosted copy's outbound boundary (R-01). | No (implements an accepted ADR). Prerequisite. | proposed |
| REC-02 | Record the Q-01 positioning in an ADR: mode of the Check-up, separate entry point on the shared engine, or separate product. | Determines routes, store, glossary and which ADRs move. Trade-offs above. | **P2: requires approval.** Decision: product boundary. | proposed |
| REC-03 | Accept ADR 0015 pacing: one per-host limit across crawl and run phase, `Crawl-delay`, honest crawler token. | REQ-035 cannot be verified without a decided rate (Q-12); run phase is unpaced. | **P2: requires approval.** Decision: live-site request policy. Trade-off: slower audits vs site load. | proposed |
| REC-04 | Add a page content model (sections, headings, images and alt, meta, CTAs, link region, language, technology) to `@qa/types`, extracted by a new core module, stored per page beside the report and referenced additively from `ReleaseReport`. | REQ-007 to 010, 013, 017 need facts the crawl does not keep today. Additive per ADR 0017. | **P2: requires approval.** Decision: report schema and storage layout. Trade-off: richer output vs report size and personal data. | proposed |
| REC-05 | Add a site-level check stage in core after the crawl (cross-page duplicate titles, descriptions, content) rather than giving checkers cross-page state. | Checkers are per page; `siteWide` only de-duplicates. Keeps checkers stateless. | **P2: requires approval.** Decision: checker pipeline boundary. | proposed |
| REC-06 | Replace the two model slots with a per-`AIStage` model map in `AiSettings`, keeping text and vision as defaults; add new stages for assessment, documents, rewrite. | REQ-039; AI usage is already tallied per stage. | **P2: requires approval.** Decision: saved settings schema. | proposed |
| REC-07 | Amend ADR 0002 so a key is never persisted in plain text (refuse without keychain, or encrypt the fallback). | REQ-040; plaintext fallback exists today. | **P2: requires approval.** Decision: secret storage. Trade-off: headless Linux users must pass keys per run. | proposed |
| REC-08 | Add an external data adapter in core with its own key in the BYOK resolver and per-value source and method; failures read "not measured". | REQ-012, 042, 043; ADR 0018. | **P2: requires approval.** Decision: new external system and what audited URLs are sent to it. | proposed |
| REC-09 | Document generator in core: Markdown first; PDF by printing self-contained HTML with the bundled Chromium; embedded OFL fonts as `data:` URIs; `lang` per document; Word deferred to a dependency decision. | REQ-018, 019, 021, 022, 044 with no new runtime for PDF. | **P2: requires approval.** Decisions: font assets in the image or bundle; Word dependency. | proposed |
| REC-10 | Post-run edits as an overlay file beside `report.json` (original kept), exposed through route-table rows and applied at export. | REQ-020, Q-25; keeps fingerprints and history stable. | **P2: requires approval.** Decision: data model for edits and versions. | proposed |
| REC-11 | Saved Apps local-first; hosted persistence only after an infrastructure decision (storage service, cost, retention). | REQ-028, R-02, ADR 0032. | **P2: requires approval.** Decision: hosted storage; amends ADR 0032. | proposed |
| REC-12 | Defer accounts and helpers (REQ-033) and pricing (REQ-031) until Q-01, Q-05, Q-06 are answered; design as their own subsystem. | Needs identity and tenancy the system does not have. | **P2: requires approval.** Decision: auth subsystem; supersedes parts of ADR 0008, 0012, 0032. | proposed |
| REC-13 | Settle glossary terms (audit pass, enhancement roadmap, saved App) in CONTEXT.md before code. | R-09; CLAUDE.md requires CONTEXT.md terms in UI text. | No (needs owner sign-off on CONTEXT.md). | proposed |
| REC-14 | Keep every AI-written audit output advisory and out of grades; show no release verdict on third-party audits. | ADR 0009, 0018, 0029; R-10. | No (applies accepted ADRs). | proposed |

## Documentation versus code

- **ADR 0031** (Accepted) describes `makeOutboundFetch`, a source-grep test and GET-only link checks; none exist in code
  (`safe-net.ts` exports at 14-228 have no `makeOutboundFetch`; `seo.ts:555-557` HEAD then GET; `security-depth.ts:146`
  fallback; `deterministic-spider.ts:409,428`). Behaviour is affected (R-01).
- **CLAUDE.md** says the wizard imports single modules from `@qa/types/src/...`; the guard test and `browser.ts:1-17`
  allow only `browser.js` by path, and the wizard also imports values from the `@qa/types` barrel
  (`ReportScreen.tsx:2`, `SettingsScreen.tsx:28`). Behaviour not affected today because `packages/types/src` imports no
  Node built-ins.
- **ADR 0018** known gap: area label "Secure" (`packages/types/src/aspects.ts:3`), already recorded in the ADR.

## Not assessed in this task

Wizard screens beyond routes and download buttons (`NewCheckupScreen`, `ReportScreen` body, `PastCheckupsScreen`,
`SiteMap.tsx`); `html-report.ts` content; `redact.ts`; `plan/pipeline.ts` and `ai-planner.ts` internals; `scheduler.ts`;
`competitive/safe-crawler.ts` beyond the lines cited; ADRs 0004, 0006, 0013, 0014, 0016, 0019, 0020, 0022 to 0026 (not
read); `docs/DEPLOYMENT.md`, `docs/CONFIGURATION.md`; fonts shipped in the Playwright base image; external API quotas.
`engineering/repo-analysis.md` was not used.
