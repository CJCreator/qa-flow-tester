# Impact / regression: URL + test credentials crawl

## Baseline vs after
| | Tests failed / total | Failing files |
|---|---|---|
| Baseline (HEAD efd62a9, parallel full run) | 13 / 1069 (an earlier run: 23) | 6: keyboard-a11y, security, e2e-discovery, saved-session-secrecy, url-first (2), wizard-e2e (9) |
| After (parallel full run) | 24 / 1116 | 17, mostly timeouts under load |
| After, failing files re-run serially (`--no-file-parallelism`) | 0 / 119 | none (e2e-orchestrator, plan-validator, wizard-endpoints, runner-server, consent-enforcement, page-coverage, spider-site-edge, performance, keyboard-a11y, url-first, saved-session-secrecy, e2e-discovery, browser-guard, narrow-look, signin, security) |
| Not re-verified | | wizard-e2e (9 failures at baseline and after; browser) |

Parallel full runs on this machine are load-flaky: the same code gave 13, 23 and 24 failures. Files that failed at baseline (url-first, saved-session-secrecy, e2e-discovery) also pass serially. No regression found; wizard-e2e unverified.

## Dependents checked (read-only impact analysis + code review)
- Exported signatures: new fields are optional (RunOptions.requireSignIn/pageCoverage/authDir, discover requireSignIn, SpiderResult.skipped, RunnerServer authDir, TriggerRunBody.signInConsent). `resolveReadOnly` is new, requires `ownerExplicit`; all callers pass it. `pnpm build` passes (type-check).
- RUN_FAILED: `signInReason` only added for SignInFailedError; wizard translate falls back for unknown values; new `code` values ERR_SIGN_IN_FAILED / ERR_SIGN_IN_REQUIRED.
- Site memory: consent runs no longer write `owner`; non-consent flows (goDeeper, Test again, resume) write as before. `staging` is still saved if the person sent it.
- Config: `.env.example` names only (QA_USERNAME, QA_PASSWORD, QA_LOGIN_PATH, QA_CHECKUP_PORT); docs updated. `qa-check.yml` NOT changed (documented as a manual step).
- Migrations, global styles, event names: none changed.
- Smoke: `pnpm start` serves /healthz 200 and the wizard 200.

## Known risks
1. Safety model weakened by decision (ADR 0022): sign-in details do not prove ownership; with consent, the block-all-changes filter is off. GET-based deletes and POST mutations are caught only by the Safety Filter's word check.
2. Wizard approve after restart: re-entered role is always named `member`; the re-enter form has no component test.
3. `checkups.test.ts` uses port 3601 which equals the check-up default; parallel runs on that port may clash.
4. `form.ts` and ~48 other files fail `format:check` at the base commit (pre-existing). Files this branch introduced or broke were formatted.
5. wizard-e2e and a live-site (non-fixture) run were not executed.
