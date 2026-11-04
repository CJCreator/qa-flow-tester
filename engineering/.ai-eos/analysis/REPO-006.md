## Shard REPO-006: Website Audit feature map (refresh)

Scope: request "Redo the Website audit feature (ADR 0033)". Working tree inspected at `71cf6af` + uncommitted/untracked files (git status unchanged since the survey snapshot). Feature list: `engineering/archive/WF-20261030-i24p/carried-forward/requirements.md` (holds REQ-001..REQ-046; **no REQ-047 exists in that file**). Tests not run (task forbids; `DEFER_TESTS` rules also apply).

### Headline

The Website Audit exists only as a **contract** (`packages/types/src/website-audit.ts`, 1331 lines, untracked) plus types-level additions (crawl limits, skip reasons, marketing signals), a static fixture site and fixture/type tests. **No core pipeline, no runner route, no wizard screen** uses it: `website-audit` / `AUDIT_API` / `validateAuditStartBody` / `LinkRegion` / `MARKETING_SIGNALS` / `CrawlLimits` / `modelForStage` are referenced only from `packages/types/**` (grep over `packages/{core,runner,checkers,wizard}/src`). Status below is for the Website Audit feature; "engine" notes say what the Check-up engine already offers for reuse.

Legend: COMPLETE = implemented and evidenced for the audit; PARTIAL = contract and/or reusable engine piece exists, audit behaviour missing; MISSING = nothing found (search listed); UNVERIFIED = code exists, behaviour not confirmed.

### Prerequisites

| Item | Status | Evidence | Notes |
|---|---|---|---|
| ADR 0031 `safeGet` | COMPLETE (helper) / PARTIAL (adoption) | `packages/core/src/safe-net.ts:115` `resolvePublic`, `:146` `safeGet` (per-hop resolve, public-only, redirect re-check, byte cap); used at `core/src/discovery/docs-fetch.ts:38`, `runner/src/server.ts:1462`, `safe-net.ts:213` | No `allowPrivate` option exists in `safeGet` (ADR 0031 says local runs pass it); `resolvePublic` always refuses private. Audit is public-only so fine for audit, but local fixture tests on 127.0.0.1 need injected `NetDeps`. |
| ADR 0031 `makeOutboundFetch` | MISSING | grep `makeOutboundFetch` over `packages/**` and `docs/**`: only `docs/adr/0031...md:13` | Checkers still use Playwright request API: `checkers/src/security-depth.ts:43-52` `defaultFetch(page)` via `request.fetch`; `checkers/src/seo.ts:397,556-557` (HEAD then GET link check). Spider sitemap/robots via `context.request.get` (`core/src/discovery/deterministic-spider.ts:410,429`). `RobotsPolicy.fetch` uses Node `fetch` (`core/src/competitive/robots.ts:50`). ADR 0031's guard test `packages/core/tests/outbound-source-grep.test.ts` does not exist (only `safe-net.test.ts`). DEC-002 ("safeGet built before any audit work") is therefore not met for page-derived paths. |
| Runner route table access levels | MISSING | `packages/runner/src/routes/route.ts:12-24` `Route` = `method/path/prefix/anyMethod/handle`, no access field; `routes/index.ts:9` `allRoutes = [...planRoutes]`; dispatch `server.ts:1008` | Access today is one global `RUNNER_ACCESS_TOKEN` gate (`server.ts:364`, `cli.ts:30`). Contract requires per-route `access: 'owner'|'view'|'edit'|'export'|'sign-in'|'public'` (`website-audit.ts:1023-1081`); route table needs an access column + prefix-param matching (`matchAuditPath`, `website-audit.ts:1110`) since `matchRoute` is exact/prefix only (`route.ts:34-70`). |
| `RunSlot` / `benchmarkBusy` | PARTIAL | `runner/src/session/run-slot.ts:3-23` (`begin` returns false when running, `:54`); `server.ts:481` `benchmarkBusy` flag, checked at `:1227,1284,2783,2809,3396`, set `:3421/3453` | Single run slot is Check-up-shaped (phase/runId/targetUrl). Benchmark uses a separate boolean, not the slot. ADR 0033 needs audit and Check-up mutually exclusive (409 `ERR_RUN_IN_PROGRESS`, `website-audit.ts:1036`): must add an audit-busy check to all five guard sites or generalise the slot. |
| ADR 0036 | MISSING | `ls docs/adr`: last is `0034-encrypted-key-fallback.md` | 0035 (PageSpeed), 0036 (hosted storage + Shared Links, amends 0032), 0037 (helper sign-in) are named in ADR 0033 "Follow-up records" but not written. ADR 0015 still `Status: Deferred` (`docs/adr/0015...md:3`) although ADR 0033 says it "moves to Accepted". |

### Requirement status

| ID | Requirement / feature | Status | Evidence | Notes |
|---|---|---|---|---|
| REQ-001 | Accept public URL, confirm reachable | PARTIAL | `website-audit.ts:96-114,178-229` syntax validation (http/https, no creds, length) | Reachability + public-only check is "the runner's check" (`:175`) and not built; `resolvePublic` (`safe-net.ts:115`) reusable. No `/api/audits` route. |
| REQ-002 | Crawl limits: pages, depth, include/exclude | PARTIAL | Bounds/defaults `types/src/discovery.ts` (`CRAWL_LIMIT_BOUNDS`, diff); validator `website-audit.ts:189-200`; spider `maxPages` `deterministic-spider.ts:594-598`; `frontier.ts:133-134` returns `depth-limit` | Spider drops `depth-limit` silently: only `trap-limit` is pushed to `skipped` (`deterministic-spider.ts:382-393`), so AC-2 Skipped Page reason missing. Include/exclude: no matching in core (grep `includePaths|excludePaths` in `core/src` = none). `maxDepth` option exists (`deterministic-spider.ts:109,326`). |
| REQ-003 | Crawl internal pages, read-only | PARTIAL | Deterministic Spider on-site filter `deterministic-spider.ts:379`; Safe Interaction crawler `core/src/competitive/safe-crawler.ts` | Engine exists; no audit pipeline drives it. "Links leaving the site" list not confirmed for audit output. |
| REQ-004 | sitemap.xml merge, no duplicates | PARTIAL | `deterministic-spider.ts:405-458` seeds `/sitemap.xml` + robots `Sitemap:`; frontier dedupe `frontier.ts:130-131` | Fetches via `context.request.get` (`:410,429`), violating ADR 0031. `<loc>` on-site check present (`onSite(locUrl)`). |
| REQ-005 | Render JS-heavy pages | PARTIAL | Spider is Playwright-based (survey; `deterministic-spider.ts`); fixture `fixtures/audit-site/updates/` + test `audit-site-fixture.test.ts:380` | Fixture test checks the fixture, not the product. No audit extraction to consume it. |
| REQ-006 | Flag and skip sign-in areas | PARTIAL | `deterministic-spider.ts:632-692` sign-in wall -> skip `sign-in` | Spider may still enqueue the sign-in form page (`:697`) and supports sign-in for Roles; audit must run with no credentials. No audit flag in output. |
| REQ-007 | Page hierarchy + navigation with link region | PARTIAL | Types only: `LinkRegion` `website-audit.ts:239`, `HierarchyNode`/`NavigationLink`/`PageHierarchy` `:403-425` | No region classification or hierarchy builder in core (grep `LinkRegion` = types only). |
| REQ-008 | Sections per page | PARTIAL | Types only: `Section`, `SectionKind`, `sectionText` `website-audit.ts:299-320` | No sectioniser in core. |
| REQ-009 | Extract page content | PARTIAL | Types only: `PageContent` `website-audit.ts:335`, `ContentHeading/Image/Link/Form/Cta` `:243-297` | Engine has partial facts (SEO details e.g. `imagesWithoutAltCount` `checkers/src/seo.ts:41`; spider form facts) but no `PageContent` extractor. |
| REQ-010 | Record CMS/framework | PARTIAL | Types only: `TECHNOLOGIES`, `TechnologyResult` `website-audit.ts:360-401` | No detector: grep `wordpress|wp-content|shopify|wix` in `packages/*/src` = none. Fixture has WordPress generator meta (`audit-site-fixture.test.ts:270`). |
| REQ-011 | BYOK AI keys | PARTIAL | Key resolver `core/src/ai/key-resolver.ts` (keychain, encrypted file, env); ADR 0002 | Engine BYOK works for Check-up; no audit AI step; `AssessmentNotDoneReason 'no-ai-key'` typed only (`website-audit.ts:499`). |
| REQ-012 | PageSpeed / CWV from external API | PARTIAL | Key storage `key-resolver.ts:14,23` (`pagespeed`, `PAGESPEED_API_KEY`); types `ExternalSpeed`/`SpeedNotMeasuredReason` `website-audit.ts:560-598` | No PSI client: grep `pagespeed` shows only key names/comments; `checkers/src/performance.ts:57` is local lab throttling. ADR 0035 unwritten. |
| REQ-013 | Detect page language | PARTIAL | Type `PageLanguage` `website-audit.ts:322`; `seo.ts:196-205` only checks `<html lang>` presence | No content-based detection (grep `franc|detectLanguage|Tamil` in src = none). Fixture has ta/hi pages. |
| REQ-014 | Content problems | PARTIAL | Per-page: missing title `seo.ts:96`, missing description `:117`, missing alt `:329-338`, broken links `seo.ts:556` | No cross-page duplicate title/description/content (grep `duplicate.?title|duplicate.?description` = none); heading problems not confirmed; no audit finding grouping. |
| REQ-015 | Ten marketing signals | PARTIAL | `MARKETING_SIGNALS`, `MarketingSignal`, `NapDetails` in `types/src/aspects.ts` (diff); `AuditMarketing` `website-audit.ts:631`; `tel:` `seo.ts:509`; LocalBusiness `aeo.ts:98` | No code produces `signals[]` (grep `MARKETING_SIGNALS` in src non-types = none). NAP extraction absent. |
| REQ-016 | AI assessment of six areas | MISSING | Types only: `AUDIT_AREAS` `website-audit.ts:441`, `AreaAssessment` `:505` | No audit assessment prompt/stage in `core/src/ai` (grep `assessment` stage use = types only). |
| REQ-017 | Rank by impact/effort, cite page+section | PARTIAL | `core/src/recommendations.ts:6-7,29-30,46` effort/impact on Check-up findings; `AuditFinding` `website-audit.ts:448`, `AUDIT_SCALE` `:437` | No section citation (no sections exist); ordering rule for audit not implemented. |
| REQ-018 | Five Audit Documents | MISSING | Types only: `AUDIT_DOCUMENT_KINDS` `website-audit.ts:665` | No document writer for structure/content/findings/roadmap/proposal. Note REQ text still says "three", decision says five. |
| REQ-019 | Pitch Glimpse EN/TA | MISSING | `AUDIT_API.pitch` `website-audit.ts:1054`; CONTEXT.md:339-340 | No generator, no opt-out defaults, no A4 layout. |
| REQ-020 | Edit hierarchy/content/findings before export | MISSING | Types only: `EditOverlay`, `FindingEdit`, `SectionEdit`, `AuditEditsPatch` `website-audit.ts:692-754` | No store, route or UI. |
| REQ-021 | Markdown + JSON export | PARTIAL | Check-up has issues Markdown (`core/src/issues-document.ts`); `EXPORT_FORMATS` `website-audit.ts:673` | No audit bundle/JSON layout (Q-24). |
| REQ-022 | PDF and Word export | MISSING | grep `pdf|docx` in src: only `docx-to-markdown.ts` (import) and report HTML | No PDF/DOCX writer; Tamil font embedding absent. |
| REQ-023 | Shortlist | MISSING | Types only: `SHORTLIST_OUTCOMES`, `ShortlistEntry` `website-audit.ts:797-830` | No store/route/UI. |
| REQ-024 | Clickable homepage preview | MISSING | `AUDIT_API.createPreview/getPreview` `website-audit.ts:1057-1058` | Nothing implemented. |
| REQ-025 | Owner Audit EN/TA | MISSING | `AUDIT_API.owner` `website-audit.ts:1055` | Nothing implemented. |
| REQ-026 | Improvement Roadmap | MISSING | Type `RoadmapItem` `website-audit.ts:483` | No generator. |
| REQ-027 | Proposal from editable template | MISSING | Types `ProposalInputs` `:717`, `CompanyDetails`/`AuditSettings` `:909-945` | No template store or generator. |
| REQ-028 | Saved audits, versions, re-run | MISSING | Types `AuditVersion`, `AuditSummary` `website-audit.ts:761-795`; `AUDIT_API.rerun` `:1045` | Check-up history (`PastCheckupsScreen.tsx`, report store) is Check-up-only. No Cloud Storage adapter (ADR 0036 missing). |
| REQ-029 | Local by default, Cloud when needed | UNVERIFIED | Local `pnpm start`; Cloud Run per ADR 0032 (survey) | Holds for the app; audit not built, so "full audit works" cannot be shown. |
| REQ-030 | AI rewrite after approval, no reused wording | MISSING | Types `RewriteState`, `OverlapFlag`, `DEFAULT_REWRITE_OVERLAP_WORDS` `website-audit.ts:886-906`; routes `:1064-1069` | Nothing implemented. |
| REQ-031 | Pricing | MISSING (deferred) | none; ADR 0033 free tier | Deferred by decision. |
| REQ-032 | Hindi + other Indian languages | PARTIAL | `DOCUMENT_LANGUAGES` 12 codes `website-audit.ts:24-50`; fixture `fixtures/audit-site/hi/` | Contract only; no translations/detection. |
| REQ-033 | Helper accounts per App | MISSING | Types `HELPER_PERMISSIONS`, `HelperGrant`, `HelperSession` `:863-884`; routes `:1073-1080` | grep `firebase` in src = none. ADR 0037 unwritten. |
| REQ-034 | Honour robots.txt | PARTIAL | `deterministic-spider.ts:528-534` skip `robots`; `RobotsPolicy` `competitive/robots.ts`; public sites only (`discovery-agent.ts:477`) | Fetch is Node `fetch` (`robots.ts:50`), not `safeGet`. Sitemap-listed disallowed pages: checked at visit time (`:528`), OK. |
| REQ-035 | Rate limit per host (one at a time + Crawl-delay) | PARTIAL | Fixed pacing `deterministic-spider.ts:476-488` (`pageDelayMs`, `PUBLIC_SITE_PAGE_DELAY_MS` `discovery-agent.ts:479`) | No `Crawl-delay` parsing (grep in `robots.ts` = none); worker concurrency vs "one request at a time" not confirmed; ADR 0015 still Deferred. |
| REQ-036 | Flag and skip payment areas | PARTIAL | `payment` reason added to `ROUTE_SKIP_REASONS` (`types/src/route-telemetry.ts`, diff) and wording `core/src/issues-document.ts:129-131`; Safety Filter blocks payment *actions* `core/src/discovery/safety-filter.ts:41-50` | No page-level payment detection (card field / provider frame / checkout path) in spider: grep `'payment'` in spider = none. |
| REQ-037 | Phone layout | PARTIAL | `PhoneLayout` type `website-audit.ts:549`; engine mobile breakpoints (`core/src/browser.ts`, `checkers/src/performance.ts:57`) | No audit producer. |
| REQ-038 | Accessibility + SEO basics | PARTIAL | `SeoBasics`, `AccessibilityBasics` `website-audit.ts:527-547`; axe + SEO checkers (survey) | No audit wiring; ADR 0018 wording tests for audit outputs not present. |
| REQ-039 | Model per task | PARTIAL | `modelForStage`, `ModelsByStage`, `STAGE_MODEL_SLOT` `packages/types/src/ai.ts:11-66` (diff) | Not called anywhere outside types (grep = `types/src/ai.ts`, `types/tests/website-audit.test.ts`). |
| REQ-040 | AI keys encrypted at rest | COMPLETE (UNVERIFIED by run) | `core/src/ai/key-resolver.ts:1,45,279,366` aes-256-gcm + scrypt, keychain-first `:106`; test `core/tests/key-resolver-encryption.test.ts` (untracked); ADR 0034 | Uncommitted. Tests not run this pass. |
| REQ-041 | Ship no AI keys | COMPLETE (UNVERIFIED by run) | `scripts/scan-build-secrets.mjs` wired in `.github/workflows/ci.yml:176,192` (wizard dist, runner image); tests `runner/tests/scan-build-secrets.test.ts`, `scan-commit-secrets.test.ts` | `scripts/scan-commit-secrets.mjs` not referenced in `.github/` (grep = none); repo-scan path unconfirmed. All untracked/uncommitted. |
| REQ-042 | Search data API | MISSING (deferred) | none | Deferred by decision. |
| REQ-043 | Free tiers first | UNVERIFIED | Only planned API is PSI (key name `key-resolver.ts:14`) | No external data client exists to review. |
| REQ-044 | English + Tamil end to end | PARTIAL | `DOCUMENT_LANGUAGE_INFO` `website-audit.ts:37`; fixture `fixtures/audit-site/ta/`, test `audit-site-fixture.test.ts:400` | No extraction/export path to carry Tamil text; no TA document strings. |
| REQ-045 | Redesign or repair per page | MISSING | Types `PageAction`, `PageRecommendation`, `RecommendationEdit` `website-audit.ts:509-525,710` | grep `redesign` in src = none. |
| REQ-046 | Full test suite passes on Windows | UNVERIFIED | 21 test files modified + `vitest.config.ts`/`vitest.workspace.ts` changed (git status) | Not run (task forbids). |
| REQ-047 | (not defined) | n/a | grep `REQ-047` in carried-forward file = none | Orchestrator's range assumption is off by one. |

### Changes since the survey that matter to the plan

1. No code change since the survey snapshot (git status identical). Corrections/additions to the survey:
   - `fixtures/audit-site` has **no `package.json`** (glob `fixtures/audit-site/**/package.json` = none), so it is not a pnpm workspace importer; the survey's Dockerfile/frozen-lockfile risk is likely moot.
   - `makeOutboundFetch` and `outbound-source-grep.test.ts` do **not exist**; ADR 0031 is only partly implemented (safeGet helper only). DEC-002 prerequisite unmet.
   - `safeGet` has no `allowPrivate` flag; audit tests against `127.0.0.1` fixture must inject `NetDeps`.
   - Frontier yields `depth-limit` but the spider never records it as a Skipped Page (`deterministic-spider.ts:382-393`).
   - ADR 0035/0036/0037 absent; ADR 0015 still Deferred despite ADR 0033 claiming acceptance.
   - `Route` has no access level; `AUDIT_API` requires six access levels including `public` (`/s/:linkId`) and Helper `sign-in`, which bypass or replace the single access token.
   - Benchmark exclusivity is a separate `benchmarkBusy` boolean, not `RunSlot`; audit exclusivity needs the same five guard sites or a generalised slot.
2. Types-level pieces already in the tree and reusable as-is: `validateAuditStartBody`, `CRAWL_LIMIT_BOUNDS`, `ROUTE_SKIP_REASONS` (+ `depth-limit`/`excluded`/`payment` wording in `issues-document.ts`), `MARKETING_SIGNALS`, `modelForStage`, full `AUDIT_API` route contract, `AUDIT_ERROR_CODES`, `AuditProgressEvent`. Exported from both `types/src/index.ts:26` and browser-safe `types/src/browser.ts:17` (no Node imports to keep out).
3. CONTEXT.md already defines Website Audit, Page Content, Improvement Roadmap, Pitch Glimpse, Shared Link (CONTEXT.md:184, 319-343).

### Cross-shard

- Audit pipeline will consume `core/src/discovery/deterministic-spider.ts`, `frontier.ts`, `competitive/robots.ts`, `safe-net.ts`, `ai/key-resolver.ts`, and checkers `seo.ts`, `aeo.ts`, `security-depth.ts` (`FetchFn`).
- Runner integration points: `runner/src/routes/route.ts`, `routes/index.ts`, `server.ts:481,1008,1227,1284,2783,2809,3396`, `session/run-slot.ts`.
