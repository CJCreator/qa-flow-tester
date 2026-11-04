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
