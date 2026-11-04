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
