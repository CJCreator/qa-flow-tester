# Changelog

All notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/); the project is pre-1.0 and
0.1.0 is the first version; the tag is created by the owner after merge.

## [Unreleased]

### Added

- Export the approved Plan as a Playwright project (zip) from Plan Review (`GET /api/runner/plan/export`); read-only Plans export no submits or Sensitive Actions; sign-in state by path only (T-17)
- `findings.json` contract: `schemaVersion` 1, per-finding `fingerprint`, JSON Schema (`docs/findings.schema.json`), `fix-these.md`, `known-findings.json`, `AGENTS.snippet.md`, and GitHub annotations from the CI command (T-16, ADR 0017)

### Changed

- Sign-in test now names why it failed (wrong details, no sign-in form found, site unreachable or timed out, needs more than a password) and handles two-step and modal sign-ins (T-18)

## [0.1.0] - 2026-10-08

### Added

- Release build workflow on `v*` tags (no publish); generated workflow pins the tool to `v0.1.0` (T-19)
- Docs: ADR 0016 records how sign-in details and secret URL parameters are hidden, what is not covered, and what is planned (T-20)
- Docs: repeatable self Check-up of the landing page (`docs/TESTING.md`) and its summary in `docs/research/` (T-15)
- Landing: areas link to the sample report; light/dark toggle; wake limit configurable (`VITE_WAKE_LIMIT_SECONDS`). New check-up: extra options behind one "More options"; command palette and shortcuts buttons appear after the first check-up. Tests: sample report format check, axe check (T-14)
- Landing: optional cookie-free counter (landing view, start of a check-up, completed check-up), 1200x630 PNG share image, contact link and email-updates control driven by `VITE_COUNTER_URL`, `VITE_CONTACT_EMAIL`, `VITE_SIGNUP_URL` (T-13)
- Verified Domains: a file per exact address (`/.well-known/qa-verify.txt`, token per session), plus DNS-aware, redirect- and rebinding-safe host checks and a per-request browser guard on shared machines; new route `POST /api/runner/domain-proof` (T-12, ADR 0014)
- Beta mode: per-visitor and daily check-up limits (`RUNNER_BETA_RUNS_PER_VISITOR`, `RUNNER_BETA_RUNS_PER_DAY`), in memory, reset at UTC midnight; over a limit the start answers 429 `ERR_BETA_LIMIT` (T-11)
- Entity Namespacing in Tests on a Test Copy: typed values carry a per-run token (same on a retry); read-only checks type values unchanged (T-09)
- "Slower than last time": a page is flagged in the report and `findings.json` when its speed (test browser, throttled median) is worse than the last check-up by 20% and 300 ms; it never changes grades or the verdict (T-10)
- Planted-defect benchmark: detection and false-positive rates, per-site thresholds (`fixtures/benchmarks/thresholds.json`), `.benchmark/summary.md`, non-blocking `benchmark.yml` workflow
- Playwright version check: `scripts/check-playwright-version.mjs` fails CI when the lockfile and the runner Docker image tag differ
- Dependabot (npm, GitHub Actions), `pnpm audit --prod` gate, gitleaks secret scan (`.gitleaks.toml`: allowlists only `fixtures/` and `packages/*/tests/`; not yet run, history may flag the G38 key until rotated), and coverage summary in CI
- ESLint (flat config) and Prettier, `pnpm lint`, `pnpm format:check`; CI runs both
- Task tracking: `docs/tickets/INDEX.md` linked from docs index; `TODO(T-nn)` convention in CONTRIBUTING; ticket flow in AGENT_WORKFLOW
- Deferred verification: hook-enforced test lock, `/verify-all`, `scripts/ship-loop.mjs --verify-at-end`
- Agent pipeline (`.claude/agents`, `/ship`, `/build-next`, `scripts/ship-loop.mjs`) and `docs/AGENT_WORKFLOW.md`
- `CLAUDE.md`, project slash commands (`/check`, `/adr`, `/pr-ready`) and shared `.claude/settings.json`
- Pull request CI (`.github/workflows/ci.yml`) and a pull request template
- Docs: `docs/README.md` index, architecture, configuration, API, testing, deployment; `SECURITY.md`, `CONTRIBUTING.md`

### Changed

- Share image is now a PNG; the SVG reference is gone (T-13)
- On a shared runner a typed test-copy host is read-only until verified (https and a Verified Domain proof, checked at run start and at plan approve); dev tunnel hosts and the `x-test-copy` header no longer make a Test Copy there. Local mode is unchanged (T-12)
- A Test that already sent a form to the checked site is not retried, so a retry cannot create a duplicate record; the failure is reported with a note (G8, T-09)
- A test step whose element is missing now fails within 10 s (was up to ~35 s with retries); set `RUNNER_STEP_TIMEOUT_MS` (or the `stepTimeoutMs` run option) for slow pages
- One-off Prettier format pass over the repo (no behavior change)
- `.env.example`, `docs/PRODUCT_GUIDE.md`, README and the plan status docs rewritten to match the current app (no CLI, Report Hub, PostgreSQL/S3 or dashboard)
- `pnpm/action-setup` pinned to a verified commit SHA (v4.4.0) in `ci.yml`, `deploy.yml`, `qa-check.yml`; `benchmark.yml` and `templates/qa-check.yml` still use `@v4`
- `.gitignore` now shares `.claude/` settings and commands, and ignores only worktrees and local overrides
- CI and the deploy test job now run every package test except `wizard-e2e` (and install Chromium for the browser-driven ones); was a wizard-and-beta subset

### Fixed

- A passed test no longer leaves a stray video behind (the speed check's extra tab was recorded too)

### Removed

- Retired Report Hub client: `core/src/hub-client.ts`, `hub-push.ts`, `outbox-queue.ts`, their re-exports, `core/tests/hub-client.test.ts`, and the hub-only types in `@qa/types` (`OutboxQueueEntry`, `RunManifestInit*`, `RunFinalizeInput`, `EvidenceItemManifest`, `CanonicalFinding`, `ConsolidatedReleaseReport`, `FindingLifecycleStatus`)
- Leftover build output in `packages/cli`, `hub`, `dashboard`; stale `.kilo` worktree copy, `.scratch/wayfinder`, `.playwright-mcp`, `packages/wizard/tmp-shot.mjs`

### Security

- Known audit findings (`pnpm audit --prod --audit-level high`): none
- Removed an API key that had been saved into a local Claude Code permission rule (rotate it if you have not)

<!-- Earlier history: see `git log`. Add a dated section per release, newest first. -->
