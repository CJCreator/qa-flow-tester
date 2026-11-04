# Implementation plan

> Maintained by AI-EOS (`/ai-eos:plan`). The machine-readable plan is `engineering/.ai-eos/tasks.json`.
> After approval this file and tasks.json are **frozen**: any change invalidates the approval and
> returns the workflow to `AWAITING_APPROVAL`.
> Approve by typing `/ai-eos:plan approve` yourself. The model cannot approve on your behalf.

## Approval

<!-- ai-eos:begin approval -->
- Status: **APPROVED**
- Record: APR-007 by Saravanakumar at 2026-11-04T07:00:52.069Z (UserPromptExpansion)
- Approved artifact SHA-256: `39d3a1abaf95a7e8cc302ae8224cdc66915edbd0655f882fe93308b2d94eb955`
<!-- ai-eos:end approval -->

## Scope

In scope: REQ-001 to REQ-030, REQ-032 to REQ-039, REQ-043 to REQ-053 (the Website Audit of ADR 0033, its prerequisites REQ-047 to REQ-050 from ADR 0031 and DEC-001 to DEC-003, and the three failing mandatory checks REQ-051 to REQ-053).

Out of scope: REQ-031 (pricing) and REQ-042 (search data API) stay `deferred`; REQ-040 and REQ-041 are already `implemented`. CI changes (`.github/**`, RISK-007 / Q-54) stay a developer decision.

Developer steps outside the plan (agents may never edit these files):
- `.env.example`: add empty, optional lines `XDG_CONFIG_HOME`, `AUDIT_STORE_BUCKET`, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN` before BE-704 runs (AI-EOS never lets an agent own `.env*`).
- Tamil (and other Indic) fonts in the runner image (`packages/runner/Dockerfile`), if the hosted copy must print Tamil PDFs (BE-507 risk).

## Approach

Seven planner groups, merged by the orchestrator (`engineering/.ai-eos/drafts/PLANDR-007..013.json`):

1. **Prerequisites first (G1, BE-101..105, DOC-104/105).** `makeOutboundFetch` on `safeGet` and the migration of every page-derived request (ADR 0031, RISK-001); per-host pacing with `Crawl-delay` (REQ-035, top-level requests only, Q-56); declared per-route access levels with `:id` matching and a closed-by-default beta policy (DEC-001, D-004, Q-55 parked); one `RunSlot` with a run kind (DEC-002); ADR 0036 hosted storage (DEC-003, D-003) and ADR 0037 access model.
2. **Area modules under `packages/core/src/audit/`**, each with its own barrel: `crawl/` (G2: read-only Spider hooks, depth/include/exclude skips, sign-in and payment page detection, reachability), `analysis/` (G3: one read-only `readPage` per page, Sections, hierarchy, language, technology, content problems, marketing signals, accessibility basics), `ai/` (G4: provider timeouts, model per stage, PageSpeed, six-area assessment, redesign/repair, ranking, rewrite), `documents/` (G5: five Audit Documents + one Pitch Glimpse per D-001, Owner Audit, Improvement Roadmap, Proposal, Markdown/HTML/PDF/Word/zip with no new dependency), `store/` (G6: local files by default, Cloud Storage always-free bucket, Shortlist, Shared Links, Helpers).
3. **Merge additions:** BE-192 assembles the pipeline (crawl → analysis → phone layout → speed → grades → AI → ranking → roadmap → save) because no group owned it; BE-189 owns the core audit barrel (split from BE-190 to break a cycle with the route files); BE-190 registers all `routes/audit-*.ts` arrays with their dependencies; FE-191 registers the wizard screens; QA-195 is the end-to-end Website Audit test.
4. **Quality gates (G7).** Typecheck repaired per package (QA-700..703), `docs/CONFIGURATION.md` (BE-704), the four failing browser files diagnosed with root causes (QA-705..707), language coverage (BE-709/710 add label tables beside G5's, QA-711/712), and QA-713, the final gate, owning `vitest.workspace.ts` and depending on every task.

See `repo-analysis.md` (requirement status table), `architecture.md` (AR-01..AR-11, REC-01..REC-11) and `risks.md`.

## Tasks

<!-- ai-eos:begin tasks -->
| ID | Title | Agent | Requirements | Depends on | Priority | Complexity | Status |
|---|---|---|---|---|---|---|---|
| BE-101 | makeOutboundFetch on safeGet; move Spider robots/sitemap, RobotsPolicy.fetch and access-control onto it | backend-engineer | REQ-047 | — | critical | M | VERIFIED |
| BE-104 | Checkers take FetchFn only; orchestrator link check and checker fetch on makeOutboundFetch; source-grep guard | backend-engineer | REQ-047 | BE-101 | high | M | VERIFIED |
| BE-105 | robots.txt Crawl-delay and one request at a time per host (host pacer) in Spider and outbound fetch | backend-engineer | REQ-034, REQ-035 | BE-101 | high | M | VERIFIED |
| BE-102 | Route table access levels, beta policy and :param matching; dispatch closed by default | backend-engineer | REQ-048 | — | critical | L | VERIFIED |
| BE-103 | RunSlot with run kind (checkup \| benchmark \| audit) as the only run lock; remove benchmarkBusy | backend-engineer | REQ-049 | BE-102 | high | M | VERIFIED |
| DOC-104 | ADR 0036: hosted Website Audit storage and Shared Links (amends ADR 0032) | backend-engineer | REQ-050 | — | high | S | VERIFIED |
| DOC-105 | ADR 0037 route access model (owner, Helper, public, beta) and ADR 0015 Accepted for pacing | backend-engineer | REQ-048, REQ-035, REQ-050 | — | medium | S | VERIFIED |
| BE-611 | Audit Page Content and screenshot file routes (AUDIT_API.content, AUDIT_API.file) | backend-engineer | REQ-048, REQ-020 | BE-601, BE-602, BE-189, BE-509 | high | S | VERIFIED |
| BE-612 | Production runner wiring: one audit store, Helper access and public accessors for the audit routes | backend-engineer | REQ-033, REQ-048 | BE-102, BE-103, BE-601, BE-606 | high | M | VERIFIED |
| BE-190 | Integration: runner registration of audit-*.ts routes and their dependencies | backend-engineer | REQ-048 | BE-102, BE-103, BE-189, BE-192, BE-205, BE-410, BE-508, BE-509, BE-510, BE-602, BE-603, BE-604, BE-605, BE-606, BE-611, BE-612 | high | M | VERIFIED |
| BE-189 | Core audit barrel and the @qa/core export line | backend-engineer | REQ-048 | BE-204, BE-308, BE-409, BE-506, BE-601, BE-708, BE-192 | high | S | VERIFIED |
| BE-192 | Website Audit pipeline: crawl to AuditResult (analysis, phone layout, speed, AI, ranking, roadmap, grades, save) | backend-engineer | REQ-003, REQ-016, REQ-017, REQ-037 | BE-204, BE-308, BE-708, BE-404, BE-406, BE-407, BE-403, BE-502, BE-601, BE-105 | high | L | VERIFIED |
| FE-191 | Integration: register Website Audit screens in the wizard router and App | frontend-engineer | REQ-001, REQ-028 | FE-200, FE-301, FE-400, FE-401, FE-500, FE-501, FE-600, FE-601, FE-602 | medium | S | VERIFIED |
| QA-195 | End-to-end Website Audit through the runner against fixtures/audit-site (website-audit-e2e) | qa-engineer | REQ-034, REQ-035, REQ-047, REQ-048, REQ-049 | BE-190, FE-191, BE-104, BE-105, BE-192 | high | M | VERIFIED |
| BE-200 | Deterministic Spider: record depth-limit skips and add audit crawl hooks | backend-engineer | REQ-002, REQ-003, REQ-005, REQ-006, REQ-036 | BE-101 | high | M | VERIFIED |
| BE-201 | Audit crawl: payment-area and sign-in-page detection rules | backend-engineer | REQ-006, REQ-036 | — | high | S | VERIFIED |
| BE-202 | Audit crawl: include/exclude path-prefix filter | backend-engineer | REQ-002 | — | high | XS | VERIFIED |
| BE-203 | Audit start address check: public-only and reachable (Q-22) | backend-engineer | REQ-001 | BE-101 | high | S | VERIFIED |
| BE-204 | Audit crawl pipeline on the Deterministic Spider, with crawl barrel | backend-engineer | REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-036 | BE-101, BE-105, BE-200, BE-201, BE-202, BE-203 | high | L | VERIFIED |
| BE-205 | Runner route: start a Website Audit and stream its progress | backend-engineer | REQ-001, REQ-002, REQ-003 | BE-102, BE-103, BE-204, BE-189 | high | M | VERIFIED |
| FE-200 | Wizard: Website Audit start screen with address and crawl limits | frontend-engineer | REQ-001, REQ-002 | — | high | M | VERIFIED |
| QA-200 | Independent read-only guarantee test for the audit crawl | qa-engineer | REQ-003, REQ-006, REQ-036 | BE-204 | high | S | VERIFIED |
| BE-302 | Detect a page's language from its main text by Unicode script share | backend-engineer | REQ-013 | — | high | S | VERIFIED |
| BE-300 | RawPage model and buildPageContent: sections, headings, images, links, forms, CTAs | backend-engineer | REQ-008, REQ-009 | BE-302 | high | M | VERIFIED |
| BE-301 | readPage: read a rendered page into RawPage in one read-only browser pass | backend-engineer | REQ-007, REQ-008, REQ-009 | BE-300 | high | M | VERIFIED |
| BE-303 | Detect the CMS or framework from page facts and response headers | backend-engineer | REQ-010 | BE-300 | high | S | VERIFIED |
| BE-304 | Build the page hierarchy, the navigation map and the internal-linking figures | backend-engineer | REQ-007, REQ-015 | BE-300 | high | M | VERIFIED |
| BE-305 | Content problems, broken links through the outbound fetch, and SEO basics | backend-engineer | REQ-014, REQ-038 | BE-300, BE-101 | high | L | VERIFIED |
| BE-306 | Report the ten marketing signals per page and site-wide, with NAP | backend-engineer | REQ-015 | BE-300 | high | M | VERIFIED |
| BE-307 | Accessibility basics on a Sample Page by reusing the axe checker | backend-engineer | REQ-038 | BE-300 | high | S | VERIFIED |
| BE-308 | analyseSite entry point and the audit/analysis barrel | backend-engineer | REQ-007, REQ-008, REQ-009, REQ-010, REQ-013, REQ-014, REQ-015, REQ-038 | BE-301, BE-303, BE-304, BE-305, BE-306, BE-307 | high | M | VERIFIED |
| QA-300 | Page analysis on the audit fixture site end to end in Chromium | qa-engineer | REQ-007, REQ-008, REQ-009, REQ-010, REQ-013, REQ-014, REQ-015, REQ-038 | BE-308 | high | M | VERIFIED |
| FE-300 | Wizard views: page hierarchy, Page Content with Sections, page facts, findings list | frontend-engineer | REQ-007, REQ-008, REQ-009, REQ-010, REQ-013, REQ-014, REQ-015, REQ-038 | — | medium | M | VERIFIED |
| FE-301 | Wizard analysis screen loading the audit result and Page Content | frontend-engineer | REQ-007, REQ-009, REQ-014 | FE-300 | medium | M | VERIFIED |
| BE-400 | AI contract: completion abort signal, audit AI stages and the per-stage model API types | backend-engineer | REQ-039, REQ-011 | — | high | XS | VERIFIED |
| BE-401 | Timeout and abort signal on Anthropic, OpenAI/OpenRouter and Gemini calls | backend-engineer | REQ-016, REQ-011 | BE-400 | high | S | VERIFIED |
| BE-402 | Audit AI by stage: BYOK resolution, model per stage store and claim-wording guard | backend-engineer | REQ-011, REQ-039, REQ-016 | BE-400 | high | M | VERIFIED |
| BE-403 | Rank audit findings by impact then lower effort, with page and Section citation | backend-engineer | REQ-017 | — | high | S | VERIFIED |
| BE-404 | PageSpeed Insights client for Sample Pages (lab and field Core Web Vitals) and ADR 0035 | backend-engineer | REQ-012, REQ-043 | BE-101 | high | M | VERIFIED |
| BE-405 | Service keys: remove the PageSpeed key and keep beta service keys in the session only | backend-engineer | REQ-012, REQ-011 | — | high | S | VERIFIED |
| BE-406 | AI assessment of the six areas per Sample Page and for the whole site | backend-engineer | REQ-016 | BE-402, BE-401 | high | M | VERIFIED |
| BE-407 | Redesign or repair recommendation for each Sample Page | backend-engineer | REQ-045 | BE-402 | high | M | VERIFIED |
| BE-408 | Section rewrite after approval with the word-overlap check | backend-engineer | REQ-030 | BE-402 | low | M | VERIFIED |
| BE-409 | Barrel for packages/core/src/audit/ai | backend-engineer | REQ-011, REQ-012, REQ-016, REQ-017, REQ-030, REQ-039, REQ-045 | BE-401, BE-402, BE-403, BE-404, BE-406, BE-407, BE-408 | high | XS | VERIFIED |
| BE-410 | Runner routes: audit AI models per stage and Section rewrite (approve, run, accept, list) | backend-engineer | REQ-030, REQ-039, REQ-011 | BE-400, BE-102, BE-189 | medium | M | VERIFIED |
| FE-400 | Wizard: AI model per audit stage settings panel | frontend-engineer | REQ-039 | BE-400 | high | S | VERIFIED |
| FE-401 | Wizard: Section rewrite review (approve, write, see copied phrases, edit, accept) | frontend-engineer | REQ-030 | — | low | M | VERIFIED |
| QA-400 | Audit AI flow contract test and free-tier external API inspection | qa-engineer | REQ-011, REQ-016, REQ-017, REQ-039, REQ-043, REQ-045 | BE-409 | high | S | VERIFIED |
| BE-500 | Edit overlay: validate and merge edits, build the edited view of an audit version | backend-engineer | REQ-020 | — | high | M | VERIFIED |
| BE-501 | Document model, English and Tamil labels, Markdown and HTML renderers, claim-wording guard | backend-engineer | REQ-018, REQ-021, REQ-019, REQ-025 | — | high | M | VERIFIED |
| BE-502 | Improvement Roadmap: build items from ranked findings and render the Roadmap document | backend-engineer | REQ-026 | BE-500, BE-501 | high | S | VERIFIED |
| BE-503 | Structure, Content and Findings Audit Documents from the edited view | backend-engineer | REQ-018, REQ-020 | BE-500, BE-501 | high | M | VERIFIED |
| BE-504 | Proposal template filler and document settings defaults (template, opt-out text, company details) | backend-engineer | REQ-027, REQ-019 | BE-500, BE-501 | high | M | VERIFIED |
| BE-505 | Pitch Glimpse (one A4 page, top 3) and Owner Audit (cleaned-up, plain summary on top) | backend-engineer | REQ-019, REQ-025 | BE-502, BE-503, BE-504 | high | L | VERIFIED |
| BE-507 | PDF (Playwright print) and Word (.docx) renderers plus a dependency-free zip writer | backend-engineer | REQ-022, REQ-021 | BE-501 | medium | L | VERIFIED |
| BE-506 | Generate all documents, site.json, the Claude Code export bundle and the documents barrel | backend-engineer | REQ-018, REQ-021 | BE-505, BE-507 | high | M | VERIFIED |
| BE-508 | Audit settings routes: GET/PUT /api/audit-settings (Proposal template, opt-out text, company details) | backend-engineer | REQ-027, REQ-019 | BE-504, BE-102, DOC-104, BE-601, BE-405, BE-189 | high | M | VERIFIED |
| BE-509 | Edits routes: GET and PATCH /api/audits/:id/edits | backend-engineer | REQ-020 | BE-500, BE-102, DOC-104, BE-601, BE-189 | high | S | VERIFIED |
| BE-510 | Export, Pitch Glimpse and Owner Audit download routes | backend-engineer | REQ-021, REQ-022, REQ-019, REQ-025, REQ-018 | BE-506, BE-508, BE-102, BE-601, BE-189 | high | M | VERIFIED |
| FE-500 | Wizard: review and edit page hierarchy, Section content and findings before export | frontend-engineer | REQ-020 | — | high | M | VERIFIED |
| FE-501 | Wizard: export panel (formats, documents, language, Pitch Glimpse, Owner Audit) and document settings | frontend-engineer | REQ-021, REQ-022, REQ-019, REQ-025, REQ-027, REQ-018 | — | medium | M | VERIFIED |
| QA-500 | End-to-end acceptance of Audit Documents and exports through a running runner | qa-engineer | REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-025, REQ-026, REQ-027 | BE-508, BE-509, BE-510, BE-190, BE-601 | high | M | VERIFIED |
| BE-600 | Audit store backends: local files by default, Cloud Storage JSON API when a bucket is set | backend-engineer | REQ-028, REQ-029 | DOC-104 | high | M | VERIFIED |
| BE-601 | Website Audit store: audits and versions, Shortlist, Shared Links and Helper grants | backend-engineer | REQ-028, REQ-023, REQ-033, REQ-024 | DOC-104, BE-600 | high | L | VERIFIED |
| BE-602 | Runner routes for saved Website Audits and the Shortlist | backend-engineer | REQ-028, REQ-023 | DOC-104, BE-601, BE-102, BE-189 | medium | M | VERIFIED |
| BE-603 | Re-run a saved Website Audit as a new version | backend-engineer | REQ-028 | DOC-104, BE-601, BE-102, BE-103, BE-205, BE-189 | medium | S | VERIFIED |
| BE-604 | Shared Link routes and the public /s/:linkId page | backend-engineer | REQ-024, REQ-023 | DOC-104, BE-601, BE-102, BE-505, BE-189 | medium | M | VERIFIED |
| BE-605 | Improved-homepage preview: AI generator, sanitiser and preview routes | backend-engineer | REQ-024 | DOC-104, BE-601, BE-101, BE-102, BE-402, BE-500, BE-189 | medium | L | VERIFIED |
| BE-606 | Helper sign-in (Firebase ID token), Helper session and per-audit access | backend-engineer | REQ-033 | DOC-104, BE-601, BE-102, DOC-105, BE-189 | low | L | VERIFIED |
| BE-607 | Hosted copy wiring: Cloud Storage bucket and Firebase settings in deploy, deployment guide | release-engineer | REQ-029, REQ-028 | DOC-104, BE-600, BE-606 | medium | S | VERIFIED |
| FE-600 | Wizard: saved Website Audits, version history, re-run, delete and Shortlist | frontend-engineer | REQ-028, REQ-023 | — | medium | M | VERIFIED |
| FE-601 | Wizard: improved-homepage preview and Shared Links screen | frontend-engineer | REQ-024 | — | medium | S | VERIFIED |
| FE-602 | Wizard: Helpers screen and Helper sign-in with Google (Firebase Authentication) | frontend-engineer | REQ-033 | — | low | M | VERIFIED |
| QA-600 | Persistence, sharing and Helper access through the real runner dispatch, plus preview click test | qa-engineer | REQ-028, REQ-029, REQ-033, REQ-024, REQ-023 | BE-190, BE-602, BE-603, BE-604, BE-605, BE-606 | medium | M | VERIFIED |
| QA-700 | Test typecheck foundation: shared config, fixture declaration, per-package configs, checkers test typings | qa-engineer | REQ-051 | — | high | S | VERIFIED |
| QA-701 | Fix core test typings (EV-0003) | qa-engineer | REQ-051 | QA-700 | high | M | VERIFIED |
| QA-702 | Fix runner test typings (EV-0003) | qa-engineer | REQ-051 | QA-700 | high | S | VERIFIED |
| QA-703 | Fix wizard test typings (EV-0003) | qa-engineer | REQ-051 | QA-700 | high | M | VERIFIED |
| BE-704 | List XDG_CONFIG_HOME as optional in .env.example and docs/CONFIGURATION.md | backend-engineer | REQ-052 | — | high | XS | VERIFIED |
| QA-705 | Diagnose and fix the 4 failing wizard-e2e tests | qa-engineer | REQ-053, REQ-046 | QA-703 | high | L | VERIFIED |
| QA-706 | Diagnose and fix runner-server and url-first browser failures | qa-engineer | REQ-053, REQ-046 | — | high | M | VERIFIED |
| QA-707 | Diagnose and fix the auth-crawl-e2e dead-links timeout | qa-engineer | REQ-053, REQ-046 | QA-701 | high | M | VERIFIED |
| BE-708 | Phone layout recorder for Website Audit Sample Pages | backend-engineer | REQ-037 | — | high | M | VERIFIED |
| BE-709 | Audit Document fixed text in English, Tamil and Hindi | backend-engineer | REQ-044, REQ-032 | BE-501 | high | M | VERIFIED |
| BE-710 | Audit Document fixed text in the other nine Indian languages | backend-engineer | REQ-032 | BE-709 | low | M | VERIFIED |
| QA-711 | End-to-end language test: Tamil and Hindi through extraction, audit and documents | qa-engineer | REQ-044, REQ-032 | BE-709, BE-192, BE-506, BE-507 | high | M | VERIFIED |
| QA-712 | Wizard audit screens: Tamil content and Tamil export (browser test) | qa-engineer | REQ-044 | FE-191, QA-195, BE-709, FE-200, FE-301, FE-500 | high | M | VERIFIED |
| QA-713 | Integrate new browser tests and config names; whole suite and typecheck pass | qa-engineer | REQ-046, REQ-053, REQ-052, REQ-051 | BE-101, BE-104, BE-105, BE-102, BE-103, DOC-104, DOC-105, BE-189, BE-190, BE-192, FE-191, QA-195, BE-200, BE-201, BE-202, BE-203, BE-204, BE-205, FE-200, QA-200, BE-302, BE-300, BE-301, BE-303, BE-304, BE-305, BE-306, BE-307, BE-308, QA-300, FE-300, FE-301, BE-400, BE-401, BE-402, BE-403, BE-404, BE | high | M | REPORTED |

### BE-101 — makeOutboundFetch on safeGet; move Spider robots/sitemap, RobotsPolicy.fetch and access-control onto it

Implements ADR 0031 for the core paths (part 1 of 2; BE-104 does the checkers and the orchestrator). In packages/core/src/safe-net.ts: add an `allowPrivate` option to safeGet (private addresses accepted but still resolved once per hop and pinned; every redirect hop re-checked), and export `makeOutboundFetch(opts)` returning the checkers' `FetchFn` shape (packages/checkers/src/security-depth.ts:30): GET only, body read up to a byte cap (a body over the cap still counts as a response with its status), timeout, optional extra headers (e.g. Cookie). `allowPrivate` is derived from the run, never from request input: private allowed only when no browser guard is set (getBrowserPolicy() === null, packages/core/src/browser.ts:60; RUNNER_BETA=1 sets one). Also export a small `sameSiteUrl(url, site)` helper used for sitemap host checks. Migrate: (1) Deterministic Spider sitemap seeding (deterministic-spider.ts:405-459) from context.request.get to an injectable `outboundFetch` option defaulting to makeOutboundFetch; a robots.txt `Sitemap:` line and a sitemap `<loc>` naming another host are logged (debugLog 'crawl') and skipped (today `Sitemap:` lines are pushed with no host check, :416-418). (2) RobotsPolicy.fetch (competitive/robots.ts:48-56) from Node fetch to a FetchFn parameter defaulting to makeOutboundFetch({ allowPrivate: false }), so callers (discovery-agent.ts:477, safe-crawler.ts:167, runner routes/plan.ts:631) keep their signature; missing/unreachable robots.txt still means allow all. (3) access-control contextFetcher (access-control.ts:176-183) from context.request.get to makeOutboundFetch with the context's cookies as a Cookie header and maxRedirects 0, same AccessFetcher signature so orchestrator.ts is untouched. Unit tests use injected NetDeps (no real network).

- **Requirements:** REQ-047 · **Agent:** backend-engineer · **Priority:** critical · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** none
- **File ownership:** `packages/core/src/safe-net.ts`, `packages/core/src/discovery/deterministic-spider.ts`, `packages/core/src/competitive/robots.ts`, `packages/core/src/access-control.ts`, `packages/core/tests/outbound-fetch.test.ts`, `packages/core/tests/robots.test.ts`, `packages/core/tests/access-control.test.ts`, `packages/core/tests/spider-sitemap-outbound.test.ts`
- **Acceptance criteria:**
  - REQ-047 AC-1: with a browser guard set (RUNNER_BETA=1 equivalent) and a robots.txt `Sitemap:` line or a URL whose host resolves to 127.0.0.1 or 169.254.169.254, makeOutboundFetch / the Spider sitemap seeding / RobotsPolicy.fetch make no connection to that address (injected NetDeps.connect is never called for it).
  - REQ-047 AC-2: with a browser guard set, a public URL that redirects to a private address is refused at the redirect hop.
  - REQ-047 AC-3: with no browser guard (local run), the same private-address target is fetched as before (allowPrivate), still pinned to the resolved address.
  - REQ-047 AC-4: a sitemap `<loc>` or a robots.txt `Sitemap:` line naming another host is logged and skipped, never fetched (fixtures/audit-site/robots.txt has one: sitemaps.example.invalid).
  - makeOutboundFetch sends GET only, caps the body (an over-cap body still returns its status), and never takes allowPrivate from request input.
  - access-control contextFetcher sends the context's cookies through makeOutboundFetch with no redirects followed; existing access-control tests still pass unchanged in intent.
  - No `context.request`, `page.request` or Node `fetch` call remains in deterministic-spider.ts, competitive/robots.ts or access-control.ts.
- **Validation commands:**
  - CHK-BE-101-UNIT (security): `pnpm exec vitest run packages/core/tests/outbound-fetch.test.ts packages/core/tests/robots.test.ts packages/core/tests/access-control.test.ts packages/core/tests/safe-net.test.ts`
  - CHK-BE-101-SPIDER (integration): `pnpm exec vitest run packages/core/tests/spider-sitemap-outbound.test.ts packages/core/tests/spider-robots.test.ts packages/core/tests/spider-links-and-traps.test.ts`
- **Expected outputs:**
  - makeOutboundFetch and safeGet allowPrivate in packages/core/src/safe-net.ts
  - Spider sitemap/robots, RobotsPolicy.fetch and contextFetcher on the pinned path
  - New tests outbound-fetch.test.ts (unit) and spider-sitemap-outbound.test.ts (browser)
- **Execution status:** VERIFIED

### BE-104 — Checkers take FetchFn only; orchestrator link check and checker fetch on makeOutboundFetch; source-grep guard

ADR 0031 part 2. In packages/checkers: SeoChecker accepts an optional FetchFn (checkPage context or argument); checkBrokenLinks (seo.ts:547-585) sends exactly one GET per link through it (no HEAD then GET), and the Site Root audit (seo.ts:388-410) uses the same FetchFn instead of page.context().request. SecurityDepthChecker: remove defaultFetch (security-depth.ts:43-52) and its fallbacks (:146, :202); with no FetchFn the network checks (security.txt, source maps) make no request and are reported as not checked. Same for broken links and site-root files in SeoChecker. In packages/core: new packages/core/src/checker-fetch.ts with one shared function that builds the checkers' FetchFn for a run (makeOutboundFetch with the run's allowPrivate rule), used by FlowTestOrchestrator and later by the Website Audit analysis (ADR 0033 drift risk, architecture REC-11); orchestrator.ts passes it to securityDepth.checkPage (:1113) and seoChecker.checkPage (:1149); checkLink (:209-221) uses it (one GET, redirects re-checked by safeGet, same 404/410/5xx rule). Add packages/core/tests/outbound-source-grep.test.ts: scans packages/core/src and packages/checkers/src and fails on `context.request`, `page.request`, `request.fetch`, `request.get`/`.head` on a Playwright APIRequestContext, or a Node `fetch(` outside an explicit exception list (AI provider endpoints, preflight.ts, discovery/docs-fetch.ts localDocsGet with the reason 'user-provided address, not page-derived', plan/playwright-export.ts generated code text).

- **Requirements:** REQ-047 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** BE-101
- **File ownership:** `packages/checkers/src/seo.ts`, `packages/checkers/src/security-depth.ts`, `packages/core/src/checker-fetch.ts`, `packages/core/src/orchestrator.ts`, `packages/checkers/tests/seo.test.ts`, `packages/checkers/tests/security-depth.test.ts`, `packages/core/tests/checker-fetch.test.ts`, `packages/core/tests/outbound-source-grep.test.ts`, `packages/core/tests/orchestrator-access-wiring.test.ts`
- **Acceptance criteria:**
  - REQ-047 AC-5: SecurityDepthChecker and SeoChecker called without a FetchFn make no network request and report their network checks (security.txt, source maps, broken links, site-root files) as not checked; defaultFetch no longer exists.
  - REQ-047 AC-6: outbound-source-grep.test.ts fails when a Playwright request call (`context.request`, `page.request`, `request.fetch`) or Node `fetch` appears in packages/core/src or packages/checkers/src outside its named exception list, and passes on the migrated tree.
  - REQ-047 AC-7: the broken-link check sends exactly one GET per link and no HEAD (asserted against a counting test server or a recording FetchFn).
  - REQ-047 AC-1/AC-2 for checker paths: with a browser guard set, a link or security.txt/source-map URL resolving to 127.0.0.1 or 169.254.169.254, or redirecting there, is not requested (checker-fetch.test.ts with injected NetDeps).
  - The orchestrator passes the shared checker FetchFn to SecurityDepthChecker and SeoChecker, and checkLink keeps its 404/410/5xx failure rule with one request.
  - checkers still import nothing from @qa/core (dependency direction unchanged).
- **Validation commands:**
  - CHK-BE-104-UNIT (security): `pnpm exec vitest run packages/core/tests/checker-fetch.test.ts packages/core/tests/outbound-source-grep.test.ts`
  - CHK-BE-104-CHECKERS (integration): `pnpm exec vitest run packages/checkers/tests/seo.test.ts packages/checkers/tests/security-depth.test.ts packages/core/tests/orchestrator-access-wiring.test.ts`
- **Expected outputs:**
  - FetchFn-only network access in seo.ts and security-depth.ts (defaultFetch removed)
  - packages/core/src/checker-fetch.ts shared by orchestrator and the Website Audit analysis
  - packages/core/tests/outbound-source-grep.test.ts
- **Execution status:** VERIFIED

### BE-105 — robots.txt Crawl-delay and one request at a time per host (host pacer) in Spider and outbound fetch

REQ-035 per Q-12 (accepted ADR 0015 rule: one request at a time per host, robots.txt Crawl-delay honoured) and REQ-034. (1) RobotsPolicy (competitive/robots.ts) parses `Crawl-delay` for the chosen user-agent group and exposes `crawlDelayMs` (absent = undefined; non-numeric or negative ignored; capped at a sane maximum, e.g. 30 s, logged when capped). (2) New packages/core/src/host-pacer.ts: `HostPacer` with `run(host, task)` that allows one in-flight request per host and spaces request starts by max(minGapMs, crawlDelayMs); clock and timer injectable for unit tests. (3) makeOutboundFetch (safe-net.ts) takes an optional `pacer`, so sitemap, robots and checker requests share the host's turn. (4) Deterministic Spider takes an optional `pacer`: when set, every page load to the host and the sitemap/robots fetches wait for its turn (workers never load two pages of one host at once), replacing the shared `waitForPacing` clock for that crawl; existing callers without a pacer keep today's pageDelayMs behaviour. Robots handling (REQ-034) stays at visit time (deterministic-spider.ts:528-534) so a Disallowed URL found by link or in sitemap.xml becomes a Skipped Page with reason `robots`; a missing robots.txt means a normal crawl. The audit crawl (G2) creates one HostPacer per Website Audit from the fetched RobotsPolicy and passes it to the Spider and to every FetchFn it builds.

- **Requirements:** REQ-034, REQ-035 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-101
- **File ownership:** `packages/core/src/host-pacer.ts`, `packages/core/src/competitive/robots.ts`, `packages/core/src/safe-net.ts`, `packages/core/src/discovery/deterministic-spider.ts`, `packages/core/tests/host-pacer.test.ts`, `packages/core/tests/robots.test.ts`, `packages/core/tests/spider-robots.test.ts`, `packages/core/tests/spider-host-pacing.test.ts`
- **Acceptance criteria:**
  - REQ-034 AC-1: given robots.txt disallows a path for all crawlers, a URL under it met by link (fixture /private/staff-rota) or only in sitemap.xml (fixture /private/reports) is not fetched (absent from the fixture server's request log) and is listed as a Skipped Page with reason `robots`.
  - REQ-034 AC-2: given no robots.txt (404), the crawl proceeds normally and records no `robots` skips.
  - REQ-035 AC-1: given Crawl-delay: 1 (fixtures/audit-site/robots.txt), when the Spider crawls with a HostPacer against the fixture server that logs requests, then no two top-level requests to the host (page documents, robots.txt, sitemap files) overlap in time and consecutive starts are at least the Crawl-delay apart.
  - RobotsPolicy exposes the Crawl-delay of the matching group (specific user-agent first, else `*`); malformed values are ignored.
  - HostPacer unit tests: one in flight per host, gap respected, different hosts independent, a failing task releases the turn, abort signal stops waiting.
  - Spider callers that pass no pacer behave exactly as before (existing spider tests unchanged).
- **Validation commands:**
  - CHK-BE-105-UNIT (unit): `pnpm exec vitest run packages/core/tests/host-pacer.test.ts packages/core/tests/robots.test.ts packages/core/tests/outbound-fetch.test.ts`
  - CHK-BE-105-SPIDER (integration): `pnpm exec vitest run packages/core/tests/spider-robots.test.ts packages/core/tests/spider-host-pacing.test.ts packages/core/tests/spider-concurrency.test.ts`
- **Expected outputs:**
  - packages/core/src/host-pacer.ts
  - RobotsPolicy.crawlDelayMs; pacer option on makeOutboundFetch and the Deterministic Spider
  - New tests host-pacer.test.ts (unit) and spider-host-pacing.test.ts (browser)
- **Execution status:** VERIFIED

### BE-102 — Route table access levels, beta policy and :param matching; dispatch closed by default

DEC-001 / REC-06. packages/runner/src/routes/route.ts: `Route` gains required-by-dispatch `access: AuditAccess` (type import from packages/types/src/website-audit.ts: 'owner' | 'view' | 'edit' | 'export' | 'sign-in' | 'public'; no change to the types file) and `beta: 'allow' | 'closed'` (default closed). Paths may contain `:id` / `:linkId` params matched with matchAuditPath (website-audit.ts:1110, which validates AUDIT_ID_PATTERN / SHARE_LINK_ID_PATTERN; a bad id is no match, so a 404); matched params are passed in RouteContext as `params`. Exact rows still beat prefix rows; param rows rank with exact rows in table order. Add a pure `authorizeRoute(route, caller)` returning allow or a refusal (status + code), where caller = { hasAccessKey, beta, helper?: permissions resolver hook }: a route with no access is refused (closed by default); 'owner' needs the access key; 'view'/'edit'/'export' need the access key or a Helper grant with that permission (the Helper resolver is a hook defaulting to 'no Helper'; REQ-033/G6 supplies it); 'sign-in' and 'public' are reachable without the key; in beta (RUNNER_BETA=1) only routes with beta 'allow' are served, and per D-004 (recommended default, parked) audit routes are closed in beta except 'public' Shared Link routes. server.ts dispatch (:902-1015): match the table before grantAccess so 'public'/'sign-in' rows are served without the access key, then apply authorizeRoute; refusals answer JSON `{ error, code }` (401/403) in the existing error model. Existing Plan routes (routes/plan.ts) declare access 'owner' and beta 'allow', keeping today's betaScope/closedInBeta behaviour unchanged. routes/index.ts re-exports authorizeRoute and the new types. Inline endpoints are not migrated in this task (DEC-001 consequence).

- **Requirements:** REQ-048 · **Agent:** backend-engineer · **Priority:** critical · **Complexity:** L · **P2 (sensitive)**
- **Depends on:** none
- **File ownership:** `packages/runner/src/routes/route.ts`, `packages/runner/src/routes/index.ts`, `packages/runner/src/routes/plan.ts`, `packages/runner/src/server.ts`, `packages/runner/tests/route-table.test.ts`, `packages/runner/tests/route-access.test.ts`, `packages/runner/tests/route-access-server.test.ts`, `packages/runner/tests/beta.test.ts`
- **Acceptance criteria:**
  - REQ-048 AC-1: a route registered without an `access` value is refused at dispatch (unit test on authorizeRoute and a server test with a test-only route table).
  - REQ-048 AC-3: a route with access `owner` is refused for a request without the owner's access key when RUNNER_ACCESS_TOKEN is set.
  - REQ-048 AC-4: a route with access `public` (e.g. a `/s/:linkId` test row) is served without the access key, and a malformed linkId does not match (404).
  - REQ-048 AC-5: with RUNNER_BETA=1, a route whose beta policy is not 'allow' is refused for a beta visitor; a 'public' row with beta 'allow' is served.
  - `:id` / `:linkId` params match only values meeting AUDIT_ID_PATTERN / SHARE_LINK_ID_PATTERN and reach the handler decoded in RouteContext.params.
  - Every existing Plan route declares access and beta policy; existing route-table, plan-routes, access-token and beta tests pass with unchanged assertions.
  - view/edit/export rows accept the owner's access key and consult the Helper resolver hook (default: no Helper), so G6 can add Helper grants without changing dispatch.
- **Validation commands:**
  - CHK-BE-102-UNIT (security): `pnpm exec vitest run packages/runner/tests/route-table.test.ts packages/runner/tests/route-access.test.ts packages/runner/tests/plan-routes.test.ts`
  - CHK-BE-102-SERVER (integration): `pnpm exec vitest run packages/runner/tests/route-access-server.test.ts packages/runner/tests/access-token.test.ts packages/runner/tests/beta.test.ts packages/runner/tests/route-inventory.test.ts`
- **Expected outputs:**
  - Route.access, Route.beta, :param matching and authorizeRoute in packages/runner/src/routes/route.ts
  - server.ts dispatch: table matched before the access-key gate; closed by default
  - New tests route-access.test.ts (unit) and route-access-server.test.ts (runner)
- **Execution status:** VERIFIED

### BE-103 — RunSlot with run kind (checkup | benchmark | audit) as the only run lock; remove benchmarkBusy

DEC-002 / REC-07. packages/runner/src/session/run-slot.ts: RunSlot records `kind: 'checkup' | 'benchmark' | 'audit' | null` and `begin(runId, targetUrl, kind = 'checkup')` claims it synchronously; a start of any kind is refused while the slot is held. The existing exception (a Check-up awaiting Plan Review can be replaced by a new Check-up, run-slot.ts:55) applies to kind 'checkup' only; a benchmark or audit start is refused while a Check-up is awaiting review. server.ts: remove `benchmarkBusy` (:481) and its checks/sets (:1227, :1284, :2783, :2809, :3396, :3421, :3453); benchmark start claims the slot with kind 'benchmark' synchronously before its first await after the check and releases it in its finally block; the Check-up start guards (handleTriggerRun, runSchedule, beta status `busy`) read the slot. Existing begin() callers (session/checkup-run.ts:1017, routes/plan.ts:221, server.ts:3176) keep working through the default kind. The Website Audit start route (G2) calls begin(id, url, 'audit') and answers 409 ERR_RUN_IN_PROGRESS when refused (website-audit.ts:1036).

- **Requirements:** REQ-049 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** BE-102
- **File ownership:** `packages/runner/src/session/run-slot.ts`, `packages/runner/src/server.ts`, `packages/runner/tests/run-slot.test.ts`, `packages/runner/tests/benchmark.test.ts`
- **Acceptance criteria:**
  - REQ-049 AC-1: while a Check-up holds the slot, begin(…, 'audit') returns false (and a running Check-up refuses an audit start).
  - REQ-049 AC-2: while a Website Audit holds the slot, a Check-up start (begin default kind, and POST /api/runner/run) is refused with 409 ERR_RUN_IN_PROGRESS.
  - REQ-049 AC-3: while a Competitive Benchmark holds the slot, a Check-up or Website Audit start is refused; POST /api/runner/run answers 409 during a benchmark.
  - REQ-049 AC-4: two start requests of different kinds issued together while the slot is free: exactly one claims it (unit test with interleaved begin calls; server test with concurrent benchmark + Check-up requests).
  - REQ-049 AC-5: `benchmarkBusy` does not appear anywhere in packages/runner/src (source assertion in run-slot.test.ts).
  - The slot reports which kind holds it and is released after a benchmark finishes or fails.
- **Validation commands:**
  - CHK-BE-103-UNIT (unit): `pnpm exec vitest run packages/runner/tests/run-slot.test.ts`
  - CHK-BE-103-SERVER (integration): `pnpm exec vitest run packages/runner/tests/benchmark.test.ts packages/runner/tests/scheduler.test.ts packages/runner/tests/runner-server.test.ts`
- **Expected outputs:**
  - RunSlot.kind and begin(runId, targetUrl, kind) in packages/runner/src/session/run-slot.ts
  - benchmarkBusy removed from server.ts
  - packages/runner/tests/run-slot.test.ts
- **Execution status:** VERIFIED

### DOC-104 — ADR 0036: hosted Website Audit storage and Shared Links (amends ADR 0032)

DEC-003 / REC-08. Write docs/adr/0036-hosted-audit-storage-and-shared-links.md in the repo's ADR style (Status line, Context, Decision, Consequences, Alternatives). Planned with the recommended default of parked decision D-003/Q-50: hosted Website Audit data lives in a Google Cloud Storage always-free bucket (local runs keep the data folder), accessed only by the runner's service account; retention per Q-30: kept until the tool user deletes the Website Audit, deleting removes every version, edit, file, Shortlist entry, Shared Link and Helper grant; Shared Links expire after 30 days and can be revoked; `/s/:linkId` is served by the runner as a `public` route (route table, BE-102), noindex, strict Content-Security-Policy, 410 when expired or revoked, reading only the shared snapshot. Record the $0 hosting trade-off against /tmp data loss on scale-to-zero (AR-09) and the Q-39 tension named by Q-50. Add one line to docs/adr/0032-google-cloud-only-hosting.md pointing to the amendment. Status is Accepted only with the developer's answer to D-003; if the answer differs, the ADR follows the answer. Add a docs contract test asserting the ADR's required content.

- **Requirements:** REQ-050 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** none
- **File ownership:** `docs/adr/0036-hosted-audit-storage-and-shared-links.md`, `docs/adr/0032-google-cloud-only-hosting.md`, `packages/runner/tests/adr-0036.test.ts`
- **Acceptance criteria:**
  - REQ-050 AC-1: docs/adr/0036-*.md exists, has Status Accepted (with D-003's answer and date), and states where hosted Website Audit data lives, how it is retained and deleted, and how `/s/:linkId` is served.
  - REQ-050 AC-3: its retention and Shared Link rules match Q-30: kept until the tool user deletes the Website Audit, deletion removes all its data, Shared Links expire after 30 days and can be revoked.
  - It names ADR 0032 as amended, and ADR 0032 links back to 0036.
  - Uses CONTEXT.md terms (Website Audit, Shared Link, Helper, Shortlist) and none of their Avoid words.
  - REQ-050 AC-2 (plan inspection): every Website Audit store task in the merged plan depends on DOC-104 (checked by the orchestrator at merge).
- **Validation commands:**
  - CHK-DOC-104-ADR (documentation): `pnpm exec vitest run packages/runner/tests/adr-0036.test.ts`
- **Expected outputs:**
  - docs/adr/0036-hosted-audit-storage-and-shared-links.md (Accepted)
  - Back-link in docs/adr/0032-google-cloud-only-hosting.md
  - packages/runner/tests/adr-0036.test.ts
- **Execution status:** VERIFIED

### DOC-105 — ADR 0037 route access model (owner, Helper, public, beta) and ADR 0015 Accepted for pacing

Records two decisions already taken. (1) docs/adr/0037-route-access-levels.md: the owner / Helper / public authorization model of DEC-001: every runner route declares an access level ('owner', 'view', 'edit', 'export', 'sign-in', 'public', matching AUDIT_API) and a beta policy; dispatch refuses a route with none (closed by default); owner = access key holder; Helpers get view/edit/export per audit (REQ-033) and never owner rows; 'public' rows are Shared Links only; beta visitors reach only rows whose policy allows them, with audit rows closed except 'public' (D-004/Q-51 recommended default, parked). It builds on ADR 0027 (route table) and is where Helper sign-in (ADR 0033 follow-up 0037) is placed: Google ID token verification details stay with the REQ-033 task, which extends this ADR rather than writing another 0037. (2) docs/adr/0015-live-site-request-rules.md: Status moves to Accepted for pacing only, as ADR 0033 and Q-12 say: one request at a time per host and robots.txt Crawl-delay honoured (implemented by BE-105); the GraphQL POST and GET/HEAD replay questions stay undecided and the Safety Filter rules for them are unchanged. Add a docs contract test.

- **Requirements:** REQ-048, REQ-035, REQ-050 · **Agent:** backend-engineer · **Priority:** medium · **Complexity:** S
- **Depends on:** none
- **File ownership:** `docs/adr/0037-route-access-levels.md`, `docs/adr/0015-live-site-request-rules.md`, `packages/runner/tests/adr-0037-0015.test.ts`
- **Acceptance criteria:**
  - REQ-048 AC-7: an ADR (0037) records the owner, Helper and public authorization model, the six access levels, closed by default, and the beta policy.
  - ADR 0015 has Status Accepted for pacing (one request at a time per host, Crawl-delay honoured, Q-12), with GraphQL/replay explicitly left undecided.
  - ADR 0037 states D-004's answer (or the recommended default pending it) and links ADR 0027, 0033 and 0036.
  - CONTEXT.md terms used exactly (Helper, Shared Link, Website Audit).
- **Validation commands:**
  - CHK-DOC-105-ADR (documentation): `pnpm exec vitest run packages/runner/tests/adr-0037-0015.test.ts`
- **Expected outputs:**
  - docs/adr/0037-route-access-levels.md
  - docs/adr/0015-live-site-request-rules.md Status Accepted (pacing)
  - packages/runner/tests/adr-0037-0015.test.ts
- **Execution status:** VERIFIED

### BE-611 — Audit Page Content and screenshot file routes (AUDIT_API.content, AUDIT_API.file)

RE-PLAN (BE-190 partial, autopilot replan 1/1): no task implemented AUDIT_API.content (GET /api/audits/:id/content?path=&version=, reply AuditContentReply { content: PageContent }) or AUDIT_API.file (GET /api/audits/:id/file?path=&version=, a screenshot of the version by its path relative to the version's folder). The wizard already calls content (packages/wizard/src/screens/audit/results/analysis-client.ts, packages/wizard/src/screens/audit/documents/review-api.ts). Add packages/runner/src/routes/audit-content.ts exporting a route factory (for example auditContentRoutes({ store, caller })) that returns the two rows, with method, path and access taken from AUDIT_API (both 'view', beta closed), following the conventions of audit-store.ts, audit-documents.ts and audit-export.ts: Helper access through mayUseAudit(view) from audit-store.ts, validated id and query values, the latest version when version is absent, Page Content read through the audit store (readVersionJson, the same pages/<slug>-<hash> key audit-documents.ts uses), the screenshot read through store.getVersionFile. Do not register the rows: BE-190 does that in routes/index.ts.

- **Requirements:** REQ-048, REQ-020 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-601, BE-602, BE-189, BE-509
- **File ownership:** `packages/runner/src/routes/audit-content.ts`, `packages/runner/tests/audit-content-routes.test.ts`
- **Acceptance criteria:**
  - The two rows' method, path and access equal AUDIT_API.content and AUDIT_API.file; neither row has beta 'allow'.
  - GET content with a recorded page path answers 200 AuditContentReply for the owner and for a Helper granted the audit; a Helper without a grant gets the same refusal as the other view rows; an unknown audit, version or page answers 404 ERR_AUDIT_NOT_FOUND; a missing or invalid path or version answers 400 ERR_INVALID_REQUEST.
  - GET file answers the screenshot bytes with an image content type, X-Content-Type-Options nosniff and Cache-Control no-store; a path that is absolute, contains '..', a backslash or an encoded separator, or names a file the version did not record, is refused (400 or 404) and never reads outside the version's folder.
  - Store failures answer 500 with a fixed sentence and no internals.
- **Validation commands:**
  - CHK-BE-611-UNIT (unit): `pnpm exec vitest run packages/runner/tests/audit-content-routes.test.ts`
- **Expected outputs:**
  - packages/runner/src/routes/audit-content.ts with the content and file rows
  - packages/runner/tests/audit-content-routes.test.ts
- **Execution status:** VERIFIED

### BE-612 — Production runner wiring: one audit store, Helper access and public accessors for the audit routes

RE-PLAN (BE-190 partial, autopilot replan 1/1): the production runner (packages/runner/src/cli.ts) builds RunnerServer without helperAccess, so the dispatch hooks in server.ts (helperGrants, Helper refusals, ~lines 850-890) never apply and a signed-in Helper cannot use the audits granted to them; and routes/index.ts (BE-190) reads private RunnerServer members (dataDir, keyResolver, helperAccess, readAiModels, carriesAccessKey) through an unknown cast. In packages/runner/src/server.ts add a small public, read-only surface for the audit routes (for example an `auditWiring` getter returning the one audit store for this runner, built once from createAuditStore(selectAuditStoreBackend({ dataDir })), the key resolver, the Helper access, a read of the saved AI models and an isOwnerRequest(req)), and give the runner a HelperAccess over that same store when Helper sign-in is configured (createHelperAccess({ ...helperSettingsFromEnv(), store })) unless options.helperAccess is given; change cli.ts only if needed. Keep every existing behaviour of server.ts (loopback owner DEC-004, run slot, beta rules).

- **Requirements:** REQ-033, REQ-048 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** BE-102, BE-103, BE-601, BE-606
- **File ownership:** `packages/runner/src/server.ts`, `packages/runner/src/cli.ts`, `packages/runner/tests/server-audit-wiring.test.ts`
- **Acceptance criteria:**
  - A RunnerServer built as cli.ts builds it, with Helper sign-in configured, passes Helper refusals and grants through dispatch: a Helper session may use a view row of a granted audit and is refused for an audit not granted; with Helper sign-in not configured the Helper rows say it is not set up and owner behaviour is unchanged.
  - The audit routes can get the audit store, key resolver, Helper access, saved AI models and the owner test through a typed public surface; no caller needs a cast to reach private RunnerServer members.
  - There is one audit store instance per runner, shared by Helper access and the audit routes.
  - Existing runner server tests keep passing (CHK-BE-102-SERVER, CHK-BE-103-SERVER, CHK-QA-706-RUNNER-BROWSER).
- **Validation commands:**
  - CHK-BE-612-UNIT (integration): `pnpm exec vitest run packages/runner/tests/server-audit-wiring.test.ts packages/runner/tests/helper-access.test.ts packages/runner/tests/audit-helpers-routes.test.ts`
- **Expected outputs:**
  - Typed public audit wiring surface on RunnerServer and Helper access in the production runner
  - packages/runner/tests/server-audit-wiring.test.ts
- **Execution status:** VERIFIED

### BE-190 — Integration: runner registration of audit-*.ts routes and their dependencies

RE-PLAN NOTE (orchestrator, autopilot replan 1/1): the first pass registered every audit row but reported partial: AUDIT_API.content and AUDIT_API.file had no implementation (now BE-611) and the dependencies were read from private RunnerServer members (now a public surface from BE-612). Second pass: register BE-611's rows and delete NOT_IMPLEMENTED, take the audit store, key resolver, Helper access, AI models and owner test from BE-612's public surface instead of the unknown cast, so AC-2 and the beta test pass with no exclusions. MERGE NOTE (orchestrator): the core barrel part of this task moved to BE-189 (it owns packages/core/src/audit/index.ts, the export line in packages/core/src/index.ts and packages/core/tests/audit-exports.test.ts), so route files can import @qa/core before registration. BE-190 now only registers the route arrays in packages/runner/src/routes/index.ts, passes them their real dependencies (audit store from BE-601 via selectAuditStoreBackend, settings store, PageSpeed key port from BE-405, PDF renderer from BE-507, the audit pipeline from BE-192 as BE-205's afterCrawl step) and owns audit-route-registration.test.ts. Original text follows for context. Wires the area work together. Creates packages/core/src/audit/index.ts exporting `./crawl/index.js`, `./analysis/index.js`, `./ai/index.js`, `./documents/index.js`, `./store/index.js` (each sub-barrel owned by its group), and adds the single line `export * from './audit/index.js'` to packages/core/src/index.ts (resolving any duplicate export names by asking the owning group, not by renaming in their files). In packages/runner/src/routes/index.ts registers every route array exported by packages/runner/src/routes/audit-*.ts in allRoutes (audit rows before Plan rows only where needed for match order). Adds contract tests: packages/runner/tests/audit-route-registration.test.ts asserts that every AUDIT_API entry has exactly one registered route with the same method, path and access (REQ-048 AC-2), that each audit row declares a beta policy, and that packages/runner/src/server.ts contains no inline Website Audit path (`/api/audits`, `/api/audit-settings`, `/api/shortlist`, `/api/helper`, `/s/`) (REQ-048 AC-6); packages/core/tests/audit-exports.test.ts asserts the audit entry points are reachable from @qa/core and that nothing in packages/core/src/audit imports Node `fetch` or Playwright request APIs directly (complements BE-104's guard). Cross-group depends_on (G2 audit-crawl route and crawl barrel, G3 analysis barrel, G4 ai barrel, G5 documents barrel and export routes, G6 store barrel and store/share/shortlist/helper routes) are added by the orchestrator at merge.

- **Requirements:** REQ-048 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-102, BE-103, BE-189, BE-192, BE-205, BE-410, BE-508, BE-509, BE-510, BE-602, BE-603, BE-604, BE-605, BE-606, BE-611, BE-612
- **File ownership:** `packages/runner/src/routes/index.ts`, `packages/runner/tests/audit-route-registration.test.ts`
- **Acceptance criteria:**
  - REQ-048 AC-2: for each entry of AUDIT_API, exactly one route in allRoutes has the same method and path and its declared access equals the entry's access.
  - REQ-048 AC-6: server.ts handles no Website Audit route inline (source assertion).
  - Every audit route declares a beta policy; per D-004 default, only 'public' rows have beta 'allow'.
  - Each route array gets its real dependencies; the audit start route runs the BE-192 pipeline after the crawl.
  - No AUDIT_API entry is excluded from registration (no NOT_IMPLEMENTED list), and routes/index.ts reaches runner internals only through BE-612's public surface.
  - pnpm build passes with the registrations.
- **Validation commands:**
  - CHK-BE-190-UNIT (integration): `pnpm exec vitest run packages/runner/tests/audit-route-registration.test.ts packages/runner/tests/route-table.test.ts`
- **Expected outputs:**
  - Audit routes registered in packages/runner/src/routes/index.ts with their dependencies
  - Contract test audit-route-registration.test.ts
- **Execution status:** VERIFIED

### BE-189 — Core audit barrel and the @qa/core export line

Split from BE-190 at merge so runner route files can import the audit code from @qa/core before they are registered (BE-190 registers them later; avoids a dependency cycle). Creates packages/core/src/audit/index.ts exporting `./crawl/index.js` (BE-204), `./analysis/index.js` (BE-308), `./ai/index.js` (BE-409), `./documents/index.js` (BE-506), `./store/index.js` (BE-601), `./preview/index.js` (BE-605's core part, if it lands under packages/core/src/audit/preview; otherwise omit), `./pipeline/index.js` (BE-192), plus `./phone-layout.js` (BE-708). Adds the single line `export * from './audit/index.js'` to packages/core/src/index.ts, resolving duplicate export names by asking the owning group, not by renaming in their files. Adds packages/core/tests/audit-exports.test.ts: the audit entry points are reachable from @qa/core and nothing in packages/core/src/audit imports Node `fetch` or Playwright request APIs directly (complements BE-104's guard).

- **Requirements:** REQ-048 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-204, BE-308, BE-409, BE-506, BE-601, BE-708, BE-192
- **File ownership:** `packages/core/src/audit/index.ts`, `packages/core/src/index.ts`, `packages/core/tests/audit-exports.test.ts`
- **Acceptance criteria:**
  - @qa/core exposes the audit crawl, analysis, AI, documents and store entry points through packages/core/src/audit/index.ts with no duplicate-export build error (pnpm build passes).
  - packages/core/src/index.ts gains only the audit export line in this task.
  - No module under packages/core/src/audit calls Node fetch or Playwright request APIs directly (source assertion).
- **Validation commands:**
  - CHK-BE-189-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-exports.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/index.ts and the export line in packages/core/src/index.ts
  - Contract test audit-exports.test.ts
- **Execution status:** VERIFIED

### BE-192 — Website Audit pipeline: crawl to AuditResult (analysis, phone layout, speed, AI, ranking, roadmap, grades, save)

Added at merge: no group owned the step that turns a finished crawl into an AuditResult. Creates packages/core/src/audit/pipeline/** with barrel packages/core/src/audit/pipeline/index.ts exporting `runAuditPipeline(crawlResult, deps)`, plugged into BE-205's injectable `afterCrawl` step by BE-190. Stages, in order, emitting AuditProgressEvent stages from packages/types/src/website-audit.ts: (1) pass readPage (BE-301) through runAuditCrawl's onRenderedPage hook (BE-204) so each page is visited once, and call recordPhoneLayout (BE-708) and accessibilityBasics (BE-307) on Sample Pages while they are open; (2) analyseSite (BE-308) with a FetchFn from makeOutboundFetch (BE-101) paced by the audit's HostPacer (BE-105); (3) measureSampleSpeeds (BE-404); (4) compute each audit area's deterministic grade (AreaAssessment.grade, mapped from scoring.ts calculateSiteAspectGrades to AUDIT_AREAS; owned here because no group owned it), then assessPages/assessSite/recommendPages (BE-406, BE-407); (5) scoreFindings/rankFindings (BE-403), continuing finding numbers from analyseSite.nextFindingNumber and keeping AF ids; (6) buildRoadmap (BE-502); (7) save the version through the audit store (BE-601) per ADR 0036. Any stage failure is recorded as not done, never as a clean result. Uses the RunSlot already held by BE-205. Unit tests use fakes for every stage; no real network.

- **Requirements:** REQ-003, REQ-016, REQ-017, REQ-037 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** L
- **Depends on:** BE-204, BE-308, BE-708, BE-404, BE-406, BE-407, BE-403, BE-502, BE-601, BE-105
- **File ownership:** `packages/core/src/audit/pipeline/**`, `packages/core/tests/audit-pipeline.test.ts`
- **Acceptance criteria:**
  - runAuditPipeline produces an AuditResult whose pages, hierarchy, findings (ranked, cited by page and Section), area assessments with grades, recommendations, speed and roadmap come from the stage modules, in the documented order.
  - Each page is visited once: readPage, phone layout and accessibility run inside the crawl's onRenderedPage hook.
  - Every page-derived request in the pipeline goes through makeOutboundFetch with the audit's HostPacer.
  - A failing stage is recorded as not done in the result and progress events; later stages still run where their inputs exist.
  - The finished version is saved through the audit store, so cascade delete covers it.
- **Validation commands:**
  - CHK-BE-192-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-pipeline.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/pipeline/** with runAuditPipeline
  - Unit test audit-pipeline.test.ts
- **Execution status:** VERIFIED

### FE-191 — Integration: register Website Audit screens in the wizard router and App

Adds the Website Audit screens built by the other groups under packages/wizard/src/screens/audit/** to the wizard: new Route variants and PATHS in packages/wizard/src/lib/router.ts (e.g. start, list of saved Website Audits, one Website Audit with its sections; exact paths as declared by the screen tasks), matchRoute cases with decoded, validated ids (an unreadable id is not-found, like reports), and the screen switch, tab title and step handling in packages/wizard/src/App.tsx. Website Audit routes are not Check-up routes: isCheckRoute and readsAddressParam stay false for them, so the Check-up phase never moves the user off an audit screen. UI text uses CONTEXT.md terms exactly (Website Audit, Audit Document, Pitch Glimpse, Owner Audit, Shared Link) and none of their Avoid words. Imports stay browser-safe (`@qa/types/src/...` single modules, never the barrel). Cross-group depends_on (each FE screen task of G2-G6) is added by the orchestrator at merge.

- **Requirements:** REQ-001, REQ-028 · **Agent:** frontend-engineer · **Priority:** medium · **Complexity:** S
- **Depends on:** FE-200, FE-301, FE-400, FE-401, FE-500, FE-501, FE-600, FE-601, FE-602
- **File ownership:** `packages/wizard/src/lib/router.ts`, `packages/wizard/src/App.tsx`, `packages/wizard/tests/router.test.ts`, `packages/wizard/tests/audit-routing.test.ts`
- **Acceptance criteria:**
  - Each Website Audit screen under packages/wizard/src/screens/audit/** has a route: navigating to its path selects it, refresh and Back/Forward keep it (matchRoute round-trips PATHS).
  - An audit path with an unreadable or invalid id resolves to not-found.
  - isCheckRoute and readsAddressParam are false for every audit route; existing Check-up routes match exactly as before.
  - App.tsx renders each audit screen for its route (source contract test: every exported screen in screens/audit is imported and used by App.tsx).
  - No wizard file imports the @qa/types barrel for audit values (browser-safe imports).
- **Validation commands:**
  - CHK-FE-191-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/router.test.ts packages/wizard/tests/audit-routing.test.ts`
- **Expected outputs:**
  - Audit routes in packages/wizard/src/lib/router.ts
  - Audit screens wired in packages/wizard/src/App.tsx
  - packages/wizard/tests/audit-routing.test.ts
- **Execution status:** VERIFIED

### QA-195 — End-to-end Website Audit through the runner against fixtures/audit-site (website-audit-e2e)

One browser test, packages/runner/tests/website-audit-e2e.test.ts, starting a RunnerServer (temp data dir, OS-chosen port) and the audit-site fixture server (packages/core/tests/helpers/audit-site-server.ts, request log). Because the Website Audit accepts public addresses only, the test uses the runner's test seam for host checks (injected lookup mapping a public-looking test host to 127.0.0.1, as beta refusedTarget uses hostChecks.lookup) provided by the audit start route task (G2). Flow: POST /api/audits (start, 202) -> GET /api/audits/:id/stream until done -> GET /api/audits/:id and /content; assert pages found, Skipped Pages with reasons robots (/private/staff-rota and sitemap-only /private/reports never requested), sign-in, payment, depth-limit; the off-host `Sitemap:` line never fetched; request log shows no overlapping top-level requests and Crawl-delay (1 s) respected; a Check-up start during the audit answers 409 ERR_RUN_IN_PROGRESS; an owner route without the access key (RUNNER_ACCESS_TOKEN set) is refused and a Shared Link `/s/:linkId` (if created through createShare) is served without it; export of the Audit Documents succeeds; no response contains a release verdict. AI steps run without an AI key (assessment 'no-ai-key'), so no external request is made.

- **Requirements:** REQ-034, REQ-035, REQ-047, REQ-048, REQ-049 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-190, FE-191, BE-104, BE-105, BE-192
- **File ownership:** `packages/runner/tests/website-audit-e2e.test.ts`
- **Acceptance criteria:**
  - A full Website Audit of fixtures/audit-site completes through the runner HTTP API and its result lists the fixture's pages and Skipped Pages with reasons robots, sign-in, payment and depth-limit.
  - REQ-034 AC-1 end to end: /private/staff-rota (linked) and /private/reports (sitemap only) are never requested and are Skipped Pages with reason robots.
  - REQ-035 AC-1 end to end: in the fixture request log, top-level requests never overlap and starts are at least the 1 s Crawl-delay apart.
  - REQ-047 AC-4 end to end: the robots.txt Sitemap: line for sitemaps.example.invalid is not fetched.
  - REQ-049 AC-2 end to end: POST /api/runner/run during the audit answers 409 ERR_RUN_IN_PROGRESS.
  - REQ-048 end to end: an owner audit route without the access key is refused; the public Shared Link route is served without it.
  - No audit reply or export contains a release verdict or 'Ready to release'.
- **Validation commands:**
  - CHK-QA-195-E2E (e2e): `pnpm exec vitest run packages/runner/tests/website-audit-e2e.test.ts`
- **Expected outputs:**
  - packages/runner/tests/website-audit-e2e.test.ts (browser project)
- **Execution status:** VERIFIED

### BE-200 — Deterministic Spider: record depth-limit skips and add audit crawl hooks

Extend packages/core/src/discovery/deterministic-spider.ts with small, opt-in hooks the Website Audit needs, leaving Check-up behaviour unchanged when they are not set. (1) Record `depth-limit` as a Skipped Page: today the frontier returns it (frontier.ts:133-134) but enqueue (deterministic-spider.ts:381-394) only records `trap-limit`. One entry per path. (2) `admitPath?: (url: URL, depth: number) => { why: RouteSkipReason; detail?: string } | undefined`, asked in enqueue before the frontier for every candidate except the start entries; a verdict records a Skipped Page and the URL is never visited (used for `excluded` and checkout-path `payment`). (3) `inspectPage?: (page: Page, landed: URL) => Promise<{ why: RouteSkipReason; detail?: string } | undefined>`, asked after the page has landed and passed the existing classifications, before overlay dismissal, link extraction, element inventory, clicks or screenshot; a verdict records the page as a Skipped Page with that reason, pushes `sign-in` verdicts to `signInWalls`, and follows none of its links. (4) `followFormActions?: boolean` (default true): false stops GET form actions being enqueued as links (deterministic-spider.ts:845-858). (5) `onRecordedPage?: (page: Page, item: SpiderPageInventoryItem) => Promise<void>`, awaited after a page is recorded, on the rendered page (the seam for Page Content extraction, REQ-009, group G3). (6) `onSkipped?: (info: SkippedPageInfo) => void`, called for every Skipped Page, for progress. (7) `depth` (link steps from the start address) on each SpiderPageInventoryItem. Builds on BE-101, which moves this file's robots/sitemap requests to the ADR 0031 outbound fetch.

- **Requirements:** REQ-002, REQ-003, REQ-005, REQ-006, REQ-036 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-101
- **File ownership:** `packages/core/src/discovery/deterministic-spider.ts`, `packages/core/tests/spider-audit-hooks.test.ts`
- **Acceptance criteria:**
  - Given maxDepth D and a link D+1 link steps from the start address, when the Spider crawls, then that page is not recorded and appears once in `skipped` with reason `depth-limit` (REQ-002 AC-2); today's silent drop is gone.
  - Given an `admitPath` that returns `excluded` for /blog, when the Spider meets /blog/x through a link or sitemap.xml, then /blog/x is never requested (fixture request log) and is listed in `skipped` with reason `excluded`; the start address is never passed to `admitPath`.
  - Given an `inspectPage` that returns `payment` for a page, when the Spider lands on it, then the page is not in `pages`, is in `skipped` with reason `payment`, no element on it is clicked, and no link found only on that page is requested (REQ-036 AC-1).
  - Given an `inspectPage` that returns `sign-in`, when the Spider lands on that page, then it is in `skipped` with reason `sign-in` and in `signInWalls`, and nothing on it is filled in or clicked (REQ-006 AC-1).
  - Given `followFormActions: false` and a page with a GET form, when crawled, then the form action URL is not enqueued and no form is submitted (REQ-003 AC-3).
  - Given `onRecordedPage`, when a page is recorded, then the hook receives the live Playwright page after JavaScript has run, so text and links inserted by script after load are present (REQ-005 AC-1 seam), and each recorded item carries its `depth`.
  - `onSkipped` is called exactly once for each entry pushed to `skipped`.
  - With none of the new options set, existing Spider behaviour is unchanged: spider-links-and-traps, spider-page-limit and spider-signin-walls tests pass unmodified.
- **Validation commands:**
  - CHK-BE-200-INTEGRATION (integration): `pnpm exec vitest run packages/core/tests/spider-audit-hooks.test.ts packages/core/tests/spider-links-and-traps.test.ts packages/core/tests/spider-page-limit.test.ts packages/core/tests/spider-signin-walls.test.ts`
- **Expected outputs:**
  - CrawlOptions gains admitPath, inspectPage, followFormActions, onRecordedPage, onSkipped; SpiderPageInventoryItem gains depth
  - depth-limit recorded as a Skipped Page
  - New browser test packages/core/tests/spider-audit-hooks.test.ts (G7 adds `spider-audit-hooks` to BROWSER_TESTS.core)
- **Execution status:** VERIFIED

### BE-201 — Audit crawl: payment-area and sign-in-page detection rules

New module packages/core/src/audit/crawl/area-detect.ts. Pure rules plus one thin page reader. `isCheckoutPath(pathname)`: a path segment such as checkout, payment, pay, billing (path rule of Q-10). `paymentEvidence(facts)`: a card-number field (autocomplete cc-number, or a name/id/label matching card number patterns) or a payment-provider frame (iframe src host of a known provider list, e.g. Stripe, Razorpay, PayPal, Paytm, PayU, Cashfree, PhonePe, CCAvenue, Instamojo, Braintree, Adyen, Square); returns the evidence kind or undefined. `readAreaFacts(page)`: reads inputs (type, name, id, autocomplete, label) and iframe src hosts from the rendered page without touching any element. `pageAreaVerdict(page, landed)`: `payment` (evidence or checkout path), else `sign-in` when the page is nothing but a sign-in form (reuses `isSignInOnlyForm` and `readPageForms` exported by deterministic-spider.ts), else undefined. This is the `inspectPage` implementation BE-204 passes to the Spider; `isCheckoutPath` also feeds `admitPath`.

- **Requirements:** REQ-006, REQ-036 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** none
- **File ownership:** `packages/core/src/audit/crawl/area-detect.ts`, `packages/core/tests/audit-area-detect.test.ts`
- **Acceptance criteria:**
  - A page with a field whose autocomplete is cc-number, or whose name, id or label names a card number, is identified as a payment area (Q-10 card-number field).
  - A page with an iframe from a payment-provider host is identified as a payment area (Q-10 provider frame); an iframe from any other host (e.g. a map or video embed) is not.
  - Paths such as /checkout, /shop/checkout and /cart/checkout/pay are checkout paths; /checkout-guide-blog-post style look-alikes inside a word and ordinary paths (/shop, /about) are not.
  - A page that is nothing but a sign-in form (one visible password form whose fields are all sign-in fields) gets verdict `sign-in`; a page with a sign-in form beside other content forms does not (same rule as isSignInOnlyForm, LC-002).
  - Reading facts never clicks, focuses, fills in or submits anything (the reader only evaluates DOM properties).
  - Each verdict carries a short fixed `detail` (card-field, provider-frame, checkout-path, sign-in-form), never page text.
- **Validation commands:**
  - CHK-BE-201-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-area-detect.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/crawl/area-detect.ts with isCheckoutPath, paymentEvidence, readAreaFacts, pageAreaVerdict
  - Unit tests over plain fact objects (no browser)
- **Execution status:** VERIFIED

### BE-202 — Audit crawl: include/exclude path-prefix filter

New module packages/core/src/audit/crawl/limits.ts: `pathLimitVerdict(pathname, limits, startPath)` returns `excluded` or undefined per Q-11: include and exclude are path prefixes matched on whole path segments (/blog matches /blog and /blog/x, not /blogger), compared on the decoded, case-preserved path; an exclude match wins; when include paths are set a path matching none is excluded; the start page is always allowed. Input limits are the already-validated `AuditLimits` from `validateAuditStartBody` (packages/types/src/website-audit.ts).

- **Requirements:** REQ-002 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** XS
- **Depends on:** none
- **File ownership:** `packages/core/src/audit/crawl/limits.ts`, `packages/core/tests/audit-crawl-limits.test.ts`
- **Acceptance criteria:**
  - Given an exclude path /blog, /blog and /blog/2025/x get `excluded`; /blogger and /about do not (REQ-002 AC-3).
  - Given include paths [/services], /services/catering is allowed and /about gets `excluded`; the start page is allowed whatever the include and exclude paths say (REQ-002 AC-4, Q-11).
  - A path matching both an include and an exclude path is `excluded`.
  - Percent-encoded paths are compared after decoding (/caf%C3%A9 matches the prefix /café); a path that cannot be decoded is compared as written, never throws.
  - No include and no exclude paths: every path is allowed.
- **Validation commands:**
  - CHK-BE-202-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-crawl-limits.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/crawl/limits.ts with pathLimitVerdict and unit tests
- **Execution status:** VERIFIED

### BE-203 — Audit start address check: public-only and reachable (Q-22)

New module packages/core/src/audit/crawl/reachability.ts: `checkAuditAddress(url, { timeoutMs?, netDeps? })`. Public means the host resolves to public addresses only (`resolvePublic`, packages/core/src/safe-net.ts:115); private and local addresses are refused for a Website Audit only. Reachable means the final response after redirects (each hop re-checked, through the ADR 0031 outbound path from BE-101 / `safeGet`) is below 400 within the existing page timeout. Returns `{ ok: true, finalUrl, status }` or `{ ok: false, code: 'ERR_PRIVATE_ADDRESS' | 'ERR_UNREACHABLE', reason }` with a short message for people (no internals). The Check-up preflight (packages/core/src/preflight.ts) is not touched, so Test Copies on local and private addresses keep working.

- **Requirements:** REQ-001 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S · **P2 (sensitive)**
- **Depends on:** BE-101
- **File ownership:** `packages/core/src/audit/crawl/reachability.ts`, `packages/core/tests/audit-reachability.test.ts`
- **Acceptance criteria:**
  - Given a host that resolves to a public address and answers below 400 (after redirects), the check returns ok with the final URL (REQ-001 AC-1).
  - Given a host that does not resolve, does not answer within the page timeout, or answers 400 or above, the check returns ERR_UNREACHABLE with a message that says why (REQ-001 AC-2).
  - Given a host that resolves to a private, loopback or link-local address, or a redirect hop to one, the check returns ERR_PRIVATE_ADDRESS and no request is sent to that address (Q-22).
  - A response cut at the byte cap with a status below 400 counts as reachable (the body is not needed).
  - Tests inject NetDeps (no real network or DNS); packages/core/src/preflight.ts and the Check-up reachability path are unchanged.
- **Validation commands:**
  - CHK-BE-203-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-reachability.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/crawl/reachability.ts with checkAuditAddress and unit tests
- **Execution status:** VERIFIED

### BE-204 — Audit crawl pipeline on the Deterministic Spider, with crawl barrel

New packages/core/src/audit/crawl/crawl.ts: `runAuditCrawl(request: AuditRequest, opts)` drives the Deterministic Spider for a Website Audit in Safe Interaction Mode and returns an `AuditCrawlResult` { startUrl, finalUrl, pages (urlPath, title, depth, layoutGroup, links, screenshotPath), coverage: PageCoverage (found, reached, skipped with reasons), leavingSite: Array<{ to, from[] }>, signInWalls, paymentAreas }. Settings: maxPages and maxDepth from the request limits; `admitPath` = BE-202 path filter (`excluded`) then BE-201 checkout path (`payment`); `inspectPage` = BE-201 verdict; exploreClicks false, followFormActions false, no Roles, no credentials, no relogin handler, sitemap seeding on; a context with the public-only request guard (`makeRequestGuard`, `installRequestGuard`) and `blockChanges` so no changing request leaves the browser; robots.txt policy and per-host pacing from G1's REQ-034/REQ-035 APIs. Options: signal, `onProgress({ stage: 'crawling', pagesFound, pagesRecorded, pagesSkipped, currentPath })` with redacted paths, `onRenderedPage(page, info)` passed through to the Spider's `onRecordedPage` for Page Content extraction (G3), and an in-process `deps` parameter (browser manager, request guard, NetDeps) that tests use to reach the 127.0.0.1 fixture; nothing in AuditRequest can turn the guard off. New barrel packages/core/src/audit/crawl/index.ts exports runAuditCrawl, checkAuditAddress, pathLimitVerdict, area-detect rules and their types (BE-190 re-exports it from packages/core/src/audit/index.ts).

- **Requirements:** REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-036 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** L
- **Depends on:** BE-101, BE-105, BE-200, BE-201, BE-202, BE-203
- **File ownership:** `packages/core/src/audit/crawl/crawl.ts`, `packages/core/src/audit/crawl/index.ts`, `packages/core/tests/audit-crawl.test.ts`
- **Acceptance criteria:**
  - Given maxPages N and fixtures/audit-site with more than N internal pages, at most N pages are recorded and the rest are Skipped Pages with reason `page-limit` (REQ-002 AC-1).
  - Given maxDepth 3, /blog/2025/diwali/sweets (depth 4) and deeper pages are not recorded and are Skipped Pages with reason `depth-limit` (REQ-002 AC-2).
  - Given exclude path /blog, no /blog page is recorded or requested and each is a Skipped Page with reason `excluded`; given include path /services, every recorded page except the start page starts with /services (REQ-002 AC-3, AC-4).
  - With default limits, the pages the home page links to on the same host are recorded (REQ-003 AC-1); facebook.com and instagram.com links are listed in `leavingSite` with the pages they are on and are never requested (REQ-003 AC-2).
  - No form is submitted while crawling: the fixture request log shows no POST and no request to a form action such as /account/sign-in (POST) or /shop/checkout/pay (REQ-003 AC-3).
  - /seasonal-offers, listed only in sitemap.xml, is recorded (REQ-004 AC-1); a page both linked and in sitemap.xml appears once in `pages` (REQ-004 AC-2); against a site with no sitemap.xml the crawl completes from links with no error (REQ-004 AC-3).
  - /updates/festival-hours, a link inserted by JavaScript after load and linked from nowhere else, is recorded, and `onRenderedPage` for /updates sees the script-inserted text (REQ-005 AC-1, crawl part).
  - /account/sign-in (nothing but a sign-in form) and a page answering 401 are flagged in `signInWalls`, listed as Skipped Pages with reason `sign-in`, and no credentials are entered (REQ-006 AC-1).
  - /shop/checkout (card-number field) is flagged in `paymentAreas`, listed as a Skipped Page with reason `payment`, nothing on it is clicked or submitted, and /shop/delivery-terms (linked only from the checkout page) is never requested (REQ-036 AC-1).
  - robots.txt-disallowed pages (/private/staff-rota, /private/reports) are Skipped Pages with reason `robots`, and the off-site `Sitemap:` line in robots.txt is not requested (behaviour supplied by G1; asserted here end to end).
  - Progress events report pagesRecorded and pagesSkipped as they change; paths in them are redacted; an aborted signal returns what was found so far.
  - The production default installs the public-only request guard; only the in-process `deps` parameter (tests) replaces it.
- **Validation commands:**
  - CHK-BE-204-INTEGRATION (integration): `pnpm exec vitest run packages/core/tests/audit-crawl.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/crawl/crawl.ts (runAuditCrawl, AuditCrawlResult)
  - packages/core/src/audit/crawl/index.ts barrel
  - New browser test packages/core/tests/audit-crawl.test.ts (G7 adds `audit-crawl` to BROWSER_TESTS.core)
- **Execution status:** VERIFIED

### BE-205 — Runner route: start a Website Audit and stream its progress

New packages/runner/src/routes/audit-crawl.ts exporting `auditCrawlRoutes` (and a `createAuditCrawlRoutes(deps)` factory for tests) and packages/runner/src/session/audit-run.ts holding the running audit's state and last progress event. `POST /api/audits` (AUDIT_API.start, access 'owner'): validateAuditStartBody, 400 ERR_INVALID_AUDIT with `fields`; checkAuditAddress, 400 ERR_PRIVATE_ADDRESS or 422 ERR_UNREACHABLE; claim the RunSlot with kind 'audit' (BE-103), 409 ERR_RUN_IN_PROGRESS when a Check-up, benchmark or audit holds it; then 202 `{ auditId, version: 1 }` (auditId matches AUDIT_ID_PATTERN) and the audit runs in the background: stage 'checking-address', then 'crawling' via runAuditCrawl, then an injectable `afterCrawl` pipeline step (default: none) that groups G3/G4/G6 extend for analysis and saving; the slot is released on done, failure or abort. `GET /api/audits/:id/stream` (AUDIT_API.stream, access 'view'): Server-Sent Events of AuditProgressEvent ('progress', 'done', 'failed' with a fixed message and AuditErrorCode), replaying the last event to a late subscriber, 404 ERR_AUDIT_NOT_FOUND for an unknown id. Routes declare their access level and beta policy as BE-102 defines (closed in beta unless the policy lists them, D-004). Not registered here: BE-190 adds `auditCrawlRoutes` to allRoutes.

- **Requirements:** REQ-001, REQ-002, REQ-003 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** BE-102, BE-103, BE-204, BE-189
- **File ownership:** `packages/runner/src/routes/audit-crawl.ts`, `packages/runner/src/session/audit-run.ts`, `packages/runner/tests/audit-crawl-route.test.ts`
- **Acceptance criteria:**
  - Given a valid body whose address is public and reachable, POST /api/audits answers 202 with an auditId matching AUDIT_ID_PATTERN and version 1, and the crawl starts with the validated limits (REQ-001 AC-1, REQ-002).
  - Given an address that does not resolve, does not answer, or answers 400 or above, the reply is 422 ERR_UNREACHABLE with a message saying why, and the crawl function is never called (REQ-001 AC-2).
  - Given input that is not a URL (or bad limits), the reply is 400 ERR_INVALID_AUDIT with a message per field, and neither the address check nor the crawl runs (REQ-001 AC-3).
  - Given an address that resolves to a private or local address, the reply is 400 ERR_PRIVATE_ADDRESS and no crawl starts (Q-22); the Check-up start path still accepts local and private Test Copy addresses.
  - While a Check-up, benchmark or another audit holds the RunSlot, POST /api/audits answers 409 ERR_RUN_IN_PROGRESS; while an audit runs, starting a Check-up is refused through the same slot; the slot is released after done, failure or abort.
  - GET /api/audits/:id/stream sends progress events with stage, pagesFound, pagesRecorded, pagesSkipped and a redacted currentPath, then 'done' or 'failed'; a late subscriber first gets the last event; an id that does not match AUDIT_ID_PATTERN or is unknown gets 404.
  - Each route declares its AUDIT_API access level ('owner' for start, 'view' for stream); no request field can enable sign-in, Roles, form submission or private addresses.
  - Error replies are AuditErrorReply ({ error, code, fields? }) with no stack trace, host internals or page text.
- **Validation commands:**
  - CHK-BE-205-UNIT (unit): `pnpm exec vitest run packages/runner/tests/audit-crawl-route.test.ts`
- **Expected outputs:**
  - packages/runner/src/routes/audit-crawl.ts (auditCrawlRoutes, createAuditCrawlRoutes)
  - packages/runner/src/session/audit-run.ts
  - Route test that drives the handlers on a plain http server with a fake crawl, fake address check and a real RunSlot (no Chromium, no RunnerServer: unit project)
- **Execution status:** VERIFIED

### FE-200 — Wizard: Website Audit start screen with address and crawl limits

New screen under packages/wizard/src/screens/audit/start/: AuditStartScreen.tsx (address field, Max pages, Max depth, Include paths, Exclude paths, Start button), audit-start-form.ts (form state, defaults and bounds from CRAWL_LIMIT_BOUNDS, client-side check with validateAuditStartBody imported as a single module from `@qa/types/src/website-audit.js`, never the barrel), audit-start-api.ts (POST /api/audits and the EventSource on /api/audits/:id/stream, mapping AuditErrorReply codes to plain sentences) and AuditProgress.tsx (stage, pages recorded and Skipped Pages counts). English only (ADR 0033: the wizard's own screens stay in English); CONTEXT.md terms (Website Audit, Skipped Page) and none of their _Avoid_ words, no release verdict wording. Registered in the router by FE-191 (G1).

- **Requirements:** REQ-001, REQ-002 · **Agent:** frontend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/wizard/src/screens/audit/start/**`, `packages/wizard/tests/audit-start-screen.test.tsx`, `packages/wizard/tests/audit-start-form.test.ts`
- **Acceptance criteria:**
  - The form has a labelled address field and labelled Max pages (default 200, 1-1000), Max depth (default 8, 0-100), Include paths and Exclude paths fields, with the bounds shown from CRAWL_LIMIT_BOUNDS (REQ-002).
  - Input that is not a URL is refused before any request with the validator's message shown next to the field and announced (role=alert / aria-describedby); no request is sent (REQ-001 AC-3).
  - A 422 ERR_UNREACHABLE or 400 ERR_PRIVATE_ADDRESS reply is shown as a plain sentence saying why the address cannot be audited; 400 ERR_INVALID_AUDIT field messages appear next to their fields; 409 ERR_RUN_IN_PROGRESS says another run is in progress (REQ-001 AC-2).
  - After a 202 the screen shows the audit's progress from the stream: stage, pages recorded and Skipped Pages so far, and done or failed.
  - Every field is reachable and operable by keyboard and has an accessible name; errors are linked to their fields.
  - Screen text uses Website Audit and Skipped Page as CONTEXT.md defines them, no _Avoid_ words, and no "Ready to release" or pass/fail on the site; the wizard bundle imports only `@qa/types/src/website-audit.js` (and other single modules), not the `@qa/types` barrel.
- **Validation commands:**
  - CHK-FE-200-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-start-screen.test.tsx packages/wizard/tests/audit-start-form.test.ts packages/wizard/tests/no-banned-words.test.ts`
- **Expected outputs:**
  - AuditStartScreen.tsx, AuditProgress.tsx, audit-start-form.ts, audit-start-api.ts under packages/wizard/src/screens/audit/start/
  - Render tests (renderToStaticMarkup, node) and form/client tests with a mocked fetch and EventSource
- **Execution status:** VERIFIED

### QA-200 — Independent read-only guarantee test for the audit crawl

Independent verification, written by QA without editing source: packages/core/tests/audit-crawl-read-only.test.ts runs runAuditCrawl against fixtures/audit-site (and a small inline server for a 401 page and a provider-frame payment page) and asserts on the server's request log that the Website Audit only reads: every request is GET or HEAD, no form action is requested, no request carries credentials or a sign-in body, nothing past a payment area is requested, no request goes to a host outside the start host, and no request reaches a private address other than through the test-only deps. Complements BE-204's functional test; it does not re-test limits or sitemap merging.

- **Requirements:** REQ-003, REQ-006, REQ-036 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-204
- **File ownership:** `packages/core/tests/audit-crawl-read-only.test.ts`
- **Acceptance criteria:**
  - Across a full default-limits crawl of fixtures/audit-site, the request log holds only GET and HEAD requests and no request to /shop/checkout/pay or a POST to /account/sign-in (REQ-003 AC-3).
  - No request in the log carries a password, an Authorization header or a cookie the crawl set itself to sign in; /account/sign-in and the 401 page are Skipped Pages with reason `sign-in` (REQ-006 AC-1).
  - /shop/delivery-terms and every link found only on a payment area (card-number field page and provider-frame page) are absent from the log, and the payment pages are Skipped Pages with reason `payment` (REQ-036 AC-1).
  - No request in the log goes to facebook.com, instagram.com or the off-site robots.txt `Sitemap:` host (REQ-003 AC-2).
  - The test fails if exploreClicks or followFormActions is turned on for the audit crawl (checked by asserting the crawl options passed to the Spider through the test deps, or by a click-only link in the inline fixture that must stay unrequested).
- **Validation commands:**
  - CHK-QA-200-INTEGRATION (integration): `pnpm exec vitest run packages/core/tests/audit-crawl-read-only.test.ts`
- **Expected outputs:**
  - New browser test packages/core/tests/audit-crawl-read-only.test.ts (G7 adds `audit-crawl-read-only` to BROWSER_TESTS.core)
- **Execution status:** VERIFIED

### BE-302 — Detect a page's language from its main text by Unicode script share

Add packages/core/src/audit/analysis/language.ts exporting detectPageLanguage(text, declared): PageLanguage (type in packages/types/src/website-audit.ts:322). Count letters per Unicode script (Tamil U+0B80-U+0BFF, Latin, others), pick the script with the largest share, map it to a DocumentLanguage (Latin -> 'en', Tamil -> 'ta'), list other listed languages above a minimum share in `others`, and keep the lang attribute as `declared` (a hint, never the answer). Pure function, no dependency added (no franc or similar). The script table is a data structure so REQ-032 (group G7) can add Devanagari and other scripts later without rewriting the logic.

- **Requirements:** REQ-013 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** none
- **File ownership:** `packages/core/src/audit/analysis/language.ts`, `packages/core/tests/audit-language.test.ts`
- **Acceptance criteria:**
  - REQ-013 AC-1: given text whose letters are mostly Tamil script, detectPageLanguage returns primary 'ta'.
  - REQ-013 AC-2: given text whose letters are mostly Latin script, detectPageLanguage returns primary 'en'.
  - A Tamil page with English parts above the minimum share lists 'en' in `others`; `others` never contains the primary language and has no duplicates.
  - The declared lang attribute is returned as written (null when absent) and does not decide `primary`: Tamil text with lang="en" is still 'ta'.
  - Text with fewer letters than the documented minimum, or mostly in a script with no listed language, returns primary 'not-identified' (never an empty value).
  - Pure and deterministic: no network, no clock, no new npm dependency.
- **Validation commands:**
  - CHK-BE-302-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-language.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/analysis/language.ts with detectPageLanguage
  - packages/core/tests/audit-language.test.ts
- **Execution status:** VERIFIED

### BE-300 — RawPage model and buildPageContent: sections, headings, images, links, forms, CTAs

Interface task for group G3. Add packages/core/src/audit/analysis/raw-page.ts defining RawPage, the facts read from one rendered page in the browser (title or null, meta description or null, html lang, text chunks in page order each tagged with its section boundary (landmark kind or top-level heading), headings with levels, images with src and alt (null when the attribute is missing), anchors with href, text and link region (menu, footer, breadcrumb, internal), contact links (tel:, mailto:), forms with fields (type, label, name, required; no value field exists), CTA candidates, meta generator, script and stylesheet addresses, iframe addresses, JSON-LD blocks (parsed @type list plus a capped raw copy), og:/twitter: meta keys, in-page framework markers, menu tree with nesting, breadcrumb trail, optional response headers). Add packages/core/src/audit/analysis/page-content.ts with buildPageContent(raw, { origin, maxTextChars }) returning PageContent (packages/types/src/website-audit.ts:335) and packages/core/src/audit/analysis/finding-ids.ts with createFindingIdAllocator (AF-001, AF-002...) shared by every analysis rule. Sections follow Q-23 (landmark elements and top-level headings; kind 'page' only when the page has neither); text outside any landmark joins the preceding Section (the first Section when it comes first). CTAs follow Q-33 (buttons and button-styled links, with text and target). Internal link targets become redacted site paths via redactUrl (packages/core/src/redact.ts:12).

- **Requirements:** REQ-008, REQ-009 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-302
- **File ownership:** `packages/core/src/audit/analysis/raw-page.ts`, `packages/core/src/audit/analysis/page-content.ts`, `packages/core/src/audit/analysis/finding-ids.ts`, `packages/core/tests/audit-page-content.test.ts`
- **Acceptance criteria:**
  - REQ-009 AC-1: given a RawPage containing text, headings, images, links, a form, a title, a description and CTAs, buildPageContent returns PageContent with its text, headings with their levels, images with alt text, links, forms with their fields, title, description and CTAs.
  - REQ-009 AC-2: an image with no alt attribute has alt null in the output; an empty alt is kept as '' and is distinct from missing.
  - title is null when the page has no title element and '' when it is empty; description is null when there is no meta description.
  - REQ-008 AC-1: Sections are listed in page order with ids s1..sN, each with its kind and heading when it has one, and sectionText(content, section) returns that Section's own text.
  - REQ-008 AC-2: for any RawPage (including generated ones in a property-style test), Sections are contiguous, start at 0, end at text.length and do not overlap, so every character of the extracted text belongs to exactly one Section.
  - Every heading, image, link, form and CTA carries the sectionId of the Section that contains it.
  - Links to the same host have `to` as a path on the site with secrets in the query redacted; links to another host keep the full address and have leavesSite true; tel:, mailto:, javascript: and fragment-only links are not ContentLinks.
  - CTAs are button elements and button-styled links (role=button, or a class containing button or btn), each with its text, kind and target.
  - Text longer than maxTextChars is cut at that limit and textTruncated is true; Tamil text round-trips character for character.
  - language is filled by detectPageLanguage (BE-302).
  - createFindingIdAllocator returns AF-001, AF-002... in call order, can start from a given number, and reports the next free number.
  - The RawPage type has no field for a form field's value.
- **Validation commands:**
  - CHK-BE-300-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-page-content.test.ts`
- **Expected outputs:**
  - RawPage type (raw-page.ts)
  - buildPageContent (page-content.ts)
  - createFindingIdAllocator (finding-ids.ts)
  - packages/core/tests/audit-page-content.test.ts
- **Execution status:** VERIFIED

### BE-301 — readPage: read a rendered page into RawPage in one read-only browser pass

Add packages/core/src/audit/analysis/read-page.ts exporting readPage(page: Page, { responseHeaders?, maxTextChars? }): Promise<{ raw: RawPage; content: PageContent }>. One page.evaluate walks the DOM in order and collects the RawPage facts of BE-300 (visible text with section boundaries from header/nav/main/aside/footer/role=region landmarks and top-level headings; link region: breadcrumb first (aria-label or class containing breadcrumb, or BreadcrumbList), then menu (inside nav or header, role navigation or banner), then footer (footer or role contentinfo), else internal; nested menu tree; breadcrumb trail; forms and fields without values; meta, scripts, stylesheets, iframes, JSON-LD, framework markers), then calls buildPageContent. Reuses the selectors of the SEO checker's collectDetails (packages/checkers/src/seo.ts:453-545) by copying the logic into the evaluate, without changing the checker. It never clicks, fills, submits, navigates or makes a request. The crawl (group G2) calls it while each recorded page is open, so a page is read once (no second visit, keeping the one-request-at-a-time rule).

- **Requirements:** REQ-007, REQ-008, REQ-009 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-300
- **File ownership:** `packages/core/src/audit/analysis/read-page.ts`, `packages/core/tests/audit-read-page.test.ts`
- **Acceptance criteria:**
  - REQ-007 AC-1: on the fixtures/audit-site home page, each internal link is recorded with its target page and one region: header menu links as 'menu', footer links as 'footer', the breadcrumb link as 'breadcrumb' and links in the main content as 'internal'.
  - REQ-009 AC-1: on the home page, the output contains its text, its h1 and h2 headings with levels, images with alt text, links, the enquiry form with its four fields (name, phone, email, message) and no values, the title, the description and the CTAs 'Order online' (/shop) and 'Call to order' (tel:).
  - REQ-009 AC-2: on the gallery page, the two images without an alt attribute have alt null.
  - REQ-008 AC-1/AC-2: on the home page, Sections come in page order (header, breadcrumb nav, the main content split at its top-level headings, footer) and together cover the whole text exactly once.
  - The menu tree keeps the Services sub-menu (Catering, Party orders) nested under Services; the breadcrumb trail of a blog page is read in order.
  - The meta generator, the /wp-content/ stylesheet and script addresses, the LocalBusiness JSON-LD type and the map iframe address are captured in RawPage.
  - The Tamil page's text is kept character for character and its language is 'ta'; the home page's language is 'en'.
  - The JavaScript-rendered updates page is read after rendering: its script-written text and link are present.
  - Read-only: the fixture server's request log shows no request made during readPage (no form submitted, no navigation, no fetch).
  - The test file is a browser test (launches Chromium): listed for vitest.workspace.ts BROWSER_TESTS (core: 'audit-read-page') via group G7.
- **Validation commands:**
  - CHK-BE-301-BROWSER (integration): `pnpm exec vitest run packages/core/tests/audit-read-page.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/analysis/read-page.ts with readPage
  - packages/core/tests/audit-read-page.test.ts (browser test)
- **Execution status:** VERIFIED

### BE-303 — Detect the CMS or framework from page facts and response headers

Add packages/core/src/audit/analysis/technology.ts exporting detectTechnology(pages: RawPage[], headers?): TechnologyResult (packages/types/src/website-audit.ts:360-396). A fixed signature table covers every entry of TECHNOLOGIES (Q-28 list: WordPress, Wix, Shopify, Squarespace, Webflow, Joomla, Drupal, Zoho Sites, Google Sites, Blogger, Dukaan, GoDaddy Website Builder, React, Next.js, Vue/Nuxt, Angular, Gatsby, Hugo, Jekyll, Astro, Eleventy) using meta generator, script/stylesheet address patterns, in-page markers (__NEXT_DATA__, ng-version, astro-island, data-wf-site...) and headers (x-powered-by, platform headers). Evidence uses fixed wording such as 'meta generator', 'stylesheet from /wp-content/', 'x-powered-by header'. Pure, no request of its own.

- **Requirements:** REQ-010 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-300
- **File ownership:** `packages/core/src/audit/analysis/technology.ts`, `packages/core/tests/audit-technology.test.ts`
- **Acceptance criteria:**
  - REQ-010 AC-1: given page facts from a site built with a recognised CMS or framework, the result is status 'identified' and names it with its kind and fixed-wording evidence; every one of the 21 TECHNOLOGIES has at least one tested signature.
  - Given the fixtures/audit-site home page facts (WordPress generator meta and /wp-content/ addresses), the result names WordPress with evidence 'meta generator' and an address under /wp-content/.
  - REQ-010 AC-2: given facts with no known signature, the result is { status: 'not-identified' }; an 'identified' result never has an empty technologies list.
  - When a CMS and a framework both match (for example Gatsby and React), both are listed, each once.
  - Pure and deterministic: no network, no Playwright import.
- **Validation commands:**
  - CHK-BE-303-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-technology.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/analysis/technology.ts with detectTechnology
  - packages/core/tests/audit-technology.test.ts
- **Execution status:** VERIFIED

### BE-304 — Build the page hierarchy, the navigation map and the internal-linking figures

Add packages/core/src/audit/analysis/hierarchy.ts exporting buildPageHierarchy(pages: Array<{ urlPath; title; raw: RawPage; content: PageContent }>, startPath): PageHierarchy and internalLinking(hierarchy, recordedPaths): InternalLinking (types at packages/types/src/website-audit.ts:402-430). Placement follows Q-23: the start page is the root ('start'); then menu nesting from the start page's menu tree ('menu'); then breadcrumbs, the parent being the last breadcrumb link before the current page ('breadcrumb'); then the URL path, the nearest recorded ancestor path or else the root ('path'). A candidate parent that is not a recorded page, or that would make a cycle, falls through to the next rule. The navigation map lists every internal ContentLink of every recorded page with its target and region.

- **Requirements:** REQ-007, REQ-015 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-300
- **File ownership:** `packages/core/src/audit/analysis/hierarchy.ts`, `packages/core/tests/audit-hierarchy.test.ts`
- **Acceptance criteria:**
  - REQ-007 AC-2: given a finished crawl's recorded pages, every recorded page appears in the hierarchy exactly once (checked by walking the tree), and the root is the start page with placedBy 'start'.
  - REQ-007 AC-1: links lists every internal link of every recorded page with from, to (its target page path), region and text; links that leave the site are not in it.
  - Placement order is menu nesting, then breadcrumbs, then URL path: with fixture-shaped input, /services/catering sits under /services placed by 'menu', a blog post with a breadcrumb trail sits under its breadcrumb parent, and a page reachable by neither sits under its nearest recorded ancestor path or the root ('path').
  - No cycles: menu or breadcrumb data that would make a page its own ancestor falls back to the next rule.
  - internalLinking returns inboundCounts for every recorded page (links from other recorded pages) and unlinkedPages listing recorded pages, other than the start page, that no other recorded page links to (a sitemap-only page appears there).
  - Pure and deterministic: the same input gives the same tree and child order.
- **Validation commands:**
  - CHK-BE-304-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-hierarchy.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/analysis/hierarchy.ts with buildPageHierarchy and internalLinking
  - packages/core/tests/audit-hierarchy.test.ts
- **Execution status:** VERIFIED

### BE-305 — Content problems, broken links through the outbound fetch, and SEO basics

Add packages/core/src/audit/analysis/content-problems.ts (contentProblems(pages, ids): AuditFinding[] with source 'rule'), packages/core/src/audit/analysis/broken-links.ts (checkLinks(pages, { statusByPath, skippedPaths, fetch: FetchFn, maxRequests }, ids)) and packages/core/src/audit/analysis/seo-basics.ts (seoBasics(content, findings): SeoBasics). Rules (Q-26): missing and duplicate titles, missing and duplicate descriptions, duplicate content (exact match of main text, the 'main' Sections or else the whole text, after whitespace normalisation, across every page), heading problems (no H1, more than one H1, skipped heading level), missing alt (per image; empty alt is decorative and not reported; alt quality is never judged, ADR 0018). Broken links: a target's status comes from the crawl when known; otherwise one request through the injected FetchFn built by makeOutboundFetch (BE-101, ADR 0031), requests made one after another, capped. SeoBasics.findingIds point at the page's content findings instead of repeating them (REQ-038 overlap). Ids come from the BE-300 allocator.

- **Requirements:** REQ-014, REQ-038 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** L
- **Depends on:** BE-300, BE-101
- **File ownership:** `packages/core/src/audit/analysis/content-problems.ts`, `packages/core/src/audit/analysis/broken-links.ts`, `packages/core/src/audit/analysis/seo-basics.ts`, `packages/core/tests/audit-content-problems.test.ts`, `packages/core/tests/audit-broken-links.test.ts`
- **Acceptance criteria:**
  - REQ-014 AC-1: given an internal link whose target answers 404 (status from the crawl, or from the injected FetchFn), a 'broken-link' finding names the page and the link target; one finding per broken target lists every page linking to it in `pages`.
  - REQ-014 AC-2: given two pages with the same title (after trimming and collapsing whitespace), one 'duplicate-title' finding lists both pages; pages without a title are not counted as duplicates.
  - REQ-014 AC-3: given a page with no title (null or empty), a 'missing-title' finding names the page with sectionId null.
  - REQ-014 AC-4: given a page with no meta description, a 'missing-description' finding names the page.
  - REQ-014 AC-5: given two pages with the same meta description, one 'duplicate-description' finding lists both pages.
  - REQ-014 AC-6: given an image with no alt attribute, a 'missing-alt' finding names the page, the image address (target) and its Section; an image with alt '' is not reported.
  - Duplicate content: two pages whose main text matches after whitespace normalisation give one 'duplicate-content' finding listing both; two pages sharing title and description but not main text give none.
  - Heading problems: a page with no H1, a page with more than one H1, and a page that skips a heading level each give their own finding ('no-h1', 'multiple-h1', 'skipped-heading-level').
  - Skipped Pages (sign-in, payment, robots, excluded, depth-limit) are never requested and never reported as broken; a FetchFn returning null is not reported as broken; no target is requested twice; requests stop at maxRequests.
  - Requests are made only through the injected FetchFn (no Playwright request API, no global fetch in these modules), one at a time: a fake FetchFn in the test records no overlapping calls.
  - REQ-038: seoBasics records hasTitle, hasDescription, h1Count, skippedHeadingLevel, imagesWithoutAlt, htmlLang (the lang attribute as written) and findingIds that exist among the page's findings.
  - Every finding has a rule, group, area, title, detail, suggestion, impact, effort, urlPath and sectionId; no finding text uses the ADR 0018 words (compliant, accessible, secure, passes) per a regex check in the test.
- **Validation commands:**
  - CHK-BE-305-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-content-problems.test.ts packages/core/tests/audit-broken-links.test.ts`
- **Expected outputs:**
  - content-problems.ts, broken-links.ts, seo-basics.ts under packages/core/src/audit/analysis/
  - packages/core/tests/audit-content-problems.test.ts and audit-broken-links.test.ts
- **Execution status:** VERIFIED

### BE-306 — Report the ten marketing signals per page and site-wide, with NAP

Add packages/core/src/audit/analysis/marketing-signals.ts exporting marketingSignals({ pages: Array<{ raw: RawPage; content: PageContent }>, internalLinking, findings }): MarketingSignal[] and auditMarketing(readPages, signals): AuditMarketing (types: packages/types/src/aspects.ts:31-82, website-audit.ts:631), and packages/core/src/audit/analysis/nap.ts (NAP from <address> elements, LocalBusiness JSON-LD and tel: links). One entry per MARKETING_SIGNALS key, in that order: on-page SEO (title, description, H1, citing content findings), schema (JSON-LD types), internal linking (InternalLinking from BE-304, passed in), social tags (og:/twitter:), analytics and tags (known tag hosts: Google Tag Manager, Google Analytics, Meta Pixel, Microsoft Clarity, Hotjar...), CTAs (PageContent.ctas), lead forms (forms asking for a name, email or phone; not sign-in forms with a password field, not search forms), click-to-call (tel: links), trust signals (Q-27: reviews or ratings, testimonials, certifications), local signals (Q-27: NAP, map embed, LocalBusiness schema). Pure: forms are only read.

- **Requirements:** REQ-015 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-300
- **File ownership:** `packages/core/src/audit/analysis/marketing-signals.ts`, `packages/core/src/audit/analysis/nap.ts`, `packages/core/tests/audit-marketing-signals.test.ts`
- **Acceptance criteria:**
  - REQ-015 AC-1: the result has exactly ten entries, one per MARKETING_SIGNALS key in that order with its label, each with status 'found' or 'not-found' and a fixed-wording detail saying what was found or that it was not found; 'not-checked' only when no page was read.
  - REQ-015 AC-2: given a page with a tel: link, click-to-call is 'found' and that page is in its pages.
  - REQ-015 AC-3: given a page with a lead form, lead forms is 'found' with that page; a sign-in form (password field) and a search form are not lead forms; the module never submits anything (pure function over read facts).
  - REQ-015 AC-4: given a page showing a business name, address and phone number (in an address element or LocalBusiness JSON-LD), local signals lists the NAP with the page it was found on; a map embed and LocalBusiness schema are named in its detail.
  - Trust signals are found from review or rating markup or text, testimonials, or certifications; social tags, analytics, schema, CTAs, on-page SEO and internal linking each report the pages they were found on.
  - auditMarketing returns readPages, checks [] and the ten signals; findingIds reference only ids present in the given findings.
  - Details say what was seen, never that it is good: no ADR 0018 words (compliant, accessible, secure, passes) per a regex check in the test.
- **Validation commands:**
  - CHK-BE-306-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-marketing-signals.test.ts`
- **Expected outputs:**
  - marketing-signals.ts and nap.ts under packages/core/src/audit/analysis/
  - packages/core/tests/audit-marketing-signals.test.ts
- **Execution status:** VERIFIED

### BE-307 — Accessibility basics on a Sample Page by reusing the axe checker

Add packages/core/src/audit/analysis/accessibility-basics.ts exporting accessibilityBasics(page: Page, { urlPath, ids }): Promise<{ basics: AccessibilityBasics | null; findings: AuditFinding[]; note?: string }>. It calls the existing UXQualityChecker (packages/checkers/src/ux-quality.ts:115, axe with wcag2a/2aa/21a/21aa/22aa tags; read-only, no interaction) and maps only its axe violations (F-A11Y findings) to AuditFindings (source 'checker', area 'accessibility', group 'technical', severity and findingId kept, rule = the axe rule id, sectionId null). AccessibilityBasics names 'WCAG 2.2', level 'AA', method 'automatic checks only' (packages/types/src/website-audit.ts:539). Tap-target and overflow results are left to REQ-037 (group G7). No change to packages/checkers.

- **Requirements:** REQ-038 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-300
- **File ownership:** `packages/core/src/audit/analysis/accessibility-basics.ts`, `packages/core/tests/audit-accessibility-basics.test.ts`
- **Acceptance criteria:**
  - REQ-038 AC-1: for an audited Sample Page, the output records its accessibility basics naming standard 'WCAG 2.2', level 'AA' and method 'automatic checks only', with the violation count and the ids of the findings behind it.
  - On the fixtures/audit-site gallery page (two images without alt), the image-alt axe violation is counted and becomes an AuditFinding naming the page.
  - When axe cannot run, basics is null and a note says the accessibility checks did not run on that page: never a zero-violation result.
  - Nothing in the output (basics, findings, note) calls the page accessible or compliant: a regex check over the serialised output finds none of the ADR 0018 words.
  - Only axe findings are mapped; the existing checker and packages/checkers are unchanged; the page is not clicked, filled or navigated.
  - The test file is a browser test (launches Chromium): listed for vitest.workspace.ts BROWSER_TESTS (core: 'audit-accessibility-basics') via group G7.
- **Validation commands:**
  - CHK-BE-307-BROWSER (accessibility): `pnpm exec vitest run packages/core/tests/audit-accessibility-basics.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/analysis/accessibility-basics.ts
  - packages/core/tests/audit-accessibility-basics.test.ts (browser test)
- **Execution status:** VERIFIED

### BE-308 — analyseSite entry point and the audit/analysis barrel

Add packages/core/src/audit/analysis/analyse-site.ts exporting analyseSite(input): SiteAnalysis and the barrel packages/core/src/audit/analysis/index.ts. Input (own type AnalysisInput, so the module does not import the crawl): startPath, recorded pages ({ urlPath, depth, raw, content }), statusByPath and skippedPaths from the crawl, per-Sample-Page accessibility results from BE-307, the injected FetchFn (from makeOutboundFetch), and the first free finding number. Output: technology (BE-303), hierarchy and internalLinking (BE-304), per page { urlPath, title, language, sections (SectionSummary), seo (BE-305) }, the ordered findings (content problems, broken links, accessibility) with unique AF-NNN ids, marketing (BE-306) and nextFindingNumber for the AI findings of group G4. The barrel exports the public API of every analysis module (readPage, buildPageContent, detectPageLanguage, detectTechnology, buildPageHierarchy, internalLinking, contentProblems, checkLinks, seoBasics, marketingSignals, auditMarketing, accessibilityBasics, analyseSite, createFindingIdAllocator, RawPage and AnalysisInput types). BE-190 (group G1) re-exports this barrel from the core barrel.

- **Requirements:** REQ-007, REQ-008, REQ-009, REQ-010, REQ-013, REQ-014, REQ-015, REQ-038 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-301, BE-303, BE-304, BE-305, BE-306, BE-307
- **File ownership:** `packages/core/src/audit/analysis/analyse-site.ts`, `packages/core/src/audit/analysis/index.ts`, `packages/core/tests/audit-analyse-site.test.ts`
- **Acceptance criteria:**
  - Every recorded page appears exactly once in the page list and exactly once in the hierarchy (REQ-007 AC-2), with its language (REQ-013), Section summaries in page order (REQ-008) and SEO basics (REQ-038).
  - technology is always present: 'identified' with names or 'not-identified' (REQ-010 AC-2).
  - Finding ids are unique AF-NNN starting at the given number, in a stable order for the same input; every findingIds entry in seo basics, accessibility basics and marketing signals refers to an existing finding; nextFindingNumber is one past the last id used.
  - Content findings (REQ-014) and the ten marketing signals (REQ-015 AC-1) from the sub-modules are passed through unchanged apart from id assignment; nothing is reported twice for the same rule, page and target.
  - Same input gives the same output (no clock, no randomness); no request is made except through the injected FetchFn.
  - The barrel exports the listed functions and types, and importing it pulls in no runner or wizard module.
  - Unit test with hand-built RawPage inputs and a fake FetchFn (no browser).
- **Validation commands:**
  - CHK-BE-308-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-analyse-site.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/analysis/analyse-site.ts with analyseSite
  - packages/core/src/audit/analysis/index.ts barrel
  - packages/core/tests/audit-analyse-site.test.ts
- **Execution status:** VERIFIED

### QA-300 — Page analysis on the audit fixture site end to end in Chromium

Add packages/core/tests/audit-analysis-fixture.test.ts. Serve fixtures/audit-site with startAuditSite (packages/core/tests/helpers/audit-site-server.ts:99), open each public fixture page in Chromium (sign-in, checkout and /private pages passed in as Skipped Pages), call readPage and accessibilityBasics (gallery and home as Sample Pages), then analyseSite with a FetchFn over the local fixture server (makeOutboundFetch with injected NetDeps for 127.0.0.1, per BE-101), and check every acceptance criterion of the group against the fixture's known scenarios. Independent of the crawl of group G2 so it verifies analysis alone.

- **Requirements:** REQ-007, REQ-008, REQ-009, REQ-010, REQ-013, REQ-014, REQ-015, REQ-038 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-308
- **File ownership:** `packages/core/tests/audit-analysis-fixture.test.ts`
- **Acceptance criteria:**
  - REQ-007: every recorded fixture page is in the hierarchy exactly once; the home page's internal links carry the regions menu, footer, breadcrumb and internal with their target pages; /services/catering sits under /services.
  - REQ-008: every recorded page's Sections are in page order and cover its text exactly once.
  - REQ-009: the home page output has text, headings with levels, images with alt, links, the enquiry form with its fields, title, description and CTAs; the gallery's two images have alt null.
  - REQ-010: the site is identified as WordPress with its evidence.
  - REQ-013: the Tamil page is recorded as Tamil ('ta') and the home page as English ('en').
  - REQ-014: the about page's link to the 404 page gives a broken-link finding naming /about and the target; the fixture's duplicate pair gives one duplicate-title and one duplicate-description finding listing both pages and no duplicate-content finding; the gallery gives two missing-alt findings naming each image; no other page gives a duplicate-title or missing-alt finding.
  - REQ-015: the marketing result has ten signals; click-to-call and local signals (NAP with '/', map embed, LocalBusiness schema) are found on the home page; the lead form is reported and the fixture server's request log has no request to the form's action (/enquiry) and no POST at all.
  - REQ-038: each page has SEO basics; the Sample Pages' accessibility basics name WCAG 2.2 level AA with automatic checks only, and no output text calls a page accessible or compliant.
  - No request reaches a Skipped Page (/account/sign-in, /shop/checkout, /private/*) from the analysis (request log).
  - Browser test: listed for vitest.workspace.ts BROWSER_TESTS (core: 'audit-analysis-fixture') via group G7.
- **Validation commands:**
  - CHK-QA-300-BROWSER (integration): `pnpm exec vitest run packages/core/tests/audit-analysis-fixture.test.ts`
- **Expected outputs:**
  - packages/core/tests/audit-analysis-fixture.test.ts (browser test)
- **Execution status:** VERIFIED

### FE-300 — Wizard views: page hierarchy, Page Content with Sections, page facts, findings list

Add presentational React components under packages/wizard/src/screens/audit/results/: HierarchyView.tsx (PageHierarchy tree and the navigation map grouped by link region); PageContentView.tsx (one page's Page Content: title, description, language, Sections in page order with their own text via sectionText, headings with levels, images with alt or 'Alt text missing', links with region, forms with fields marked as read and never sent, CTAs); PageFactsView.tsx (one AuditPage's language, SEO basics and accessibility basics, plus the site's technology and the ten marketing signals); FindingsList.tsx (AuditFinding[] in the given order with page, Section, all pages of cross-page findings, impact, effort, source; AI ones labelled advisory). analysis-text.ts holds the fixed UI wording used by all four. Types come only from @qa/types/src/browser.js. Props only; no fetching.

- **Requirements:** REQ-007, REQ-008, REQ-009, REQ-010, REQ-013, REQ-014, REQ-015, REQ-038 · **Agent:** frontend-engineer · **Priority:** medium · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/wizard/src/screens/audit/results/HierarchyView.tsx`, `packages/wizard/src/screens/audit/results/PageContentView.tsx`, `packages/wizard/src/screens/audit/results/PageFactsView.tsx`, `packages/wizard/src/screens/audit/results/FindingsList.tsx`, `packages/wizard/src/screens/audit/results/analysis-text.ts`, `packages/wizard/tests/audit-analysis-views.test.tsx`
- **Acceptance criteria:**
  - HierarchyView renders every page of a PageHierarchy exactly once as a nested list with its title (or path) and how it was placed, and the navigation map with each link's page, target and region labelled Menu, Footer, Breadcrumb or Internal link.
  - PageContentView renders the Sections in page order, each with its heading or kind and its own text; headings with levels; images with alt text or 'Alt text missing' when alt is null (an empty alt is shown as decorative); links with region; forms with their fields and a note that forms are read and never sent; CTAs with text and target.
  - Missing values are stated, never blank: 'No title', 'No description', language 'Not identified', technology 'Not identified'.
  - Language shows the detected language name, other languages present and the page's lang attribute as written; Tamil text is rendered with lang="ta" on its element and kept character for character.
  - PageFactsView shows SEO basics as facts, accessibility basics as 'WCAG 2.2 level AA, automatic checks only' with the violation count, the technology, and the ten marketing signals each with found, not found or not checked and its pages and NAP.
  - No rendered text calls a page or the site accessible, compliant or secure, and no release verdict or 'Ready to release' appears (ADR 0018, ADR 0033): asserted on the rendered markup.
  - FindingsList keeps the given order and shows each finding's title, page, Section (or 'Whole page'), every page of a cross-page finding, impact, effort and source; AI findings are labelled advisory.
  - UI text uses CONTEXT.md terms (Website Audit, Page Content, Section, Sample Page, Skipped Page) and none of their Avoid words (scan, scrape, page data, page dump, block, component, region for a Section, plan for the roadmap): asserted by a regex over the rendered markup.
  - Semantic markup: headings in order, lists for trees, tables with header cells; asserted in the server-render test.
  - Imports from @qa/types use only @qa/types/src/browser.js (the browser-entry guard stays green).
- **Validation commands:**
  - CHK-FE-300-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-analysis-views.test.tsx`
- **Expected outputs:**
  - HierarchyView.tsx, PageContentView.tsx, PageFactsView.tsx, FindingsList.tsx, analysis-text.ts under packages/wizard/src/screens/audit/results/
  - packages/wizard/tests/audit-analysis-views.test.tsx
- **Execution status:** VERIFIED

### FE-301 — Wizard analysis screen loading the audit result and Page Content

Add packages/wizard/src/screens/audit/results/analysis-client.ts (getAuditResult(id, version?) on AUDIT_API.get and getPageContent(id, path, version?) on AUDIT_API.content, paths built from the AUDIT_API constants in packages/types/src/website-audit.ts:1040-1046, using the wizard's existing fetch conventions in packages/wizard/src/api.ts) and AnalysisScreen.tsx (props auditId and optional version) showing Structure (HierarchyView), Pages (page list with PageFactsView; covered pages say 'Checked on its Sample Page <path>'), Page Content of the selected page (loaded on selection) and Findings (FindingsList). FE-191 (group G1) mounts AnalysisScreen in the wizard router; this task does not edit the router.

- **Requirements:** REQ-007, REQ-009, REQ-014 · **Agent:** frontend-engineer · **Priority:** medium · **Complexity:** M
- **Depends on:** FE-300
- **File ownership:** `packages/wizard/src/screens/audit/results/AnalysisScreen.tsx`, `packages/wizard/src/screens/audit/results/analysis-client.ts`, `packages/wizard/tests/audit-analysis-screen.test.tsx`
- **Acceptance criteria:**
  - The client requests the AUDIT_API.get and AUDIT_API.content paths with the audit id, the version when given and the page path as a query value (encoded); error replies are returned as { error, code } and never thrown as raw text.
  - AnalysisScreen shows the page hierarchy, the page list, the selected page's Page Content and the findings list from the loaded result, with loading, empty and error states stated in words.
  - A covered page (not a Sample Page) says its checks come from its Sample Page with that page's path, instead of showing empty accessibility results.
  - Skipped Pages are listed as not checked with their reason, never as clean.
  - UI text uses CONTEXT.md terms and none of their Avoid words, and shows no release verdict; asserted on the rendered markup.
  - Tests mock fetch (no runner, no browser) and import types only from @qa/types/src/browser.js.
- **Validation commands:**
  - CHK-FE-301-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-analysis-screen.test.tsx`
- **Expected outputs:**
  - AnalysisScreen.tsx and analysis-client.ts under packages/wizard/src/screens/audit/results/
  - packages/wizard/tests/audit-analysis-screen.test.tsx
- **Execution status:** VERIFIED

### BE-400 — AI contract: completion abort signal, audit AI stages and the per-stage model API types

Extend packages/types/src/ai.ts (this task is its only owner in the plan). Add to AICompletionOptions an optional `signal?: AbortSignal` and `timeoutMs?: number` so every AI Provider call can be stopped (RISK-005). Add `AUDIT_AI_STAGES = ['assessment','documents','preview','rewrite'] as const` (Q-29: one model setting per AI feature), `AuditAiStage`, `AuditAiModels = Partial<Record<AuditAiStage, string>>`, `AuditAiModelsReply { models: AuditAiModels; defaults: { text: string | null; vision: string | null }; effective: Record<AuditAiStage, string | null> }`, `AuditAiModelsUpdate { models: Partial<Record<AuditAiStage, string | null>> }` (null puts the default back), a validator `validateAuditAiModelsUpdate(body)` (known stages only, model id a non-empty string of at most 200 characters without control characters, or null) and `AUDIT_AI_API = { getModels: GET /api/audit-ai/models, putModels: PUT /api/audit-ai/models }`, both typed `AuditEndpoint` (type-only import from ./website-audit.js) with access 'owner'. Keep the module Node-free: the wizard imports it through @qa/types/src/ai.js and the browser entry.

- **Requirements:** REQ-039, REQ-011 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** XS
- **Depends on:** none
- **File ownership:** `packages/types/src/ai.ts`, `packages/types/tests/audit-ai-contract.test.ts`
- **Acceptance criteria:**
  - AICompletionOptions accepts `signal` and `timeoutMs`; existing callers compile unchanged.
  - AUDIT_AI_STAGES lists exactly assessment, documents, preview and rewrite, and each is a member of AI_STAGES.
  - validateAuditAiModelsUpdate accepts a model id or null per audit stage and refuses unknown stages, empty strings, ids over 200 characters and control characters, with a message per field.
  - AUDIT_AI_API.getModels and putModels declare access 'owner' and paths under /api/audit-ai/.
  - packages/types/src/ai.ts imports no Node built-in (browser-entry test still passes).
- **Validation commands:**
  - CHK-BE-400-UNIT (unit): `pnpm exec vitest run packages/types/tests/audit-ai-contract.test.ts packages/types/tests/browser-entry.test.ts`
- **Expected outputs:**
  - packages/types/src/ai.ts with signal/timeoutMs options, AUDIT_AI_STAGES, model-per-stage API types, validator and AUDIT_AI_API
  - packages/types/tests/audit-ai-contract.test.ts
- **Execution status:** VERIFIED

### BE-401 — Timeout and abort signal on Anthropic, OpenAI/OpenRouter and Gemini calls

RISK-005 / AR-05 / REC-05: a hung AI Provider must not hold the single run slot. Add packages/core/src/ai/timeout.ts with `AI_REQUEST_TIMEOUT_MS = 120_000`, `class AITimeoutError extends Error` (name 'AITimeoutError') and `requestSignal(options)` that combines `options.signal` with `AbortSignal.timeout(options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS)` (AbortSignal.any, Node 22). Pass that signal to every fetch in providers/anthropic.ts (:59), providers/openai.ts (:62) and providers/gemini.ts (:36 token, :126, :142 fallback), and map a timeout abort to AITimeoutError and a caller abort to an AbortError. Error messages must not contain the API key. The audit modules import AITimeoutError by relative path; no core barrel change is needed.

- **Requirements:** REQ-016, REQ-011 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-400
- **File ownership:** `packages/core/src/ai/timeout.ts`, `packages/core/src/ai/providers/anthropic.ts`, `packages/core/src/ai/providers/openai.ts`, `packages/core/src/ai/providers/gemini.ts`, `packages/core/tests/ai-provider-timeout.test.ts`
- **Acceptance criteria:**
  - Given a provider whose fetch never answers (stubbed global fetch, fake timers), when generateText/complete runs with timeoutMs set, then it rejects with AITimeoutError after that time, for Anthropic, OpenAI, OpenRouter (OpenAI client) and Gemini.
  - Given a caller AbortSignal that is aborted, when a provider call is in flight, then the call rejects promptly and the fetch received an aborted signal.
  - Without timeoutMs the default AI_REQUEST_TIMEOUT_MS applies to every provider fetch (asserted on the signal passed to fetch).
  - No timeout or abort error message contains the API key.
  - Existing provider behaviour (request body, headers, finishReason, usage) is unchanged for answered calls; no real network is used in the tests.
- **Validation commands:**
  - CHK-BE-401-UNIT (unit): `pnpm exec vitest run packages/core/tests/ai-provider-timeout.test.ts`
- **Expected outputs:**
  - packages/core/src/ai/timeout.ts
  - Timeout/abort wiring in anthropic.ts, openai.ts, gemini.ts
  - packages/core/tests/ai-provider-timeout.test.ts
- **Execution status:** VERIFIED

### BE-402 — Audit AI by stage: BYOK resolution, model per stage store and claim-wording guard

Create packages/core/src/audit/ai/stage-ai.ts: `resolveAuditAi(deps)` takes the saved AI setup (provider, text and vision default models, as the runner's AI settings hold them), a key lookup (KeyResolver.resolveKey or SessionKeyResolver), the saved models per stage and a provider factory seam (default createAIProvider). It returns `{ ok: false, reason: 'no-ai-key' }` when the tool user has no key, else an `AuditAi` whose `ask(stage, messages, options)` calls the provider built with the tool user's key and passes `model = modelForStage(stage, models, defaults)`, `stage` and the abort signal / timeoutMs (BE-400 types), and counts requests against an optional AI Request Budget (`budget-spent` when exhausted). Create packages/core/src/audit/ai/stage-models-store.ts: read/write the per-stage models (`audit-ai-models.json` in an injected state folder) with writeJsonAtomic, validated by validateAuditAiModelsUpdate; no key is ever written to it. Create packages/core/src/audit/ai/claim-words.ts: the ADR 0018 word list (compliant, certified, secure, fully accessible, passes WCAG, plus 'ready to release') and `findClaimWords(text)` (case-insensitive, whole words and phrases, Unicode-safe), used by every audit AI output in this group and offered to G3/G5.

- **Requirements:** REQ-011, REQ-039, REQ-016 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** BE-400
- **File ownership:** `packages/core/src/audit/ai/stage-ai.ts`, `packages/core/src/audit/ai/stage-models-store.ts`, `packages/core/src/audit/ai/claim-words.ts`, `packages/core/tests/audit-ai-stage.test.ts`, `packages/core/tests/audit-ai-stage-models-store.test.ts`, `packages/core/tests/audit-claim-words.test.ts`
- **Acceptance criteria:**
  - REQ-011 AC-1: Given the tool user has saved a key for an AI Provider, when an AI step runs, then it calls that provider with that key (asserted through the provider factory seam: provider type and key).
  - REQ-011 AC-2: Given the tool user has supplied no key, when an AI step is needed, then the step does not run (no provider is created, no request is made) and the result says a key is needed (reason 'no-ai-key').
  - REQ-039 AC-1: Given model A set for the assessment stage and model B for the rewrite stage, when both stages run, then each request carries its own model (A for assessment, B for rewrite); a stage without its own model uses its slot default (vision for assessment, text for the others).
  - Saved per-stage models survive a reload of the store, refuse invalid input with the validator's messages, and the stored file contains no key.
  - When the AI Request Budget is spent, ask() makes no further request and reports 'budget-spent'.
  - findClaimWords finds each ADR 0018 word or phrase (compliant, certified, secure, fully accessible, passes WCAG) in any letter case as a whole word or phrase, and reports none for text without them; the exact treatment of derived forms (such as 'securely', 'non-compliant') is fixed by named test cases.
- **Validation commands:**
  - CHK-BE-402-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-ai-stage.test.ts packages/core/tests/audit-ai-stage-models-store.test.ts packages/core/tests/audit-claim-words.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/ai/stage-ai.ts
  - packages/core/src/audit/ai/stage-models-store.ts
  - packages/core/src/audit/ai/claim-words.ts
  - Three unit test files
- **Execution status:** VERIFIED

### BE-403 — Rank audit findings by impact then lower effort, with page and Section citation

Create packages/core/src/audit/ai/ranking.ts. `IMPACT_EFFORT_BY_RULE`: default impact and effort (AUDIT_SCALE high/medium/low, Q-14) for every rule G3 emits (missing-title, missing-description, missing-alt, broken-link, duplicate-title, duplicate-description, duplicate-content, heading problems, marketing signals...) and a severity-based mapping for checker findings (critical/serious -> high impact, and so on). `scoreFindings(findings)` fills impact/effort where the producer left them unset (never overwrites a set value). `rankFindings(findings)` returns a new list ordered by impact (high first), then lower effort, then a stable tiebreak (page path, Section order, rule), and assigns ids AF-001… in ranked order. `checkCitations(findings, pages)` reports any finding whose urlPath is not an audited page or whose sectionId is not a Section of that page (null is allowed only for whole-page findings: title, description, heading outline). Pure functions; no AI.

- **Requirements:** REQ-017 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** none
- **File ownership:** `packages/core/src/audit/ai/ranking.ts`, `packages/core/tests/audit-ranking.test.ts`
- **Acceptance criteria:**
  - REQ-017 AC-1: Given a set of issues, when ranked, then each issue has an impact value and an effort value (high, medium or low) and the list is ordered by impact, then by lower effort (Q-14).
  - REQ-017 AC-2: Given an issue found on a page, when reported, then it cites the page URL path and the Section (REQ-008) where it was found; checkCitations flags any finding whose page or Section does not exist.
  - Ranking is deterministic: the same input gives the same order and the same AF ids.
  - A value the producer already set is never changed by scoreFindings.
- **Validation commands:**
  - CHK-BE-403-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-ranking.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/ai/ranking.ts
  - packages/core/tests/audit-ranking.test.ts
- **Execution status:** VERIFIED

### BE-404 — PageSpeed Insights client for Sample Pages (lab and field Core Web Vitals) and ADR 0035

Create packages/core/src/audit/ai/pagespeed.ts: `measurePageSpeed(url, deps)` calls the Google PageSpeed Insights v5 API (`https://www.googleapis.com/pagespeedonline/v5/runPagespeed`, strategy=mobile, category=performance) through the outbound fetch of ADR 0031 (BE-101 makeOutboundFetch; the request host is the fixed googleapis.com host, the audited page URL is only a query parameter and has already passed the public-address check). The key comes from an injected `resolveServiceKey('pagespeed')`; without a key the call is made keyless (free, lower limit). Map lighthouseResult to lab values (performance-score, lcp, cls, fcp, ttfb, tbt, speed-index) and loadingExperience (page) or originLoadingExperience (origin, scope 'origin') to field values (lcp, inp, cls, fcp, ttfb); return the `PageSpeed` type (source 'pagespeed-insights', method, measuredAt). Failure mapping: HTTP 429 or quota error -> 'quota', timeout -> 'timeout', DNS/connection error -> 'no-network', no field data -> field 'no-field-data', anything else -> 'failed'. `measureSampleSpeeds(pages, deps)` runs one request at a time and, after a quota answer, marks the remaining pages 'quota' without calling. The key is never logged or put in an error message. Write docs/adr/0035-pagespeed-data.md (named in ADR 0033 'Follow-up records'): PSI as the speed source (Q-03), free tier and its limits (Q-32/REQ-043), mobile strategy, lab vs field wording (ADR 0018), not-measured rules, key storage via the key resolver (ADR 0034).

- **Requirements:** REQ-012, REQ-043 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-101
- **File ownership:** `packages/core/src/audit/ai/pagespeed.ts`, `packages/core/tests/audit-pagespeed.test.ts`, `packages/core/tests/fixtures/pagespeed/**`, `docs/adr/0035-pagespeed-data.md`
- **Acceptance criteria:**
  - REQ-012 AC-1: Given a public page, when audited, then the output shows its page speed and Core Web Vitals values from the external API, naming the API (pagespeed-insights) and how the values were measured (lab or field, page or origin scope).
  - REQ-012 AC-2: Given the API fails or its free quota is used up, when the page is audited, then the output says the values were not measured (status 'not-measured' with a reason) and carries no values, so it can never read as good.
  - After a quota answer no further PageSpeed request is made in that audit; the remaining Sample Pages are 'not-measured' with reason 'quota'.
  - REQ-043 AC-1: the only external data API called is the PageSpeed Insights v5 endpoint, which is usable on its free tier without payment (keyless or with a free Google API key); ADR 0035 records this.
  - The API key never appears in returned values, thrown errors or log lines (asserted).
  - Tests use recorded PSI JSON fixtures and an injected fetch; no real network.
- **Validation commands:**
  - CHK-BE-404-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-pagespeed.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/ai/pagespeed.ts
  - packages/core/tests/audit-pagespeed.test.ts with fixtures
  - docs/adr/0035-pagespeed-data.md
- **Execution status:** VERIFIED

### BE-405 — Service keys: remove the PageSpeed key and keep beta service keys in the session only

REC-03 / RISK-003 / AR-03 (ADR 0034 requires it before any beta route saves a service key). In packages/core/src/ai/key-resolver.ts add `removeServiceKey(service)` (keychain entry and encrypted-file entry removed; AuditSettingsUpdate.pagespeedKey = null needs it). In packages/runner/src/beta.ts make SessionKeyResolver override `saveServiceKey`, `resolveServiceKey` and `removeServiceKey` to use the session secret store only: no keychain, no file, no environment variable, so a beta visitor never uses the owner's PAGESPEED_API_KEY and an out-of-session save throws instead of writing under process.cwd().

- **Requirements:** REQ-012, REQ-011 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S · **P2 (sensitive)**
- **Depends on:** none
- **File ownership:** `packages/core/src/ai/key-resolver.ts`, `packages/runner/src/beta.ts`, `packages/core/tests/key-resolver-service-key.test.ts`, `packages/runner/tests/beta-service-keys.test.ts`
- **Acceptance criteria:**
  - removeServiceKey('pagespeed') removes the saved key so resolveServiceKey returns the environment value or null; the encrypted file keeps its other entries and is never written in plain text.
  - Given a beta session with no PageSpeed key and PAGESPEED_API_KEY set in the environment, when SessionKeyResolver.resolveServiceKey('pagespeed') runs, then it returns null.
  - Given a beta session, when a PageSpeed key is saved, then it resolves inside that session only, another session does not see it, and no file is written.
  - Outside a session, SessionKeyResolver.saveServiceKey throws and writes nothing to disk.
  - Existing key-resolver-encryption tests still pass.
- **Validation commands:**
  - CHK-BE-405-UNIT (security): `pnpm exec vitest run packages/core/tests/key-resolver-service-key.test.ts packages/core/tests/key-resolver-encryption.test.ts packages/runner/tests/beta-service-keys.test.ts`
- **Expected outputs:**
  - KeyResolver.removeServiceKey
  - SessionKeyResolver service-key overrides
  - Two new unit test files
- **Execution status:** VERIFIED

### BE-406 — AI assessment of the six areas per Sample Page and for the whole site

Create packages/core/src/audit/ai/assessment.ts. `assessPages(input, ai)`: for each Sample Page, one 'assessment' stage request (BE-402 AuditAi) with the page's Page Content summary (title, headings, Sections, CTAs), its ranked findings (ids), its area grades and its PageSpeed values; the answer is JSON { areas: [{ area, note, evidence: findingIds[] }] } for all six AUDIT_AREAS (search-ranking, marketing, usability, content, accessibility, speed). `assessSite(input, ai)` does the same once for the whole site. The grade of each AreaAssessment comes from the caller's deterministic grades (null when nothing in the area was checked); the AI writes only the note (Q-04, no AI score). Evidence ids not in the input are dropped. Notes are written in the audit's document language. A note containing an ADR 0018 word (findClaimWords) gets one repair request; if it still contains one, that area is 'not-done' with reason 'ai-failed'. No key -> every area 'not-done' 'no-ai-key'; provider error, timeout (AITimeoutError) or unparsable answer after one repair -> 'ai-failed'; budget spent -> 'budget-spent'. Pages are assessed one request at a time.

- **Requirements:** REQ-016 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-402, BE-401
- **File ownership:** `packages/core/src/audit/ai/assessment.ts`, `packages/core/tests/audit-assessment.test.ts`
- **Acceptance criteria:**
  - REQ-016 AC-1: Given an audited App and a working AI key (MockAIProvider), when the assessment runs, then the output has an assessment of each of the six areas for every audited Sample Page and for the whole site.
  - REQ-016 AC-2: Given the assessment output, when read, then it contains none of the words ADR 0018 forbids (compliant, certified, secure, fully accessible, passes WCAG), including when the mock AI answers with them.
  - REQ-016 AC-3: Given the AI step did not run or failed for a page (no key, provider error, timeout, unusable answer, budget spent), when the output is produced, then that page's areas are 'not-done' with the reason, never a note or a clean result.
  - Grades in the output equal the deterministic grades given as input; the AI answer cannot change them, and no numeric AI score appears.
  - Every evidence id in a note refers to a finding of that page (site-wide: of the audit).
- **Validation commands:**
  - CHK-BE-406-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-assessment.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/ai/assessment.ts
  - packages/core/tests/audit-assessment.test.ts
- **Execution status:** VERIFIED

### BE-407 — Redesign or repair recommendation for each Sample Page

Create packages/core/src/audit/ai/page-recommendation.ts. `recommendPages(input, ai)`: for each Sample Page, one 'assessment' stage request asking the AI to propose redesign or repair with a plain reason and the finding ids behind it (Q-14: AI proposes, editable in review). Validate: action is 'redesign' or 'repair', findingIds are findings of that page (unknown ids dropped; at least one id when the page has findings), reason free of ADR 0018 words (one repair request). When there is no AI key or the AI fails, a fixed rule decides (`decidedBy: 'rule'`): redesign when the page has at least N high-impact findings across at least two groups or its usability/content grades are the two lowest, else repair; the rule and threshold are constants documented in the module and tested. Output: exactly one PageRecommendation per Sample Page; covered pages refer to their Layout Group's Sample Page (no own recommendation).

- **Requirements:** REQ-045 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-402
- **File ownership:** `packages/core/src/audit/ai/page-recommendation.ts`, `packages/core/tests/audit-page-recommendation.test.ts`
- **Acceptance criteria:**
  - REQ-045 AC-1: Given an audited page, when analysed, then the output gives it exactly one recommendation, redesign or repair, with the issues (finding ids) that led to it.
  - With an AI key the recommendation is marked decidedBy 'ai'; without a key, or after an AI failure, it is decidedBy 'rule' and still exactly one per Sample Page.
  - The reason text contains no ADR 0018 word.
  - A page with no findings gets 'repair' with a reason saying no issues were found on the checked parts, never a claim about the whole page.
- **Validation commands:**
  - CHK-BE-407-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-page-recommendation.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/ai/page-recommendation.ts
  - packages/core/tests/audit-page-recommendation.test.ts
- **Execution status:** VERIFIED

### BE-408 — Section rewrite after approval with the word-overlap check

Create packages/core/src/audit/ai/rewrite.ts and packages/core/src/audit/ai/rewrite-store.ts. Q-08: new copy goes into the Audit Documents only, never onto the live site; the tool user approves each Section; a word-overlap check flags phrases copied from the original. `findOverlaps(original, proposal, minWords)`: normalised (case, punctuation, Unicode letters/marks incl. Tamil) runs of at least `minWords` consecutive words (AuditSettings.rewriteOverlapWords, default DEFAULT_REWRITE_OVERLAP_WORDS = 6) shared with the original, merged into maximal runs, as OverlapFlag[]. RewriteStore keeps RewriteState per (urlPath, sectionId) in `rewrites.json` inside an injected version folder (writeJsonAtomic). Operations: `approve` (sets approvedAt), `run` (refuses with ERR_NOT_APPROVED unless approved; ERR_NO_AI_KEY without a key; one 'rewrite' stage request with the Section text from Page Content, the document language and an instruction not to reuse its wording or invent facts such as prices or phone numbers; if overlaps remain, one retry naming the flagged phrases; stores the proposal with its overlaps and createdAt; proposal text checked with findClaimWords), `accept(text)` (refuses with ERR_NOT_APPROVED if not approved and ERR_OVERLAP if the accepted text still has an overlap; returns the SectionEdit with by: 'rewrite' for the edit overlay). The rewrite uses the Section text captured by the crawl; it opens no browser and sends nothing to the audited site (ADR 0030 read-only).

- **Requirements:** REQ-030 · **Agent:** backend-engineer · **Priority:** low · **Complexity:** M
- **Depends on:** BE-402
- **File ownership:** `packages/core/src/audit/ai/rewrite.ts`, `packages/core/src/audit/ai/rewrite-store.ts`, `packages/core/tests/audit-rewrite.test.ts`, `packages/core/tests/audit-rewrite-store.test.ts`
- **Acceptance criteria:**
  - REQ-030 AC-1: Given no approval has been recorded for a Section, when a rewrite is requested, then no rewrite runs (no AI request is made) and the refusal code is ERR_NOT_APPROVED.
  - REQ-030 AC-2: Given an approved rewrite, when its output is compared with the original Section, then any run of at least rewriteOverlapWords words shared with the original is flagged, and accepting copy that still has a flagged run is refused with ERR_OVERLAP.
  - Overlap detection works on Tamil text (Unicode marks kept) and ignores case and punctuation; runs shorter than the threshold are not flagged.
  - Approval and proposals survive a reload of the store; the store never holds a key.
  - Accepting copy returns an edit marked by 'rewrite' for the Audit Documents; nothing is sent to the audited site.
- **Validation commands:**
  - CHK-BE-408-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-rewrite.test.ts packages/core/tests/audit-rewrite-store.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/ai/rewrite.ts
  - packages/core/src/audit/ai/rewrite-store.ts
  - Two unit test files
- **Execution status:** VERIFIED

### BE-409 — Barrel for packages/core/src/audit/ai

Create packages/core/src/audit/ai/index.ts exporting the public API of stage-ai, stage-models-store, claim-words, ranking, pagespeed, assessment, page-recommendation, rewrite and rewrite-store (named exports only, no `export *` collisions with the core barrel), plus AITimeoutError from ../../ai/timeout.js. BE-190 (G1) adds `export * from './audit/ai/index.js'` to packages/core/src/index.ts. A test imports the barrel and asserts each expected export exists.

- **Requirements:** REQ-011, REQ-012, REQ-016, REQ-017, REQ-030, REQ-039, REQ-045 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** XS
- **Depends on:** BE-401, BE-402, BE-403, BE-404, BE-406, BE-407, BE-408
- **File ownership:** `packages/core/src/audit/ai/index.ts`, `packages/core/tests/audit-ai-barrel.test.ts`
- **Acceptance criteria:**
  - Importing packages/core/src/audit/ai/index.ts exposes resolveAuditAi, the stage models store, findClaimWords, rankFindings, scoreFindings, checkCitations, measurePageSpeed, measureSampleSpeeds, assessPages, assessSite, recommendPages, findOverlaps, the rewrite operations and AITimeoutError.
  - No exported name collides with an existing export of packages/core/src/index.ts (asserted by importing both).
- **Validation commands:**
  - CHK-BE-409-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-ai-barrel.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/ai/index.ts
  - packages/core/tests/audit-ai-barrel.test.ts
- **Execution status:** VERIFIED

### BE-410 — Runner routes: audit AI models per stage and Section rewrite (approve, run, accept, list)

Create packages/runner/src/routes/audit-ai.ts exporting `createAuditAiRoutes(deps): Route[]`. Dependencies are injected so the module imports only @qa/types and the route helpers (no @qa/core import, no server.ts edit): `readModels/writeModels` (stage models store), `aiDefaults()` (the saved text and vision models), `hasAiKey()`, and per audit version `rewrites` operations (list/approve/run/accept from BE-408), `loadSection(auditId, version, urlPath, sectionId)` (G6 audit store / G3 Page Content), `applyRewriteEdit` (G5 edit overlay) and `overlapWords()` (audit settings). Routes: AUDIT_AI_API.getModels/putModels (validateAuditAiModelsUpdate, reply AuditAiModelsReply with effective model per stage via modelForStage), AUDIT_API.listRewrites, approveRewrite, runRewrite, acceptRewrite with the access levels declared in AUDIT_API / AUDIT_AI_API (BE-102 Route access field and :id matching). Errors use AuditErrorReply codes: ERR_INVALID_REQUEST (400), ERR_AUDIT_NOT_FOUND (404), ERR_AUDIT_RUNNING (409), ERR_NOT_APPROVED (409), ERR_NO_AI_KEY (409), ERR_OVERLAP (422). Replies never contain a key or a provider error body. BE-190 (G1) registers the routes with real dependencies.

- **Requirements:** REQ-030, REQ-039, REQ-011 · **Agent:** backend-engineer · **Priority:** medium · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** BE-400, BE-102, BE-189
- **File ownership:** `packages/runner/src/routes/audit-ai.ts`, `packages/runner/tests/audit-ai-routes.test.ts`
- **Acceptance criteria:**
  - REQ-030 AC-1 (route): POST /api/audits/:id/rewrite for a Section with no recorded approval answers 409 ERR_NOT_APPROVED and calls no AI; after POST .../rewrite/approve it runs.
  - REQ-030 AC-2 (route): POST .../rewrite/accept with text that still shares a run of at least rewriteOverlapWords words with the original answers 422 ERR_OVERLAP and applies no edit; clean text is applied as an edit marked 'rewrite'.
  - REQ-011 AC-2 (route): without a saved AI key, POST .../rewrite answers 409 ERR_NO_AI_KEY.
  - REQ-039: PUT /api/audit-ai/models saves a model per audit stage and GET returns each stage's own model or its slot default; invalid bodies answer 400 ERR_INVALID_REQUEST with field messages.
  - Each route row declares the access level of its AUDIT_API / AUDIT_AI_API entry (owner for runRewrite and models, edit for approve/accept, view for list).
  - No reply body contains the AI key or a raw provider error.
- **Validation commands:**
  - CHK-BE-410-UNIT (integration): `pnpm exec vitest run packages/runner/tests/audit-ai-routes.test.ts`
- **Expected outputs:**
  - packages/runner/src/routes/audit-ai.ts
  - packages/runner/tests/audit-ai-routes.test.ts
- **Execution status:** VERIFIED

### FE-400 — Wizard: AI model per audit stage settings panel

Create packages/wizard/src/screens/audit/ai/AuditAiModelsPanel.tsx and packages/wizard/src/screens/audit/ai/stage-models-api.ts. The panel lists the four Website Audit AI tasks (assessment notes and redesign or repair; Audit Documents and Pitch Glimpse; homepage preview; Section rewrite) with a model field each, shows the default used when left empty (from AuditAiModelsReply.defaults/effective), saves through PUT /api/audit-ai/models and shows the validator's field messages. Labelled inputs, keyboard reachable, CONTEXT.md terms (AI Provider, Website Audit, Pitch Glimpse, Audit Document; no 'scan', 'quota'). Imports types only from @qa/types/src/ai.js (browser-safe). FE-191 (G1) mounts the panel in the audit settings screen.

- **Requirements:** REQ-039 · **Agent:** frontend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-400
- **File ownership:** `packages/wizard/src/screens/audit/ai/AuditAiModelsPanel.tsx`, `packages/wizard/src/screens/audit/ai/stage-models-api.ts`, `packages/wizard/tests/audit-ai-models-panel.test.tsx`
- **Acceptance criteria:**
  - REQ-039 AC-1 (UI): the tool user can set a different model for each of the four audit AI tasks; saving sends exactly the changed stages, and clearing a field sends null to put the default back.
  - Each field has a visible label tied to its input, and the shown default matches the reply's effective model.
  - A 400 reply shows the field messages next to the fields; nothing else is cleared.
  - Rendered text passes the wizard's banned-words test and uses CONTEXT.md terms.
- **Validation commands:**
  - CHK-FE-400-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-ai-models-panel.test.tsx packages/wizard/tests/no-banned-words.test.ts`
- **Expected outputs:**
  - packages/wizard/src/screens/audit/ai/AuditAiModelsPanel.tsx
  - packages/wizard/src/screens/audit/ai/stage-models-api.ts
  - packages/wizard/tests/audit-ai-models-panel.test.tsx
- **Execution status:** VERIFIED

### FE-401 — Wizard: Section rewrite review (approve, write, see copied phrases, edit, accept)

Create packages/wizard/src/screens/audit/ai/RewriteReview.tsx and packages/wizard/src/screens/audit/ai/rewrite-api.ts. For each Section of a page: the original text, an 'Approve rewrite' control, a 'Write new copy' control that is disabled until approved, the proposal with every OverlapFlag phrase highlighted (and listed with its word count), an editable text area, and 'Accept' that is refused with the server's ERR_OVERLAP message while copied phrases remain. Shows ERR_NO_AI_KEY as 'Add an AI key in Settings to write new copy.' States that new copy goes into the Audit Documents only, never onto the site. Types from @qa/types/src/website-audit.js only. FE-191 (G1) mounts it in the audit result screen.

- **Requirements:** REQ-030 · **Agent:** frontend-engineer · **Priority:** low · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/wizard/src/screens/audit/ai/RewriteReview.tsx`, `packages/wizard/src/screens/audit/ai/rewrite-api.ts`, `packages/wizard/tests/audit-rewrite-review.test.tsx`
- **Acceptance criteria:**
  - REQ-030 AC-1 (UI): before approval the write control is disabled and no rewrite request is sent.
  - REQ-030 AC-2 (UI): each flagged phrase of the proposal is highlighted and listed; Accept shows the ERR_OVERLAP refusal and keeps the edited text.
  - Controls are buttons with accessible names and reachable by keyboard; the highlighted phrases are announced (mark element or aria label), not shown by colour alone.
  - Rendered text passes the wizard's banned-words test and uses CONTEXT.md terms (Section, Audit Document, Website Audit).
- **Validation commands:**
  - CHK-FE-401-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-rewrite-review.test.tsx packages/wizard/tests/no-banned-words.test.ts`
- **Expected outputs:**
  - packages/wizard/src/screens/audit/ai/RewriteReview.tsx
  - packages/wizard/src/screens/audit/ai/rewrite-api.ts
  - packages/wizard/tests/audit-rewrite-review.test.tsx
- **Execution status:** VERIFIED

### QA-400 — Audit AI flow contract test and free-tier external API inspection

Independent verification across the group's core modules through the barrel. packages/core/tests/audit-ai-flow.test.ts: findings from a small hand-built audit (two Layout Groups, Sections, findings with and without impact/effort) go through scoreFindings, rankFindings, assessPages/assessSite and recommendPages with a MockAIProvider recording each request; asserts ranking order and citations, six areas per Sample Page and site-wide, exactly one recommendation per Sample Page, no ADR 0018 word anywhere in the output, model A for 'assessment' and model B for 'rewrite' when set, and the no-key path (every area 'not-done' 'no-ai-key', recommendations decidedBy 'rule'). packages/core/tests/audit-external-apis.test.ts: source inspection of packages/core/src/audit/** finding every absolute https URL; the only external data API is the PageSpeed Insights v5 endpoint, and docs/adr/0035-pagespeed-data.md states it is used on its free tier (REQ-043 AC-1).

- **Requirements:** REQ-011, REQ-016, REQ-017, REQ-039, REQ-043, REQ-045 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-409
- **File ownership:** `packages/core/tests/audit-ai-flow.test.ts`, `packages/core/tests/audit-external-apis.test.ts`
- **Acceptance criteria:**
  - REQ-043 AC-1: Given the MVP build, when its external data API calls are reviewed (source inspection test), then each one uses an API usable on a free tier without payment, and ADR 0035 says so.
  - REQ-016 AC-1..AC-3, REQ-017 AC-1..AC-2, REQ-039 AC-1 and REQ-045 AC-1 hold end to end across the modules with a mocked AI Provider (no real network, no clock dependence).
  - REQ-011 AC-2: with no key, no AI request is recorded and every AI output is marked not done or rule-based.
- **Validation commands:**
  - CHK-QA-400-UNIT (integration): `pnpm exec vitest run packages/core/tests/audit-ai-flow.test.ts packages/core/tests/audit-external-apis.test.ts`
- **Expected outputs:**
  - packages/core/tests/audit-ai-flow.test.ts
  - packages/core/tests/audit-external-apis.test.ts
- **Execution status:** VERIFIED

### BE-500 — Edit overlay: validate and merge edits, build the edited view of an audit version

Pure core module for REQ-020 (Q-25: originals kept, edits are an overlay). `packages/core/src/audit/documents/edits.ts` exports: `emptyOverlay()`, `validateAuditEditsPatch(body)` (shape of `AuditEditsPatch` from `packages/types/src/website-audit.ts:738`, text caps, unknown keys refused, returns field errors), `mergeEditsPatch(overlay, patch, now)` (adds/replaces/resets finding, section and recommendation edits, remove/restore pages, proposal inputs; sets `updatedAt`), and `buildEditedView(result, contents, overlay)` returning the read model every document builder uses: removed pages dropped from `pages`, the hierarchy (children re-parented to the removed node's parent), navigation links, leaving-site `from` lists, internal-linking counts, findings (findings only on removed pages dropped; removed pages stripped from `pages`), roadmap items left without findings dropped; finding title/detail/suggestion and Section text replaced by edits; recommendation action replaced. Never mutates `result`, `contents` or `overlay`. Also owns the shared test fixture `packages/core/tests/helpers/audit-doc-fixture.ts` (a small finished `AuditResult` with English and Tamil `PageContent`, findings on several pages and Sections, a roadmap, recommendations) that the other document tasks import.

- **Requirements:** REQ-020 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/core/src/audit/documents/edits.ts`, `packages/core/tests/audit-doc-edits.test.ts`, `packages/core/tests/helpers/audit-doc-fixture.ts`
- **Acceptance criteria:**
  - Given a finding edit (title, detail or suggestion), when the edited view is built, then the finding carries the edited text and the original `AuditResult` object is unchanged (deep-equal to its copy taken before).
  - Given a page removed from the hierarchy, when the edited view is built, then that urlPath appears nowhere in the view: not in pages, hierarchy nodes, navigation links, leaving-site sources, internal-linking counts, finding pages or roadmap pages; its child pages stay, re-parented to its parent.
  - Given a Section edit, when the edited view is built, then that Section's text is the edited text and every other Section's text is unchanged character for character (Tamil included).
  - Given a patch with `reset: true` for a finding, Section or recommendation, when merged, then the edit is removed and the original shows again; `restorePages` brings a removed page back.
  - Given an invalid patch (wrong types, unknown keys, text over the cap, malformed urlPath), when validated, then it is refused with per-field errors and nothing is merged.
- **Validation commands:**
  - CHK-BE-500-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-doc-edits.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/documents/edits.ts with validateAuditEditsPatch, mergeEditsPatch, buildEditedView
  - Shared fixture packages/core/tests/helpers/audit-doc-fixture.ts
  - Unit tests covering REQ-020 AC-1..AC-3 at the model level
- **Execution status:** VERIFIED

### BE-501 — Document model, English and Tamil labels, Markdown and HTML renderers, claim-wording guard

Foundation for every Audit Document, the Pitch Glimpse and the Owner Audit. `model.ts`: a small block model (`AuditDoc { kind, title, language, blocks }`; blocks heading/paragraph/list/table/image/note/pagebreak). `labels/en.ts`, `labels/ta.ts`, `labels/index.ts`: every fixed piece of document wording (headings, column names, scale words high/medium/low, 'not checked', skipped-page reasons, phase names) keyed per `DocumentLanguage`, English and Tamil filled; `labelsFor(lang)` falls back to English for languages without a table and reports that fallback so G7 (REQ-032) can add tables. `render-markdown.ts` (GitHub-flavoured Markdown, escaping of page text so page content cannot inject Markdown structure) and `render-html.ts` (self-contained HTML per ADR 0021: inline CSS, images as data URIs only, no external resource, `lang` attribute, A4 print CSS, a font stack that covers Tamil: 'Noto Sans Tamil', 'Nirmala UI', 'Latha', 'FreeSerif', sans-serif; HTML-escapes all text). `wording.ts`: the ADR 0018 word list (compliant, compliance, certified, secure, safe, hack-proof, passes WCAG, fully accessible) plus 'Ready to release' and release-verdict words, with `findClaimWords(text)` for tests and for the fixed labels.

- **Requirements:** REQ-018, REQ-021, REQ-019, REQ-025 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/core/src/audit/documents/model.ts`, `packages/core/src/audit/documents/render-markdown.ts`, `packages/core/src/audit/documents/render-html.ts`, `packages/core/src/audit/documents/wording.ts`, `packages/core/src/audit/documents/labels/en.ts`, `packages/core/src/audit/documents/labels/ta.ts`, `packages/core/src/audit/documents/labels/index.ts`, `packages/core/tests/audit-doc-render.test.ts`
- **Acceptance criteria:**
  - Given a document model, when rendered to Markdown and to HTML, then every heading, paragraph, list item and table cell appears in both outputs in order.
  - Given page text containing Markdown or HTML syntax (`#`, `|`, `<script>`), when rendered, then it is escaped and cannot add structure or markup.
  - Given Tamil text, when rendered to Markdown and HTML, then it is preserved character for character and the HTML declares `lang="ta"` and a Tamil-capable font stack.
  - Given the English and Tamil label tables, when compared, then both have exactly the same keys and no value is empty.
  - Given every English label, when checked with `findClaimWords`, then none contains an ADR 0018 word or 'Ready to release'; CONTEXT.md _Avoid_ terms ('report', 'Plan', 'enhancement plan', 'the three audit documents', 'pitch deck', 'owner report') do not appear in the labels.
  - Given the HTML output, when inspected, then it references no external URL (no http(s) src/href to load, no @import, no remote font).
- **Validation commands:**
  - CHK-BE-501-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-doc-render.test.ts`
- **Expected outputs:**
  - Document block model, Markdown and HTML renderers
  - English and Tamil label tables with a fallback lookup
  - ADR 0018 claim-word guard used by tests of every later document task
- **Execution status:** VERIFIED

### BE-502 — Improvement Roadmap: build items from ranked findings and render the Roadmap document

`roadmap.ts` exports `buildRoadmap(rankedFindings: AuditFinding[]): RoadmapItem[]` (type at `packages/types/src/website-audit.ts:483`): findings grouped into items by rule (one item per rule, listing every finding and page), priority = highest impact of its findings, effort = highest effort, ordered by impact then lower effort (CONTEXT.md 'Improvement Roadmap'), phase 1 = high priority, 2 = medium, 3 = low (a fixed rule, documented in the module). The audit pipeline calls it to fill `AuditResult.roadmap`. `roadmap-document.ts` exports `buildRoadmapDocument(view, labels, { showEffort })` producing the Improvement Roadmap Audit Document from the edited view (BE-500's view shape, imported as a type): phases in order, each item with priority, phase and effort, the findings and pages it covers. `showEffort: false` is used by the Owner Audit. Never called a Plan in any wording.

- **Requirements:** REQ-026 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-500, BE-501
- **File ownership:** `packages/core/src/audit/documents/roadmap.ts`, `packages/core/src/audit/documents/roadmap-document.ts`, `packages/core/tests/audit-doc-roadmap.test.ts`
- **Acceptance criteria:**
  - Given ranked findings, when the roadmap is generated, then every item has a priority, a phase and an effort value (REQ-026 AC-1), and every finding id is covered by exactly one item.
  - Given items, when ordered, then they are by impact (high, medium, low) then lower effort, and phase numbers never decrease along the list.
  - Given no findings, when the roadmap is generated, then it is empty and the document says that nothing was found to order, without any claim that the site is fine (ADR 0018).
  - Given `showEffort: false`, when the document is built, then no effort value or effort heading appears.
  - Given the document in English or Tamil, when rendered, then its fixed wording comes from that language's labels and contains no 'Plan', 'enhancement plan' or ADR 0018 word.
- **Validation commands:**
  - CHK-BE-502-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-doc-roadmap.test.ts`
- **Expected outputs:**
  - buildRoadmap(rankedFindings) for the audit pipeline
  - Improvement Roadmap Audit Document builder with an effort-free variant for the Owner Audit
- **Execution status:** VERIFIED

### BE-503 — Structure, Content and Findings Audit Documents from the edited view

Three builders over BE-500's edited view and BE-501's model: `structure.ts` (page hierarchy as a nested list with how each place was decided, navigation by region, links that leave the site, Skipped Pages with their reasons listed as not checked, technology result), `content.ts` (every page's Page Content Section by Section: heading, kind and text, images with alt or a 'missing alt' note, calls to action, forms read-never-sent; uses edited Section text), `findings.ts` (grouped technical, marketing and content; inside each group in ranking order; each finding cites its page and Section, shows impact and effort, title, detail, suggestion, and marks AI-written findings as advisory; per-area grades from deterministic checks with AI notes as advisory text, an area with no grade shown as not checked; options `{ showEffort }` for the Owner Audit). No document has a release verdict or a site-wide pass/fail.

- **Requirements:** REQ-018, REQ-020 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-500, BE-501
- **File ownership:** `packages/core/src/audit/documents/structure.ts`, `packages/core/src/audit/documents/content.ts`, `packages/core/src/audit/documents/findings.ts`, `packages/core/tests/audit-doc-builders.test.ts`
- **Acceptance criteria:**
  - Given an edited finding, when the Findings document is built and rendered, then it contains the edited text and not the original (REQ-020 AC-1).
  - Given a page removed from the hierarchy, when the Structure, Content and Findings documents are rendered, then none of them lists that page (REQ-020 AC-2).
  - Given an edited Section, when the Content document is rendered, then it contains the edited content (REQ-020 AC-3).
  - Given the fixture, when the Findings document is rendered, then findings are under technical, marketing and content, in ranking order, and each cites its page URL path and Section (REQ-017 AC-2 carried into the document).
  - Given Skipped Pages and areas without a grade, when the documents are rendered, then each is listed as not checked, never as a clean result (ADR 0018).
  - Given English or Tamil, when the three documents are built, then their fixed wording is in that language and page text is kept character for character; no output contains an ADR 0018 word, 'Ready to release' or a verdict.
- **Validation commands:**
  - CHK-BE-503-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-doc-builders.test.ts`
- **Expected outputs:**
  - buildStructureDocument, buildContentDocument, buildFindingsDocument
- **Execution status:** VERIFIED

### BE-504 — Proposal template filler and document settings defaults (template, opt-out text, company details)

`proposal.ts`: a Markdown template with documented placeholders (`{{findings_summary}}`, `{{scope}}` (redesign or repair per page from the edited recommendations), `{{not_included}}` (ProposalInputs.notIncluded or the default list), `{{price}}`, `{{payment_terms}}` (INR, as the tool user wrote them; left as a visible 'to fill in' marker when empty), `{{timeline}}` (phases and their items from the edited view's roadmap), `{{company.name}}` … `{{company.terms}}`, `{{site.url}}`, `{{date}}`). `fillProposal(template, view, inputs, company, labels)` returns the Proposal Audit Document; unknown placeholders are left visible and reported, values are escaped so audit text cannot add placeholders. `templates/proposal-en.ts`, `templates/proposal-ta.ts`: default templates (website-only scope). `templates/opt-out.ts`: default Pitch Glimpse opt-out text in English and Tamil (D-002). `settings.ts`: `auditSettingsDefaults()` (`AuditSettingsDefaults`) and `applySettingsUpdate(current, update)` validating `AuditSettingsUpdate` (string caps, null puts the default back, `rewriteOverlapWords` a positive integer, `pagespeedKey` passed through untouched for the route to hand to the key resolver, never stored here). Defaults live in TS modules, not files read at runtime, so the runner's dist and Docker image need nothing extra.

- **Requirements:** REQ-027, REQ-019 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-500, BE-501
- **File ownership:** `packages/core/src/audit/documents/proposal.ts`, `packages/core/src/audit/documents/settings.ts`, `packages/core/src/audit/documents/templates/proposal-en.ts`, `packages/core/src/audit/documents/templates/proposal-ta.ts`, `packages/core/src/audit/documents/templates/opt-out.ts`, `packages/core/tests/audit-doc-proposal.test.ts`, `packages/core/tests/audit-doc-settings.test.ts`
- **Acceptance criteria:**
  - Given an edited template, when a Proposal is generated for an audited App, then it follows the edited template (its own text and order kept) and is filled with that App's audit data: findings summary, scope with redesign or repair per page, what is not included, price and payment terms as entered, timeline from the Improvement Roadmap, company details (REQ-027 AC-2).
  - Given a page removed in the edits, when the Proposal is generated, then its scope and timeline do not list that page.
  - Given a settings update with a new template, when applied and read back, then the template equals the update; a null value puts the default back (supports REQ-027 AC-1 with BE-508).
  - Given the defaults, when read, then English and Tamil opt-out texts and proposal templates are present and non-empty and use no ADR 0018 word.
  - Given an unknown placeholder or audit text containing `{{...}}`, when filled, then the unknown placeholder stays visible and is reported and the audit text is not expanded.
  - Given an invalid settings update (wrong types, over-long text, non-integer overlap words), when applied, then it is refused with field errors and nothing changes.
- **Validation commands:**
  - CHK-BE-504-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-doc-proposal.test.ts packages/core/tests/audit-doc-settings.test.ts`
- **Expected outputs:**
  - fillProposal and default English/Tamil Proposal templates
  - Default English/Tamil opt-out text
  - auditSettingsDefaults and applySettingsUpdate
- **Execution status:** VERIFIED

### BE-505 — Pitch Glimpse (one A4 page, top 3) and Owner Audit (cleaned-up, plain summary on top)

`pitch.ts`: `buildPitchGlimpse(view, { language, optOutText, screenshots })` returns self-contained A4 HTML (via BE-501's HTML renderer and print CSS) with the site address, the top 3 findings by ranking (edited text, page cited), one screenshot each embedded as a data URI (a finding without a screenshot shows a 'no screenshot' note), what was checked and what was not, and the opt-out text (the tool user's text for that language, else the default from BE-504). Text is clamped so the page fits one A4 page in both languages. No send action, no contact form, no mailto link. `owner-audit.ts`: `buildOwnerAudit(view, labels)` returns one combined document: a plain-language summary on top (deterministic: what was checked, how many findings per group, the top items; no score), then Structure, Content, Findings and Improvement Roadmap with effort removed (BE-503/BE-502 `showEffort: false`); it leaves out the Proposal, price and payment terms, and never reads Shortlist mark, notes or outcome (Q-17).

- **Requirements:** REQ-019, REQ-025 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** L
- **Depends on:** BE-502, BE-503, BE-504
- **File ownership:** `packages/core/src/audit/documents/pitch.ts`, `packages/core/src/audit/documents/owner-audit.ts`, `packages/core/tests/audit-doc-pitch.test.ts`, `packages/core/tests/audit-doc-owner.test.ts`
- **Acceptance criteria:**
  - Given a finished audit, when the Pitch Glimpse is generated, then it contains exactly the top 3 findings in ranking order (fewer when fewer exist), one screenshot each, and the opt-out wording (REQ-019 AC-1; the one-page length is proven by QA-500/BE-507's PDF page count).
  - Given the tool user picks Tamil, when the Pitch Glimpse is generated, then its fixed text and default opt-out text are Tamil and `lang="ta"` is set; given English, they are English (REQ-019 AC-2, AC-3).
  - Given saved opt-out text for a language, when the Pitch Glimpse is generated in that language, then the saved text is used instead of the default.
  - Given a generated Pitch Glimpse, when inspected, then it contains no form, no mailto: or tel: action, no script and no external resource (supports REQ-019 AC-4).
  - Given a finished audit, when the Owner Audit is requested in English or Tamil, then it is generated in that language (REQ-025 AC-1).
  - Given the Owner Audit, when generated with a Shortlist entry, proposal price and payment terms present in the inputs, then it contains none of: pitch/skip mark, notes, outcome, any effort value, price or payment terms (REQ-025 AC-2 per Q-17), and starts with the plain-language summary.
  - Given either output, when checked, then it contains no ADR 0018 word, no 'Ready to release' and no verdict.
- **Validation commands:**
  - CHK-BE-505-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-doc-pitch.test.ts packages/core/tests/audit-doc-owner.test.ts`
- **Expected outputs:**
  - buildPitchGlimpse (A4 HTML)
  - buildOwnerAudit (combined document with summary on top)
- **Execution status:** VERIFIED

### BE-507 — PDF (Playwright print) and Word (.docx) renderers plus a dependency-free zip writer

No new npm dependency (checked: core has `playwright` 1.63.0 and `mammoth` 1.12.3 (read-only docx); no zip or docx writer exists in any package.json). `zip.ts`: minimal ZIP writer on `node:zlib` (`deflateRawSync`, `crc32`, Node 22) with sorted, sanitized entry names (no `..`, no absolute paths), used for .docx and the export bundle. `render-pdf.ts`: `renderPdf(html, { format: 'A4' })` launches Chromium via the existing `playwright` dependency, `page.route('**/*')` aborts every request that is not `data:` (the document is self-contained, ADR 0021), `setContent` then `page.pdf({ format: 'A4', printBackground: true })`, always closes the browser, honours a timeout. `render-docx.ts`: `renderDocx(docs)` writes WordprocessingML from BE-501's block model (headings as Heading1..3 styles, paragraphs, lists, tables, embedded PNG/JPEG images, page breaks between documents), `w:lang` per language and run fonts with `w:cs` set to a Tamil-capable font ('Nirmala UI', fallback 'Latha') for complex-script text. Node-only module: never imported by the wizard.

- **Requirements:** REQ-022, REQ-021 · **Agent:** backend-engineer · **Priority:** medium · **Complexity:** L
- **Depends on:** BE-501
- **File ownership:** `packages/core/src/audit/documents/zip.ts`, `packages/core/src/audit/documents/render-pdf.ts`, `packages/core/src/audit/documents/render-docx.ts`, `packages/core/tests/audit-doc-docx.test.ts`, `packages/core/tests/audit-doc-pdf.test.ts`
- **Acceptance criteria:**
  - Given rendered documents, when exported as Word, then a valid .docx is produced and `mammoth` (existing dependency) reads back every heading, paragraph and table cell of the same documents (REQ-022 AC-2).
  - Given Tamil documents, when exported as Word, then the text read back equals the source character for character and runs carry `w:lang` ta-IN and a complex-script Tamil font.
  - Given rendered HTML, when exported as PDF, then a file starting `%PDF-` is produced, with A4 page size, containing the same documents (REQ-022 AC-1).
  - Given Tamil HTML, when exported as PDF, then the PDF embeds a font that covers Tamil (font program present, name matching the declared Tamil font stack) (supports REQ-022 AC-3).
  - Given HTML referencing an external URL, when printed, then no request leaves the process (the route handler aborted it) and the browser is closed even when printing fails or times out.
  - Given zip entries, when written, then names are sanitized and the archive is readable (round-trip through the docx reader proves it).
- **Validation commands:**
  - CHK-BE-507-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-doc-docx.test.ts`
  - CHK-BE-507-BROWSER (integration): `pnpm exec vitest run packages/core/tests/audit-doc-pdf.test.ts`
- **Expected outputs:**
  - renderPdf, renderDocx, writeZip
  - audit-doc-pdf added to BROWSER_TESTS.core by G7
- **Execution status:** VERIFIED

### BE-506 — Generate all documents, site.json, the Claude Code export bundle and the documents barrel

`generate.ts`: `generateAuditDocuments({ result, contents, edits, settings, language, documents? })` builds the edited view once and returns the five Audit Documents (Structure, Content, Findings, Improvement Roadmap, Proposal) in that order, or the requested subset; `generatePitchGlimpse` and `generateOwnerAudit` wrap BE-505. `site-json.ts`: `buildSiteJson(view)` with a `schemaVersion`, the site address, pages (urlPath, title, depth, coverage, language, recommendation), Sections with their (edited) text, findings (edited, with ids, group, area, page, Section, impact, effort), roadmap items, Skipped Pages. `bundle.ts`: Q-24 layout zipped with BE-507's writer: one folder `<host>-v<version>/` holding `01-structure.md`, `02-content.md`, `03-findings.md`, `04-improvement-roadmap.md`, `05-proposal.md`, `site.json` and a `README.md` index describing each file for Claude Code. `exportAudit(format, …)` maps `md` and `html` (selected documents in one file), `pdf`, `docx` (via BE-507) and `bundle` to `{ fileName, contentType: EXPORT_CONTENT_TYPES[format], body }`. `index.ts`: the documents barrel exporting the public API (edits, roadmap, generate, export, pitch, owner, settings, renderers); BE-190 (G1) re-exports it from the core barrel.

- **Requirements:** REQ-018, REQ-021 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-505, BE-507
- **File ownership:** `packages/core/src/audit/documents/generate.ts`, `packages/core/src/audit/documents/site-json.ts`, `packages/core/src/audit/documents/bundle.ts`, `packages/core/src/audit/documents/index.ts`, `packages/core/tests/audit-doc-export.test.ts`
- **Acceptance criteria:**
  - Given a finished audit, when documents are generated, then exactly the five Audit Documents (Structure, Content, Findings, Improvement Roadmap, Proposal) and one Pitch Glimpse are produced (REQ-018 AC-1 per the Q-02 decision and D-001 recommended default; REQ-018's text still says three, Q-46).
  - Given a finished audit, when exported as a bundle, then the archive contains the five Audit Documents as Markdown files, site.json with pages, sections and findings, and README.md, in one folder (REQ-021 AC-1, Q-24).
  - Given the exported site.json, when parsed, then it is valid JSON and every finding id and title in the Markdown documents appears in it (REQ-021 AC-2).
  - Given edits (finding text, removed page, Section text), when exported in any format, then the export carries the edits and the removed page appears in no file (REQ-020 AC-1..AC-3 at export level).
  - Given a Tamil page, when exported to Markdown and site.json, then its text matches the Page Content character for character.
  - Given each export format, when produced, then its content type comes from EXPORT_CONTENT_TYPES and its file name contains only safe characters.
- **Validation commands:**
  - CHK-BE-506-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-doc-export.test.ts`
- **Expected outputs:**
  - generateAuditDocuments, exportAudit, buildSiteJson, bundle writer
  - packages/core/src/audit/documents/index.ts barrel for BE-190
- **Execution status:** VERIFIED

### BE-508 — Audit settings routes: GET/PUT /api/audit-settings (Proposal template, opt-out text, company details)

`packages/runner/src/routes/audit-settings.ts` exports `auditSettingsRoutes(deps)` route-table rows for `AUDIT_API.getSettings` and `AUDIT_API.putSettings` (access `owner`, declared per BE-102). GET returns `AuditSettingsReply` (settings merged over BE-504 defaults, plus the defaults); PUT validates with `applySettingsUpdate`, persists the stored settings through the audit store's settings object (G6, ADR 0036: local plain file written atomically, hosted Cloud Storage bucket), and returns the new reply. `pagespeedKey` is never stored with the settings or echoed: it is handed to an injected `pagespeedKey` port (`saved(): Promise<boolean>`, `save(key|null)`) implemented over the key resolver by G4; the reply carries only `pagespeedKeySaved`. Errors use `AuditErrorReply` codes (400 ERR_INVALID_REQUEST with fields). Handlers take their dependencies as arguments so tests run without a RunnerServer.

- **Requirements:** REQ-027, REQ-019 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** BE-504, BE-102, DOC-104, BE-601, BE-405, BE-189
- **File ownership:** `packages/runner/src/routes/audit-settings.ts`, `packages/runner/tests/audit-settings-routes.test.ts`
- **Acceptance criteria:**
  - Given the tool user edits the Proposal template, when the template is saved and the settings are reopened (a new route instance over the same store), then the edits are kept (REQ-027 AC-1).
  - Given saved opt-out text for English or Tamil, when settings are read, then that text is returned; a null value puts the default back.
  - Given a PUT with `pagespeedKey`, when handled, then the key goes only to the injected key port, is never written to the settings store and never appears in any reply (only `pagespeedKeySaved`).
  - Given an invalid body, when PUT, then 400 ERR_INVALID_REQUEST with per-field messages and the stored settings are unchanged.
  - Given the route rows, when inspected, then both declare access `owner` from AUDIT_API.
- **Validation commands:**
  - CHK-BE-508-UNIT (unit): `pnpm exec vitest run packages/runner/tests/audit-settings-routes.test.ts`
- **Expected outputs:**
  - auditSettingsRoutes(deps) rows for BE-190 to register in packages/runner/src/routes/index.ts
- **Execution status:** VERIFIED

### BE-509 — Edits routes: GET and PATCH /api/audits/:id/edits

`packages/runner/src/routes/audit-documents.ts` exports `auditEditsRoutes(deps)` rows for `AUDIT_API.getEdits` (access `view`) and `AUDIT_API.patchEdits` (access `edit`), matched with `matchAuditPath`. `?version=` picks a version (latest by default). PATCH validates with BE-500 `validateAuditEditsPatch`, refuses a running version (409 ERR_AUDIT_RUNNING), an unknown audit or version (404 ERR_AUDIT_NOT_FOUND), a finding id, page or Section not in the version (400 ERR_INVALID_REQUEST), merges with `mergeEditsPatch` and saves the overlay through the G6 audit store beside the version's result (original result never written), and returns `AuditEditsReply`. Body size capped with the existing `readJsonBody`.

- **Requirements:** REQ-020 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** BE-500, BE-102, DOC-104, BE-601, BE-189
- **File ownership:** `packages/runner/src/routes/audit-documents.ts`, `packages/runner/tests/audit-edits-routes.test.ts`
- **Acceptance criteria:**
  - Given a finding, when the tool user PATCHes its text and GETs the edits, then the overlay holds the edited text and the stored result still holds the original (Q-25).
  - Given a page removed through PATCH, when the edits are read, then `removedPages` lists it; `restorePages` brings it back.
  - Given a running version, an unknown audit id, or an id failing AUDIT_ID_PATTERN, when PATCH, then 409 ERR_AUDIT_RUNNING, 404 ERR_AUDIT_NOT_FOUND, or 404 (no match) respectively, and nothing is stored.
  - Given a patch naming a finding, page or Section that the version does not have, when PATCH, then 400 ERR_INVALID_REQUEST and nothing is stored.
  - Given the route rows, when inspected, then getEdits declares access `view` and patchEdits `edit`.
- **Validation commands:**
  - CHK-BE-509-UNIT (unit): `pnpm exec vitest run packages/runner/tests/audit-edits-routes.test.ts`
- **Expected outputs:**
  - auditEditsRoutes(deps) rows for BE-190 to register
- **Execution status:** VERIFIED

### BE-510 — Export, Pitch Glimpse and Owner Audit download routes

`packages/runner/src/routes/audit-export.ts` exports `auditExportRoutes(deps)` rows for `AUDIT_API.export` (query `AuditExportQuery`: format md|html|pdf|docx|bundle, documents comma list, language, version), `AUDIT_API.pitch` (`PitchQuery`: language, format html|pdf) and `AUDIT_API.owner` (`OwnerAuditQuery`), all access `export`. Each loads the version's result, Page Content, edit overlay and screenshots from the G6 audit store and the settings (BE-508's store object), calls BE-506 `exportAudit` / `generatePitchGlimpse` / `generateOwnerAudit`, and replies with the file: Content-Type from EXPORT_CONTENT_TYPES, `Content-Disposition: attachment` with a sanitized file name, `Cache-Control: no-store`. Query values are validated (400 ERR_INVALID_REQUEST); running version 409 ERR_AUDIT_RUNNING; unknown 404 ERR_AUDIT_NOT_FOUND. Language defaults to the version's language. No route sends anything anywhere: no mail, message or form call exists in the module.

- **Requirements:** REQ-021, REQ-022, REQ-019, REQ-025, REQ-018 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-506, BE-508, BE-102, BE-601, BE-189
- **File ownership:** `packages/runner/src/routes/audit-export.ts`, `packages/runner/tests/audit-export-routes.test.ts`
- **Acceptance criteria:**
  - Given a finished audit, when GET export?format=bundle, then a zip with the five Markdown Audit Documents, site.json and README.md is returned with content type application/zip (REQ-021 AC-1).
  - Given format=md|html|docx|pdf, when exported, then the reply carries that format's content type and an attachment file name; pdf and docx contain the same documents as md (REQ-022 AC-1, AC-2; pdf/docx rendering injected in unit tests, real in QA-500).
  - Given edits saved for the version, when exported in any format, then the export carries them (REQ-020 AC-1..AC-3 end to end at route level).
  - Given language=ta or language=en, when the Pitch Glimpse or Owner Audit is requested, then it is produced in that language (REQ-019 AC-2/AC-3, REQ-025 AC-1).
  - Given any of these routes, when handled with a spying fetch and network layer, then no outbound request, email, message or form submission is made (REQ-019 AC-4).
  - Given an invalid format, document kind, language or version, when requested, then 400 ERR_INVALID_REQUEST; a running version gives 409 ERR_AUDIT_RUNNING.
  - Given the route rows, when inspected, then export, pitch and owner declare access `export`.
- **Validation commands:**
  - CHK-BE-510-UNIT (unit): `pnpm exec vitest run packages/runner/tests/audit-export-routes.test.ts`
- **Expected outputs:**
  - auditExportRoutes(deps) rows for BE-190 to register
- **Execution status:** VERIFIED

### FE-500 — Wizard: review and edit page hierarchy, Section content and findings before export

Screen under `packages/wizard/src/screens/audit/documents/`: `ReviewDocumentsScreen.tsx` shows the version's page hierarchy (remove/restore a page), each page's Sections with editable text (original kept and shown beside the edit, reset to original), findings with editable title/detail/suggestion (reset), and the redesign-or-repair choice per Sample Page. `review-model.ts`: pure helpers that turn screen changes into an `AuditEditsPatch` and merge `AuditGetReply.result` with `edits` for display. `review-api.ts`: calls `AUDIT_API.get`, `getEdits`, `patchEdits`, `content` through `auditPath`. Imports only single browser-safe modules (`@qa/types/src/website-audit.js`), never `@qa/core`. UI words follow CONTEXT.md (Website Audit, Section, Audit Document, Improvement Roadmap); no 'report', 'Plan', 'scan' or 'sitemap'. Accessible: labelled inputs, buttons with names, keyboard reachable.

- **Requirements:** REQ-020 · **Agent:** frontend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/wizard/src/screens/audit/documents/ReviewDocumentsScreen.tsx`, `packages/wizard/src/screens/audit/documents/review-model.ts`, `packages/wizard/src/screens/audit/documents/review-api.ts`, `packages/wizard/tests/audit-documents-review.test.tsx`
- **Acceptance criteria:**
  - Given a finding whose text the tool user edits, when saved, then the screen sends a patch with that finding's new text and shows the edited text with the original available.
  - Given a page the tool user removes from the hierarchy, when saved, then the patch lists it in `removePages` and the screen shows it as removed with a restore control.
  - Given a Section whose content the tool user edits, when saved, then the patch carries the urlPath, sectionId and new text; reset sends `reset: true`.
  - Given the rendered screen, when its markup is checked, then every input has a label, every button an accessible name, and no _Avoid_ term ('report', 'Plan', 'scan', 'sitemap', 'enhancement plan') appears in UI text.
  - Given the screen's imports, when checked, then it imports no Node-only module and no `@qa/core`.
- **Validation commands:**
  - CHK-FE-500-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-documents-review.test.tsx`
- **Expected outputs:**
  - ReviewDocumentsScreen for FE-191 (G1) to register in the wizard router
- **Execution status:** VERIFIED

### FE-501 — Wizard: export panel (formats, documents, language, Pitch Glimpse, Owner Audit) and document settings

`ExportDocumentsScreen.tsx`: pick the Audit Documents (all five by default), the language (English or Tamil), and download as Markdown, HTML, PDF, Word or the Claude Code bundle; separate buttons to download the Pitch Glimpse (HTML or PDF, language) and the Owner Audit (format, language). Downloads are links to `AUDIT_API.export|pitch|owner`; there is no send, email or message action (REQ-019 AC-4). `DocumentSettingsScreen.tsx`: edit the Proposal template (with the placeholder list and a 'put the default back' control), opt-out text per language (English, Tamil; shows the default and says the tool user owns checking it), and company details; saves through `AUDIT_API.putSettings`. `export-api.ts` and `settings-api.ts` build URLs and bodies via `auditPath`. Browser-safe imports only; CONTEXT.md terms ('Audit Document', 'Improvement Roadmap', 'Pitch Glimpse', 'Owner Audit', 'Proposal'), none of their _Avoid_ terms.

- **Requirements:** REQ-021, REQ-022, REQ-019, REQ-025, REQ-027, REQ-018 · **Agent:** frontend-engineer · **Priority:** medium · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/wizard/src/screens/audit/documents/ExportDocumentsScreen.tsx`, `packages/wizard/src/screens/audit/documents/DocumentSettingsScreen.tsx`, `packages/wizard/src/screens/audit/documents/export-api.ts`, `packages/wizard/src/screens/audit/documents/settings-api.ts`, `packages/wizard/tests/audit-documents-export.test.tsx`, `packages/wizard/tests/audit-document-settings.test.tsx`
- **Acceptance criteria:**
  - Given the export panel, when the tool user picks a format, documents and language, then the download link is the export route with exactly those query values (all five documents when none is unticked).
  - Given the export panel, when rendered, then it offers Markdown, HTML, PDF, Word and the bundle, a Pitch Glimpse download in English or Tamil, and an Owner Audit download, and has no send, email, share-by-message or form-submit-to-third-party control.
  - Given the settings screen, when the tool user edits the Proposal template and saves, then the PUT body carries the new template; 'put the default back' sends null.
  - Given the settings screen, when rendered, then English and Tamil opt-out texts are editable, the default is shown, and the screen says the tool user owns checking the text.
  - Given both screens, when their markup is checked, then inputs are labelled, and no _Avoid_ term appears ('the three audit documents', 'enhancement plan', 'pitch deck', 'owner report', 'report', 'Plan').
- **Validation commands:**
  - CHK-FE-501-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-documents-export.test.tsx packages/wizard/tests/audit-document-settings.test.tsx`
- **Expected outputs:**
  - ExportDocumentsScreen and DocumentSettingsScreen for FE-191 (G1) to register
- **Execution status:** VERIFIED

### QA-500 — End-to-end acceptance of Audit Documents and exports through a running runner

One runner test (`packages/runner/tests/audit-documents-flow.test.ts`) that starts a RunnerServer with the registered audit routes over a temporary data folder, seeds a finished Website Audit version (from `packages/core/tests/helpers/audit-doc-fixture.ts` through the G6 store API, English and Tamil pages), then through HTTP: PATCHes edits (finding text, removed page, Section text), saves an edited Proposal template, exports every format and the bundle, downloads the Pitch Glimpse (en, ta; html, pdf) and the Owner Audit (en, ta), and checks every acceptance criterion of the group end to end, including the ADR 0018 word list and the absence of a release verdict across all outputs (ADR 0033 consequence), PDF page count 1 for the Pitch Glimpse, and no outbound network activity during export (the server's outbound fetch and Chromium requests spied). Launches Chromium and a runner: G7 adds it to BROWSER_TESTS.runner.

- **Requirements:** REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-025, REQ-026, REQ-027 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-508, BE-509, BE-510, BE-190, BE-601
- **File ownership:** `packages/runner/tests/audit-documents-flow.test.ts`
- **Acceptance criteria:**
  - Given a finished audit, when documents are generated, then exactly the five Audit Documents and one Pitch Glimpse are produced (REQ-018 AC-1, D-001 default).
  - Given a finished audit, when the Pitch Glimpse is printed to PDF in English and in Tamil, then each is exactly one A4 page with the top 3 issues, their screenshots and the opt-out wording, in the chosen language (REQ-019 AC-1..AC-3).
  - Given the whole flow, when exports and the Pitch Glimpse are produced, then the runner made no outbound request and no email, message or form submission (REQ-019 AC-4).
  - Given edits to a finding, a removed page and a Section, when exported, then every format carries the edited text and no file lists the removed page (REQ-020 AC-1..AC-3).
  - Given the bundle, when unpacked, then it holds the five Markdown Audit Documents, a valid site.json in which every finding of the Markdown appears, and README.md (REQ-021 AC-1, AC-2).
  - Given PDF and Word exports, when produced, then they contain the same documents as the Markdown; Tamil text survives into the .docx character for character (REQ-022 AC-1..AC-2; AC-3 visual part by waiver on BE-507).
  - Given the Owner Audit in English and Tamil, when produced, then it is in that language and contains no pitch/skip mark, notes, outcome, effort or price (REQ-025 AC-1, AC-2).
  - Given the Improvement Roadmap document, when produced, then every item shows a priority, a phase and an effort (REQ-026 AC-1).
  - Given an edited Proposal template saved and the runner restarted on the same data folder, when the settings are read and the Proposal exported, then the edits are kept and the Proposal follows the template filled with the audit's data (REQ-027 AC-1, AC-2).
  - Given every generated output in both languages, when scanned, then none contains an ADR 0018 word, 'Ready to release' or a verdict.
- **Validation commands:**
  - CHK-QA-500-FLOW (integration): `pnpm exec vitest run packages/runner/tests/audit-documents-flow.test.ts`
- **Expected outputs:**
  - packages/runner/tests/audit-documents-flow.test.ts proving every G5 acceptance criterion end to end
  - audit-documents-flow added to BROWSER_TESTS.runner by G7
- **Execution status:** VERIFIED

### BE-600 — Audit store backends: local files by default, Cloud Storage JSON API when a bucket is set

Add the storage layer under packages/core/src/audit/store/: an `AuditStoreBackend` interface (getJson, putJson, getBytes, putBytes, list(prefix), deletePrefix(prefix)), a local file backend (default) and a Cloud Storage backend that talks to the Cloud Storage JSON REST API with an injected fetch (no SDK, no new dependency), plus `selectAuditStoreBackend({ dataDir, env, fetch })` that picks local unless `AUDIT_STORE_BUCKET` is set (D-003 default, Q-39, ADR 0036). This task does not touch the barrel (BE-601 owns packages/core/src/audit/store/index.ts).

- **Requirements:** REQ-028, REQ-029 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** DOC-104
- **File ownership:** `packages/core/src/audit/store/backend.ts`, `packages/core/src/audit/store/local-backend.ts`, `packages/core/src/audit/store/gcs-backend.ts`, `packages/core/src/audit/store/select-backend.ts`, `packages/core/tests/audit-store-backend.test.ts`, `packages/core/tests/audit-store-gcs.test.ts`, `packages/core/tests/audit-store-select.test.ts`
- **Acceptance criteria:**
  - The backend interface takes relative object keys only; a key with '..', '.', an empty segment, a leading '/', a backslash or a character outside [A-Za-z0-9._-/] is refused before any I/O, so no key can name a path outside the store root.
  - The local backend stores under `<dataDir>/audit-store/`, writes JSON with `writeJsonAtomic` (packages/core/src/atomic-write.ts:16) and bytes through a temp file plus rename; a missing key reads as null; deletePrefix removes everything under the prefix.
  - The Cloud Storage backend uses the JSON REST API through the injected fetch only: media upload (`uploadType=media`), download (`alt=media`), list with `prefix` and `pageToken` until done, and delete per object; object names are URL-encoded; requests carry a bearer token from an injected token provider.
  - The default token provider reads the Cloud Run metadata server (`Metadata-Flavor: Google`) and caches the token until shortly before it expires; tests inject a fake provider and a fake fetch, and no test makes a real network call.
  - A 404 from Cloud Storage reads as null; 401, 403, 429 and 5xx raise a store error with fixed wording that never contains the token, the bucket response body or object contents.
  - The same backend contract suite (put, get, overwrite, list, deletePrefix, missing key, refused key) passes against the local backend on a temp dir and against the Cloud Storage backend on an in-memory fake fetch.
  - REQ-029 AC-1 at store level: with no `AUDIT_STORE_BUCKET` the selector returns the local backend and makes no network call (the fake fetch records none); with it set, it returns the Cloud Storage backend; a bucket name that breaks Cloud Storage naming rules is refused with a clear message.
- **Validation commands:**
  - CHK-BE-600-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-store-backend.test.ts packages/core/tests/audit-store-gcs.test.ts packages/core/tests/audit-store-select.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/store/{backend,local-backend,gcs-backend,select-backend}.ts
  - Backend contract tests run against both backends
- **Execution status:** VERIFIED

### BE-601 — Website Audit store: audits and versions, Shortlist, Shared Links and Helper grants

Build the store on top of BE-600's backend: one folder per Website Audit and version (Q-39), the saved-audit and version records (REQ-028), Shortlist entries (REQ-023), Shared Link records (REQ-019/REQ-024 share, Q-30 expiry and revocation) and Helper grants (REQ-033), deletion of everything an audit owns (Q-30), and the barrel packages/core/src/audit/store/index.ts (BE-190 wires it into the core entry and the runner). Other groups write results, Page Content, screenshots, edits and rewrites through its generic per-version JSON and file methods, so deletion covers them.

- **Requirements:** REQ-028, REQ-023, REQ-033, REQ-024 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** L
- **Depends on:** DOC-104, BE-600
- **File ownership:** `packages/core/src/audit/store/index.ts`, `packages/core/src/audit/store/keys.ts`, `packages/core/src/audit/store/audit-store.ts`, `packages/core/src/audit/store/shortlist.ts`, `packages/core/src/audit/store/shares.ts`, `packages/core/src/audit/store/helper-grants.ts`, `packages/core/tests/audit-store.test.ts`, `packages/core/tests/audit-store-shortlist.test.ts`, `packages/core/tests/audit-store-shares.test.ts`, `packages/core/tests/audit-store-helper-grants.test.ts`
- **Acceptance criteria:**
  - Key layout (keys.ts) puts each Website Audit under `audits/<auditId>/` and each version under `audits/<auditId>/v<n>/` (version record, result, Page Content and screenshot files, edits, preview.html); Shortlist entry, Shared Links and Helper grants live in the audit folder; the only cross-audit objects are the Shared Link index `share-index/<linkId>` and the Helper index `helper-index/<sha256(email)>/<auditId>`.
  - Audit ids are random and match AUDIT_ID_PATTERN; every method refuses an id, version or file name that does not match its pattern before touching the backend.
  - createAudit(request) records version 1 as running; addVersion(auditId) adds the next version with the same url, limits and language (support for REQ-028 AC-3); updateVersion records status, finishedAt and counts; saveResult/getResult store the AuditResult per version; generic readVersionJson/writeVersionJson/putVersionFile/getVersionFile serve other groups.
  - REQ-028 AC-1 and AC-2: after a new store instance is opened on the same backend (a restart), a finished audit opens, and an audit run twice lists both versions oldest first and each opens its own result; listAudits returns AuditSummary objects with their Shortlist entry.
  - deleteAudit removes every version, result, file, edit, preview, Shortlist entry, Shared Link (and its index entry) and Helper grant (and its index entry); afterwards the backend holds no object under the audit's prefix and no index entry refers to it (Q-30).
  - Shortlist (REQ-023 AC-1..AC-3 at store level): put applies ShortlistUpdate (only sent fields change, null clears mark or outcome); mark must be pitch or skip, outcome must pass isShortlistOutcome; notes and outcomeNote are length-capped; listShortlist filters by mark and by outcome; an entry is saved with its audit and shown in its summary.
  - Shared Links: ids come from crypto random bytes (at least 128 bits, base64url) and match SHARE_LINK_ID_PATTERN; expiresAt is createdAt plus SHARE_LINK_DAYS; revoke sets revokedAt; resolveShare(linkId) returns the link and its audit when open, 'gone' when revoked, expired (tested with an injected clock at 30 days plus 1 ms) or its audit was deleted, and 'missing' when unknown.
  - Helper grants: grant, remove and list per audit; the email is trimmed, lower-cased and validated; permissions are a non-empty subset of HELPER_PERMISSIONS; grantsFor(email) returns only that email's grants; a removal is visible on the very next read (no cache).
  - Writes to the same audit are serialised so concurrent updates (for example a Shortlist save during a version update) lose nothing.
  - No secrets in stored audits: a test seeds fake values for RUNNER_ACCESS_TOKEN, an AI key and a Google ID token in the environment and inputs, runs every store method, and finds none of them in any stored object.
- **Validation commands:**
  - CHK-BE-601-UNIT (unit): `pnpm exec vitest run packages/core/tests/audit-store.test.ts packages/core/tests/audit-store-shortlist.test.ts packages/core/tests/audit-store-shares.test.ts packages/core/tests/audit-store-helper-grants.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/store/{index,keys,audit-store,shortlist,shares,helper-grants}.ts
  - Store tests covering restart, versions, cascade delete, Shortlist, Shared Links and Helper grants
- **Execution status:** VERIFIED

### BE-602 — Runner routes for saved Website Audits and the Shortlist

Add route modules `packages/runner/src/routes/audit-store.ts` (AUDIT_API list, get, remove) and `packages/runner/src/routes/audit-shortlist.ts` (getShortlist, putShortlist, listShortlist). Each exports a factory taking its dependencies (the store, the caller from BE-102's route context) and returning Route rows with declared access, so tests run without server.ts. BE-190 (G1) adds the rows to the route table.

- **Requirements:** REQ-028, REQ-023 · **Agent:** backend-engineer · **Priority:** medium · **Complexity:** M
- **Depends on:** DOC-104, BE-601, BE-102, BE-189
- **File ownership:** `packages/runner/src/routes/audit-store.ts`, `packages/runner/src/routes/audit-shortlist.ts`, `packages/runner/tests/audit-store-routes.test.ts`, `packages/runner/tests/audit-shortlist-routes.test.ts`
- **Acceptance criteria:**
  - Every row's method, path and declared access equal its AUDIT_API entry (list, get, remove, getShortlist, putShortlist, listShortlist); a test iterates the rows and compares.
  - GET /api/audits lists the Website Audits the caller may see, each with all versions oldest first and its Shortlist entry: the owner sees all; a Helper sees only audits granted to them (REQ-033 AC-1).
  - GET /api/audits/:id returns AuditGetReply for the latest version or the `version` asked for (REQ-028 AC-1, AC-2); an unknown audit or version answers 404 ERR_AUDIT_NOT_FOUND; a malformed version answers 400 ERR_INVALID_REQUEST.
  - DELETE /api/audits/:id (owner) deletes every version, file, edit, Shortlist entry, Shared Link and Helper grant of the audit and answers { deleted: true }; it answers 409 ERR_AUDIT_RUNNING while a version of that audit is running.
  - PUT /api/audits/:id/shortlist saves the mark (pitch or skip), notes and outcome (fixed list, Q-31) plus outcome note and returns the saved entry; GET returns it; GET /api/shortlist filters by mark and outcome (REQ-023 AC-1..AC-3); invalid values answer 400 ERR_INVALID_REQUEST with a field message.
  - Every refusal is an AuditErrorReply with a fixed message and code; no stack trace, file path or store detail appears in a reply.
- **Validation commands:**
  - CHK-BE-602-UNIT (integration): `pnpm exec vitest run packages/runner/tests/audit-store-routes.test.ts packages/runner/tests/audit-shortlist-routes.test.ts`
- **Expected outputs:**
  - auditStoreRoutes and auditShortlistRoutes factories with tests
- **Execution status:** VERIFIED

### BE-603 — Re-run a saved Website Audit as a new version

Add `packages/runner/src/routes/audit-rerun.ts` for AUDIT_API.rerun: take the run slot with kind 'audit' (BE-103), add the next version through the store with the saved url, limits and language, and start the audit pipeline through G2's audit start service (the same function the start route uses).

- **Requirements:** REQ-028 · **Agent:** backend-engineer · **Priority:** medium · **Complexity:** S
- **Depends on:** DOC-104, BE-601, BE-102, BE-103, BE-205, BE-189
- **File ownership:** `packages/runner/src/routes/audit-rerun.ts`, `packages/runner/tests/audit-rerun-route.test.ts`
- **Acceptance criteria:**
  - The row's method, path and access equal AUDIT_API.rerun (owner).
  - REQ-028 AC-3: given a saved audit, POST /api/audits/:id/rerun answers 202 AuditStartReply, starts a run with the same url and limits (and language) as the saved audit, and the history then lists the new version after the earlier ones.
  - While the run slot is held by a Check-up, a Competitive Benchmark or another Website Audit, re-run answers 409 ERR_RUN_IN_PROGRESS and no version is added.
  - An unknown audit answers 404 ERR_AUDIT_NOT_FOUND; a re-run while the audit's latest version is still running answers 409 ERR_AUDIT_RUNNING.
  - A start failure after the version was added marks that version failed with fixed wording and releases the run slot.
- **Validation commands:**
  - CHK-BE-603-UNIT (integration): `pnpm exec vitest run packages/runner/tests/audit-rerun-route.test.ts`
- **Expected outputs:**
  - auditRerunRoutes factory with tests (fake audit starter injected)
- **Execution status:** VERIFIED

### BE-604 — Shared Link routes and the public /s/:linkId page

Add `packages/runner/src/routes/audit-share.ts` for AUDIT_API listShares, createShare, revokeShare and sharedPage. Shared Links are unguessable, revocable and expire after 30 days (Q-30); `/s/:linkId` is the only public audit route (access 'public', D-004). A pitch link renders the Pitch Glimpse through G5's renderer; a preview link serves the stored preview.html of that version.

- **Requirements:** REQ-024, REQ-023 · **Agent:** backend-engineer · **Priority:** medium · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** DOC-104, BE-601, BE-102, BE-505, BE-189
- **File ownership:** `packages/runner/src/routes/audit-share.ts`, `packages/runner/tests/audit-share-routes.test.ts`
- **Acceptance criteria:**
  - Each row's method, path and access equal its AUDIT_API entry: listShares view, createShare owner, revokeShare owner, sharedPage public.
  - POST /api/audits/:id/share (kind pitch or preview, language, version) creates a link through the store and returns ShareLinkReply; kind preview without a stored preview for that version answers 409 with a fixed message; an unknown audit answers 404 ERR_AUDIT_NOT_FOUND.
  - GET /s/:linkId is served with no access key and no cookie of any kind; it sets no cookie.
  - Every Shared Link page reply carries `X-Robots-Tag: noindex, nofollow`, a robots noindex meta tag, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and a Content-Security-Policy that allows no script, no external resource, no form and no framing (default-src 'none'; images only from data:; inline styles only).
  - A revoked link, and a link opened 30 days plus 1 ms after creation (injected clock), answer 410 ERR_LINK_GONE as a small HTML page; a malformed or unknown linkId answers the same 404 body either way, so the reply reveals nothing about other links.
  - DELETE /api/audits/:id/share/:linkId (owner) revokes the link and the next GET /s/:linkId answers 410.
  - The page never shows the owner's contact details: with a fixture audit whose marketing signals hold a name, address, phone and email, none of them appears in the shared pitch page.
  - The page shows no release verdict and none of the ADR 0018 words (compliant, certified, secure, fully accessible, passes WCAG).
- **Validation commands:**
  - CHK-BE-604-UNIT (security): `pnpm exec vitest run packages/runner/tests/audit-share-routes.test.ts`
- **Expected outputs:**
  - auditShareRoutes factory with tests
- **Execution status:** VERIFIED

### BE-605 — Improved-homepage preview: AI generator, sanitiser and preview routes

Add the preview generator under packages/core/src/audit/preview/ (prompt from the version's homepage Page Content, navigation, top findings and edits; AI stage 'preview' with the tool user's key; output sanitised into one self-contained HTML page, Q-16) and `packages/runner/src/routes/audit-preview.ts` for AUDIT_API createPreview (owner) and getPreview (view). The page is stored as preview.html in the version folder, so the export folder (G5) and a preview Shared Link (BE-604) can use it.

- **Requirements:** REQ-024 · **Agent:** backend-engineer · **Priority:** medium · **Complexity:** L · **P2 (sensitive)**
- **Depends on:** DOC-104, BE-601, BE-101, BE-102, BE-402, BE-500, BE-189
- **File ownership:** `packages/core/src/audit/preview/**`, `packages/core/tests/audit-preview.test.ts`, `packages/core/tests/audit-preview-sanitize.test.ts`, `packages/runner/src/routes/audit-preview.ts`, `packages/runner/tests/audit-preview-routes.test.ts`
- **Acceptance criteria:**
  - createPreview and getPreview rows' method, path and access equal AUDIT_API (owner and view).
  - Without an AI key, POST /api/audits/:id/preview answers 409 ERR_NO_AI_KEY and stores nothing; with a key (fake provider in tests) it stores preview.html for the version and returns PreviewReply with version, language and createdAt.
  - The AI call uses the model chosen for the 'preview' stage (REQ-039) and has a timeout; a failure answers with fixed wording and stores nothing.
  - The output is self-contained (ADR 0021): no script element, no on* attribute, no javascript: or data:text/html URL, no meta refresh, no base element, no iframe, object or embed, no external stylesheet, font or CSS url(); the sanitiser removes each of these from hostile AI output fixtures.
  - Images from the audited site are fetched only through makeOutboundFetch (BE-101) with a byte cap and inlined as data: images; a refused or failed fetch leaves the alt text instead; no Playwright request or bare fetch is used.
  - REQ-024 AC-1 (structure): every menu link of the homepage (PageHierarchy links with region 'menu') appears as a working <a href> in the preview, on-site links as absolute http(s) addresses of the audited site opening in a new tab with rel="noopener noreferrer", and every in-page '#id' link points to an id that exists in the page.
  - GET /api/audits/:id/preview serves the stored page with the same strict Content-Security-Policy and noindex header as Shared Link pages; 404 ERR_AUDIT_NOT_FOUND when no preview exists for that version.
  - The page says it is a preview of suggested changes, shows no release verdict and none of the ADR 0018 words.
- **Validation commands:**
  - CHK-BE-605-UNIT (security): `pnpm exec vitest run packages/core/tests/audit-preview.test.ts packages/core/tests/audit-preview-sanitize.test.ts packages/runner/tests/audit-preview-routes.test.ts`
- **Expected outputs:**
  - packages/core/src/audit/preview/{index,generate,sanitize,prompt}.ts
  - auditPreviewRoutes factory with tests
- **Execution status:** VERIFIED

### BE-606 — Helper sign-in (Firebase ID token), Helper session and per-audit access

Add packages/runner/src/helpers/ (Firebase ID token verification with node:crypto against Google's published keys, a signed Helper session cookie, and the Helper access resolver BE-102's dispatch calls for view, edit and export routes) and `packages/runner/src/routes/audit-helpers.ts` for AUDIT_API listHelpers, grantHelper, removeHelper (owner) and helperStatus, helperSignIn, helperSession, helperSignOut (sign-in). No Firebase Admin SDK: verification is done in code (Q-38, Q-15).

- **Requirements:** REQ-033 · **Agent:** backend-engineer · **Priority:** low · **Complexity:** L · **P2 (sensitive)**
- **Depends on:** DOC-104, BE-601, BE-102, DOC-105, BE-189
- **File ownership:** `packages/runner/src/helpers/**`, `packages/runner/src/routes/audit-helpers.ts`, `packages/runner/tests/helper-token.test.ts`, `packages/runner/tests/helper-session.test.ts`, `packages/runner/tests/helper-access.test.ts`, `packages/runner/tests/audit-helpers-routes.test.ts`
- **Acceptance criteria:**
  - Each row's method, path and access equal its AUDIT_API entry.
  - Helper sign-in is on only when FIREBASE_PROJECT_ID and RUNNER_ACCESS_TOKEN are set; otherwise helperStatus answers { enabled: false } and the session routes answer 404 ERR_HELPERS_OFF.
  - The ID token is accepted only when: alg is RS256 (none and HS256 refused), the kid's key from Google's securetoken public keys verifies the signature (keys fetched from the fixed Google URL with an injected fetch in tests and cached per Cache-Control), iss is https://securetoken.google.com/<project>, aud is the project, exp is in the future, iat and auth_time are not in the future beyond 5 minutes of skew, sub is set, and email is present with email_verified true; any failure answers 401 ERR_SIGN_IN_FAILED. Tests sign tokens with a locally generated RSA key.
  - The ID token is never stored, logged or echoed in a reply.
  - The Helper session cookie is HttpOnly, SameSite=Strict, Path=/, Secure on https, at most 8 hours long, holds only the lower-cased email and expiry, and is HMAC-SHA256 signed with a key derived from RUNNER_ACCESS_TOKEN; a tampered or expired cookie means no Helper; sign-out clears it.
  - The access resolver reads grants from the store on every request: a Helper reaches view, edit and export routes only for audits granted to them with that permission ('edit' and 'export' include 'view'); any other audit answers 404 ERR_AUDIT_NOT_FOUND, so its existence is not revealed (REQ-033 AC-1); an owner-only route answers 403 ERR_FORBIDDEN, so a Helper cannot see or use AI keys, settings, delete, re-run, publish Shared Links or manage Helpers (Q-15).
  - REQ-033 AC-2: after the owner removes a Helper's grant for audit A, the Helper's next request for audit A is refused, without signing out.
  - PUT /api/audits/:id/helpers validates and lower-cases the email and the permissions and returns HelperGrantReply; DELETE removes the grant; GET lists the audit's grants; a Helper calling any of them gets 403 ERR_FORBIDDEN.
  - GET /api/helper/session returns HelperSession with only the signed-in Helper's grants.
- **Validation commands:**
  - CHK-BE-606-UNIT (security): `pnpm exec vitest run packages/runner/tests/helper-token.test.ts packages/runner/tests/helper-session.test.ts packages/runner/tests/helper-access.test.ts packages/runner/tests/audit-helpers-routes.test.ts`
- **Expected outputs:**
  - packages/runner/src/helpers/{firebase-token,helper-session,helper-access}.ts
  - auditHelperRoutes factory with tests
- **Execution status:** VERIFIED

### BE-607 — Hosted copy wiring: Cloud Storage bucket and Firebase settings in deploy, deployment guide

Pass the audit store bucket and the Firebase project settings to Cloud Run in .github/workflows/deploy.yml and document the one-time setup in docs/DEPLOYMENT.md: an always-free Cloud Storage bucket for Website Audits (D-003, Q-39) and Firebase Authentication in the same project (Q-44). Local runs need none of it (REQ-029 AC-1).

- **Requirements:** REQ-029, REQ-028 · **Agent:** release-engineer · **Priority:** medium · **Complexity:** S · **P2 (sensitive)**
- **Depends on:** DOC-104, BE-600, BE-606
- **File ownership:** `.github/workflows/deploy.yml`, `docs/DEPLOYMENT.md`, `packages/runner/tests/deploy-audit-store.test.ts`
- **Acceptance criteria:**
  - deploy.yml passes AUDIT_STORE_BUCKET and FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY, FIREBASE_AUTH_DOMAIN to the runner service from GitHub repository variables, without changing the existing env vars, secrets or the tag rule checked by release-workflow.test.ts.
  - docs/DEPLOYMENT.md gives the gcloud commands to create the bucket in an always-free region (us-central1, us-east1 or us-west1, matching the runner), with uniform bucket-level access, public access prevention enforced, no lifecycle delete rule, object versioning off and soft delete cleared, so deleting a Website Audit removes its data and nothing else expires it (Q-30).
  - docs/DEPLOYMENT.md grants the Cloud Run runtime service account roles/storage.objectAdmin on that bucket only, and lists the Firebase setup commands for Google sign-in in the same project (Q-44).
  - docs/DEPLOYMENT.md states that local runs keep plain files under the data folder and need no cloud account (REQ-029 AC-1), and that Shared Links and audits live in the bucket on the hosted copy.
  - A test reads deploy.yml and docs/DEPLOYMENT.md and asserts the variables are passed and the retention settings are documented.
- **Validation commands:**
  - CHK-BE-607-UNIT (documentation): `pnpm exec vitest run packages/runner/tests/deploy-audit-store.test.ts packages/runner/tests/release-workflow.test.ts`
- **Expected outputs:**
  - Updated deploy.yml and docs/DEPLOYMENT.md
  - packages/runner/tests/deploy-audit-store.test.ts
- **Execution status:** VERIFIED

### FE-600 — Wizard: saved Website Audits, version history, re-run, delete and Shortlist

Add the past Website Audits list, the history of one Website Audit (every version, each opening), re-run and delete, the Shortlist panel (mark, notes, outcome) and the Shortlist screen with filters, under packages/wizard/src/screens/audit/saved/, with their own small client over AUDIT_API. FE-191 (G1) registers the screens' routes.

- **Requirements:** REQ-028, REQ-023 · **Agent:** frontend-engineer · **Priority:** medium · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/wizard/src/screens/audit/saved/SavedAuditsScreen.tsx`, `packages/wizard/src/screens/audit/saved/AuditHistoryScreen.tsx`, `packages/wizard/src/screens/audit/saved/ShortlistPanel.tsx`, `packages/wizard/src/screens/audit/saved/ShortlistScreen.tsx`, `packages/wizard/src/screens/audit/saved/saved-api.ts`, `packages/wizard/tests/audit-saved.test.tsx`, `packages/wizard/tests/audit-shortlist.test.tsx`
- **Acceptance criteria:**
  - The list shows each saved Website Audit with its host, address, number of versions, latest status and Shortlist mark; an empty list shows a short how-to-start line.
  - REQ-028 AC-1/AC-2: the history screen lists every version oldest first with start time, status and counts, and each version opens through GET /api/audits/:id?version=n.
  - REQ-028 AC-3: 'Re-run' posts AUDIT_API.rerun and shows the new version; ERR_RUN_IN_PROGRESS shows a plain message that another run is in progress.
  - Delete asks for confirmation and says it removes every version, edit, Shortlist entry, Shared Link and Helper access of that Website Audit.
  - REQ-023 AC-1..AC-3: the Shortlist panel sets pitch or skip, notes, an outcome from the six fixed values (SHORTLIST_OUTCOMES) and an outcome note, saves through PUT /api/audits/:id/shortlist and shows the saved values; the Shortlist screen filters by mark and by outcome.
  - Every control has a visible label or accessible name; status is not shown by colour alone.
  - UI text uses CONTEXT.md terms (Website Audit, Shortlist, Shared Link, Helper) and none of their Avoid words (scan, project, leads, pipeline, CRM, prospect list); no-banned-words.test.ts still passes.
  - The screens import only browser-safe modules from @qa/types/src/... (no Node built-ins); links to the preview and Shared Link screen (FE-601) and the Helpers screen (FE-602) are plain route paths, not imports.
- **Validation commands:**
  - CHK-FE-600-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-saved.test.tsx packages/wizard/tests/audit-shortlist.test.tsx packages/wizard/tests/no-banned-words.test.ts`
- **Expected outputs:**
  - Saved audit, history and Shortlist screens with server-rendered tests
- **Execution status:** VERIFIED

### FE-601 — Wizard: improved-homepage preview and Shared Links screen

Add a screen under packages/wizard/src/screens/audit/saved/ to generate and open the improved-homepage preview of a version, and to create, list and revoke Shared Links for the Pitch Glimpse or the preview.

- **Requirements:** REQ-024 · **Agent:** frontend-engineer · **Priority:** medium · **Complexity:** S
- **Depends on:** none
- **File ownership:** `packages/wizard/src/screens/audit/saved/PreviewShareScreen.tsx`, `packages/wizard/src/screens/audit/saved/share-api.ts`, `packages/wizard/tests/audit-preview-share.test.tsx`
- **Acceptance criteria:**
  - 'Make preview' posts AUDIT_API.createPreview for the chosen version and language; ERR_NO_AI_KEY shows that an AI key is needed and links to the AI key settings.
  - 'Open preview' opens GET /api/audits/:id/preview?version=n in a new tab (REQ-024 AC-1: opens in a browser).
  - Creating a Shared Link (Pitch Glimpse or preview, language) shows the full link with a copy button and its expiry date 30 days out, and warns that anyone holding the link can open it.
  - The list shows each Shared Link with kind, language, created, expires and revoked state; 'Revoke' asks for confirmation and then shows it as revoked.
  - UI text says 'Shared Link' and avoids public link, permalink, share URL and published report; controls have accessible names.
  - Only browser-safe @qa/types/src/... imports.
- **Validation commands:**
  - CHK-FE-601-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-preview-share.test.tsx packages/wizard/tests/no-banned-words.test.ts`
- **Expected outputs:**
  - PreviewShareScreen with tests
- **Execution status:** VERIFIED

### FE-602 — Wizard: Helpers screen and Helper sign-in with Google (Firebase Authentication)

Add the owner's Helpers screen (give and remove access per Website Audit) and the Helper sign-in screen that signs in with Google through the Firebase Authentication web SDK and exchanges the ID token at POST /api/helper/session. Adds the `firebase` package to the wizard (P2 dependency_add, Q-38), loaded only on the sign-in screen.

- **Requirements:** REQ-033 · **Agent:** frontend-engineer · **Priority:** low · **Complexity:** M · **P2 (sensitive)**
- **Depends on:** none
- **File ownership:** `packages/wizard/src/screens/audit/saved/HelpersScreen.tsx`, `packages/wizard/src/screens/audit/saved/HelperSignInScreen.tsx`, `packages/wizard/src/screens/audit/saved/helper-api.ts`, `packages/wizard/src/screens/audit/saved/firebase-sign-in.ts`, `packages/wizard/package.json`, `pnpm-lock.yaml`, `packages/wizard/tests/audit-helpers.test.tsx`
- **Acceptance criteria:**
  - The Helpers screen lists the Helpers of a Website Audit with their permissions, gives access by Google account email with view, edit and export choices, and removes access after confirmation; when helperStatus is not enabled it says Helper sign-in is not set up on this copy and offers nothing else.
  - The Helper sign-in screen signs in with Google through Firebase Authentication, posts the ID token to POST /api/helper/session, and then lists only the Website Audits given to that Helper; ERR_SIGN_IN_FAILED shows a plain message; 'Sign out' calls DELETE /api/helper/session.
  - Firebase auth persistence is in memory only; the ID token is never written to localStorage, sessionStorage or the URL.
  - The firebase SDK is loaded by dynamic import on the sign-in screen only, so other wizard screens do not include it; only the auth module is used.
  - UI text calls the person a Helper and avoids Role, user, team member and collaborator; it states what a Helper can do (view, edit, export) and cannot do (AI keys, delete, add Helpers).
  - The `firebase` dependency is pinned to an exact version in packages/wizard/package.json and the lockfile is updated with it only.
- **Validation commands:**
  - CHK-FE-602-UNIT (unit): `pnpm exec vitest run packages/wizard/tests/audit-helpers.test.tsx packages/wizard/tests/no-banned-words.test.ts`
- **Expected outputs:**
  - HelpersScreen and HelperSignInScreen with tests
  - firebase added to packages/wizard/package.json
- **Execution status:** VERIFIED

### QA-600 — Persistence, sharing and Helper access through the real runner dispatch, plus preview click test

Integration tests that start the runner with the wired route table (after BE-190) on a temp data folder: saved audits survive a restart, delete removes everything, Shared Links are the only thing a visitor without the access key reaches, Helper access is scoped per audit; and a Chromium test that opens a stored preview and clicks its navigation.

- **Requirements:** REQ-028, REQ-029, REQ-033, REQ-024, REQ-023 · **Agent:** qa-engineer · **Priority:** medium · **Complexity:** M
- **Depends on:** BE-190, BE-602, BE-603, BE-604, BE-605, BE-606
- **File ownership:** `packages/runner/tests/audit-persistence-integration.test.ts`, `packages/runner/tests/audit-preview-browser.test.ts`
- **Acceptance criteria:**
  - REQ-028 AC-1/AC-2: a finished audit (seeded through the store) is listed and opens after the runner is stopped and started again on the same data folder; an audit with two versions lists both and each opens.
  - REQ-029 AC-1: with no AUDIT_STORE_BUCKET and no cloud variables, the runner saves and lists audits in local files, and the injected fetch records no call to a Google host.
  - Q-30: DELETE /api/audits/:id leaves no file of that audit under the store folder and its Shared Links then answer 410 or 404.
  - With RUNNER_ACCESS_TOKEN set and RUNNER_BETA=1, GET /s/:linkId is served without the access key, while list, get, Shortlist, share management and preview routes are refused without it (D-004).
  - REQ-033 AC-1/AC-2 over HTTP: a Helper signed in with a test-signed token (fake Google keys) and granted audit A lists only A, opens A, cannot open B (404) or any owner route (403); after the owner removes the grant the next request for A is refused.
  - REQ-023: a Shortlist mark, notes and outcome saved over HTTP are returned with the audit in GET /api/audits.
  - REQ-024 AC-1 (browser): Chromium opens a stored preview through GET /api/audits/:id/preview and through its Shared Link, clicks a menu link and an in-page link, and the navigation happens (outbound requests intercepted, no real site contacted); the page runs no script.
- **Validation commands:**
  - CHK-QA-600-INTEGRATION (integration): `pnpm exec vitest run packages/runner/tests/audit-persistence-integration.test.ts`
  - CHK-QA-600-BROWSER (e2e): `pnpm exec vitest run packages/runner/tests/audit-preview-browser.test.ts`
- **Expected outputs:**
  - Two runner test files covering REQ-023, REQ-024, REQ-028, REQ-029, REQ-033 end to end
- **Execution status:** VERIFIED

### QA-700 — Test typecheck foundation: shared config, fixture declaration, per-package configs, checkers test typings

Fix the causes of the 216 TS errors in EV-0003 that are config- or declaration-wide, so the per-package tasks (QA-701 core, QA-702 runner, QA-703 wizard) only fix real test typings, and fix the three checkers test files. (1) `tsconfig.test.json`: resolve modules the way vitest does: `module: ESNext` + `moduleResolution: Bundler` (removes every TS2835 'needs explicit file extension' error, about 70 in wizard tests and checkers/bug-grouping), `lib` adds `DOM.Iterable` (wizard-e2e NodeListOf iteration), `jsx: react-jsx` for the .tsx tests, and `paths` mapping `@qa/types`, `@qa/types/src/*`, `@qa/core`, `@qa/checkers`, `@qa/runner` to their `src` exactly as `vitest.config.ts` `sharedResolve` aliases do (fixes TS2307 in wizard landing-audit-browser/sample-report-format/wizard-e2e and stale-dist errors such as missing-element `TestStep`). Resolve `pngjs` types for core tests (e2e-orchestrator, visual-baseline-compat) without a new dependency, e.g. a `paths` entry to the `@types/pngjs` that `@qa/checkers` already installs; if that is not possible, stop and report a P2 dependency question (`@types/pngjs` in core devDependencies) instead of adding it. (2) Add `fixtures/test-app/server.d.ts` declaring `export const server: import('http').Server` (fixes the ~40 TS7016 errors in core/runner/wizard tests and scripts/benchmark.ts). (3) Add `packages/<pkg>/tests/tsconfig.typecheck.json` for checkers, core, runner, wizard and types, each extending `../../../tsconfig.test.json` and including only its own tests directory, so each package task can run a scoped typecheck; the name is not `tsconfig.json` on purpose so vitest/esbuild keep using the package tsconfig for transforms. (4) Fix the typings in `packages/checkers/tests/bug-detection.test.ts` (`statusText` not in `NetworkEntry`), `bug-grouping.test.ts`, `visual-diff-finding.test.ts` ('desktop' is not a `Breakpoint`). `pnpm typecheck` keeps its command (`tsc -p tsconfig.test.json --noEmit`); root `package.json` is not touched.

- **Requirements:** REQ-051 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** none
- **File ownership:** `tsconfig.test.json`, `fixtures/test-app/server.d.ts`, `packages/checkers/tests/tsconfig.typecheck.json`, `packages/core/tests/tsconfig.typecheck.json`, `packages/runner/tests/tsconfig.typecheck.json`, `packages/wizard/tests/tsconfig.typecheck.json`, `packages/types/tests/tsconfig.typecheck.json`, `packages/checkers/tests/bug-detection.test.ts`, `packages/checkers/tests/bug-grouping.test.ts`, `packages/checkers/tests/visual-diff-finding.test.ts`
- **Acceptance criteria:**
  - Given the per-package configs, when `pnpm exec tsc -p packages/checkers/tests/tsconfig.typecheck.json --noEmit` and `pnpm exec tsc -p packages/types/tests/tsconfig.typecheck.json --noEmit` run, then both exit 0 with no TS errors.
  - Given `pnpm typecheck` after this task, when its output is read, then no TS2835, TS2307 (`@qa/*`) or TS7016 (`fixtures/test-app/server.js`, `pngjs`) error remains, and every remaining error is in a file owned by QA-701, QA-702 or QA-703.
  - Given the config change, when the diff is reviewed, then `strict` stays on, no `noImplicitAny: false`, `// @ts-nocheck`, `// @ts-ignore`, `@ts-expect-error` or `as any` was added to silence an error, and no test was deleted or skipped and no assertion removed or weakened (REQ-051 AC-2).
  - Given the three checkers test files, when `pnpm exec vitest run packages/checkers/tests/bug-detection.test.ts packages/checkers/tests/bug-grouping.test.ts packages/checkers/tests/visual-diff-finding.test.ts` runs, then every test passes.
  - Given `pnpm test` and `pnpm build`, when they run after the change, then vitest still resolves the same files (no `tsconfig.json` was added under any `tests/` folder) and the package builds are unchanged (only `tsconfig.test.json` and the new typecheck-only configs changed).
- **Validation commands:**
  - CHK-QA-700-TYPECHECK-CHECKERS (typecheck): `pnpm exec tsc -p packages/checkers/tests/tsconfig.typecheck.json --noEmit`
  - CHK-QA-700-TYPECHECK-TYPES (typecheck): `pnpm exec tsc -p packages/types/tests/tsconfig.typecheck.json --noEmit`
  - CHK-QA-700-UNIT (unit): `pnpm exec vitest run packages/checkers/tests/bug-detection.test.ts packages/checkers/tests/bug-grouping.test.ts packages/checkers/tests/visual-diff-finding.test.ts`
- **Expected outputs:**
  - tsconfig.test.json resolving like vitest (Bundler, DOM.Iterable, jsx, @qa/* paths)
  - fixtures/test-app/server.d.ts
  - five packages/<pkg>/tests/tsconfig.typecheck.json files
  - three checkers test files type-clean
  - report listing the remaining errors per file for QA-701..QA-703
- **Execution status:** VERIFIED

### QA-701 — Fix core test typings (EV-0003)

Fix the remaining TS errors in packages/core/tests after QA-700, without weakening any test. Files with real typing errors at baseline: ai-planner-sources (c.name possibly undefined), auth-crawl-e2e (useAI not in DiscoveryOptions, StorageStateData record, maxPages not in CrawlOptions, result.skipped possibly undefined), expand-intents-off, marketing-grades, missing-element (TestStep import), orchestrator-session (line 212 string vs PermissionRule[]), plan-build (13: tagName, startPage, DraftPlan layoutGroups/otherHosts, DiscoveredFlow description, PageInventoryItem counts, checks possibly undefined), plan-old-selectors, plan-sources-live-site, rejects-gating, rejects-plan (TestCaseStep name), signin (8: narrow SignInResult on `ok` before reading landingPath/reason), spider-reliability (result.routes possibly undefined). Fix test data to match the current types; where an option the test passes no longer exists (useAI, maxPages), find the current option that gives the behaviour the test asserts and use it, and say so in the report; never delete the assertion. Use narrowing or an explicit `expect(x).toBeDefined()` before use rather than `!` where the value being present is part of what the test should prove. The TS7016-only files (fixture import) need no edit after QA-700.

- **Requirements:** REQ-051 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** QA-700
- **File ownership:** `packages/core/tests/ai-planner-sources.test.ts`, `packages/core/tests/auth-crawl-e2e.test.ts`, `packages/core/tests/expand-intents-off.test.ts`, `packages/core/tests/marketing-grades.test.ts`, `packages/core/tests/missing-element.test.ts`, `packages/core/tests/orchestrator-session.test.ts`, `packages/core/tests/plan-build.test.ts`, `packages/core/tests/plan-old-selectors.test.ts`, `packages/core/tests/plan-sources-live-site.test.ts`, `packages/core/tests/rejects-gating.test.ts`, `packages/core/tests/rejects-plan.test.ts`, `packages/core/tests/signin.test.ts`, `packages/core/tests/spider-reliability.test.ts`
- **Acceptance criteria:**
  - Given QA-700 is done, when `pnpm exec tsc -p packages/core/tests/tsconfig.typecheck.json --noEmit` runs, then it exits 0 with no TS errors.
  - Given the edited files (auth-crawl-e2e excepted, see QA-707), when they run under vitest, then every test passes as before.
  - Given the diff, when reviewed, then no test was deleted or skipped, no assertion was removed or weakened, and no `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` or `as any` silences an error (REQ-051 AC-2).
- **Validation commands:**
  - CHK-QA-701-TYPECHECK (typecheck): `pnpm exec tsc -p packages/core/tests/tsconfig.typecheck.json --noEmit`
  - CHK-QA-701-TESTS (integration): `pnpm exec vitest run packages/core/tests/ai-planner-sources.test.ts packages/core/tests/expand-intents-off.test.ts packages/core/tests/marketing-grades.test.ts packages/core/tests/missing-element.test.ts packages/core/tests/orchestrator-session.test.ts packages/core/tests/plan-build.test.ts packages/core/tests/plan-old-selectors.test.ts packages/core/tests/plan-sources-live-site.test.ts packages/core/tests/rejects-gating.test.ts packages/core/tests/rejects-plan.test.ts packages/core/tests/signin.test.ts packages/core/tests/spider-reliability.test.ts`
- **Expected outputs:**
  - 13 core test files type-clean
  - report naming each replaced option (useAI, maxPages) and why the assertion is unchanged
- **Execution status:** VERIFIED

### QA-702 — Fix runner test typings (EV-0003)

Fix the remaining TS errors in packages/runner/tests after QA-700: auth-crawl-run (reads private `RunnerServer.port`: use a public way to get the bound address or port; no source change), plan-routes (9: ElementInventoryItem tagName/visible/enabled, startPage, DraftPlan layoutGroups/otherHosts, summary fields, TestCase expectations, testCases possibly undefined), session-state (4: PlanSummary totalRoutes, ReviewPlan vs DraftPlan). Update test data to the current types; never delete or weaken an assertion. If the only way to reach a value is a private member and no public API exists, stop and report rather than change runner source (outside ownership). The TS7016-only files need no edit after QA-700.

- **Requirements:** REQ-051 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** S
- **Depends on:** QA-700
- **File ownership:** `packages/runner/tests/auth-crawl-run.test.ts`, `packages/runner/tests/plan-routes.test.ts`, `packages/runner/tests/session-state.test.ts`
- **Acceptance criteria:**
  - Given QA-700 is done, when `pnpm exec tsc -p packages/runner/tests/tsconfig.typecheck.json --noEmit` runs, then it exits 0 with no TS errors.
  - Given the three edited files, when they run under vitest, then every test passes.
  - Given the diff, when reviewed, then no test was deleted or skipped, no assertion was removed or weakened, and no `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` or `as any` silences an error (REQ-051 AC-2).
- **Validation commands:**
  - CHK-QA-702-TYPECHECK (typecheck): `pnpm exec tsc -p packages/runner/tests/tsconfig.typecheck.json --noEmit`
  - CHK-QA-702-TESTS (integration): `pnpm exec vitest run packages/runner/tests/auth-crawl-run.test.ts packages/runner/tests/plan-routes.test.ts packages/runner/tests/session-state.test.ts`
- **Expected outputs:**
  - 3 runner test files type-clean
- **Execution status:** VERIFIED

### QA-703 — Fix wizard test typings (EV-0003)

Fix the TS errors left in packages/wizard/tests after QA-700 (which removes the TS2835, TS2307 and NodeListOf errors). Files with errors QA-700 does not cover: contrast (declaration for `../tailwind.config.js` via a sibling `packages/wizard/tailwind.config.d.ts`, and the `it.each` callback typing at line 70), coverage-view.test.tsx (RoleNotTested `reason`), intent-view ('rules' is not a PlanItemSource, implicit any), wizard-e2e (`g` unknown, `title` on `{}` at 622-638), and the implicit-any errors in context-files, context-read-report, context-url-summary, domain-proof-client, plan-sources-view, theme and translate (most should disappear once imports resolve; type the rest). Files whose only baseline error was TS2835 (router, release-rule, sources-screens, landing-audit, etc.) are not owned: if one still fails after QA-700, report it. Never delete or weaken an assertion; update test data to the current types.

- **Requirements:** REQ-051 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** QA-700
- **File ownership:** `packages/wizard/tailwind.config.d.ts`, `packages/wizard/tests/contrast.test.ts`, `packages/wizard/tests/coverage-view.test.tsx`, `packages/wizard/tests/intent-view.test.ts`, `packages/wizard/tests/wizard-e2e.test.ts`, `packages/wizard/tests/context-files.test.ts`, `packages/wizard/tests/context-read-report.test.ts`, `packages/wizard/tests/context-url-summary.test.ts`, `packages/wizard/tests/domain-proof-client.test.ts`, `packages/wizard/tests/plan-sources-view.test.ts`, `packages/wizard/tests/theme.test.ts`, `packages/wizard/tests/translate.test.ts`, `packages/wizard/tests/signin-form.test.ts`
- **Acceptance criteria:**
  - Given QA-700 is done, when `pnpm exec tsc -p packages/wizard/tests/tsconfig.typecheck.json --noEmit` runs, then it exits 0 with no TS errors.
  - Given the wizard unit tests, when `pnpm exec vitest run --project unit packages/wizard/tests` runs, then every test passes.
  - Given the diff, when reviewed, then no test was deleted or skipped, no assertion was removed or weakened, and no `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` or `as any` silences an error (REQ-051 AC-2).
  - Given wizard-e2e.test.ts, when diffed, then only type annotations changed (its behaviour is QA-705's).
- **Validation commands:**
  - CHK-QA-703-TYPECHECK (typecheck): `pnpm exec tsc -p packages/wizard/tests/tsconfig.typecheck.json --noEmit`
  - CHK-QA-703-UNIT (unit): `pnpm exec vitest run --project unit packages/wizard/tests`
- **Expected outputs:**
  - wizard tests type-clean
  - packages/wizard/tailwind.config.d.ts
- **Execution status:** VERIFIED

### BE-704 — List XDG_CONFIG_HOME as optional in .env.example and docs/CONFIGURATION.md

The ADR 0034 key resolver reads `XDG_CONFIG_HOME` (`packages/core/src/ai/key-resolver.ts:344`, the folder for `qa-flow-tester/key-file.key`) and `.env.example` does not list it, so `packages/runner/tests/config-docs.test.ts` fails (EV-0005, the only unit failure). Add a commented-out `# XDG_CONFIG_HOME=` entry with a one-line comment saying it is optional and what it changes (where the local key file lives; default `%APPDATA%` on Windows or `~/.config`). config-docs.test.ts also requires every `.env.example` name to be documented in `docs/CONFIGURATION.md` and a non-empty example default to match the documented default, so add the matching row there (empty example value, documented as optional). No secret value. Names-only rule: the agent never reads `.env`. MERGE NOTE (orchestrator): AI-EOS never lets an agent own `.env*` files, `.env.example` included, so the developer adds the `.env.example` lines before this task runs (XDG_CONFIG_HOME, AUDIT_STORE_BUCKET, FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY, FIREBASE_AUTH_DOMAIN, all optional and empty). This task documents every one of them in docs/CONFIGURATION.md and makes config-docs.test.ts pass; if a line is missing from .env.example, report blocked with the exact line to add.

- **Requirements:** REQ-052 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** XS
- **Depends on:** none
- **File ownership:** `docs/CONFIGURATION.md`
- **Acceptance criteria:**
  - Given `.env.example`, when read, then it lists `XDG_CONFIG_HOME` exactly once, documented as optional, with no value that is a secret (REQ-052 AC-1).
  - Given the repository, when `packages/runner/tests/config-docs.test.ts` runs, then every test in it passes (REQ-052 AC-2).
  - Given the unit project, when CHK-UNIT runs, then all unit tests pass (REQ-052 AC-3).
- **Validation commands:**
  - CHK-BE-704-CONFIG-DOCS (unit): `pnpm exec vitest run packages/runner/tests/config-docs.test.ts`
  - CHK-UNIT (unit): `pnpm exec vitest run --project unit`
- **Expected outputs:**
  - .env.example with XDG_CONFIG_HOME (optional)
  - docs/CONFIGURATION.md row for XDG_CONFIG_HOME
- **Execution status:** VERIFIED

### QA-705 — Diagnose and fix the 4 failing wizard-e2e tests

EV-0006: 4 of 10 tests in `packages/wizard/tests/wizard-e2e.test.ts` fail on the developer's Windows PC (repository inside OneDrive): 'New check-up of this site reuses the approved plan' (245 s, 'Matcher did not succeed in 1000ms'), 'Past check-ups: an older report opens...' (waitFor heading 'localhost:<port> (2 check-ups)' 30 s), 'Go deeper starts a clean signed-in scan...' (button 'Go deeper: test the signed-in pages' 30 s), 'Settings: the key in use, and replacing it' (waitForURL /check 30 s). Find each root cause by running the file alone (`pnpm exec vitest run packages/wizard/tests/wizard-e2e.test.ts`), reading its trace and the screens it drives: a cascade from the first failure (shared server state between tests), slow Chromium on this machine, a 1000 ms poll too short for the machine, a changed UI text, or a real product bug. Fix what is in the test (state isolation, waiting on the right condition, timeouts with a stated reason). If a root cause is a product bug in wizard or runner source, do not change source (outside ownership): stop and report it with evidence so the orchestrator plans a fix task. Record each root cause in the task report and, where a timeout is raised, in a comment beside it.

- **Requirements:** REQ-053, REQ-046 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** L
- **Depends on:** QA-703
- **File ownership:** `packages/wizard/tests/wizard-e2e.test.ts`
- **Acceptance criteria:**
  - Given the developer's PC and the repository in its current folder, when `pnpm exec vitest run packages/wizard/tests/wizard-e2e.test.ts` runs, then all 10 tests pass and the file finishes well inside one browser shard's 30-minute limit.
  - Given the fix, when the diff is reviewed, then no test was deleted or skipped, no assertion was weakened, and every raised timeout has a comment naming its reason (REQ-046 AC-2, REQ-053 AC-3).
  - Given each of the 4 failures, when the report is read, then it names the root cause with evidence (log line, trace or code path).
  - Given a root cause in product source, when found, then the task reports it as a blocker with evidence instead of editing source or weakening the test.
- **Validation commands:**
  - CHK-QA-705-WIZARD-E2E (e2e): `pnpm exec vitest run packages/wizard/tests/wizard-e2e.test.ts`
- **Expected outputs:**
  - wizard-e2e.test.ts passing locally
  - root cause per failing test in the report
- **Execution status:** VERIFIED

### QA-706 — Diagnose and fix runner-server and url-first browser failures

EV-0006: `packages/runner/tests/runner-server.test.ts` 'keeps sign-in details out of the saved plan, and asks for them again after a restart' fails with `expected 'scanning' to be 'awaiting-review'` after 45.8 s (the file took 409 s); `packages/runner/tests/url-first.test.ts` skipped all 6 tests after its `beforeAll` (line 107) passed the 30 s hook timeout. Run each file alone, find the root cause (status read before the scan reaches review, i.e. a missing wait on the phase; RunnerServer/fixture start-up slower than 30 s on this machine; a dependency on a built wizard `dist` that CI builds first in tests.yml; or a real bug), and fix it in the test. A raised hook or test timeout names its reason in a comment. A product bug in runner/core source is reported with evidence, not fixed here.

- **Requirements:** REQ-053, REQ-046 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/runner/tests/runner-server.test.ts`, `packages/runner/tests/url-first.test.ts`, `packages/runner/tests/docs-url-beta.test.ts`
- **Acceptance criteria:**
  - Given the developer's PC, when `pnpm exec vitest run packages/runner/tests/runner-server.test.ts packages/runner/tests/url-first.test.ts` runs, then all 9 runner-server tests and all 6 url-first tests run and pass (none skipped).
  - Given the fix, when the diff is reviewed, then no test was deleted or skipped, no assertion weakened, and every raised timeout names its reason (REQ-046 AC-2, REQ-053 AC-3).
  - Given each failure, when the report is read, then it names the root cause with evidence.
- **Validation commands:**
  - CHK-QA-706-RUNNER-BROWSER (integration): `pnpm exec vitest run packages/runner/tests/runner-server.test.ts packages/runner/tests/url-first.test.ts`
- **Expected outputs:**
  - both runner files passing locally
  - root cause per failure in the report
- **Execution status:** VERIFIED

### QA-707 — Diagnose and fix the auth-crawl-e2e dead-links timeout

EV-0006: `packages/core/tests/auth-crawl-e2e.test.ts` 'regression: dead links (500/403/broken) are bounded and recorded under skipped' timed out at 30 s (1 of 10). Run it alone, find whether the crawl of dead links is slow because of per-link timeouts or retries on this machine (a real unbounded wait would be a product bug, which this test exists to catch) or because the test's budget is too small, and fix it in the test with a stated reason, or report the product bug with evidence. Builds on QA-701's typing fixes to the same file.

- **Requirements:** REQ-053, REQ-046 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** QA-701
- **File ownership:** `packages/core/tests/auth-crawl-e2e.test.ts`
- **Acceptance criteria:**
  - Given the developer's PC, when `pnpm exec vitest run packages/core/tests/auth-crawl-e2e.test.ts` runs, then all 10 tests pass.
  - Given the fix, when reviewed, then the dead-links bound the test asserts is unchanged or tighter, no test was deleted or skipped, and any raised timeout names its reason (REQ-053 AC-3).
  - Given the failure, when the report is read, then it names the root cause with evidence.
- **Validation commands:**
  - CHK-QA-707-AUTH-CRAWL (integration): `pnpm exec vitest run packages/core/tests/auth-crawl-e2e.test.ts`
- **Expected outputs:**
  - auth-crawl-e2e.test.ts passing locally
  - root cause in the report
- **Execution status:** VERIFIED

### BE-708 — Phone layout recorder for Website Audit Sample Pages

Add `packages/core/src/audit/phone-layout.ts` exporting `recordPhoneLayout(page, opts)` that produces the `PhoneLayout` contract (`packages/types/src/website-audit.ts:549`, Q-28: phone-width screenshot plus the existing overflow and tap-target findings). It sets the page to the existing 375px breakpoint (`BREAKPOINT_VIEWPORTS['375px']` in `packages/core/src/browser.ts`), waits for layout, saves a full-page screenshot under the version folder given in `opts` and returns its path relative to that folder (null when the screenshot fails), measures horizontal overflow (`overflow: true|false`, null when not checked), and runs the existing `UXQualityChecker` rules at `breakpoint: '375px'` to collect the tap-target and overflow findings, returning them with `findingIds`. It restores the previous viewport. It makes no network request of its own (works on the page the audit pipeline already loaded). It is not wired into the audit pipeline here: the per-page pipeline task (G3) calls it for Sample Pages and sets `AuditPage.phone`. Not exported from the core barrel (owned by G1 BE-190); the pipeline imports it by path. The test uses Chromium with `page.setContent` pages (one that overflows at 375px with a 20x20 px button, one that fits) so it needs no server and no network.

- **Requirements:** REQ-037 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** none
- **File ownership:** `packages/core/src/audit/phone-layout.ts`, `packages/core/tests/audit-phone-layout.test.ts`
- **Acceptance criteria:**
  - Given a page wider than 375px at phone width with a small tap target, when `recordPhoneLayout` runs, then it returns `widthPx: 375`, `overflow: true`, a screenshot path relative to the version folder whose file exists and is a PNG 375px wide, and `findingIds` naming the overflow and tap-target findings it returns (REQ-037 AC-1).
  - Given a page that fits the phone width, when recorded, then `overflow` is false and no overflow finding is returned.
  - Given the screenshot fails (closed page or unwritable folder), when recorded, then `screenshotPath` is null and the function does not throw.
  - Given the recorder, when it ran, then the page's previous viewport is restored and no request other than the page's own was made.
  - Given finding wording, when read, then it follows ADR 0018 ('found'/'not found'; no 'passes', 'compliant' or 'accessible').
- **Validation commands:**
  - CHK-BE-708-PHONE (integration): `pnpm exec vitest run packages/core/tests/audit-phone-layout.test.ts`
  - CHK-CORE-BUILD (build): `pnpm --filter "@qa/core..." run build`
- **Expected outputs:**
  - packages/core/src/audit/phone-layout.ts
  - packages/core/tests/audit-phone-layout.test.ts (browser project; QA-713 adds it to BROWSER_TESTS)
- **Execution status:** VERIFIED

### BE-709 — Audit Document fixed text in English, Tamil and Hindi

The UI stays English (Q-13); documents are written in the language the tool user picks per export (Q-13, REQ-044 AC-3). Add one owner for the fixed text of every Audit Document, the Pitch Glimpse and the Owner Audit: `packages/core/src/audit/document-text.ts` exports `documentText(language, key, vars?)`, the `DocumentTextKey` union, `documentDirection(language)` (from `DOCUMENT_LANGUAGE_INFO.dir`) and `betaLabel(language)` (non-empty for languages with `beta: true`, per Q-45: Hindi ships labelled beta until reviewed). Tables in `packages/core/src/audit/locales/en.ts`, `ta.ts`, `hi.ts` cover: document titles (Structure, Content, Findings with its technical, marketing and content sections, Improvement Roadmap, Proposal, Pitch Glimpse, Owner Audit), section headings, table headers, impact/effort scale (high, medium, low), redesign/repair, 'found'/'not found' wording (ADR 0018), Skipped Page reasons, speed 'not measured' reasons, the WCAG 2.2 AA 'automatic checks only' note, the Proposal's 'not included' scope lines (Q-19), and placeholders with named variables. English follows CONTEXT.md terms and their Avoid lists. G5's document writers use only these keys (they depend on this task); a key they need that is missing is reported and added here, not inlined in their files. AI-written notes are not covered: their language comes from the AI step (G4). Until BE-710 registers the other nine tables, a language with no registered table makes `documentText` throw (never a silent English fallback). MERGE NOTE (orchestrator), overrides the file names above: G5's BE-501 already owns the Audit Document label tables (packages/core/src/audit/documents/labels/{en,ta}.ts and labels/index.ts), so there is one fixed-text source. This task adds the Hindi table packages/core/src/audit/documents/labels/hi.ts with every key of en.ts, registers it in labels/index.ts (after BE-501, explicit dependency) with the beta label, and keeps the rule that a missing key throws rather than falling back to English. No packages/core/src/audit/document-text.ts or locales/ folder.

- **Requirements:** REQ-044, REQ-032 · **Agent:** backend-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-501
- **File ownership:** `packages/core/src/audit/documents/labels/hi.ts`, `packages/core/src/audit/documents/labels/index.ts`, `packages/core/tests/audit-document-text.test.ts`
- **Acceptance criteria:**
  - Given each of en, ta and hi, when the tables are compared, then every `DocumentTextKey` has a non-empty string and each string uses exactly the same `{variable}` names as English.
  - Given the Tamil table, when its strings are read, then every string that is not a proper noun or code is written in Tamil script (U+0B80-U+0BFF), and the Hindi table in Devanagari (U+0900-U+097F); no U+FFFD and all strings NFC.
  - Given `documentText('ta', key)` and `documentText('hi', key)`, when called, then they return the Tamil and Hindi text, and `betaLabel('hi')` is non-empty while `betaLabel('ta')` and `betaLabel('en')` are empty (Q-45).
  - Given the English table, when scanned, then it contains none of the CONTEXT.md Avoid terms for Website Audit, Audit Document, Improvement Roadmap, Pitch Glimpse and Owner Audit, and none of 'compliant', 'secure', 'passes', 'accessible' (ADR 0018).
  - Given a language code with no registered table, when `documentText` is called, then it throws an error naming the language (no silent English fallback); the test uses a code that is not in `DOCUMENT_LANGUAGES`, so BE-710 does not need to change this test.
- **Validation commands:**
  - CHK-BE-709-TEXT (unit): `pnpm exec vitest run packages/core/tests/audit-document-text.test.ts`
  - CHK-CORE-BUILD (build): `pnpm --filter "@qa/core..." run build`
- **Expected outputs:**
  - document-text.ts with key union and helpers
  - en/ta/hi tables
  - unit test
- **Execution status:** VERIFIED

### BE-710 — Audit Document fixed text in the other nine Indian languages

Add the remaining `DOCUMENT_LANGUAGES` tables named in Q-20: Telugu, Kannada, Malayalam, Marathi, Gujarati, Bengali, Odia, Punjabi and Urdu (`packages/core/src/audit/locales/{te,kn,ml,mr,gu,bn,or,pa,ur}.ts`), with the same keys and variables as English, and register them in `document-text.ts` so `documentText` covers every `DocumentLanguage`. All nine are beta (Q-45) so `betaLabel` is non-empty for each; Urdu is right-to-left (`documentDirection('ur') === 'rtl'`). Machine translation is acceptable; nothing here claims a person reviewed it. MERGE NOTE (orchestrator), overrides the file names above: the tables live beside G5's labels as packages/core/src/audit/documents/labels/{te,kn,ml,mr,gu,bn,or,pa,ur}.ts and are registered in labels/index.ts (after BE-709).

- **Requirements:** REQ-032 · **Agent:** backend-engineer · **Priority:** low · **Complexity:** M
- **Depends on:** BE-709
- **File ownership:** `packages/core/src/audit/documents/labels/index.ts`, `packages/core/src/audit/documents/labels/te.ts`, `packages/core/src/audit/documents/labels/kn.ts`, `packages/core/src/audit/documents/labels/ml.ts`, `packages/core/src/audit/documents/labels/mr.ts`, `packages/core/src/audit/documents/labels/gu.ts`, `packages/core/src/audit/documents/labels/bn.ts`, `packages/core/src/audit/documents/labels/or.ts`, `packages/core/src/audit/documents/labels/pa.ts`, `packages/core/src/audit/documents/labels/ur.ts`, `packages/core/tests/audit-document-text-languages.test.ts`
- **Acceptance criteria:**
  - Given every language in `DOCUMENT_LANGUAGES`, when `documentText` is called for every key, then it returns a non-empty string with the same `{variable}` names as English (no throw, no English fallback) (REQ-032: each added language handled as Tamil is).
  - Given each of the nine tables, when scanned, then non-proper-noun strings are in that language's script (Telugu, Kannada, Malayalam, Devanagari for Marathi, Gujarati, Bengali, Odia, Gurmukhi, Arabic for Urdu), NFC, with no U+FFFD.
  - Given the nine languages, when `betaLabel` and `documentDirection` are called, then each has a beta label and only Urdu is 'rtl'.
- **Validation commands:**
  - CHK-BE-710-TEXT (unit): `pnpm exec vitest run packages/core/tests/audit-document-text.test.ts packages/core/tests/audit-document-text-languages.test.ts`
  - CHK-CORE-BUILD (build): `pnpm --filter "@qa/core..." run build`
- **Expected outputs:**
  - nine locale tables
  - document-text.ts covering all 12 languages
  - language coverage test
- **Execution status:** VERIFIED

### QA-711 — End-to-end language test: Tamil and Hindi through extraction, audit and documents

Prove REQ-044 and REQ-032 AC-1 across the core audit pipeline built by the other groups, against `fixtures/audit-site` served by `packages/core/tests/helpers/audit-site-server.ts` (pages `/` in English, `/ta` in Tamil, `/hi` in Hindi). The test drives the audit pipeline entry and the document and export functions the G2/G3/G5 tasks provide (exact entry points are taken from their reports; the fixture runs on 127.0.0.1, so the test injects the `NetDeps` the public-only check lets tests inject). Checks: (1) language detection gives `ta` for `/ta` and `hi` for `/hi` (REQ-013/REQ-032); (2) every text block extracted from `/ta` and `/hi` (headings, Sections, links, CTA text) equals the page's rendered text code point for code point, including combining marks and ZWJ/ZWNJ, with no normalisation change and no U+FFFD, and the same text appears unchanged in the Markdown and `site.json` exports and in the Word export read back with mammoth (REQ-044 AC-1); (3) the Tamil and Hindi pages get findings produced as for the English page (same checks run, findings present where the fixture plants a problem) (AC-2); (4) generating the Audit Documents with language 'ta' and 'hi' gives headings from the BE-709 tables, the Hindi documents carry the beta label and the Tamil ones do not (AC-3, Q-45). PDF glyph shaping is checked by hand (waiver).

- **Requirements:** REQ-044, REQ-032 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-709, BE-192, BE-506, BE-507
- **File ownership:** `packages/core/tests/audit-languages-e2e.test.ts`
- **Acceptance criteria:**
  - Given the Tamil fixture page, when extracted and exported to Markdown, JSON and Word, then the Tamil text in each export matches the page text character for character (REQ-044 AC-1).
  - Given the Tamil fixture page, when audited, then findings are produced for it as for the English page (REQ-044 AC-2).
  - Given the tool user picks Tamil or English for the documents, when they are generated, then they are in that language (REQ-044 AC-3).
  - Given the Hindi fixture page, when audited, then its language is detected as 'hi' and it is handled in extraction, audit and documents as Tamil is, with the beta label on Hindi documents (REQ-032 AC-1).
- **Validation commands:**
  - CHK-QA-711-LANGUAGES (e2e): `pnpm exec vitest run packages/core/tests/audit-languages-e2e.test.ts`
- **Expected outputs:**
  - packages/core/tests/audit-languages-e2e.test.ts (browser project; QA-713 adds it to BROWSER_TESTS)
- **Execution status:** VERIFIED

### QA-712 — Wizard audit screens: Tamil content and Tamil export (browser test)

RE-PLAN (autopilot replan 1/1, DEC-013): the first run found three wizard features that were never built: no document-language choice on the start screen, no phone-layout view on the results screens, and the export screen offers only en/ta. A mixed-script Hindi block is also tagged lang=ta. The developer deferred these to a follow-up feature. QA-712 now covers only what is built: the Tamil page content on the results screen (code point equality inside lang='ta') and a Tamil export whose headings come from the Tamil table. The four tests for the deferred features are removed from the file. Their expectations are recorded in DEC-013 and engineering/decisions.md Known limitations, so the follow-up can add them back. Original description for context: One browser test over `packages/wizard/src/screens/audit/**` once the screen tasks exist, reusing the runner + fixture harness from G1 QA-195. Against the audit fixture site: the start screen's document-language choice offers every `DOCUMENT_LANGUAGES` entry by its English name with a beta mark where `beta` is true (UI text stays English, Q-13); the results screens show the `/ta` and `/hi` page content with the text unchanged (code point equality with the page) inside an element whose `lang` is `ta` / `hi`, so the browser picks a matching font; a Sample Page's phone layout is shown (the 375px screenshot loads and the overflow result is stated, REQ-037); exporting the documents in Tamil from the documents screen downloads files whose headings come from the Tamil table; Hindi exports show the beta label. Wording checks of the screens themselves stay with each screen task (no-banned-words).

- **Requirements:** REQ-044 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** FE-191, QA-195, BE-709, FE-200, FE-301, FE-500
- **File ownership:** `packages/wizard/tests/audit-languages-browser.test.ts`
- **Acceptance criteria:**
  - Given an audit of the fixture site, when the Tamil page's content is shown on the results screen, then the text equals the page text code point for code point and sits in an element with `lang` 'ta' (REQ-044 AC-1 in the UI).
  - Given the documents screen, when Tamil is picked and the documents exported, then the downloaded document headings are the Tamil table's (REQ-044 AC-3, Tamil part).
  - The file holds no test for the deferred features (start-screen language choice, Hindi lang tagging, phone-layout view, Hindi/beta export); none is skipped or marked todo. They are removed and listed in DEC-013.
- **Validation commands:**
  - CHK-QA-712-WIZARD-LANG (e2e): `pnpm exec vitest run packages/wizard/tests/audit-languages-browser.test.ts`
- **Expected outputs:**
  - packages/wizard/tests/audit-languages-browser.test.ts (browser project; QA-713 adds it to BROWSER_TESTS)
- **Execution status:** VERIFIED

### QA-713 — Integrate new browser tests and config names; whole suite and typecheck pass

Final integration for the test gates. (1) Add every new test file that launches Chromium or a runner to `BROWSER_TESTS` in `vitest.workspace.ts`: from this group `core: audit-phone-layout, audit-languages-e2e` and `wizard: audit-languages-browser`, plus each file the other groups' reports list (G1 QA-195 and the G2..G6 browser tests); confirm with `--project unit` and an empty `PLAYWRIGHT_BROWSERS_PATH` that no unit file launches Chromium (the method in the workspace comment). (2) Run the four browser shards (CHK-BROWSER-1..4, Q-52) and, if a shard nears its 30-minute limit, tune `vitest.config.ts` (workers, per-project pool) with a stated reason; never skip a file. (3) Add to `.env.example` and `docs/CONFIGURATION.md` every environment variable name other groups' tasks started reading (their handoffs list them; names only, commented out, optional or required as documented), so config-docs.test.ts and CHK-UNIT pass. (4) Run CHK-TYPECHECK and fix nothing outside ownership: report any new error with its owning task. Root cause of every remaining failure goes in the report.

- **Requirements:** REQ-046, REQ-053, REQ-052, REQ-051 · **Agent:** qa-engineer · **Priority:** high · **Complexity:** M
- **Depends on:** BE-101, BE-104, BE-105, BE-102, BE-103, DOC-104, DOC-105, BE-189, BE-190, BE-192, FE-191, QA-195, BE-200, BE-201, BE-202, BE-203, BE-204, BE-205, FE-200, QA-200, BE-302, BE-300, BE-301, BE-303, BE-304, BE-305, BE-306, BE-307, BE-308, QA-300, FE-300, FE-301, BE-400, BE-401, BE-402, BE-403, BE-404, BE-405, BE-406, BE-407, BE-408, BE-409, BE-410, FE-400, FE-401, QA-400, BE-500, BE-501, BE-502, BE-503, BE-504, BE-505, BE-507, BE-506, BE-508, BE-509, BE-510, FE-500, FE-501, QA-500, BE-600, BE-601, BE-602, BE-603, BE-604, BE-605, BE-606, BE-607, FE-600, FE-601, FE-602, QA-600, QA-700, QA-701, QA-702, QA-703, BE-704, QA-705, QA-706, QA-707, BE-708, BE-709, BE-710, QA-711, QA-712
- **File ownership:** `vitest.workspace.ts`, `vitest.config.ts`, `docs/CONFIGURATION.md`
- **Acceptance criteria:**
  - Given every new browser test file from all groups, when `vitest.workspace.ts` is read, then each is in `BROWSER_TESTS`, and a `--project unit` run with an empty `PLAYWRIGHT_BROWSERS_PATH` launches no Chromium.
  - Given the developer's PC, when CHK-BROWSER-1..4 run, then each shard finishes within its 30-minute limit, none ends `timed_out`, and every test in the browser project passes (REQ-053 AC-1, AC-2).
  - Given the developer's PC and the repository in its current folder, when CHK-UNIT and the browser shards run (together `pnpm test`), then every test passes (REQ-046 AC-1).
  - Given the repository, when `pnpm typecheck` runs, then it exits 0 with no TS errors (REQ-051 AC-1).
  - Given `.env.example`, when config-docs.test.ts runs, then every name the code reads, `XDG_CONFIG_HOME` included, is listed once and documented (REQ-052).
  - Given the whole diff of QA-700..QA-713, when reviewed, then no test was deleted or skipped, no assertion weakened, and every raised timeout names its reason (REQ-046 AC-2, REQ-051 AC-2, REQ-053 AC-3).
- **Validation commands:**
  - CHK-TYPECHECK (typecheck): `pnpm typecheck`
  - CHK-UNIT (unit): `pnpm exec vitest run --project unit`
  - CHK-BROWSER-1 (integration): `pnpm exec vitest run --project browser --shard=1/4`
  - CHK-BROWSER-2 (integration): `pnpm exec vitest run --project browser --shard=2/4`
  - CHK-BROWSER-3 (integration): `pnpm exec vitest run --project browser --shard=3/4`
  - CHK-BROWSER-4 (integration): `pnpm exec vitest run --project browser --shard=4/4`
- **Expected outputs:**
  - vitest.workspace.ts listing every browser test
  - shard timings per CHK-BROWSER-n in the report
  - .env.example and docs/CONFIGURATION.md in step with the code
- **Execution status:** REPORTED
<!-- ai-eos:end tasks -->

## Execution waves

<!-- ai-eos:begin waves -->
- Wave 1: BE-101, BE-102, BE-201, BE-202, BE-302, BE-400, BE-403, BE-405, BE-500, BE-501, BE-704, BE-708, DOC-104, FE-200, FE-500, QA-700, QA-706, DOC-105, FE-300, FE-501, FE-600, FE-601, FE-401, FE-602
- Wave 2: BE-103, BE-104, BE-105, BE-203, BE-300, BE-401, BE-402, BE-404, BE-502, BE-503, BE-504, BE-600, BE-709, FE-400, QA-701, QA-702, QA-703, BE-507, FE-301
- Wave 3: BE-200, BE-301, BE-303, BE-304, BE-305, BE-306, BE-307, BE-406, BE-407, BE-505, BE-601, QA-705, QA-707, FE-191, BE-408, BE-710
- Wave 4: BE-204, BE-308, BE-409, BE-506
- Wave 5: BE-192, QA-200, QA-300, QA-400
- Wave 6: BE-189, QA-711
- Wave 7: BE-205, BE-508, BE-509, BE-410, BE-602, BE-604, BE-605, BE-606
- Wave 8: BE-510, BE-611, BE-612, BE-603, BE-607
- Wave 9: BE-190
- Wave 10: QA-195, QA-500, QA-600
- Wave 11: QA-712
- Wave 12: QA-713

- ⚠ BE-200 serialized after BE-105 (file ownership may overlap: `packages/core/src/discovery/deterministic-spider.ts`)

**Sensitive (P2) changes approved with this plan:**
- ⚑ BE-607 changes `.github/workflows/deploy.yml` (CI/CD or infrastructure): pre-approved by /ai-eos:plan approve
- ⚑ FE-602 changes `packages/wizard/package.json` (dependency manifest/lockfile): pre-approved by /ai-eos:plan approve
- ⚑ FE-602 changes `pnpm-lock.yaml` (dependency manifest/lockfile): pre-approved by /ai-eos:plan approve
<!-- ai-eos:end waves -->

## Test strategy

- Framework: Vitest only (no new test framework). Unit tests for pure modules; integration tests through runner route handlers with injected fakes; browser tests (Chromium or a runner) go in `vitest.workspace.ts` BROWSER_TESTS (QA-713 adds them). No real network, cloud or AI calls in tests: NetDeps, FetchFn, MockAIProvider and fake store backends are injected; `fixtures/audit-site` is the local site under test.
- Task checks: one `CHK-<TASK>-<KIND>` per task, `pnpm exec vitest run <files>` with `paths` and `scoped_command`, so unaffected checks keep their PASS.
- Mandatory project checks: CHK-BUILD (`pnpm build`), CHK-TYPECHECK (`pnpm typecheck`, fails at baseline: REQ-051, REC-002), CHK-LINT, CHK-UNIT (`--project unit`, fails at baseline: REQ-052, REC-001), CHK-SECRETS (`scripts/scan-commit-secrets.mjs`), CHK-BROWSER-1..4 (`--project browser --shard=i/4`, replacing the single CHK-BROWSER that timed out: REQ-053, REC-003).
- Waivers (manual checks the developer approves with the plan): visual PDF/Word fidelity and Tamil glyphs (BE-507, QA-711), real Google sign-in and a real Cloud Storage bucket on Cloud Run (BE-605, BE-606, BE-607, FE-602), layout/focus order (FE-200), CI 4-shard run after the PR (QA-713).
- Never weakened: failing browser tests are diagnosed with a root cause; a product bug outside a QA task's ownership is reported as blocked, not hidden.

## Risks

- Security-sensitive dispatch reorder in `server.ts` (BE-102, P2): route-access-server test proves every non-public/sign-in row still needs the access key (RISK-002).
- Helper sign-in vs closed beta (Q-55, parked D-005): until answered, BE-102 plans beta closed except `public`.
- `deterministic-spider.ts` changed by BE-101, BE-105, BE-200 in sequence (explicit dependencies).
- AI-written preview HTML on the runner origin (BE-605, P2): sanitiser plus strict CSP.
- Forbidden paths in the plan: `.github/workflows/deploy.yml` (BE-607) and `pnpm-lock.yaml` (FE-602 adds `firebase`) need the developer's approval during the run.
- Tamil PDF on Cloud Run may lack fonts (developer step, Dockerfile).
- QA-705..707 may find product bugs outside test ownership: reported blocked, new fix tasks re-planned.
- QA-713's full-suite checks fail while any task is unfinished; it depends on every task.
- Third-party personal data (page text, NAP) in stored audits: cascade delete and Q-30 retention (BE-601), Shared Link contact removal (BE-604).
