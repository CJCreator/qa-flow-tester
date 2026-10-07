# Changelog

All notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/); the project is pre-1.0 and
versions are not yet tagged.

## [Unreleased]

### Added

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

- One-off Prettier format pass over the repo (no behavior change)
- `.env.example`, `docs/PRODUCT_GUIDE.md`, README and the plan status docs rewritten to match the current app (no CLI, Report Hub, PostgreSQL/S3 or dashboard)
- `pnpm/action-setup` pinned to a verified commit SHA (v4.4.0) in `ci.yml`, `deploy.yml`, `qa-check.yml`; `benchmark.yml` and `templates/qa-check.yml` still use `@v4`
- `.gitignore` now shares `.claude/` settings and commands, and ignores only worktrees and local overrides
- CI and the deploy test job now run every package test except `wizard-e2e` (and install Chromium for the browser-driven ones); was a wizard-and-beta subset

### Removed

- Retired Report Hub client: `core/src/hub-client.ts`, `hub-push.ts`, `outbox-queue.ts`, their re-exports, `core/tests/hub-client.test.ts`, and the hub-only types in `@qa/types` (`OutboxQueueEntry`, `RunManifestInit*`, `RunFinalizeInput`, `EvidenceItemManifest`, `CanonicalFinding`, `ConsolidatedReleaseReport`, `FindingLifecycleStatus`)
- Leftover build output in `packages/cli`, `hub`, `dashboard`; stale `.kilo` worktree copy, `.scratch/wayfinder`, `.playwright-mcp`, `packages/wizard/tmp-shot.mjs`

### Security

- Known audit findings (`pnpm audit --prod --audit-level high`): none
- Removed an API key that had been saved into a local Claude Code permission rule (rotate it if you have not)

<!-- Earlier history: see `git log`. Add a dated section per release, newest first. -->
