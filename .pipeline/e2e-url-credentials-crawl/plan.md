# Plan: URL + test credentials -> crawl -> all issues

## Context
Most of this exists already (NewCheckupScreen, POST /api/runner/run, preflight sign-in, DeterministicSpider, orchestrator, issues document). Remaining gap: on a live (non-test) host the run is read-only, a wrong password does not stop the crawl, crawl coverage is not reported, and `checkup.ts` has no credentials input. You chose "credentials = consent" (spec Q1b). Specs: `.pipeline/e2e-url-credentials-crawl/{recon,spec}.md`.

Baseline: 23 tests failing in 17 files (wizard-e2e among them); full list was not captured. Re-baseline per file before coding.

## Design
One rule change in `packages/runner/src/server.ts` `executeRun` (~L2846-2849):
```ts
const consent = !this.beta && body.signInConsent === true && roles.some(r => r.username && r.password);
const readOnly = !(owner && (testHost || consent));
```
- `isTestHost` / `resolveTestHost` unchanged (pure address rules).
- Consent is per run, never saved to site memory (a later run without credentials stays read-only).
- Shared online copy (`RUNNER_BETA=1`): consent ignored, ADR 0014 rule kept (needs marked test copy + Verified Domain). Recommended; tell me if you want otherwise.
- Sensitive Actions stay blocked (SafetyFilter; `applySafeAnswers` under skipReview). Security Probes still need a Test Copy.
- Shared-machine re-check at approve (server.ts ~L4444-4454) must not undo consent.

## Steps
1. ADR `docs/adr/0022-test-sign-in-as-consent.md`; note in ADR 0014 and CONTEXT.md (Test Copy). Scope, limits above, consent never remembered.
2. Types: optional `pageCoverage {found, reached, skipped[{urlPath, why}]}` on `ReleaseReport` (`types/src/run-report.ts`), browser-safe.
3. Fail fast: export `SignInFailedError` from `core/src/preflight.ts`; `requireSignIn` option in `discovery-agent.ts` throws before the crawl on any `roleFailures`. Test `core/tests/require-sign-in.test.ts`.
4. Coverage: spider records load failures and queue left at page cap (`deterministic-spider.ts`); `describeExploration` computes found/reached/skipped. Test `core/tests/page-coverage.test.ts`.
5. Server: accept `signInConsent`, apply rule, `requireSignIn`, report note when consent applied, `signInReason` on RUN_FAILED, pass coverage to report. Test `runner/tests/credentials-crawl.test.ts` (live host via `hostAliases` pattern from `url-first.test.ts`): interacts only after sign-in, no Sensitive Actions, beta ignores consent, wrong password = no crawl, password absent from run dir/SSE/console, reached = siteMap pages, every Plan Item has a result.
6. Issues document: `pageCoverageLines()` beside `rolesNotTestedLines` in `core/src/issues-document.ts` (md + html).
7. Wizard: username/password under URL (`NewCheckupScreen.tsx`, `lib/form.ts`, `api.ts`, `lib/translate.ts`); consent notice with explicit acknowledgement, "Show me the plan first" opt-in, "Only look at it instead" link. Sends `owner: true, signInConsent, skipReview: !reviewFirst`. Keep wizard imports to single `@qa/types/src/...` modules.
8. Headless: `checkup.ts` reads `QA_USERNAME`, `QA_PASSWORD`, `QA_LOGIN_PATH` from env only (no password flag); never printed. Update `.env.example` (names only), `docs/CONFIGURATION.md`, `docs/API.md`, `SECURITY.md`. Test `runner/tests/checkup-credentials.test.ts`: headless Issue fingerprints equal API run (AC5).
9. Update existing tests that assert read-only on live hosts only where the new rule applies (`url-first.test.ts`, `host-policy.test.ts`); do not weaken them.

## Reuse
`blockChanges`/`isTestHost` (`core/src/live-site.ts`), `PreFlightChecker.signIn`, `signInReasonText`, `Redactor`, fixture server + login stub (`core/tests/preflight-session.test.ts`), `core/tests/helpers/issues-fixtures.ts`, `scripts/benchmark*.ts`.

## Risks (accepted by you: weaker safety model)
- Credentials do not prove ownership; a user can point at a third-party production site. Mitigation: explicit UI acknowledgement, local-only, Safety Filter, host confinement, robots unchanged.
- With consent, `blockChanges` (blocks all POST/PUT/PATCH/DELETE) is not applied, so interaction is real. Destructive GET links and GraphQL mutations over POST are only caught by the Safety Filter's word guess. Deliberate; documented in the ADR.
- No mid-crawl session-expiry re-login (out of scope); pages after expiry are reported as skipped.
- Mixed Playwright versions (core 1.63.0 confirmed; wizard ^1.63.0); `check-playwright-version` in CI covers it.
- Never set `saveStorageStatePath` on this path.

## Verification
`pnpm build`, `pnpm lint`, `pnpm format:check`; run only new/changed test files while iterating (`pnpm exec vitest run <files>`), unique ports per new test; full run with `--reporter=json` and diff failing-file set against re-baseline (must be identical, new tests green); `pnpm benchmark` on the fixture with credentials (AC1); manual: start `pnpm start`, run fixture via wizard with URL + credentials. Test mapping per AC is in the pipeline plan.md.

## Branch
`feat/e2e-url-credentials-crawl`; commits per step; no push to main.
