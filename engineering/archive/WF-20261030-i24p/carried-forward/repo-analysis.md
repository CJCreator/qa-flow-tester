# Repository analysis

> Maintained by AI-EOS (repository-analyst). Every claim cites evidence as `path:line` or a command and its output.
> Status is decided by reading implementation logic, **never from file names alone**.

## Summary

QA Flow Tester is a pnpm TypeScript monorepo (Node 22) that crawls a web App with a Playwright-driven Deterministic Spider,
writes a reviewable Plan (AI Planner or fixed rules), runs it with deterministic checkers and writes Markdown, JSON and HTML
reports. It is built as a release check-up for the App's own team, not as an audit-and-pitch tool for third-party sites.
Crawl input, robots.txt, sitemap seeding, Sign-in Wall handling, BYOK and history already exist. Per-page content extraction,
sections, CMS detection, language handling, external speed/search APIs, the AI six-area assessment, documents, pitch,
PDF/Word, shortlist, proposal, rewrite, pricing and helper accounts do not exist.

Coverage limit (REPO-001 stopped at the turn limit): the requirement-relevant code paths below were read. Tests were **not run**.
`orchestrator.ts`, `server.ts`, `routes/plan.ts` and the wizard screens were read only in the line ranges cited. `.claude/`,
`.tmp-*`, `.qa-*`, `public/`, `dist/` and secret files were not read.

## Technology stack

<!-- ai-eos:begin detect -->
Detected by `aieos detect` (7364 files scanned). Confirm each item by reading the code.

- Languages: TypeScript (4283), JavaScript (39), Python (1)
- Stacks: TypeScript / Node.js [.claude/worktrees/deploy-fixes/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/checkers/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/core/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/runner/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/types/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/wizard/package.json]; JavaScript / Node.js [fixtures/test-app/package.json]; TypeScript / Node.js [package.json]; TypeScript / Node.js [packages/checkers/package.json]; TypeScript / Node.js [packages/core/package.json]; TypeScript / Node.js [packages/runner/package.json]; TypeScript / Node.js [packages/types/package.json]; TypeScript / Node.js [packages/wizard/package.json]; Python [.claude/forge/forge.py]
- Frameworks: React
- Test frameworks: Vitest, node:test
- Package managers: pnpm, npm
- CI: .github/workflows/benchmark.yml, .github/workflows/ci.yml, .github/workflows/deploy.yml, .github/workflows/e2e-nightly.yml, .github/workflows/qa-check.yml, .github/workflows/release.yml, .github/workflows/tests.yml · Containers: .claude/worktrees/deploy-fixes/packages/runner/Dockerfile, docker-compose.yml, packages/runner/Dockerfile, site/Dockerfile
- Entry points: .claude/worktrees/deploy-fixes/package.json scripts.start: node --env-file-if-exists=.env scripts/start.mjs; .claude/worktrees/deploy-fixes/packages/checkers/./dist/index.js (package.json main); .claude/worktrees/deploy-fixes/packages/core/./dist/index.js (package.json main); .claude/worktrees/deploy-fixes/packages/runner/./dist/index.js (package.json main); .claude/worktrees/deploy-fixes/packages/runner/package.json scripts.start: node dist/cli.js; .claude/worktrees/deploy-fixes/packages/types/./dist/index.js (package.json main); fixtures/test-app/package.json scripts.start: node server.js; package.json scripts.start: node --env-file-if-exists=.env scripts/start.mjs; packages/checkers/./dist/index.js (package.json main); packages/core/./dist/index.js (package.json main); packages/runner/./dist/index.js (package.json main); packages/runner/package.json scripts.start: node dist/cli.js; packages/types/./dist/index.js (package.json main); .claude/worktrees/deploy-fixes/packages/wizard/index.html; .tmp-landing-audit-ui/wizard/index.html; .tmp-wizard-e2e-ui/wizard/index.html; packages/wizard/index.html; public/index.html

Candidate checks (not yet registered):

| Check | Category | Command | Source |
|---|---|---|---|
| CHK-NODE-CLAUDE-WORKTREES-BUILD | build | `cd ".claude/worktrees/deploy-fixes" && pnpm run build` | .claude/worktrees/deploy-fixes/package.json scripts.build |
| CHK-NODE-CLAUDE-WORKTREES-UNIT | unit | `cd ".claude/worktrees/deploy-fixes" && pnpm test` | .claude/worktrees/deploy-fixes/package.json scripts.test |
| CHK-NODE-CLAUDE-WORKTREES-LINT | lint | `cd ".claude/worktrees/deploy-fixes" && pnpm run lint` | .claude/worktrees/deploy-fixes/package.json scripts.lint |
| CHK-NODE-CLAUDE-WORKTREES-TYPECHECK | typecheck | `cd ".claude/worktrees/deploy-fixes" && pnpm run typecheck` | .claude/worktrees/deploy-fixes/package.json scripts.typecheck |
| CHK-NODE-BUILD | build | `pnpm run build` | package.json scripts.build |
| CHK-NODE-UNIT | unit | `pnpm test` | package.json scripts.test |
| CHK-NODE-LINT | lint | `pnpm run lint` | package.json scripts.lint |
| CHK-NODE-TYPECHECK | typecheck | `pnpm run typecheck` | package.json scripts.typecheck |
| CHK-NODE-PACKAGES-CHECKER-BUILD | build | `cd "packages/checkers" && npm run build` | packages/checkers/package.json scripts.build |
| CHK-NODE-PACKAGES-CHECKER-TYPECHECK | typecheck | `cd "packages/checkers" && npx --no-install tsc --noEmit` | packages/checkers/tsconfig.json |
| CHK-NODE-PACKAGES-CORE-BUILD | build | `cd "packages/core" && npm run build` | packages/core/package.json scripts.build |
| CHK-NODE-PACKAGES-CORE-TYPECHECK | typecheck | `cd "packages/core" && npx --no-install tsc --noEmit` | packages/core/tsconfig.json |
| CHK-NODE-PACKAGES-RUNNER-BUILD | build | `cd "packages/runner" && npm run build` | packages/runner/package.json scripts.build |
| CHK-NODE-PACKAGES-RUNNER-TYPECHECK | typecheck | `cd "packages/runner" && npx --no-install tsc --noEmit` | packages/runner/tsconfig.json |
| CHK-NODE-PACKAGES-TYPES-BUILD | build | `cd "packages/types" && npm run build` | packages/types/package.json scripts.build |
| CHK-NODE-PACKAGES-TYPES-TYPECHECK | typecheck | `cd "packages/types" && npx --no-install tsc --noEmit` | packages/types/tsconfig.json |
| CHK-NODE-PACKAGES-WIZARD-BUILD | build | `cd "packages/wizard" && npm run build` | packages/wizard/package.json scripts.build |
| CHK-NODE-PACKAGES-WIZARD-TYPECHECK | typecheck | `cd "packages/wizard" && npx --no-install tsc --noEmit` | packages/wizard/tsconfig.json |
| CHK-PY-BUILD | build | `python -m compileall -q -x "(\.venv\|venv\|node_modules)" .` | byte-compilation (syntax) check |
<!-- ai-eos:end detect -->

Detect noise to ignore: everything under `.claude/worktrees/deploy-fixes/` (a duplicate worktree), `.claude/forge/forge.py`
(the only Python, local tooling), `.tmp-*` and `public/` entry points (generated output). Use only the non-`.claude` checks.

| Layer | Technology | Version | Evidence |
|---|---|---|---|
| Runtime | Node.js, ESM | >=22 | `package.json` `engines.node`, `"type": "module"` |
| Language | TypeScript | ^5.7.2 | `package.json` devDependencies |
| Monorepo | pnpm workspace | pnpm@11.10.0 | `package.json` `packageManager`; `pnpm-workspace.yaml` (`packages/*`, `fixtures/*`) |
| Browser automation | Playwright (Chromium) | 1.63.0 (pinned override) | `pnpm-workspace.yaml` overrides; `packages/core/package.json`; used in `packages/core/src/navigate.ts:161` |
| Accessibility | @axe-core/playwright | ^4.10.1 | `packages/checkers/package.json`; `packages/checkers/src/ux-quality.ts:7-9` |
| UI | React + Vite + Tailwind | react ^18.3.1, vite ^6.0.7 | `packages/wizard/package.json` |
| Word input | mammoth (docx to Markdown, read only) | 1.12.3 | `packages/core/package.json`; `packages/runner/src/server.ts:1479-1509` |
| Key storage | @napi-rs/keyring (OS keychain) | ^2.1.0 | `packages/core/src/ai/key-resolver.ts:23-26` |
| Tests | Vitest | ^2.1.8 | `package.json` `scripts.test`: `vitest run`; 251 tracked `*.test.*` files (`git ls-files`), node:test only for `plugins/repo-orchestrator` |
| Lint/format | ESLint 9, Prettier 3 | | `package.json` scripts `lint`, `format:check` |

## Entry points

| Entry point | Kind (server, CLI, UI, worker, library) | Evidence |
|---|---|---|
| `pnpm start` → `scripts/start.mjs` (runner + built wizard on port 3001) | server | `package.json` `scripts.start` |
| `packages/runner/src/cli.ts` → `RunnerServer` (HTTP + SSE, serves wizard) | server | `packages/runner/package.json` `scripts.start`; `packages/runner/src/server.ts:819-1204` |
| `packages/runner/src/checkup.ts` (one Check-up, no UI, for CI; `QA_MAX_PAGES` default 50) | CLI | `packages/runner/src/checkup.ts:172`, `:272` |
| `packages/runner/src/scheduler.ts` (scheduled check-ups) | worker | `packages/runner/src/server.ts:1116-1132` (schedule routes) |
| `packages/wizard/index.html` → `src/main.tsx` | UI | `packages/wizard/package.json` |
| `fixtures/test-app/server.js` | test fixture server | `package.json` `scripts.fixture` |
| `@qa/types`, `@qa/checkers`, `@qa/core` (`dist/index.js`) | library | package.json `main` fields |

## Major modules

| Module | Responsibility | Key files | Depends on |
|---|---|---|---|
| `@qa/types` | Shared types and pure browser-safe logic (run API, plan, findings, aspects) | `src/checkup-api.ts`, `src/discovery.ts`, `src/aspects.ts`, `src/plan.ts` | none |
| `@qa/checkers` | Deterministic checkers: SEO, AEO, GEO, marketing, performance, UX/axe, keyboard a11y, security, design | `src/seo.ts`, `src/marketing.ts`, `src/aeo.ts`, `src/geo.ts`, `src/performance.ts`, `src/ux-quality.ts` | `@qa/types`, Playwright, axe |
| `@qa/core` discovery | Deterministic Spider, frontier, element inventory, Discovery Agent, safety filter | `src/discovery/deterministic-spider.ts`, `frontier.ts`, `element-inventory.ts`, `discovery-agent.ts`, `safety-filter.ts` | `@qa/types`, Playwright |
| `@qa/core` plan | AI Planner, site graph (App Flow), sampling (Layout Groups), expansion, exports | `src/plan/site-graph.ts`, `sampling.ts`, `ai-planner.ts`, `playwright-export.ts`, `zip.ts` | AI providers |
| `@qa/core` run + report | Orchestrator runs Tests and checkers; scoring, recommendations, reports, history | `src/orchestrator.ts`, `scoring.ts`, `recommendations.ts`, `reporter.ts`, `html-report.ts`, `issues-document.ts`, `findings-contract.ts`, `site-history.ts`, `site-memory.ts` | `@qa/checkers` |
| `@qa/core` AI | Provider adapters (Anthropic, OpenAI, Gemini, OpenRouter, mock), key resolver, visual review | `src/ai/ai-provider.ts`, `key-resolver.ts`, `default-models.ts`, `visual-review.ts` | provider HTTP APIs |
| `@qa/core` net safety | Pinned-resolver GETs for shared machines, robots policy, safe public crawler | `src/safe-net.ts`, `src/competitive/robots.ts`, `src/competitive/safe-crawler.ts` | Node http/dns |
| `@qa/runner` | HTTP/SSE server, route table, Check-up Session, beta limits | `src/server.ts`, `src/routes/plan.ts`, `src/session/checkup-run.ts`, `src/beta.ts`, `src/run-inputs.ts` | `@qa/core` |
| `@qa/wizard` | React UI: new check-up, scanning, Plan Review, report, past check-ups, settings | `src/screens/*.tsx`, `src/api.ts`, `src/components/SiteMap.tsx` | `@qa/types` (source imports) |

## APIs

Only the routes relevant to REQ-001..045 are listed. The full route set is in `packages/runner/src/server.ts:933-1151` and
`packages/runner/src/routes/plan.ts:1285-1358`. Auth was not traced in this pass (see Authentication).

| Method / operation | Path / name | Handler | Auth | Evidence |
|---|---|---|---|---|
| POST | `/api/runner/preflight` | `handlePreflight` (URL syntax + reachability) | not traced | `packages/runner/src/server.ts:1040`, `:1572-1641` |
| POST | `/api/runner/run` | run start (scheme check, then `createCheckupRun`) | not traced | `packages/runner/src/server.ts:961`, `:2837-2861` |
| GET/PATCH | `/api/runner/plan` | Plan Review read/edit | not traced | `packages/runner/src/routes/plan.ts:1285-1296` |
| POST | `/api/runner/plan/approve` | approve Plan, start run | not traced | `packages/runner/src/routes/plan.ts:1299-1302` |
| GET | `/api/runner/plan/markdown`, `/api/runner/plan/export` | Plan as Markdown; Plan as Playwright project zip | not traced | `packages/runner/src/routes/plan.ts:1313-1324`, `:446-464` |
| GET | `/api/runs`, `/api/runs/:id` | Past check-ups list and report | per-session `isMine` filter | `packages/runner/src/server.ts:2119-2136` |
| POST | `/api/runs/:id/triage`, `/api/runs/:id/accept-judgement` | mark findings Intended/False Positive; accept AI judgement | per-session | `packages/runner/src/server.ts:2141-2225` |
| GET | `/api/runs/:id/download/:file`, `/api/report/download/:file` | report.html, report.md, findings.json, issues.md, issues.html | per-session | `packages/runner/src/server.ts:317-323`, `:2227-2252`, `:2297-2319` |
| DELETE | `/api/runs/:id` | delete a check-up | per-session | `packages/runner/src/server.ts:2254-2269` |
| GET/POST | `/api/ai/settings` | provider, key, text model, vision model | not traced | `packages/runner/src/server.ts:2548-2628` |

## Data and database

No database. Files on disk under `RUNNER_DATA_DIR` (default `.qa-data/`, `/tmp/qa-data` on Cloud Run) and `RUNNER_OUTPUT_DIR`
(`docs/ARCHITECTURE.md` "State and storage"; `.github/workflows/deploy.yml:130`). Per-site memory (`core/src/site-memory.ts`),
per-site history (`core/src/site-history.ts`), per-run report folders, at most 10 runs kept per site
(`packages/runner/src/server.ts:324` `RUNS_KEPT_PER_SITE = 10`). Cloud Run `/tmp` is wiped on redeploy or scale-down (ADR 0032).

## Authentication and authorization

Not traced in depth in this pass. Seen: the hosted copy runs with `RUNNER_BETA=1` and one `RUNNER_ACCESS_TOKEN` secret
(`.github/workflows/deploy.yml:130-131`); in beta, past runs are filtered per browser session (`server.ts:2121`, `:2129`
`refuseNotMine`). No user accounts, roles of the tool itself or per-App access control exist.

## Tests

| Suite | Framework | Command | Approx. count | Last observed result |
|---|---|---|---|---|
| All unit/integration | Vitest | `pnpm test` | 251 tracked test files | not run (turn limit; CLAUDE.md deferred-tests rule may also apply) |
| URL-first focus | Vitest | `pnpm test:url-first` | subset | not run |
| Auth crawl e2e | Vitest + Chromium | `pnpm exec vitest run packages/core/tests/auth-crawl-e2e.test.ts packages/runner/tests/auth-crawl-run.test.ts` | 2 files | not run (`.github/workflows/ci.yml:118`) |
| Plugin | node:test | `pnpm test:plugin` | `plugins/repo-orchestrator/test/*.test.mjs` | not run |

## Configuration

Variable names seen in code (values never read): `QA_MAX_PAGES` (`runner/src/checkup.ts:172`), `QA_CRAWL_MAX_MINUTES`
(`core/src/discovery/deterministic-spider.ts:328`), `QA_DISCOVERY_MAX_MINUTES` (`core/src/discovery/discovery-agent.ts:471`),
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` (`core/src/ai/key-resolver.ts:139-145`),
`RUNNER_BETA`, `RUNNER_HOST`, `RUNNER_DATA_DIR`, `RUNNER_OUTPUT_DIR`, `RUNNER_ALLOWED_ORIGINS`, `RUNNER_ACCESS_TOKEN`
(`.github/workflows/deploy.yml:130-131`), `QA_AI_API_KEY` (`.github/workflows/qa-check.yml:39`), `QA_CUSTOM_HEADERS`
(`docs/ARCHITECTURE.md`). Full list: `.env.example`, `docs/CONFIGURATION.md` (not read). Secret files exist by name only:
`.env`, `.qa-keys.json`, `.qa-ai-models.json` (excluded by `.dockerignore`).

## CI/CD

- `ci.yml`: on PR and push to main: lint, format check, build-and-test, auth-crawl e2e, `pnpm audit --prod --audit-level high`,
  gitleaks over full git history (`.github/workflows/ci.yml:4-8`, `:37-40`, `:118`, `:131`, `:134-153`).
- `tests.yml`: reusable sharded Vitest run excluding `wizard-e2e` and `auth-crawl-*` (`.github/workflows/tests.yml:54`).
- `deploy.yml`: push to main → Google Cloud Run runner (`--max-instances 1`, `RUNNER_BETA=1`) and a static site service
  (`.github/workflows/deploy.yml:11-13`, `:126-131`, `:184-186`).
- Not read: `benchmark.yml`, `e2e-nightly.yml`, `qa-check.yml` (beyond line 39), `release.yml` (header only: build, no publish).

## Requirement / feature status

Status values: `COMPLETE` (implemented and evidenced), `PARTIAL` (some acceptance criteria unmet),
`MISSING` (no implementation found after searching), `UNVERIFIED` (code exists but behavior not confirmed).
No test was run, so every status rests on reading code.

Search method for MISSING rows: the tracked file list (`git ls-files packages`), the runner route list
(`server.ts:933-1151`, `routes/plan.ts:1285-1358`) and the greps named in each row. A broad grep
(`pitch|opt-?out|proposal|shortlist|roadmap|rewrite|redesign|helper|cms|billing|stripe`) matched 50 `.ts` files, mostly through
generic words ("helper", "rewrite"). Those hits were not triaged one by one. No route, type or module for these features
appears in the route list or the file list.

| ID | Requirement / feature | Status | Evidence | Notes |
|---|---|---|---|---|
| REQ-001 | Accept a public URL and confirm it is reachable | COMPLETE | `wizard/src/lib/url.ts:10-31` (`normalizeUrl` rejects non-URLs, non-http(s), hosts with no TLD); `wizard/src/screens/NewCheckupScreen.tsx:131-174` (debounced `checkReachable`), `:240-246` (`canStart` needs `check.state === 'ok'`); `runner/src/server.ts:1572-1641` (`handlePreflight`: 400 `ERR_INVALID_URL`, `ERR_TARGET_UNREACHABLE`/`ERR_SERVER_ERROR` with suggestion); `core/src/preflight.ts:116-198` (`checkUrlReachable`, 2 attempts, 25 s then 10 s) | "Public" is not enforced: local and private addresses are accepted on purpose (Test Copies), refused only in beta (`checkup-run.ts:671-676` `resolvePublic`). `POST /api/runner/run` itself checks only the scheme (`server.ts:2837-2861`), so an API or CI caller can start a crawl on an unreachable URL. A 4xx start page is "reachable" with `startWarning` (`preflight.ts:175-176`). |
| REQ-002 | Crawl limits: max pages, depth, include/exclude paths | PARTIAL | Max pages: `types/src/checkup-api.ts:78-79`, `runner/src/session/checkup-run.ts:829-832` (clamped 1-1000), `core/src/discovery/deterministic-spider.ts:157` (default 200), `:593-609` and `:1148-1153` (Skipped Page `page-limit`), wizard field `NewCheckupScreen.tsx:488-494`. Depth: `deterministic-spider.ts:108-109`, `:326` (default 8), `frontier.ts:133-135` | Max pages meets AC-1. Depth is internal only: not in `RunStartBody` or `DiscoveryOptions` (`discovery-agent.ts:47-120`), and a depth-limited URL is dropped silently, with no Skipped Page (`deterministic-spider.ts:382-394` records only `trap-limit`). Depth counts link steps, and sitemap URLs enter at depth 1 (`:445`). Include/exclude paths: MISSING at crawl time (grep `excludePath|includePath|pathFilter|ignorePaths`). Only post-crawl Scope Exclusions exist (`outOfScope`, `types/src/discovery.ts:68`, `core/src/discovery/test-planner.ts:42`). |
| REQ-003 | Crawl the App's internal pages | COMPLETE | `deterministic-spider.ts:324` (`onSite` = same site or loopback), `:367-399` (enqueue only on-site), `:817-885` (anchors, `[role=link]`, `data-href`, GET forms without required fields), `:177-205` (`pageLinks` marks `leavesSite`, keeps off-site target), `:218-298` (forms read, never submitted); `core/src/plan/site-graph.ts:98-112` (`otherHosts`) | A GET form with no required field is followed as a link (`:845-858`); nothing is submitted. Extra hosts: `/api/runner/plan/include-host` (`routes/plan.ts:1357-1358`). Read-only browser context on non-Test-Copy Apps: `discovery-agent.ts:499` (`blockChanges`). |
| REQ-004 | Read sitemap.xml and merge with discovered links | COMPLETE | `deterministic-spider.ts:405-460` (`/sitemap.xml` + robots.txt `Sitemap:` lines, sitemap indexes up to 25 files, at most 200 `<loc>`, on-site only); de-duplication via `frontier.ts:129-131` and `deterministic-spider.ts:1079-1088`; a missing or failed sitemap is skipped (`:430`, `:453-458`) | The overlap table's claim is confirmed, including merge and de-dup. Sitemap URLs are queued after the start URL, so links found early and sitemap entries share the page limit in queue order (not stated in the source). |
| REQ-005 | Render JavaScript-heavy pages | PARTIAL | Chromium via Playwright: `core/src/navigate.ts:161` (`domcontentloaded`), `:62-107` (`settlePage`: networkidle raced with 3 s, link wait and a zero-link retry for SPA hydration); `deterministic-spider.ts:960-1005` (clicks script links and nav buttons, records `scripted` links), `:1007-1046` (opens tabs, drawers, dialogs) | Rendering and following script-added links are implemented. AC-1 also needs extracted content (REQ-009), which does not exist, so AC-1 cannot pass yet. |
| REQ-006 | Flag and skip sign-in areas | COMPLETE | `deterministic-spider.ts:642-649` (wall when 401, known login path, or bounce to a sign-in-only form), `:143-152` (`isSignInOnlyForm`), `:680-686` (Skipped Page `sign-in`, `signInWalls`), `types/src/discovery.ts:153-156` (`signInPages`, `notReached` in output) | The visitor crawl enters no credentials. Role crawls (person-supplied details) sign in by design, via preflight. |
| REQ-007 | Page hierarchy and navigation map with link regions | PARTIAL | `core/src/plan/site-graph.ts:44-115` (`buildSiteGraph`: shared menu links vs in-page links, BFS click paths from start `:75-93`, `unlinked` `:95-96`); `discovery/element-inventory.ts:118-126` (region = `header`/`nav`/`footer` only); `wizard/src/components/SiteMap.tsx:127-140` (groups pages by first path segment) | No `breadcrumb` region (`landmarkOf` ignores breadcrumbs; `checkers/src/aeo.ts:213-217` detects breadcrumbs only for an AEO finding). No explicit hierarchy object listing every page exactly once: click paths cover only pages reachable from start; unlinked pages are listed separately. |
| REQ-008 | Break each page into sections with content | MISSING | Grep `sections?:|pageText|mainText|bodyText|extractContent` and `innerText|textContent` in `core/src`: no page segmentation or stored page text | Building blocks: `landmarkOf` (`element-inventory.ts:118-126`), `readLayoutFingerprint` (`competitive/safe-crawler.ts:97`), GEO's `<main>/<article>` check (`checkers/src/geo.ts:47`). |
| REQ-009 | Extract each page's content | PARTIAL | Stored per page (`deterministic-spider.ts:919-929`, type `types/src/discovery.ts:63-95`): title, links with region, forms and fields (`:218-298`), up to 200 interactive elements with names ≤80 chars (`element-inventory.ts:5`, `:35`), screenshot. Read but not stored: headings with levels, meta description, missing-alt count (`checkers/src/seo.ts:453-545`), only on tested pages during the run | Missing: text, images with alt text, CTAs as data, a per-page extraction record. AC-2 is unmet: the SEO checker reports a count, not each image (`seo.ts:330-351`). A full DOM snapshot is saved per Test step (`core/src/evidence.ts:100-110`), a possible extraction source. |
| REQ-010 | Record the CMS or framework | MISSING | Grep `wordpress|shopify|wix|squarespace|drupal|joomla|__NEXT_DATA__|generator` in `packages`, and `x-powered-by|framework` in `checkers/src`: no detection | `detectSiteType` (`core/src/discovery/site-type.ts:16`) names the site category (shop, SaaS, content...), not the CMS. |
| REQ-011 | Use the tool user's own AI keys (BYOK) | COMPLETE | `core/src/ai/ai-provider.ts:39-58` (Anthropic, OpenAI, Gemini, OpenRouter, mock); `runner/src/server.ts:2578-2628` (settings POST, key validated for OpenRouter, saved by `saveByokKey` `:2600`), `:2528-2544` (`aiSetup` uses the stored key); `checkup-run.ts:744-760` | One active provider at a time (`settings.provider`), though keys for several can be stored. No key: the Plan is written by fixed rules and the visual review is skipped with a note (`core/src/ai/visual-review.ts:48-59`). Beta key handling (`runner/src/beta.ts`) was not read (Q-07). |
| REQ-012 | Page speed and Core Web Vitals from an external API | MISSING | Grep `pagespeed|crux|chromeuxreport|googleapis` in `packages`: only a comment (`checkers/src/performance.ts:57`) | Lab measurement exists: LCP, CLS and INP thresholds (`performance.ts:46-52`), simulated slow-4G phone (`:57-66`), wording "Measured in a test browser, not by real visitors." (`:68`), per-page samples and "slower than last time" (`core/src/speed-change.ts`). |
| REQ-013 | Detect each page's language | MISSING | Grep `tamil|hindi|detectLang|languageOf|franc|i18n|locale` in `packages`: none in source | Only `<html lang>` presence is checked (`seo.ts:196-215`, `:493`). |
| REQ-014 | Report content problems | PARTIAL | Missing title `seo.ts:87-106`; missing description `:108-127`; heading problems (no H1, several H1, skipped level) `:129-194`; missing alt as a count `:329-352`; broken links `:382-386`, `:547-585`; App Flow Navigation Checks (`CONTEXT.md:111-113`) | Missing: duplicate titles, duplicate descriptions, duplicate content (grep `duplicate (title|description|content)` found nothing). AC-6 unmet: the alt finding does not name the image. Broken-link coverage is narrow: the first 10 same-site links collected, 5 checked by HEAD, 3 s timeout (`:539`, `:552-556`). Checks run only on tested pages (Sample Pages per Layout Group, `core/src/plan/sampling.ts:5`) at one screen size (`orchestrator.ts:1146`). |
| REQ-015 | Report ten marketing signals | PARTIAL | Marketing rules `checkers/src/marketing.ts:65-209` (twitter card, share image, CTA, contact incl. `mailto:`/`tel:`, privacy, analytics, social, pricing, trust, lead capture, cookie); checklist with not-checked status `:244-261`; schema `checkers/src/aeo.ts:93-149` (JSON-LD validity, Organization/WebSite/LocalBusiness, BreadcrumbList); on-page SEO `seo.ts`; OG `seo.ts:354-379` | Present: on-page SEO, schema, social tags, analytics, CTAs, lead forms (email field), trust signals. Missing: NAP and map (local signals), click-to-call as its own signal (`tel:` only counts toward "contact", `marketing.ts:339-344`), an internal-linking report (only `unlinked` in `site-graph.ts:95-96`). Most rules are home page only (`marketing.ts:282`), not per page. |
| REQ-016 | AI assessment of six areas, per page and site-wide | PARTIAL | AI visual and copy review per Layout Group, at most 3 issues, clamped to advisory Minor/Suggestion (`core/src/ai/visual-review.ts:37-135`, `:86-88`, prompt `:154-168`); status `skipped`/`partial` with note (`:48-59`, `:120-134`) | Only one area (look and copy) is assessed by AI. The six report grades are deterministic, not AI (`types/src/aspects.ts:3`: Works, Accessible, Fast and mobile, Findable, Secure, Looks and reads well; `core/src/scoring.ts`). No ranking/marketing/usability/content/accessibility/speed AI assessment per page or site. AC-2 (forbidden words) unverified for AI output. |
| REQ-017 | Rank issues by impact and effort, citing page and section | PARTIAL | `core/src/recommendations.ts:6-7` (effort, impact Low/Medium/High), `:72` (`generateRankedRecommendations`), `:120` (ordered by effort among impact), page via `finding.where.urlPath` | Ranking exists for recommendations, not as fields on every finding. No section citation (REQ-008 missing). |
| REQ-018 | Generate the three audit documents | MISSING | Report outputs are `findings.json`, `report.md`, `fix-these.md`, `known-findings.json`, `AGENTS.snippet.md`, `issues.md`, `issues.html` (`core/src/reporter.ts:51-74`) and `report.html` (`core/src/html-report.ts:37`) | None is one of "three audit documents" or a pitch glimpse (Q-02). |
| REQ-019 | One-page pitch glimpse, EN or TA, sent by hand | MISSING | No pitch module, type or route (file list, route list, broad grep above) | |
| REQ-020 | Edit hierarchy, content and findings before export | PARTIAL | Plan Review edits before the run: `PATCH /api/runner/plan` switches pages and items off, edits expectations and journeys (`types/src/checkup-api.ts:143-170`); after the run: triage Intended/False Positive and accept-judgement rewrite the report (`server.ts:2141-2225`) | No edit of a finding's text, no edit of content (none is extracted), and switching a page off affects the run, not an export. |
| REQ-021 | Export Markdown documents and JSON laid out for Claude Code | PARTIAL | Markdown and JSON per run (`reporter.ts:51-74`); coding-agent-oriented `fix-these.md` and `AGENTS.snippet.md` (`core/src/findings-contract.ts:132-185`, ADR 0017); downloads limited to `report.html`, `report.md`, `findings.json`, `issues.md`, `issues.html` (`server.ts:317-323`); zip writer `core/src/plan/zip.ts` | Missing: pages and sections in the JSON (sections do not exist; pages in `findings.json` not confirmed), the "laid out for Claude Code" bundle (Q-24). `fix-these.md` and `known-findings.json` are written but not downloadable from the wizard. |
| REQ-022 | Export PDF and Word | MISSING | Grep `page\.pdf\(|application/pdf|wordprocessingml|docx` in `packages`: `.docx` is input only (mammoth, `server.ts:1479-1509`); PDF is refused as context input | Building block: Playwright's Chromium `page.pdf()` over `report.html`/`issues.html` (not used today). |
| REQ-023 | Shortlist: pitch/skip, notes, outcome | MISSING | No shortlist fields in site memory or routes (`server.ts:1018` `/api/sites` handles test-copy, search-check and sign-in fields only, `:1652-1660`) | |
| REQ-024 | Clickable improved-homepage preview | MISSING | No module or route | |
| REQ-025 | Owner audit in EN or TA | MISSING | No module or route | |
| REQ-026 | Enhancement roadmap with priority, phase, effort | PARTIAL | `recommendations.ts:6-7`, `:72` give impact and effort per ranked recommendation | No phase field, no roadmap document. Low confidence that this is the right base until Q-18 names the artifact. |
| REQ-027 | Website-only proposal from an editable template | MISSING | No module or route | |
| REQ-028 | Saved audits per App, version history, re-run | PARTIAL | Past check-ups list, open, delete (`server.ts:2119-2136`, `:2254-2269`); 10 runs kept per site (`:324`); per-site history and speeds (`core/src/site-history.ts:20`, `:39-45`); re-run "Test again" (`types/src/checkup-api.ts:96-100`) reusing the approved Plan (site memory) | Hosted copy loses data on redeploy or scale-down (`/tmp`, `deploy.yml:130`, ADR 0032). Whether a re-run reuses the same max pages was not verified. |
| REQ-029 | Run locally by default, on Google Cloud when needed | UNVERIFIED | Local: `package.json` `scripts.start`; Cloud Run: `.github/workflows/deploy.yml:126-131` | Both paths exist; a full audit was not run on either. The hosted copy runs `RUNNER_BETA=1` (shared-machine limits), so "full audit" there is limited by design (Q-06). |
| REQ-030 | AI rewrites after approval, no original wording | MISSING | No rewrite module or route | |
| REQ-031 | Free first 10, then fixed price per site | MISSING | No billing or pricing code (grep `billing|stripe`) | |
| REQ-032 | Hindi and other Indian languages | MISSING | See REQ-013 | |
| REQ-033 | Helper accounts with per-App access | MISSING | One shared `RUNNER_ACCESS_TOKEN` (`deploy.yml:131`); beta runs are scoped per browser session (`server.ts:2121`, `:2129`), not per account | |
| REQ-034 | Honour robots.txt | COMPLETE | `core/src/competitive/robots.ts:12-45` (RFC 9309 groups, longest match, `*`/`$`), `:48-56` (missing file means allow all); checked per route on path and query before navigation, for linked and sitemap URLs alike (`deterministic-spider.ts:528-547`, Skipped Page `robots`); fetched for non-private hosts (`discovery-agent.ts:477`, token `QA-Benchmarking-Bot` `:161`) | Not applied on private or local hosts by design (`isPrivateHost`). One policy for the start origin only (`deterministic-spider.ts:525-527`). |
| REQ-035 | Limit the request rate to the audited site | PARTIAL | Shared pacing clock across workers (`deterministic-spider.ts:476-489`); 2000 ms default on public sites, 0 on own machine (`discovery-agent.ts:160`, `:478-479`); user override `crawlDelayMs` 0-2000 and concurrency 1-5 (`runner/src/checkup.ts:201-203`, `run-inputs.ts:190-209`) | Not honoured: robots.txt `Crawl-delay` (not parsed, `robots.ts:33-39`). Pacing covers page loads only, not sitemap fetches, checker HEAD/GET link checks (`seo.ts:552-557`) or the run phase (not verified). ADR 0015 is still Deferred. |
| REQ-036 | Flag and skip payment areas | PARTIAL | Payment Sensitive Action and Ambiguity Question (`core/src/discovery/safety-filter.ts:42-49`, `deterministic-spider.ts:891-900`); never clicked: `RISKY_TO_CLICK` includes pay, purchase, buy, place order (`deterministic-spider.ts:129-130`); mutating requests blocked on non-Test-Copy Apps (`discovery-agent.ts:499`) | Payment pages are still crawled, recorded and their links followed. There is no `payment` Skipped Page reason (`CONTEXT.md:184`). Detection is keyword-only on control names. |
| REQ-037 | Record the mobile layout | PARTIAL | 375 px is in the default screen sizes (`checkup-run.ts:73`); full-page screenshot per Test step (`core/src/evidence.ts:100`); horizontal overflow finding (`checkers/src/performance.ts:307-333`); tap targets (`checkers/src/ux-quality.ts:323`) | Only for tested Plan Items (Sample Pages) and only when 375 px is selected; no per-page mobile layout record for every crawled page. |
| REQ-038 | Record accessibility and SEO basics | PARTIAL | axe-core via `UXQualityChecker` with WCAG criterion names (`checkers/src/ux-quality.ts:7-9`, `:46-59`); keyboard checks worded "automatic check only" (`checkers/src/keyboard-a11y.ts:282`); SEO basics `seo.ts:87-379`; "makes no claim about overall compliance" (`findings-contract.ts:149`) | Coverage is tested pages only. Whether the report names the WCAG level per page was not confirmed. |
| REQ-039 | Choose the AI model per task | PARTIAL | Two settings: text model (planning) and vision model (visual review) (`server.ts:2528-2544`, `:2604-2612`; `checkup-run.ts:543`) | No other tasks exist yet; a per-task map is needed once assessment, documents, preview and rewrite exist (Q-29). |
| REQ-040 | Store AI keys encrypted | PARTIAL | OS keychain first (`core/src/ai/key-resolver.ts:23-26`, `:61-65`) | Fallback writes plaintext `.qa-keys.json` (mode 0600) when no keychain exists (`key-resolver.ts:47`, `:51-72`); environment variables are read in plaintext (`:139-145`). No app-level encryption (overlap table: no `createCipheriv`/`aes-256-gcm`). Beta keeps keys in memory per session (`docs/ARCHITECTURE.md`; `beta.ts` not read). |
| REQ-041 | Ship no AI keys | PARTIAL | gitleaks over full git history in CI (`.github/workflows/ci.yml:134-153`, `.gitleaks.toml` allowlists `fixtures/` and `packages/*/tests/`); `.dockerignore` excludes `.env`, `.qa-keys.json`, `.qa-ai-models.json` | The repository is covered. The container image and the built wizard bundle are not scanned. |
| REQ-042 | Search data from an external API | MISSING | Grep `search ?console|serpapi|dataforseo|ahrefs|semrush|googleapis`: none | |
| REQ-043 | Prefer free tiers of external APIs | MISSING | No external data API exists to assess | Related precedent: the default AI model on OpenRouter is the free router (`core/src/ai/default-models.ts:3-8`). |
| REQ-044 | Handle English and Tamil | MISSING | See REQ-013; no document language choice | Files are written as UTF-8 (`reporter.ts:58-74`); Tamil round-trip not verified. |
| REQ-045 | Recommend redesign or repair per page | MISSING | Grep `redesign` (broad grep above); no per-page recommendation type | |

### Overlap-table claims checked

| Claim in requirements.md | Result |
|---|---|
| Sitemap seeding `deterministic-spider.ts:405-412` | Confirmed (`:405-460`), with merge and de-duplication via the frontier. |
| robots.txt `deterministic-spider.ts:82-83` + `competitive/robots.ts` | Confirmed; enforcement at `:528-547`, fetch at `discovery-agent.ts:477`. |
| Max pages `checkup-api.ts:79` | Confirmed; default 200 in the UI, 50 in CI (`checkup.ts:172`), clamp 1-1000. |
| Sign-in Wall skip | Confirmed (`deterministic-spider.ts:642-686`). |
| BYOK ADR 0002, keychain first, `.qa-keys.json` fallback | Confirmed in code (`key-resolver.ts`); the fallback file is plaintext. |
| Past check-ups history | Confirmed (`server.ts:2119-2272`, `RUNS_KEPT_PER_SITE = 10`). |
| No key encryption | Confirmed: no app-level encryption; the OS keychain is the only protected store. |
| No PageSpeed API call | Confirmed. |
| No `payment` skip reason | Confirmed. |
| FR-15 "`tel:` and LocalBusiness handling" | Weaker than stated: `tel:` only satisfies the contact rule; LocalBusiness only counts as organization schema. No NAP or map check. |

### Reusable building blocks for PARTIAL items

| REQ | Extend | Where |
|---|---|---|
| REQ-001 | `PreFlightChecker.checkUrlReachable`; call it in `POST /api/runner/run` for API callers; `resolvePublic` for a public-only mode | `core/src/preflight.ts:116`; `runner/src/server.ts:2837-2861`; `core/src/safe-net.ts:115` |
| REQ-002 | Add `maxDepth`, include/exclude to `RunStartBody` → `DiscoveryOptions` → `CrawlOptions`; filter in the Spider's `enqueue`; record a new Skipped Page reason (add it to `RouteSkipReason` and `CONTEXT.md`); `scanScope` is a path-prefix precedent | `types/src/checkup-api.ts:24-129`; `discovery-agent.ts:476-489`; `deterministic-spider.ts:367-399`; `frontier.ts:115-145`; `competitive/safe-crawler.ts:57-61` |
| REQ-005, REQ-009, REQ-008, REQ-013 | Add a content-extraction `page.evaluate` beside `collectElementInventory` in `evaluatePage` (text, headings, images/alt, meta, CTAs, `lang`, sections from landmarks/headings) and store it on `PageInventoryItem`; reuse SEO `collectDetails` selectors | `deterministic-spider.ts:887-929`; `element-inventory.ts:32`; `checkers/src/seo.ts:453-545`; `types/src/discovery.ts:63-95` |
| REQ-007 | Add `breadcrumb` to `landmarkOf`; build a hierarchy tree from `clickPaths` + URL path | `element-inventory.ts:118-126`; `plan/site-graph.ts:44-115`; `types/src/discovery.ts:56` |
| REQ-014 | Cross-page duplicate title/description from stored per-page metadata (after REQ-009); name each image without alt | `checkers/src/seo.ts:329-352`, `:476-486` |
| REQ-015 | New rules in `RULES` (click-to-call, NAP, map embed) and per-page mode | `checkers/src/marketing.ts:65-209`, `:323-435`; `aeo.ts:93-125` |
| REQ-016 | Generalise `VisualReviewer` (prompt per area, advisory findings, budget, skipped status) | `core/src/ai/visual-review.ts:37-190`; `core/src/ai/ai-provider.ts:11-18` (`completeWith`); `plan/ai-budget.ts` |
| REQ-017, REQ-026 | Put `classification` (impact, effort) on each finding; add phase | `core/src/recommendations.ts:6-7`, `:72-145` |
| REQ-020 | Extend triage endpoint to edit finding text; regenerate files via `ReportGenerator` | `runner/src/server.ts:2141-2225`; `core/src/reporter.ts:37-74` |
| REQ-021 | Bundle per App with `zipFiles`; extend `DOWNLOADABLE_REPORT_FILES`; reuse findings contract and schema | `core/src/plan/zip.ts`; `runner/src/server.ts:317-323`; `core/src/findings-contract.ts`; `docs/findings.schema.json` |
| REQ-028 | Persistent storage for the hosted copy; store crawl limits in site memory for re-run | `core/src/site-history.ts`; `core/src/site-memory.ts`; ADR 0032 |
| REQ-035 | Parse `Crawl-delay` in `RobotsPolicy`; route checker link checks through the pacing clock | `competitive/robots.ts:33-39`; `deterministic-spider.ts:476-489`; `checkers/src/seo.ts:547-585` |
| REQ-036 | Add a `payment` Skipped Page reason; stop recording/following when `SafetyFilter` sees a payment page (card field, provider iframe, checkout path) | `discovery/safety-filter.ts:42-49`; `deterministic-spider.ts:887-900`; `types` `RouteSkipReason` |
| REQ-037, REQ-038 | Phone-width capture during crawl (spider screenshot at a 375 px context) or per-page summary from Test evidence | `deterministic-spider.ts:934-943`; `core/src/browser.ts:82-83`; `core/src/evidence.ts:100` |
| REQ-039 | Generalise `{ text, vision }` to a task-keyed model map | `runner/src/server.ts:2528-2544`, `:2604-2612` |
| REQ-040 | Encrypt the fallback file (or refuse to write it) | `core/src/ai/key-resolver.ts:61-72` |
| REQ-041 | Add gitleaks (or equivalent) over the built wizard bundle and the runner image in CI | `.github/workflows/ci.yml:134-153`; `packages/runner/Dockerfile` |

## Technical debt

| Item | Location | Impact | Suggested action |
|---|---|---|---|
| Depth-limited URLs are dropped with no Skipped Page or telemetry row | `core/src/discovery/deterministic-spider.ts:382-394`; `frontier.ts:133-135` | The Plan under-reports what was not reached | Record `depth-limit` like `trap-limit` (new reason in `CONTEXT.md`) |
| Comments cite "FR-1.7" for crawl defaults, an ID from an older requirements set | `types/src/checkup-api.ts:117-120` | Collides with the new FR numbering in `Requirements.txt` | Reword when REQ-035 lands |
| Docs say 4xx start answers are "reachable"; code returns `ok: false` with `startWarning` and the server maps it | `docs/ARCHITECTURE.md` (Sign-in and crawling) vs `core/src/preflight.ts:175-176`, `runner/src/server.ts:1613` | Minor doc drift | Align wording |
| Checker coverage depends on Plan sampling (3 Sample Pages per Layout Group) and one screen size for SEO | `core/src/plan/sampling.ts:5`; `core/src/orchestrator.ts:1146` | Per-page audit requirements (REQ-009/014/015/038) cannot be met for every crawled page | Decide per-page vs sampled coverage before planning |

## Incomplete implementations

None found as TODO/FIXME in the files read (no grep for TODO was run across the repo in this pass). The `plan/sampling.ts`
"covered" pages and the 10-link/5-check broken-link cap (`checkers/src/seo.ts:539`, `:552`) are deliberate limits, not stubs.

## Duplicated logic

- Two crawlers: `DeterministicSpider` (`core/src/discovery/deterministic-spider.ts`) and `SafePublicCrawler`
  (`core/src/competitive/safe-crawler.ts:131`, used by `mode: 'safe-public'`, `runner/src/session/checkup-run.ts:603-627`),
  each with its own page delay, robots fetch, session-ending regex (`safe-crawler.ts:54` vs `deterministic-spider.ts:127`) and
  page limit (60 vs 1000). An audit mode should extend one of them, not add a third.
- Two link collections per page: the Spider's `rawLinks` (`deterministic-spider.ts:818-861`) and SEO's `sameSiteLinks`
  (`checkers/src/seo.ts:497-522`).

## Architectural inconsistencies

- `RobotsPolicy.fetch` and `checkUrlReachable` (non-beta) use Node's global `fetch` (`competitive/robots.ts:50`,
  `core/src/preflight.ts:163`), while ADR 0031 says every outbound request uses the pinned resolver. Only beta preflight passes a
  guarded getter (`server.ts:1611`). Needs a check against ADR 0031's actual scope before changing.
- The product is a self-check tool for the App's own team (`CONTEXT.md` App, Test Copy, Check-up); the source requirements
  audit third-party sites for outreach. Read-only and robots behaviour already fits third-party crawling; documents, pitch and
  shortlist have no home in the current model (Q-01).

## Security concerns

- Plaintext AI key fallback `.qa-keys.json` when no OS keychain exists (`core/src/ai/key-resolver.ts:61-72`). Relevant to REQ-040.
- Release artifacts (container image, wizard bundle) are not secret-scanned; only git history is (`.github/workflows/ci.yml:134-153`).
- Payment pages are crawled and recorded; only clicks on payment controls are avoided (`deterministic-spider.ts:129-130`).
  On a non-Test-Copy App mutating requests are blocked (`discovery-agent.ts:499`), which limits the risk.
- Third-party page content (titles, element names) already flows into AI prompts during planning; an AI assessment of
  extracted text (REQ-016) widens what is sent to the AI Provider.
