# Changelog

All notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/); the project is pre-1.0 and
0.1.0 is the first version; the tag is created by the owner after merge.

## [Unreleased]

### Removed

- Finished `.pipeline/e2e-url-credentials-crawl` records, unused `yaml` dependency from `@qa/core`, duplicate `.gitignore` lines

### Added

- Removed every fabricated website (`fixtures/`, `pnpm fixture`, the planted-defect benchmark) and the tests that used one; two test tiers: `pnpm test` runs only the fast `unit` project (no website, no Chromium), `test:browser` and `test:all` added; pull requests and deploys run `unit` only, browser tests run nightly; real sites are checked by hand (ADR 0040)
- Owner can create, pause and delete scheduled Check-ups on the hosted copy; they run from Google Cloud Scheduler, which proves itself with a Google token, never the access key (ADR 0039). Scheduled Check-ups now record `passed` when the run finishes, not when it starts
- Intent on Plan Items (Works, Rejects, Limits, Denied); Rejects planned from form attributes by fixed rules (no AI key needed); Limits from the AI Planner or a Source; the refusal rule shared by the Check-up and the Playwright export (`expectRefused`); Rejects and Limits wait for a Test Copy or sign-in consent; Ambiguity Questions for Sensitive submits (ADR 0024)
- Test cap (default 2000; `testCap` in the API, `--test-cap` in the CI command): Rejects and Limits past it are switched off and counted in the approval summary; Plan Review has a filter chip and one switch-off per Intent, with counts
- Spider deep exploration of tabs, accordions, drawers and modals (opening steps stored on the Plan Item, shown in Plan Review, replayed by the export), CRUD facts from structure, and a guarded Delete probe that cancels at the confirm (ADR 0025)
- Word (.docx) Product Context; structured reading of tables, numbered steps, flow diagrams and User Flows; Plan Items from your documents written by fixed rules when there is no AI key (User Flows, route access and Denial items, each with its Source; unmatched steps and free-text expectations under "Needs your judgement"); per-document read feedback; Import roles; CLI `--docs` and several roles (ADR 0023)
- Sources: Plan Items link to the document they came from (name, section); roles are proposed and confirmed in Plan Review; Product Context takes several .md/.txt files and a docs URL (ADR 0020)
- Denial Plan Items (a role that should not see a control is checked read-only) and "Not found in app" with a reason; the report says "N of M documented items reached" (ADR 0020)
- "Needs your judgement" section: logical-flow guesses by the AI sit apart and do not change the verdict or grades until accepted (ADR 0020)
- Issues document (`issues.md`, `issues.html`): per role, by issue type, self-contained, screenshots embedded (ADR 0020, ADR 0021)
- Per-role sign-in failure with a plain reason ("Roles not tested and why"; a failed role no longer runs signed out) and saved sessions held in memory only (ADR 0021)
- Planning starts while the scan runs; items planned early are never changed, later ones are marked as added after the scan (ADR 0020)
- The AI Request Budget follows the provider's reported limits, runs requests in parallel only when allowed, and takes an optional request or dollar cap per Check-up (dollars only when the provider reports a price)
- Perceptual Visual Diff steadier and visible: page stabilised before capture, dates, ads and password fields masked in new baselines, old/new/difference images in the single-file HTML report; existing baselines compare as before (T-21, ADR 0019)
- Export the approved Plan as a Playwright project (zip) from Plan Review (`GET /api/runner/plan/export`); read-only Plans export no submits or Sensitive Actions; sign-in state by path only (T-17)
- `findings.json` contract: `schemaVersion` 1, per-finding `fingerprint`, JSON Schema (`docs/findings.schema.json`), `fix-these.md`, `known-findings.json`, `AGENTS.snippet.md`, and GitHub annotations from the CI command (T-16, ADR 0017)
- Keyboard checks (Tab reach, focus not obscured, focus trap) and a 320 px reflow check; security depth: missing integrity attribute on other-site scripts and styles, reachable source maps, `security.txt`, weaker Content-Security-Policy settings. All passive, same site only (T-22)

### Changed

- Denial Plan Items are now Intent Denied (`intent: 'denied'` replaces `kind: 'denial'`); saved Plans and site memory with the old value still load (ADR 0024)
- The CI command takes Product Context with `--docs` (or `QA_DOCS`); a docs URL still works in the wizard and runner only
- "N of M documented items reached" counts User Flows, routes and negative specs once any exist, not plain headings (ADR 0023)
- Wizard text-file cap is 500 KB (was 1 MB), matching the runner

- Sign-in test now names why it failed (wrong details, no sign-in form found, site unreachable or timed out, needs more than a password) and handles two-step and modal sign-ins (T-18)
- Internal: Check-up Session module (`session/`) and modular Route Table (`routes/`) in `@qa/runner`. The session owns one Check-up's state and operations (Plan under review, run slot, report, event log, run secrets) while policy and transport stay in the server; plan routes are registered in the route table as standalone functions over the session, and CLI check-ups run directly on the session without binding a port (ADR 0027, T-201–T-211)
- Internal: split packages/types/src/index.ts into area files; exports unchanged (T-23a)
- Fixture benchmark: every finding is labelled in the answer key (real, or known noise), fixture pages got a viewport, icon, description and h1, the fixture's sitemap address follows its port, and thresholds are calibrated
- `robots.txt` is now actually honoured: the crawl asks the policy about each route's path and query (it was asking about the full address, so no `Disallow` rule ever matched) and names the pages it left alone in the politeness note. This changes what a Check-up of a live site contains
- A start address that answers 404 (any 4xx) is now flagged next to the address before the Check-up starts, instead of being shown as fine. A 401/403 still reads as reachable, because a site that asks for a sign-in is a real site
- The pre-flight result no longer claims what was not checked: a Role is reported as signed in only when its sign-in ran and succeeded, so a caller with no browser can no longer see every Role as verified, and `loginReachable` is true only when the sign-in page actually answered

### Fixed

- A document's description fell back to its heading; it is now the first prose line, or empty
- A page that shows a password field for its own reasons is no longer mistaken for a sign-in page: a change-password form, a two-factor step, or a page reached through a redirect, a trailing slash or different casing is now crawled and appears in the Plan, and the "these pages ask for a sign-in" note no longer names it. The pages in that note and in the coverage list are now the paths as asked for, not internal route keys, so they can be opened
- A session restored mid-crawl no longer leaves a hole: the route that triggered the recovery is retried and gets its own row in the crawl's route table, and restoring a session puts back cookies **and** `localStorage`, so an App that keeps its token in `localStorage` recovers as well

## [0.1.0] - 2026-10-08

### Added

- Release build workflow on `v*` tags (no publish); generated workflow pins the tool to `v0.1.0` (T-19)
- Docs: ADR 0016 records how sign-in details and secret URL parameters are hidden, what is not covered, and what is planned (T-20)
- Docs: repeatable self Check-up of the landing page (`docs/TESTING.md`) (T-15)
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
- `.gitignore` ignores `.claude/` (local only) and all `.tmp-*` files
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
