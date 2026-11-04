# Repository analysis

> Maintained by AI-EOS (repository-analyst). Every claim cites evidence as `path:line` or a command and its output.
> Status is decided by reading implementation logic, **never from file names alone**.

## Summary

Analysed commit: `71cf6af` (branch `feat/website-audit`, with uncommitted Website Audit and ADR 0034 work in the tree). Survey date 2026-11-03, three shards (REPO-001 S1, REPO-002 S2, REPO-003 S3) merged below.

QA Flow Tester is a pnpm TypeScript monorepo (Node 22): `@qa/types` → `@qa/checkers` + `@qa/core` → `@qa/runner` (plain Node `http` server with SSE, serving the Vite/React `@qa/wizard`). There is no database; state is files (`.qa-data`, report dirs, OS keychain or encrypted `.qa-keys.json`). Tests are Vitest, split into `unit` and `browser` projects by a hand-kept list in `vitest.workspace.ts`. CI is GitHub Actions; deploy is Cloud Run (runner image plus nginx static site).

Cross-shard summary:
- **Website Audit (ADR 0033) is only partly built:** types (`packages/types/src/website-audit.ts`, `AUDIT_API`) and `fixtures/audit-site` exist, but the runner has no audit routes and the wizard has no audit screens (S2, S1).
- **Build/deploy coupling:** the runner Dockerfile copies only the `fixtures/test-app` manifest, while the untracked `fixtures/audit-site` matches the `fixtures/*` workspace glob, which may break the frozen-lockfile image install (S1, S2; unverified).
- **Health:** large god-files (`packages/runner/src/server.ts` 3609 lines; core `orchestrator.ts` 1661, `ai-planner.ts` 1202, `deterministic-spider.ts` 1196). CI typecheck is non-blocking (`.github/workflows/ci.yml:45` `|| true`). `createAIProvider` silently falls back to the mock provider for unknown types (`packages/core/src/ai/ai-provider.ts:54-55`). `vercel.json` and `.vercelignore` are still tracked although commit 71cf6af says they were dropped (`git ls-files`).
- Verified by the orchestrator: `server.ts:846` `/healthz`, `ai-provider.ts:54-55`, `ci.yml:45`, `git ls-files vercel.json .vercelignore`.

## Technology stack

<!-- ai-eos:begin detect -->
Detected by `aieos detect` (7421 files scanned). Confirm each item by reading the code.

- Languages: TypeScript (4299), JavaScript (33), Python (1)
- Stacks: TypeScript / Node.js [.claude/worktrees/deploy-fixes/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/checkers/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/core/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/runner/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/types/package.json]; TypeScript / Node.js [.claude/worktrees/deploy-fixes/packages/wizard/package.json]; JavaScript / Node.js [fixtures/test-app/package.json]; TypeScript / Node.js [package.json]; TypeScript / Node.js [packages/checkers/package.json]; TypeScript / Node.js [packages/core/package.json]; TypeScript / Node.js [packages/runner/package.json]; TypeScript / Node.js [packages/types/package.json]; TypeScript / Node.js [packages/wizard/package.json]; Python [.claude/forge/forge.py]
- Frameworks: React
- Test frameworks: Vitest, node:test
- Package managers: pnpm, npm
- CI: .github/workflows/benchmark.yml, .github/workflows/ci.yml, .github/workflows/deploy.yml, .github/workflows/e2e-nightly.yml, .github/workflows/qa-check.yml, .github/workflows/release.yml, .github/workflows/tests.yml · Containers: .claude/worktrees/deploy-fixes/packages/runner/Dockerfile, docker-compose.yml, packages/runner/Dockerfile, site/Dockerfile
- Entry points: .claude/worktrees/deploy-fixes/package.json scripts.start: node --env-file-if-exists=.env scripts/start.mjs; .claude/worktrees/deploy-fixes/packages/checkers/./dist/index.js (package.json main); .claude/worktrees/deploy-fixes/packages/core/./dist/index.js (package.json main); .claude/worktrees/deploy-fixes/packages/runner/./dist/index.js (package.json main); .claude/worktrees/deploy-fixes/packages/runner/package.json scripts.start: node dist/cli.js; .claude/worktrees/deploy-fixes/packages/types/./dist/index.js (package.json main); fixtures/test-app/package.json scripts.start: node server.js; package.json scripts.start: node --env-file-if-exists=.env scripts/start.mjs; packages/checkers/./dist/index.js (package.json main); packages/core/./dist/index.js (package.json main); packages/runner/./dist/index.js (package.json main); packages/runner/package.json scripts.start: node dist/cli.js; packages/types/./dist/index.js (package.json main); .claude/worktrees/deploy-fixes/packages/wizard/index.html; fixtures/audit-site/blog/2025/diwali/index.html; fixtures/audit-site/blog/2025/index.html; fixtures/audit-site/blog/index.html; fixtures/audit-site/hi/index.html; fixtures/audit-site/index.html; fixtures/audit-site/services/index.html; fixtures/audit-site/shop/index.html; fixtures/audit-site/ta/index.html; fixtures/audit-site/updates/index.html; packages/wizard/index.html; public/index.html

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

| Layer | Technology | Version | Evidence |
|---|---|---|---|

## Entry points

| Entry point | Kind (server, CLI, UI, worker, library) | Evidence |
|---|---|---|

## Major modules

| Module | Responsibility | Key files | Depends on |
|---|---|---|---|

## APIs

| Method / operation | Path / name | Handler | Auth | Evidence |
|---|---|---|---|---|

## Data and database

_Engines, schemas/models, migrations, ORM, data ownership._

## Authentication and authorization

_Mechanisms, where enforced, gaps._

## Tests

| Suite | Framework | Command | Approx. count | Last observed result |
|---|---|---|---|---|

## Configuration

_Configuration files and environment variables (names only, never values)._

## CI/CD

_Pipelines, triggers, deployment targets._

## Requirement / feature status

Status values: `COMPLETE` (implemented and evidenced), `PARTIAL` (some acceptance criteria unmet),
`MISSING` (no implementation found after searching), `UNVERIFIED` (code exists but behavior not confirmed).

| ID | Requirement / feature | Status | Evidence | Notes |
|---|---|---|---|---|
| REQ-001 | Accept public URL, confirm reachable | PARTIAL | REPO-006 map | Syntax validation only (`website-audit.ts`) |
| REQ-002 | Crawl limits: pages, depth, include/exclude | PARTIAL | REPO-006; `deterministic-spider.ts:382-393` | `depth-limit` not recorded as Skipped Page; no include/exclude |
| REQ-003 | Crawl internal pages, read-only | PARTIAL | REPO-006 | Spider reusable; no audit pipeline |
| REQ-004 | sitemap.xml merge, no duplicates | PARTIAL | REPO-006; `deterministic-spider.ts:410-429` | Sitemap fetch bypasses `safeGet` (REQ-047) |
| REQ-005 | Render JS-heavy pages | PARTIAL | REPO-006 | |
| REQ-006 | Flag and skip sign-in areas | PARTIAL | REPO-006 | |
| REQ-007 | Page hierarchy + navigation with link region | PARTIAL | REPO-006 | `LinkRegion` type only |
| REQ-008 | Sections per page | PARTIAL | REPO-006 | Type only |
| REQ-009 | Extract page content | PARTIAL | REPO-006 | Type only |
| REQ-010 | Record CMS/framework | PARTIAL | REPO-006 | No CMS detection |
| REQ-011 | BYOK AI keys | PARTIAL | REPO-006 | Check-up BYOK reusable |
| REQ-012 | PageSpeed / CWV from external API | PARTIAL | REPO-006; `key-resolver.ts:14,23` | Key name only, no client |
| REQ-013 | Detect page language | PARTIAL | REPO-006 | No content-based detection |
| REQ-014 | Content problems | PARTIAL | REPO-006 | No cross-page duplicate title/description check |
| REQ-015 | Ten marketing signals | PARTIAL | REPO-006 | `MARKETING_SIGNALS` type only |
| REQ-016 | AI assessment of six areas | MISSING | REPO-006 | |
| REQ-017 | Rank by impact/effort, cite page+section | PARTIAL | REPO-006 | |
| REQ-018 | Five Audit Documents | MISSING | REPO-006 | AC-1 conflict parked (D-001) |
| REQ-019 | Pitch Glimpse EN/TA | MISSING | REPO-006 | D-002 |
| REQ-020 | Edit hierarchy/content/findings before export | MISSING | REPO-006 | |
| REQ-021 | Markdown + JSON export | PARTIAL | REPO-006 | |
| REQ-022 | PDF and Word export | MISSING | REPO-006 | |
| REQ-023 | Shortlist | MISSING | REPO-006 | |
| REQ-024 | Clickable homepage preview | MISSING | REPO-006 | |
| REQ-025 | Owner Audit EN/TA | MISSING | REPO-006 | |
| REQ-026 | Improvement Roadmap | MISSING | REPO-006 | |
| REQ-027 | Proposal from editable template | MISSING | REPO-006 | |
| REQ-028 | Saved audits, versions, re-run | MISSING | REPO-006 | Storage depends on ADR 0036 (REQ-050, D-003) |
| REQ-029 | Local by default, Cloud when needed | UNVERIFIED | REPO-006 | |
| REQ-030 | AI rewrite after approval, no reused wording | MISSING | REPO-006 | |
| REQ-031 | Pricing | MISSING | REPO-006 | deferred |
| REQ-032 | Hindi + other Indian languages | PARTIAL | REPO-006 | |
| REQ-033 | Helper accounts per App | MISSING | REPO-006 | Needs REQ-048 access levels (D-004) |
| REQ-034 | Honour robots.txt | PARTIAL | REPO-006; `competitive/robots.ts:50` | Robots fetch uses Node `fetch`, bypasses `safeGet` |
| REQ-035 | Rate limit per host (one at a time + Crawl-delay) | PARTIAL | REPO-006 | No `Crawl-delay` parsing; ADR 0015 still Deferred |
| REQ-036 | Flag and skip payment areas | PARTIAL | REPO-006; `safety-filter.ts:41-50` | Actions blocked, no page-level detection |
| REQ-037 | Phone layout | PARTIAL | REPO-006 | |
| REQ-038 | Accessibility + SEO basics | PARTIAL | REPO-006 | |
| REQ-039 | Model per task | PARTIAL | REPO-006 | `modelForStage` type only |
| REQ-040 | AI keys encrypted at rest | COMPLETE | REPO-006; `key-resolver.ts:45,279,366` | Code read, tests not run (uncommitted) |
| REQ-041 | Ship no AI keys | COMPLETE | REPO-006; CHK-SECRETS EV-0007 PASS | `scan-commit-secrets.mjs` not wired into CI |
| REQ-042 | Search data API | MISSING | REPO-006 | deferred |
| REQ-043 | Free tiers first | UNVERIFIED | REPO-006 | |
| REQ-044 | English + Tamil end to end | PARTIAL | REPO-006 | |
| REQ-045 | Redesign or repair per page | MISSING | REPO-006 | |
| REQ-046 | Full test suite passes on Windows | UNVERIFIED | REPO-006; EV-0003/0005/0006 FAIL | Baselines fail (see REQ-051..053) |
| REQ-047 | ADR 0031: page-derived requests via `safeGet` (`makeOutboundFetch`) | PARTIAL | `safe-net.ts:115,146`; grep: `makeOutboundFetch` only in ADR 0031 | `safeGet` exists; 4+ bypass paths remain |
| REQ-048 | Declared per-route access levels | MISSING | `routes/route.ts:12-24` (no access field) | `matchRoute` has no `:id` params |
| REQ-049 | One `RunSlot` with run kind | MISSING | `server.ts:481` (`benchmarkBusy`) | 5 check sites |
| REQ-050 | ADR 0036 hosted audit storage | MISSING | `docs/adr/` ends at 0034 | |
| REQ-051 | `pnpm typecheck` clean | MISSING | CHK-TYPECHECK EV-0003 FAIL | 216 errors in test files |
| REQ-052 | `.env.example` lists `XDG_CONFIG_HOME` | MISSING | CHK-UNIT EV-0005 FAIL; `key-resolver.ts:344` | |
| REQ-053 | Browser suite finishes and passes | MISSING | CHK-BROWSER EV-0006 FAIL (timed out) | 4 files failing |

Counts (53): COMPLETE 2, PARTIAL 26, MISSING 22 (2 deferred), UNVERIFIED 3.

## Technical debt

| Item | Location | Impact | Suggested action |
|---|---|---|---|

## Incomplete implementations

_TODO/FIXME stubs, unimplemented branches, feature flags left off — with locations._

## Duplicated logic

## Architectural inconsistencies

## Security concerns

_Describe the concern and location. Never include secret values._

<!-- ai-eos:survey:start -->
<!-- REPO-001 -->
## Shard S1: .claude-plugin/**, dev-pipeline/**, fixtures/**, packages/checkers/**, packages/wizard/**, plugins/**, scripts/**, site/**, templates/**

Coverage: manifests, entry/barrel files, config, scripts, test inventory and route tables read; per-checker logic and per-screen React code not read line by line. Tests were not run (instruction). Counts from `git ls-files` and `it(`/`test(` grep.

### Stack (confirmed from manifests and source)
- pnpm 11.10 monorepo, ESM (`"type": "module"`), Node >=22, TypeScript ^5.7 (`package.json`: packageManager, engines). Lockfile `pnpm-lock.yaml` and `pnpm-workspace.yaml` are tracked at root (`git ls-files`). No per-package lockfiles found.
- `@qa/checkers` (`packages/checkers/package.json`): tsc build to `dist/`, deps `@axe-core/playwright`, `playwright` pinned 1.63.0, `pixelmatch`, `pngjs`, `yaml`, `@qa/types` (workspace). No test script of its own; tests run from the root vitest.
- `@qa/wizard` (`packages/wizard/package.json`): React 18.3, Vite 6, Tailwind 3.4, `@dnd-kit/*`, fontsource fonts; build = `tsc && vite build`. Playwright 1.63.0 is a devDependency (used by tests and `og-image` script).
- Playwright version is pinned identically in checkers and wizard; `scripts/check-playwright-version.mjs` exists to guard drift.

### Modules
**packages/checkers** (17 src files, 5,879 lines; barrel `src/index.ts:1-16` re-exports all). Deterministic checkers, no AI:
- bug-detection, spec-conformance (576 lines), ux-quality, design-standards, permission-matrix, security (545), security-depth (460), performance (690), could-not-verify, seo (586), site-root (271), aeo, geo, marketing (436), keyboard-a11y (504), refusal-rule.
- Depends on: `@qa/types` only (plus playwright/axe). Consumed by `@qa/core` and `@qa/runner` (Cross-shard).
- No TODO/FIXME/HACK in `packages/checkers/src` or `packages/wizard/src` (grep count 0).

**packages/wizard** (61 src files, 36 test files). Vite SPA, Vite dev port 3002 with `/api` proxy to `VITE_RUNNER_URL` or localhost:3001; `VITE_BASE` sets sub-path (`vite.config.ts:4-15`).
- Entry: `index.html`, `src/main.tsx`, `src/App.tsx`, `src/LandingRoot.tsx` (landing).
- Hand-rolled History API router, no router library (`src/lib/router.ts:1-35`). Routes: `/`, `/check`, `/check/scan`, `/check/plan`, `/check/testing`, `/reports`, `/reports/:id`, `/reports/:id/visibility`, `/baselines`, `/benchmark`, `/settings`, else not-found.
- Screens (`src/screens/`): Landing, NewCheckup, Scanning, PlanReview, Testing, Report, Visibility, PastCheckups, VisualBaselines, Benchmark, Settings, Connection, NotFound. Components in `src/components` (incl. `plan/`), hooks in `src/hooks` (`useRunnerStream`, `useRunnerConnection`, `useWakeOnline`), pure helpers in `src/lib` (translate, plan-translate, release-rule, session-file, etc.).
- All server calls go through `src/api.ts`; errors become `RunnerError` with plain-language messages (`api.ts:29-60`). SSE stream at `/api/runner/stream` (`api.ts:27`).
- Imports browser-safe `@qa/types/src/browser.js` by subpath to keep `node:crypto` out of the bundle (`api.ts:14-19`; alias in `vitest.config.ts:24-27`).
- Assets: `public/` (8 files), `scripts/make-og-image.mjs`, `DESIGN.md`, `tailwind.config.js`, `postcss.config.js`.

### Public APIs consumed by the wizard (client view, from `packages/wizard/src/api.ts`; handlers live in packages/runner)
Runner: `/api/runner/{stream,status,run,abort,preflight,domain-proof,ai-estimate,context/docx,ai/finish,spec-override,baselines,baselines/accept,baselines/:id,benchmark,benchmark/:id,benchmarks,schedules,schedules/:id,waiting-plans}`; plan: `/api/runner/plan`, `plan/replan`, `plan/add-page`, `plan/include-host`, `plan/add-sign-in`, `plan/markdown`, `plan/export`, `plan/approve`, `plan/interpret`. Others: `/api/ai/{settings,usage,test-model,openrouter/free-models,openrouter/validate,openrouter/key}`, `/api/runs[/:id...]`, `/api/evidence/runs/:id`, `/api/sites[/:id...]`, `/api/settings/defaults`. Auth: not determinable from this shard (see Cross-shard).
- This shard defines no server API. `fixtures/test-app/server.js` is a plain `http.createServer` app (port `PORT` or 3050, `server.js:6,29`) with per-response CSP nonce and an in-memory "lab" counter on `globalThis.__fixtureLab` (`server.js:8-19`); it is test infrastructure, not product.

### Fixtures
- `fixtures/test-app/` (server.js, package.json, docs/): built-in app the tool tests against (`pnpm fixture`, root `package.json`). Has its own package.json (tracked).
- `fixtures/audit-site/`: UNTRACKED (git status `??`). ~30 static files (HTML pages in en/ta/hi, `robots.txt`, `sitemap.xml`, WordPress-style `wp-content/**`, `private/`, `account/sign-in.html`). Used by `packages/core/tests/audit-site-fixture.test.ts` (browser project). Part of the in-progress Website audit work (ADR 0033, untracked).
- `fixtures/benchmarks/*.json` (todomvc, saucedemo, books, bad-demo, fixture, thresholds): benchmark targets and thresholds consumed by `scripts/benchmark.ts` and `scripts/benchmark-gate.ts` (root script `benchmark`). saucedemo/todomvc/books imply external public sites: network-dependent.

### Scripts (`scripts/`)
`start.mjs` (root `pnpm start`, loads `.env` if present), `smoke.mjs`, `clean.mjs`, `tunnel.mjs`, `ship-loop.mjs` (agent batch mode), `check-playwright-version.mjs`, `site-output.mjs` (copies wizard `dist` to `./public`, writes `version.json` with `GITHUB_SHA`; `site-output.mjs:11-21`), `deploy-cloud-run.mjs`, `benchmark.ts`, `benchmark-gate.ts`. Untracked in git status but outside this shard's globs scripts: `scan-build-secrets.mjs`, `scan-commit-secrets.mjs` exist at `scripts/` as untracked (`??`), with tests in packages/runner/tests.

### Build and deployment (this shard)
- Static site: `site/Dockerfile` = `nginxinc/nginx-unprivileged:1.27-alpine`, copies `site/nginx.conf` and `public/` (`Dockerfile:3-5`). nginx on 8080, hashed `/assets/` cached 1y immutable, SPA fallback to `index.html` (`nginx.conf:8-17`). No security headers (CSP, X-Frame-Options) are set in nginx.
- `scripts/deploy-cloud-run.mjs:5-9`: hardcoded GCP project id `qa-flow-tester-512310`, region default us-central1 and three hardcoded Cloud Run URLs (runner, runner hash URL, site). Overridable only for project/region. Pushes images to Artifact Registry `qa/runner:<sha>`, `qa/site:<sha>`.
- Root `pnpm site-build` = build types, build wizard, run `site-output.mjs`.
- `templates/qa-check.yml`: consumer-facing GitHub Actions template for CI use of the tool (not run by this repo).
- Discrepancy: latest commit 71cf6af says "drop vercel.json and .vercelignore" yet `vercel.json` is listed in the root directory; `site/nginx.conf:13` comment still refers to "what vercel.json did". Verify whether the file is untracked or leftover (UNVERIFIED; `git ls-files` for it was not run).

### Plugins and tooling in this shard (not product runtime)
- `.claude-plugin/marketplace.json`: marketplace "qa-flow-tester" listing one plugin, `repo-orchestrator` at `./plugins/repo-orchestrator`.
- `plugins/repo-orchestrator/`: Claude Code plugin (agents x4 files, skills x3, hooks, scripts, `test/`, README). Hook: PreToolUse Bash -> `hooks/guard-test-runs.mjs` (`hooks/hooks.json:3-12`). Tests: `node --test plugins/repo-orchestrator/test/*.test.mjs` plus `scripts/validate.mjs` via `pnpm test:plugin`. Not included in `pnpm test` (vitest globs only `packages/*/tests`).
- `dev-pipeline/`: second Claude plugin; registers `/build` (`hooks/register.js:1-40`, a prompt template that drives phases 0-7 and writes `.claude/build-runs/<runId>/status.json`). Agents: architect, code-reviewer, impact-analyst. `dev-pipeline/build.test.ts` and `tsconfig.json` sit outside `packages/*/tests`, so vitest (`vitest.config.ts:40`) does not pick it up: likely never run in CI (UNVERIFIED; check .github).
- Both plugin sets overlap in purpose with `.claude/agents` and `/ship` described in CLAUDE.md (architectural overlap, debt).

### Tests (this shard)
- Framework: vitest ^2.1.8, globals, environment `node`, 30 s test and hook timeouts (`vitest.config.ts:14-19`). Workspace splits into `unit` and `browser` projects; `browser` is an explicit allow-list of files that launch Chromium or a runner (`vitest.workspace.ts:10-38`). New test files default to `unit`.
- checkers: 17 files, ~168 `it/test` cases. Browser-project: alt-text-quality, design-ux-checkers, keyboard-a11y, marketing, marketing-review, performance, refusal-rule, security, security-depth, seo, spec-denial. Unit: bug-detection, bug-grouping, permission-matrix, spec-url-pattern, visual-diff-finding, wcag-coverage.
- wizard: 36 files, ~269 cases. Browser: `landing-audit-browser`, `wizard-e2e` (slow; CLAUDE.md says run before a release). `.test.tsx` files run under `environment: 'node'` (no jsdom in `sharedTest`); they presumably use server rendering (UNVERIFIED, not read).
- Notable guards: `no-banned-words.test.ts` (glossary "Avoid" terms in UI), `repo-hygiene.test.ts`.
- Focused suite `pnpm test:url-first` (root `package.json`) lists `packages/checkers/tests` whole plus selected core/wizard/runner files. It uses `vitest run` without a project flag.
- Baseline: not run.

### CI/CD touching this shard (workflows themselves are outside the shard)
`.github/workflows`: ci, deploy, tests, e2e-nightly, qa-check, release, benchmark (per detect). `ci.yml` is modified in the working tree. The deploy job builds the wizard to `./public` then `site/Dockerfile` (comments in `Dockerfile:1-2`). Not read here.

### Generated and vendored code, dependency ecosystems
- Generated: `packages/*/dist`, `public/` (site-output), `coverage/`; none of it is in the shard's tracked files. Root `public/` and `dist` exist on disk; CLAUDE.md says `/public` is generated and not to be committed.
- Vendored: none found in the shard.
- Ecosystems: npm (pnpm workspace) only. `fixtures/test-app/package.json` is a separate workspace-like package with its own deps (not read; check `pnpm-workspace.yaml`).
- Fonts via `@fontsource*` packages (no remote font loading).

### Debt, risks and findings
1. `scripts/deploy-cloud-run.mjs:5-9`: hardcoded project id and production URLs; forks cannot deploy without editing the file. Impact: low-medium (portability).
2. `site/nginx.conf`: no CSP, X-Content-Type-Options or frame headers for the SPA host; the tool itself values these headers (fixture sets CSP, `server.js:37-39`). Impact: medium for a security-focused product.
3. Stale references to removed Vercel setup (`nginx.conf:13`, possible leftover `vercel.json`).
4. `dev-pipeline/build.test.ts` and `plugins/repo-orchestrator` tests are outside the vitest include globs; they run only via `pnpm test:plugin` (plugin) or not at all (dev-pipeline). CI coverage UNVERIFIED.
5. `vitest.workspace.ts` `BROWSER_TESTS` is a hand-maintained allow-list (manual sync risk; a new browser test placed in `unit` would run without Chromium assumptions and fail or slow). Note the file is untracked (new).
6. `fixtures/audit-site/` and `docs/adr/0033` are untracked: Website audit feature work in progress is not committed.
7. `benchmark` fixtures target third-party public sites (saucedemo, todomvc, books): flaky/offline risk, and the `benchmark.yml` workflow depends on them.
8. `packages/checkers` has no package-local test or lint scripts; all quality gates run from root.
9. Large single files (checkers: performance 690, seo 586, spec-conformance 576, security 545) are acceptable but are the main complexity hotspots.
10. No TODO/FIXME markers in shard source: either clean or tracked elsewhere (`engineering/`, `docs/`).

### Cross-shard
- `@qa/types` (packages/types): checkers and wizard import it; the wizard subpath import `@qa/types/src/browser.js` and aliases in `vitest.config.ts:24-27` must stay browser-safe. `packages/types/src/website-audit.ts` and `browser.ts` are modified/untracked.
- `@qa/core` and `@qa/runner` import `@qa/checkers` (index barrel); build order types -> checkers/core -> runner (CLAUDE.md).
- Wizard depends on every runner endpoint listed above; handlers, auth (`access-token`), SSE and `ui-static.ts` (serves the built wizard, falls back to the SPA) are in packages/runner. API contract doc: `docs/API.md`.
- Tests in packages/core and packages/runner use fixtures in this shard (`fixtures/test-app`, `fixtures/audit-site`) and a helper at `packages/core/tests/helpers/audit-site-server.ts`.
- `scripts/start.mjs`, `smoke.mjs`, `benchmark*.ts` run packages/runner and core `dist`; `fixtures/benchmarks/*.json` schema is owned by runner/core benchmark code.
- `.github/workflows/*` (deploy, ci, benchmark, qa-check) call root scripts, `site-build`, `site/Dockerfile`, `templates/qa-check.yml`. `.github/workflows/ci.yml` has uncommitted edits.
- Root files used by this shard: `vitest.config.ts`, `vitest.workspace.ts` (untracked), `tsconfig.base.json`, `tsconfig.test.json`, `eslint.config.mjs`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vercel.json` (status unclear), `docker-compose.yml`.
- Docs: `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/AGENT_WORKFLOW.md`, `CONTEXT.md` (glossary enforced by `no-banned-words.test.ts`).

<!-- REPO-002 -->
## Shard S2: `*` (root files), `.github/**`, `agent-dashboard/**`, `docs/**`, `packages/runner/**`, `packages/types/**`

Survey of commit 71cf6af on branch `feat/website-audit` (working tree has uncommitted edits, listed in the task's git status). Read-only; tests not run (task forbids it).

### Stack (confirmed)

- pnpm 11.10.0 monorepo, ESM TypeScript, Node >=22 (`package.json:5,7,38`; `.nvmrc` = 22). Workspaces `packages/*` and `fixtures/*` (`pnpm-workspace.yaml:1-3`).
- Playwright pinned by `overrides` to 1.63.0 (`pnpm-workspace.yaml:7-8`), matched to Docker image tag `mcr.microsoft.com/playwright:v1.63.0-noble` (`packages/runner/Dockerfile:3`); enforced by `scripts/check-playwright-version.mjs` (CI step, `ci.yml:36-37`) and `packages/runner/tests/playwright-version-check.test.ts`.
- Dev tooling (root devDependencies): vitest ^2.1.8 and `@vitest/coverage-v8`, eslint 9 + typescript-eslint, prettier, tsx, typescript ^5.7.2 (`package.json:40-51`).
- `@qa/runner` has only workspace deps `@qa/core` and `@qa/types` (`packages/runner/package.json:13-16`): the HTTP server uses Node `http` directly, no Express/Fastify. `@qa/types` has zero runtime deps and only `typescript` as devDep.
- Lockfile: single `pnpm-lock.yaml` (npm ecosystem). Dockerfile ecosystems: `packages/runner/Dockerfile`, `site/Dockerfile`. GitHub Actions. Dependabot covers npm `/`, github-actions `/`, docker `/packages/runner` (`.github/dependabot.yml`), ignoring `playwright`/`playwright-core` (bumped by hand).
- Build: `tsc` per package (`packages/runner/package.json:9`, `packages/types/package.json:9`), `rootDir ./src`, `outDir ./dist` (`packages/runner/tsconfig.json`). `pnpm build` = `pnpm -r run build` (`package.json:23`). `typecheck` uses `tsconfig.test.json` (covers `packages/*/tests` and `scripts`, noEmit).

### Entry points

- Runner CLI `packages/runner/src/cli.ts` (`pnpm runner` / `node packages/runner/dist/cli.js`): reads env, starts `RunnerServer`, serves wizard via `defaultUiApps()` (`cli.ts:49-60`, `ui-static.ts`). Refuses to start on a non-loopback host without `RUNNER_ACCESS_TOKEN` (`cli.ts:36-41`).
- CI CLI `packages/runner/src/checkup.ts` (573 lines; used by `templates/qa-check.yml` and `.github/workflows/qa-check.yml:70`: `node .qa-tool/packages/runner/dist/checkup.js`). Reads `QA_DEBUG`, `RUNNER_BETA`, `GITHUB_ACTIONS`, `GITHUB_STEP_SUMMARY`.
- Root orchestration scripts (in `scripts/`, other shard): `start.mjs`, `smoke.mjs`, `site-output.mjs`, `deploy-cloud-run.mjs`, `benchmark.ts`, `scan-build-secrets.mjs`, `scan-commit-secrets.mjs`.
- Static site: `site/Dockerfile` + `site/nginx.conf` (nginx-unprivileged:1.27-alpine, port 8080), content from `public/` (git-ignored, `.gitignore:44`, produced by `pnpm site-build`).

### Modules (runner, 8,904 src lines)

| File | Lines | Role |
|---|---|---|
| `src/server.ts` | 3609 | `RunnerServer`: http server, access gate, CORS/host checks, beta scoping, all route dispatch and many handlers (runs, sites, AI settings, benchmarks, baselines, schedules, evidence) |
| `src/routes/plan.ts` | 1361 | Plan Review handlers + the only declarative route table (`planRoutes`, `plan.ts:1282`) |
| `src/session/checkup-run.ts` | 1143 | start/abort of a Check-up, run lifecycle |
| `src/session/{checkup-session,plan-store,report-store,run-events,run-secrets,run-slot}.ts` | 86-336 | per-session state, plan/report persistence, SSE event log, in-memory secrets, single run slot (ADR 0027) |
| `src/checkup.ts` | 573 | CI CLI |
| `src/run-inputs.ts` | 365 | request-body validation (intents, headers, saved sessions) |
| `src/beta.ts` | 342 | shared-beta mode: per-visitor sessions, daily/visitor run caps, session cookie, request guard |
| `src/scheduler.ts`, `benchmarks.ts` | 158 / 134 | schedules (persisted in data dir), benchmark runner |
| `src/host-policy.ts`, `bind-host.ts`, `ui-static.ts`, `routes/{route,body,index}.ts` | small | host/loopback checks, static UI serving, route matcher, JSON body reader |

`@qa/types` (src files: fingerprint, findings-contract, site-map, plan, verdict, problems, signin, issue-type, test-case, evidence-finding, run-report, aspects, ai, discovery, hub, review-plan, context-parse, intent, route-telemetry, input-rules, checkup-api, website-audit, plus `browser.ts`, `index.ts`) is the shared contract. `index.ts` re-exports everything, but the wizard must import single modules from `@qa/types/src/...` or `browser.ts` because the index pulls `node:crypto` (`vitest.config.ts:23`; CLAUDE.md rule). `website-audit.ts` (new, untracked) defines the Website Audit contract and `AUDIT_API` (ADR 0033).

### Runner HTTP + SSE API (from `server.ts` dispatcher, lines 841-1207, and `plan.ts:1282-1361`)

Order of gates in the request handler: `/healthz` (200 `ok`, no auth, `server.ts:847`) -> Host allow-list incl. loopback, `RUNNER_ALLOWED_ORIGINS` hosts, or `*.run.app` when `K_SERVICE` set (`:856-874`, 403 otherwise) -> CORS/Origin check (cross-origin non-GET from unlisted origin = 403, `:890`) -> OPTIONS 204 -> `grantAccess` (cookie, `X-QA-Access` header, or GET `?access=` then 303 and HttpOnly cookie; 401 otherwise, `:794-829`) -> beta session, rate limit 429, `closedInBeta` 403, `betaScope` (`:904-922`) -> routes.

| Method / path | Handler | Notes |
|---|---|---|
| GET `/healthz` | inline | unauthenticated |
| `/studio`, `/studio/*` | 308 -> `/reports` | retired (ADR 0010) |
| GET `/api/runs`, `/api/runs/<id>`, `/api/runs/<id>/download/<file>`; POST `/api/runs/<id>/triage`, `/accept-judgement`; DELETE `/api/runs/<id>` | `handleRuns` (`server.ts:2120-2254`) | past Check-ups |
| GET `/api/runner/stream` | inline SSE (`:939`) | `text/event-stream`, replays current run's event log, first event `connected` |
| POST `/api/runner/run` | `handleTriggerRun` | starts Check-up |
| POST `/api/runner/abort`, `/api/runner/stop` | `handleAbortRun` | |
| GET `/api/report`, `/api/report/download/*` | inline | last report; 404 before first run |
| GET `/api/runner/status` | inline (`:985`) | |
| `/api/sites`, `/api/sites/*` | `handleSites` | site memory |
| GET/POST `/api/settings/defaults` | `handleDefaults` | screen sizes |
| POST `/api/runner/ai-estimate`, `/preflight`, `/context/docx`, `/domain-proof`, `/ai/finish` | inline | |
| `/api/ai/*` (settings GET/POST, usage GET, test-model, validate, key GET/POST, free-models) and `/api/ai/openrouter/*` | AI handlers (`:2548-2742`) | handles saved key (`.qa-keys.json`) |
| GET `/api/baselines/*`, GET `/api/runner/baselines`, POST `/api/runner/baselines/accept`, DELETE `/api/runner/baselines/*` | inline | visual baselines in `.qa-baselines/` |
| POST `/api/runner/benchmark`, GET `/api/runner/benchmarks`, GET/DELETE `/api/runner/benchmark/*` | inline | |
| GET/POST `/api/runner/schedules`, POST `.../<id>/toggle`, DELETE `.../<id>` | inline | closed in beta |
| POST `/api/runner/spec-override`, GET `/api/runner/spec-overrides` | inline | |
| GET `/api/evidence/<path>` | inline (`:1151`) | path-confined: `..` rejected, realpath check, saved sessions blocked (`:1153-1173`) |
| Plan routes via `planRoutes` | `routes/plan.ts` | GET/PATCH `/api/runner/plan`; POST `/plan/approve`, `/plan/interpret`, `/plan/replan` (202 + `PLAN_UPDATE_*` events), `/plan/add-page`, `/plan/add-sign-in`, `/plan/include-host`; GET `/plan/markdown`, `/plan/export` (zip); any method `/api/runner/waiting-plans` |
| non-`/api/` | `serveUi` (`ui-static.ts`) | wizard + landing; else 404 JSON |

Observations: (1) No Website Audit routes exist in the runner: `grep AUDIT_API|/api/audit packages/runner/src` returns nothing, so ADR 0033/`website-audit.ts` is contract-only on the runner side (wizard/core shards may hold the rest). (2) `docs/API.md` is the stated API doc; `packages/runner/tests/route-inventory.test.ts` and `route-table.test.ts` presumably guard drift (not opened). (3) Route table migration is partial: `allRoutes` holds only `planRoutes` (`routes/index.ts:9`); the rest remains in an if-chain in `server.ts` (ADR 0027 follow-up, `route.ts:7` comment "Grows in the follow-up plan").

### Authentication and authorization

- Single shared secret `RUNNER_ACCESS_TOKEN` (cookie/header/`?access=`), compared with `matchesSecret` (`server.ts:797-801`); no per-user identity. Cloud Run deploy uses `--allow-unauthenticated` and relies on this token from Secret Manager `qa-access-token` (`deploy.yml:130-138`). Deploy verification expects 401 at `/` (`deploy.yml:141-150`).
- Beta mode (`RUNNER_BETA=1`): per-visitor sessions (`beta.ts`), data under `<dataDir>/sessions/<id>` (`server.ts:743-744`), outbound browser request guard for non-public hosts (ADR 0014/0031, `server.ts:833`), mutating routes closed (`closedInBeta`, `server.ts:1341-1346`).
- Target-site authorization: `resolveAuthorization` with `owner` flag and verified-domain proof (`/api/runner/domain-proof`; ADR 0014/0022).

### Data and persistence (no database, no migrations)

File-based, in `RUNNER_DATA_DIR` (default `<cwd>/.qa-data`, `server.ts:670`): `.qa-keys.json` (saved AI key, may be encrypted per ADR 0034 in the modified `core/ai/key-resolver.ts`), `.qa-ai-models.json`, `.qa-ai-model-record.json`, `.qa-settings.json` (`:679-681`), `spec-overrides.json`, `benchmark-shots/`, `sites/` (site memory), schedules file. Reports in `RUNNER_OUTPUT_DIR` (default `.qa-runner-report`, `:664`), per-run `runs/<runId>/`. Baselines in `<cwd>/.qa-baselines` (committed on purpose, `:665`). One legacy "migration": `moveLegacyData()` moves files from cwd into `.qa-data` (`server.ts:2275-2289`). In-memory only: saved sign-in sessions (ADR 0021, `session/run-secrets.ts`), SSE log. Single run slot (`session/run-slot.ts`): one Check-up at a time per server.

### Configuration (names only)

Runner: `PORT` (trusted only with `K_SERVICE`/`RENDER`), `RUNNER_PORT`, `RUNNER_HOST`, `RUNNER_OUTPUT_DIR`, `RUNNER_DATA_DIR`, `RUNNER_LOCALHOST_ALIAS`, `RUNNER_ALLOWED_ORIGINS`, `RENDER_EXTERNAL_URL`, `RUNNER_ACCESS_TOKEN`, `RUNNER_BETA`, `RUNNER_BETA_RUNS_PER_VISITOR`, `RUNNER_BETA_RUNS_PER_DAY`, `RUNNER_STEP_TIMEOUT_MS`, `PUBLIC_URL` (`ui-static.ts:76`), `QA_DEBUG`, `K_SERVICE`. Vite build args: `VITE_COUNTER_URL`, `VITE_CONTACT_EMAIL`, `VITE_SIGNUP_URL`. `.env.example` exists (not read; names only per rule); `.env` read by `pnpm start` via `--env-file-if-exists` (`package.json:9`). `docs/CONFIGURATION.md` documents variables; `packages/runner/tests/config-docs.test.ts` guards it.

### Tests

- Frameworks: vitest ^2.1.8 (all packages' `tests/**/*.test.{ts,tsx}`), `node:test` for `plugins/repo-orchestrator/test/*.test.mjs` (`test:plugin`), plus `agent-dashboard/dashboard.test.ts` and `dev-pipeline/build.test.ts` (not under the vitest include glob `packages/*/tests/**`, so `pnpm test` does not run them; unclear how/if they run).
- Counts in shard: runner 53 test files (`packages/runner/tests/`), types 14 (`packages/types/tests/`, plus new untracked `website-audit.test.ts`).
- `vitest.config.ts`: shared `sharedTest` (globals, node env, 30 s test/hook timeouts, `:11-16`), alias map for `@qa/*` to source, worker count `min(cpus-1, floor(totalmem/4GiB))` (`:10`), v8 coverage with no thresholds (`:34-41`).
- `vitest.workspace.ts` (new, untracked): two projects, `unit` (everything except browser files) and `browser` (explicit `BROWSER_TESTS` allow-list of files that launch Chromium or a runner; runner list at lines 31-38, wizard `landing-audit-browser`, `wizard-e2e`). A new test lands in `unit` by default; the comment says it was verified 2026-11-03 by running unit with an empty browsers path. Note: `vitest.workspace.ts` is a deprecated mechanism in vitest 3 (project uses 2.1.8, fine for now). Runner test files not in the browser list include: `config-docs`, `consent-rule`, `host-policy`, `plan-routes`, `planted-defect-gate`, `playwright-version-check`, `release-workflow`, `route-table`, `run-inputs-*`, `seo-static`, `session-state`, `smoke-preset`, `checkup-annotations/credentials/debug/docs`, `fixture-app`, `scan-*-secrets` (untracked, new) etc. Some of these (`fixture-app`, `planted-defect-gate`) may start the fixture app or a browser; the workspace comment claims verification, not re-verified here.
- Scripts: `pnpm test` = `vitest run`; `test:url-first` curated file list (`package.json:30`); `smoke` = `scripts/smoke.mjs`; `typecheck`; `lint`; `format:check`.
- Baseline run: NOT RUN (task instruction; `.claude/work/DEFER_TESTS` policy in CLAUDE.md also applies).
- `packages/runner/tests/` modified (uncommitted) in 11 files; `vitest.config.ts` modified.

### CI/CD (`.github/workflows/`)

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR, push main, dispatch | `quality-gate` (frozen install, playwright version check, lint, format:check, typecheck with `continue-on-error: true` and only a summary count, `ci.yml:44-53`), `build-and-test` (PR only, 4 shards calling `tests.yml`), `auth-crawl` (path-filtered, 20 min), `audit` (`pnpm audit --prod --audit-level high`), `secret-scan` (gitleaks, full history), new uncommitted `build-secret-scan` (+39 lines: scans wizard dist and runner image `/app`, env and history with `scripts/scan-build-secrets.mjs`) |
| `tests.yml` | reusable | site-build, runner build, Playwright Chromium install, `vitest run --shard=N/4 --exclude wizard-e2e --exclude auth-crawl-*` (`tests.yml:54`) |
| `deploy.yml` | push main, dispatch | gated by `github.repository == 'CJCreator/qa-flow-tester'`: build-and-smoke, tests, then `cloud-run` (runner image to Artifact Registry `us-central1-docker.pkg.dev/qa-flow-tester-512310/qa/runner:$SHA`, `gcloud run deploy qa-check-up`, 2Gi, 1 CPU, min 0/max 1 instance, timeout 3600, `RUNNER_BETA=1`, data in `/tmp/qa-data`, secret `RUNNER_ACCESS_TOKEN`) and `site` (nginx image, 256Mi, max 2). Keyless auth via Workload Identity Federation (`vars.GCP_*`). Post-deploy verify steps check 401/200 and `version.json` commit. |
| `e2e-nightly.yml` | cron `0 3 * * *`, dispatch | runs `wizard-e2e.test.ts` only |
| `release.yml` | tag `v*` | lint, format, audit, site-build, runner build, full vitest minus wizard-e2e, `pnpm build`; no publish |
| `benchmark.yml` | cron `0 3 * * 1`, dispatch | `pnpm benchmark --sites fixture --no-ai`, upload artifact |
| `qa-check.yml` | dispatch | self-check-up of a target using `packages/runner/dist/checkup.js`; `templates/qa-check.yml` is the user-facing copy |

Actions pinned by SHA only for `pnpm/action-setup` and `dorny/paths-filter`; `actions/checkout@v4`, `setup-node@v4`, `google-github-actions/*@v2` pinned by tag. PR template and `.gitleaks.toml` (allowlists `fixtures/` and `packages/*/tests/`).

### Deployment

- Runner image `packages/runner/Dockerfile`: Playwright noble base, corepack pnpm 11.10.0, frozen-lockfile install filtered to runner and wizard, builds both, `EXPOSE 3001`, defaults `RUNNER_HOST=0.0.0.0`, `RUNNER_PORT=3001`, `RUNNER_DATA_DIR=/data`; runs as the base image's default user (no `USER` instruction; base image runs root, not verified), CMD `node packages/runner/dist/cli.js`. Image copies `fixtures/test-app/package.json` only but not `fixtures/audit-site` (new, untracked, a new workspace package matched by `fixtures/*`): with `--frozen-lockfile` the lockfile would list `fixtures/audit-site` as an importer whose manifest is absent in the image. Verify before merge (UNVERIFIED: depends on whether audit-site has a `package.json` and whether lockfile includes it).
- Cloud Run overrides to port 8080 via `--port 8080` and `PORT` env (trusted only with `K_SERVICE`, `cli.ts:7-9`).
- Static site `site/Dockerfile` + `site/nginx.conf`.
- `docker-compose.yml` exists at root (not detailed here; read it if compose deployment matters). `scripts/deploy-cloud-run.mjs` = manual path (`pnpm deploy:cloud`).
- `.dockerignore` present.
- Hosting decision: ADR 0032 (Google Cloud only; Render and Vercel retired).

### Generated, vendored, ignored

No vendored third-party source in the shard. Generated/ignored: `public/` (`.gitignore:44`), `.claude/` (`.gitignore:49`), `dist/` per package, `.qa-*`, `.tmp-*`, `.benchmark/`, `coverage/`. `packages/runner/dist` exists on disk. `docs/findings.schema.json` is a published schema (hand-maintained? generator not located in this shard).

### Documentation and decisions (docs/)

34 ADRs `docs/adr/0001`-`0034` (0033 website-audit-entry-point and 0034 encrypted-key-fallback are untracked/new). Docs index `docs/README.md`; architecture, API, config, deployment, testing, security review, PRD, gap analysis, research notes, tickets (`docs/tickets/INDEX.md`, `REVIEW-REMEDIATION-PLAN.md`). `CONTEXT.md` glossary (modified, uncommitted). Root `Requirements.txt` (untracked): a tab-separated Website Audit requirements table (FR-1 to FR-28+, MVP/Phase 2), with a visible typo ("previe.//w", FR-24); not wired into code.

### Other top-level packages in the shard

- `agent-dashboard/`: Claude Code plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json` -> `register.js`, `dashboard.test.ts`, `types/index.d.ts`), unrelated to the product runtime. `dev-pipeline/`, `plugins/repo-orchestrator/` are also dev-tooling plugins (not in the S2 globs except `plugins/**` and `dev-pipeline/**` being root dirs; surveyed only by listing). `.claude-plugin/marketplace.json` at root.

### Technical debt and findings

1. `packages/runner/src/server.ts` is 3609 lines with the dispatcher, ~20 inline handlers and AI-settings logic; the route table (`routes/`) only holds plan routes (`routes/index.ts:9`). Debt: finish ADR 0027 migration. Also `plan.ts:1270-1275` reaches into `RunnerServer` privates with `(server as any)` (11 `as any` in runner src); fragile coupling, type-safety hole.
2. `ci.yml:44-53` typecheck is `continue-on-error: true` and never fails the build, so type errors in tests/scripts can merge. (Package builds do type-check via `tsc`, so src is covered by build.)
3. Parked: root `vercel.json` and `.vercelignore` are still tracked (`git ls-files`) although commit 71cf6af's message says "drop vercel.json and .vercelignore" and ADR 0032 says Vercel is retired; also CLAUDE.md says deploys go via Cloud Run. Stale files or deliberate? Discrepancy (code trusted over docs).
4. Render remnants: `cli.ts:7-16` still honours `RENDER`/`RENDER_EXTERNAL_URL` though Render is retired (ADR 0032). Minor.
5. Deploy: `--allow-unauthenticated` with `RUNNER_BETA=1` and max one instance, in-memory state and `/tmp` data: state lost on restart/scale to zero; documented design. Hard-coded project ID, project number and service URLs in `deploy.yml:27-30` and a second `*.a.run.app` origin hard-coded in the deploy command (`deploy.yml:134`).
6. Docker: no `USER` directive in runner Dockerfile; image contains full workspace sources (packages/*), not just dist (`COPY packages/...`), no multi-stage build, so devDependencies, tsc and sources ship. The new `build-secret-scan` job scans exactly this /app tree.
7. Test discipline: `BROWSER_TESTS` in `vitest.workspace.ts` is a manual list; a new browser test defaulting to `unit` would run without Chromium and fail in unit-only runs. Not enforced by a test (UNVERIFIED if one exists).
8. Test gaps in shard: `agent-dashboard/dashboard.test.ts` and `dev-pipeline/build.test.ts` are outside the vitest include globs and outside `test:plugin`; not run by `pnpm test` or CI.
9. Website Audit: `packages/types/src/website-audit.ts` defines `AUDIT_API`, but the runner implements none of it (no `/api/audit*` route), so any audit entry-point work in `packages/runner` is MISSING at this commit (searched `packages/runner/src` for `AUDIT_API`, `/api/audit`).
10. Security positives to retain: token gate with refuse-to-start (`cli.ts:36-41`), DNS-rebinding host check (`server.ts:853-874`), strict CORS, evidence path confinement with realpath (`:1151-1173`), SSE and error redaction (`redactedMessage`, `:1209`), secret scanning in CI (gitleaks history + build scan), `pnpm audit` gates. Concern: the access token is placed into a cookie via `?access=` link (documented design); `Access-Control-Allow-Credentials: true` for any allowed origin.
11. Only 12 TODO/FIXME/`as any`/eslint-disable markers across runner and types src (grep), so the stub footprint is low.

### Cross-shard

- `@qa/core` (S1 presumably): runner imports `RunnerServer` deps: `PlanValidator`, `BrowserManager`, `DeterministicSpider`, `PreFlightChecker`, `RobotsPolicy`, `KeyResolver`/`SessionKeyResolver`, `Redactor`, `PacedAI`, replanning, scoring and report functions (`plan.ts:23-68`; `server.ts`). Modified `packages/core/src/ai/key-resolver.ts` (ADR 0034) and `issues-document.ts` affect runner behaviour.
- `@qa/checkers`: used through core only (runner does not depend on it directly); `vitest.config.ts` aliases it; `test:url-first` runs `packages/checkers/tests`.
- `@qa/wizard`: served by runner (`defaultUiApps`, `ui-static.ts`); built in Dockerfile (`pnpm --filter @qa/wizard run build`); imports `@qa/types/src/*.js` single modules (vitest alias `vitest.config.ts:23`); `wizard-e2e.test.ts` and `landing-audit-browser` in browser project.
- `fixtures/test-app` (workspace package, manifest copied in Dockerfile, started by `pnpm fixture`), `fixtures/audit-site` (new, untracked, used by `packages/core/tests/audit-site-fixture.test.ts`; not copied in runner Dockerfile), `fixtures/benchmarks`.
- `scripts/`: `start.mjs`, `smoke.mjs`, `site-output.mjs`, `deploy-cloud-run.mjs`, `check-playwright-version.mjs`, `benchmark.ts`, `scan-build-secrets.mjs`, `scan-commit-secrets.mjs` (invoked from CI and `package.json`).
- `templates/qa-check.yml` is copied into the wizard build (Dockerfile `COPY templates`).
- `dev-pipeline/`, `plugins/repo-orchestrator/` are other dev-tool plugins outside the product runtime.

<!-- REPO-003 -->
## Shard S3: packages/core/**

Coverage: structural survey (manifest, barrel, export signatures, file sizes, key-resolver read in full). Large files (orchestrator, ai-planner, spider) were not read end to end. Tests not run. Env-var greps were blocked by the AI-EOS guard, so env names are limited to those read directly.

### Stack
- `@qa/core` 0.1.0, ESM (`"type": "module"`), `tsc` build to `dist/`, `main ./dist/index.js` (packages/core/package.json:4-9). tsconfig extends `../../tsconfig.base.json`, rootDir `src` (packages/core/tsconfig.json).
- Deps: `@napi-rs/keyring`, `@qa/checkers`, `@qa/types` (workspace), `mammoth` 1.12.3 (docx), `playwright` 1.63.0, `pngjs` (package.json:11-16). No test runner declared here; vitest runs from the root (`vitest.config.ts`, new untracked `vitest.workspace.ts`).
- Size: about 21k lines in src (tracked non-test files), 135 test files under tests/ (git ls-files count).

### Entry point and public API
- `src/index.ts:1-73` is a barrel of `export *` over about 60 modules. Exceptions with named exports: `SendGuard, watchSends` (send-guard), `buildIssuesModel, renderIssuesMarkdown` (issues-document), `renderIssuesHtml` (issues-html). Not exported from the barrel: `access-control`, `debug-log`, `flaky-cause`, `not-checked`, `source-wording`, `json-schema-lite`, `visual-capture`, `navigate`, `plan/fill-values`, `plan/selector-order`, `plan/spec-roles`, `plan/sources`, `discovery/{guard,overlay,frontier,crud-facts,interactive-states}`. Tests or runner may deep-import them (verify in S-runner).
- No CLI or server in this package: it is a library consumed by `packages/runner`.

### Modules
| Module | Files | Evidence / role |
|---|---|---|
| Orchestrator | `src/orchestrator.ts` (1661 lines) | `class FlowTestOrchestrator` (:343) holds one instance each of BrowserManager, PreFlightChecker and the checkers (Bug, Spec, UX, Design, Security, SecurityDepth, KeyboardA11y, Performance, Seo) (:344-354). `run(options: RunOptions): Promise<ReleaseReport>` (:356). All emitted events pass through `Redactor.deep` (:362-366). Default output `.qa-report`, with `evidence/` and `auth/` subfolders (:367-370). Expands validation rules into synthetic test cases first (:379). Retry attempts at :687. Exports `OrchestratorEvent` (:83), `RunOptions` (:262), `sitePathOf` (:193), `removeVideosExcept` (:165). |
| Browser / navigation | `browser.ts` (347), `navigate.ts`, `visual-capture.ts`, `retry-runner.ts`, `step-budget.ts`, `send-guard.ts` | Playwright wrapper (BrowserManager) and request-send guard. |
| Preflight | `preflight.ts` (828) | PreFlightChecker: reachability, sign-in and session checks (tests: preflight-*.test.ts). |
| Discovery / spider | `discovery/deterministic-spider.ts` (1196; `DeterministicSpider` :300), `discovery-agent.ts` (911; `DiscoveryAgent` :330, `mergeCrawls` :167, `restoreSession` :302), `frontier`, `element-inventory`, `page-sweep`, `crud-facts`, `interactive-states`, `site-type`, `docs-fetch`, `docx-to-markdown`, `context-parser`, `questions`, `interpret`, `plan-validator`, `safety-filter`, `test-planner`, `guard`, `overlay` | Crawl, element inventory, forms (`readPageForms` :218), safety filtering. |
| Planning | `plan/pipeline.ts` (`PlanPipeline` :50), `plan/build.ts` (`buildPlan` :146, `emptyPlan` :61), `plan/ai-planner.ts` (1202; `planPagesAndMenus` :852, `planBatch` :926, `assemblePlan` :995, `askWithOneRepair` :689, `parseJsonAnswer` :228), `plan/spec-plan.ts` (`planFromSpec` :108), plus `ai-budget`, `expand`, `journeys`, `replan`, `rejects`, `sampling`, `narrow-look`, `site-graph`, `sources`, `markdown`, `playwright-export` (612), `zip` | Builds the Plan (ReviewPlan) from discovery plus an AI Provider; deterministic fallbacks (`fallbackPageTests` :328, `fallbackReasonOf` :740). Exports a Plan as Markdown, Playwright code and zip. |
| AI providers | `ai/ai-provider.ts` (interface `AIProvider` :3, `completeWith` :11, `AITruncatedError` :21, `createAIProvider` :40), `providers/{anthropic,openai,gemini,mock}.ts`, `openrouter.ts` (298), `default-models.ts`, `visual-review.ts` | Factory switch: anthropic, openai and openrouter (OpenAI client with base URL `https://openrouter.ai/api/v1`), gemini, and `mock` as the default for unknown types (ai-provider.ts:40-55). Default models: anthropic `claude-sonnet-5-5`, openai `gpt-4o`, gemini `gemini-3.8-flash`, openrouter `openrouter/free` (default-models.ts:4-9). |
| Key resolver | `ai/key-resolver.ts` (382 lines, uncommitted modification of +257/-22 vs HEAD) | `KeyResolver` (:84). Resolution order: explicit key, then keychain, then encrypted `.qa-keys.json`, then env, for the preferred provider, then anthropic, openai, gemini, openrouter (:153-187). `OsKeychainStore` via `@napi-rs/keyring`, service `qa-flow-tester` (:42,65). The fallback file is AES-256-GCM with scrypt (:1,45); key from env `QA_KEYS_ENCRYPTION_KEY` (:40) or a generated `key-file.key` in a user config dir, not the data dir (:31-34, 46). Service keys (`pagespeed`, env `PAGESPEED_API_KEY`) are handled the same way (:14,23,111-128). Env names for AI keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY (:189-198). Sign-in passwords go to the keychain only, never a file (`saveSecret` :134). Governed by ADR 0034 (untracked). |
| Scoring | `scoring.ts` (235; `scoreToGrade` :40, `calculateSiteAspectGrades` :88, re-exports `ASPECT_CHECKERS` :12), `finding-groups`, `recommendations`, `speed-change`, `suppressions`, `findings-contract` | Grades per aspect from Findings. |
| Reports | `reporter.ts` (363, ReportGenerator), `html-report.ts` (699), `issues-document.ts` (218; `buildIssuesModel` :64, `renderIssuesMarkdown` :182, `pageCoverageLines` :156), `issues-html.ts`, `evidence.ts`, `repro-generator.ts`, `source-locator.ts` | Writes the ReleaseReport, HTML report, issues markdown/HTML, repro scripts. issues-document.ts has a +3 uncommitted diff. |
| Competitive | `competitive/{safe-crawler (522), robots, benchmarking-engine, ux-gap-synthesizer}` | Safe crawl of competitor sites with robots.txt respect, UX gap synthesis. |
| Safety / network | `safe-net.ts`, `address-class.ts`, `domain-verification.ts`, `same-site.ts`, `redact.ts`, `safe-scan.ts`, `access-control.ts` | SSRF/address classes, domain ownership checks, redaction of sign-in details. |
| Other | `site-memory.ts` (368), `site-history.ts`, `live-site.ts`, `post-deploy-smoke.ts`, `api-spec-checks.ts`, `figma-sync.ts`, `account-pool.ts`, `credentials.ts`, `entity-namespacing.ts`, `validator-expander.ts`, `abort.ts`, `debug-log.ts`, `flaky-cause.ts`, `not-checked.ts` | See file names; not read in depth. |

### Data and persistence
- No database. File persistence only: report folder `.qa-report/{evidence,auth}` (orchestrator.ts:367-370), `.qa-keys.json` (key-resolver.ts:95), suppressions, site memory and history under `options.stateDir || outputDir` (orchestrator.ts:376). Atomic JSON writes via `writeJsonAtomic` / `readJsonSafe` (atomic-write.ts:16,35).
- Secrets: OS keychain first; encrypted file only as a fallback.
- Generated code: none checked in under src. `dist/` is build output (ignore).

### Tests
- 135 files in `packages/core/tests/` (vitest, run from the repo root: `pnpm test`, or `pnpm exec vitest run packages/core/tests/<file>`). The package has no own test script.
- Helpers: `tests/helpers/{audit-site-server,issues-fixtures,json-schema-lite,spec-crawl}.ts`; fixture `tests/fixtures/checkindaily`.
- Browser-using tests (spider-*, e2e-*, fixture-*, browser-*) need Chromium. `audit-site-fixture.test.ts` and `audit-site-server.ts` serve `../../../../fixtures/audit-site` (untracked) on 127.0.0.1 (helpers/audit-site-server.ts:6,98).
- Many core tests are modified (uncommitted): auth-crawl-e2e, discovery-agent-headers, e2e-orchestrator, element-inventory, orchestrator-session, plan-validator, spider-form-facts, spider-signin-walls. Untracked: `key-resolver-encryption.test.ts`, `audit-site-fixture.test.ts`.
- Baseline: not run (instructed).

### Health findings
- Size and complexity: `orchestrator.ts` 1661, `ai-planner.ts` 1202, `deterministic-spider.ts` 1196, `discovery-agent.ts` 911, `preflight.ts` 828. Each is a god-file candidate.
- No TODO/FIXME/@ts-ignore/@ts-nocheck in src (Grep returned none). Debt shows up as size, not markers.
- Barrel inconsistency: some modules are not exported while their siblings are (see Entry point). `export *` of about 60 modules risks name collisions. `ai-provider.ts:28-33` re-exports `KeyResolver` and providers while the barrel also does `export *` from `key-resolver.js` (duplicate path, same binding, so allowed).
- `createAIProvider` silently returns `MockAIProvider` for any unknown type (ai-provider.ts:50-52). A bad provider name yields fake AI answers rather than an error.
- `resolveKey` with `explicitKey` and no provider assumes `anthropic` (key-resolver.ts:157).
- Key-resolver security: `forgetSecret` writes an empty string rather than deleting (:150). Key-file secret minimum length 16 (:47). The change is uncommitted and covered by a new, uncommitted test, so review before merge.
- Doc drift check: the model id `claude-sonnet-5-5` and `gemini-3.8-flash` in default-models.ts could not be verified against provider docs.
- `@qa/core` depends on `playwright` 1.63.0 pinned exactly while `mammoth` is pinned; `pngjs` and keyring use caret ranges. Mixed policy, low impact.

### Cross-shard
- `@qa/types` (shared types, plan types, verdict, `AIProviderType`, `ReleaseReport`, `Finding`, `ASPECT_CHECKERS`): used throughout src. Uncommitted changes in `packages/types/src/{ai,aspects,browser,discovery,index,route-telemetry}.ts` and new `website-audit.ts` may affect core compile and the new website-audit work. Build order requires types first.
- `@qa/checkers`: orchestrator.ts:344-354 instantiate Bug/Spec/UX/Design/Security/SecurityDepth/KeyboardA11y/Performance/Seo checkers.
- `packages/runner` consumes the `@qa/core` barrel (HTTP + SSE server, `checkup.ts`), including `KeyResolver`, `FlowTestOrchestrator`, plan pipeline. Runner has new `scan-build-secrets` and `scan-commit-secrets` tests unrelated to core directly.
- `fixtures/audit-site` (untracked) and `fixtures/test-app`: used by core tests (helpers/audit-site-server.ts:6).
- Root: `vitest.config.ts` (modified), `vitest.workspace.ts` (untracked), `.github/workflows/ci.yml` (modified) govern how core tests run.
- Docs: `docs/adr/0033-website-audit-entry-point.md` and `0034-encrypted-key-fallback.md` (both untracked) cover the new work touching types and key-resolver.

<!-- REPO-006 -->
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
<!-- ai-eos:survey:end -->
