# Testing

Runner: vitest (`vitest.config.ts`), Node environment, tests in `packages/*/tests/**/*.test.ts(x)`.

## Layout

| Package          | What its tests cover                                                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkers/tests` | One file per checker: bug detection and grouping, security, SEO, performance, design/UX, marketing, permission matrix, spec URL patterns                                                                                                                                                     |
| `core/tests`     | Scoring, recommendations, plan building and validation (`test-planner`, `plan-validator`, `complete-plan`, `plan-reuse`), the spider and safety filter, robots and same-site rules, redaction, reports, site memory and history, AI providers, flaky retries, e2e discovery and orchestrator |
| `runner/tests`   | The server (`runner-server`, `wizard-endpoints`, `single-server`), access token, beta mode and privacy, check-ups, URL-first flow, benchmarks, static SEO                                                                                                                                    |
| `types/tests`    | Structural fingerprints                                                                                                                                                                                                                                                                      |
| `wizard/tests`   | Router, translation of plan text, contrast, landing prefill, run start, online wake, and `wizard-e2e` (drives real screens in a browser)                                                                                                                                                     |

`findings.json` is checked against `docs/findings.schema.json` (`core/tests/findings-contract.test.ts`) with a small in-repo validator (`core/tests/helpers/json-schema-lite.ts`, no `ajv`). It supports only `type, required, properties, items, enum, const, pattern, minimum`; a test fails if the schema uses another keyword.

`fixtures/test-app` (`pnpm fixture`, port 3050) is the app the end-to-end tests and the README walkthrough check.

## What to run

| Situation                                      | Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| While editing                                  | `pnpm test:watch`, or `pnpm exec vitest run <file>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Before a pull request                          | `pnpm build` then `pnpm test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Touching URL-first, checkers, scoring, reports | `pnpm test:url-first` (the focused suite)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Before a release                               | everything above, plus `pnpm smoke` and `wizard-e2e.test.ts` (needs Chromium: `pnpm --filter @qa/core exec playwright install chromium`)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CI on pull requests                            | `.github/workflows/ci.yml`: both builds, then every test except `wizard-e2e` (takes minutes). Chromium is installed in CI for the browser-driven tests. The deploy workflow runs the same step. Also prints a coverage summary, runs a `pnpm audit --prod --audit-level high` gate and a gitleaks secret scan of the full history (config: `.gitleaks.toml`, allowlists only `fixtures/` and `packages/*/tests/`; not yet run, so a history hit is possible until the G38 key is rotated). Dependabot (`.github/dependabot.yml`) opens weekly update PRs. |
| Checking detection quality                     | `pnpm build` then `pnpm benchmark --sites fixture --no-ai` (see Planted-defect benchmark)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Touching the landing page                      | see Check-up of our own landing page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Check-up of our own landing page

Prerequisite: `pnpm bootstrap` (all packages built, Chromium installed, `packages/wizard/dist` present). Same syntax in PowerShell and bash.

1. Terminal 1: `pnpm start --no-open` (serves the landing page on http://localhost:3001/).
2. Terminal 2: `node packages/runner/dist/checkup.js http://localhost:3001/ --fail-on none --max-pages 20 --output .tmp-self-checkup`
3. Stop terminal 1 when done.

Notes:

- Read-only: no `--staging`, so nothing is sent from forms. No `QA_AI_API_KEY` is needed; the Plan is the fixed-rule Plan.
- Exit code 0 with `--fail-on none` whatever the verdict; 2 means the Check-up could not run.
- Output goes to `.tmp-self-checkup` (ignored by git): `report.html`, `report.md`, `findings.json`. Copy the verdict and findings into `docs/research/self-checkup-landing.md`.
- The crawl also reaches the app's own routes, which are noindex by design. Treat only findings on `/` and `/sample-report.html` as landing findings.
- Speed numbers are lab measurements on localhost; see `docs/research/lab-lcp-noise.md` before filing a performance finding.
- If port 3001 is busy, set `RUNNER_PORT` and change the URL.

## Exported Playwright project

Plan Review has "Export as Playwright tests" (`GET /api/runner/plan/export`): the approved Plan as a zip with `playwright.config.ts`, one Playwright project per role, `tests/<role>/*.spec.ts` and a README. Sign-in state is a path (`auth/<role>.json`), never a value; see the README inside the zip.

Verify by hand (deferred to `/verify-all`):

1. `pnpm build`, `pnpm fixture` (port 3050), `pnpm start --no-open`.
2. Start a Check-up of `http://localhost:3050` with review on and no AI key.
3. `curl -o t17.zip http://localhost:3001/api/runner/plan/export`; unzip into a new empty directory.
4. In that directory: `npm install`, install Chromium for Playwright, then run its `test` script. Expect no failures (skipped and fixme tests are allowed).

Limits of the export (also in the README of the zip):

- Checkers and findings are not exported, only steps and expectations.
- No fuzzy or quoted-text selector fallback, no closest-option select.
- No Clean Flow Retry, Entity Namespacing, per-step retries or budgets.
- One screen size per test; menu steps appear only through their size.
- AI-judged and AI-guess expectations are comments, not checks.
- URL expectations support the `*` wildcard only, not regular expressions.
- No evidence, screenshots or visual baselines.

## Planted-defect benchmark

Scores the Check-up against sites whose problems are known. This is not the Competitive Benchmark (ADR 0007).

```
pnpm build
pnpm benchmark [--sites fixture,todomvc] [--no-ai] [--score-only]
```

- `--sites`: file names in `fixtures/benchmarks/` without `.json` (default: all). `--no-ai`: no AI journeys; the page sweep and checks still run. `--score-only`: re-score the last run's reports in `.benchmark/<site>/` after labelling an answer key.
- Outputs (not committed): `.benchmark/results.json` (per-site and overall rates, thresholds, failures), `.benchmark/summary.md`, per-site reports in `.benchmark/<site>/`.
- **Detection rate** = planted defects found / planted defects due (defects for later phases are listed, not counted). **False positive rate** = 1 - real / reported = (known false + unlabelled) / reported. Unlabelled issues count as false, so the rate is an upper bound until the answer key is labelled. Labelling a finding as known false does not lower the rate: only a fix or a real label does, so the floor is known noise / reported. Needs-confirmation findings are not counted. The overall rates add up the sites that finished; they are reported, never gated.
- **Thresholds**: `fixtures/benchmarks/thresholds.json`, `{ "sites": { "<site>": { "minDetectionRate", "maxFalsePositiveRate" } } }`. Only listed sites gate. A miss, or an error on a gated site, exits 1; other sites only print a warning. The fixture values are calibrated (2026-10-09: 55 reported, 29 real, rate 0.47, planted 6 of 6; limits 1 and 0.55). Recalibrate when the answer key or the checks change.
- **CI**: `.github/workflows/benchmark.yml` runs `pnpm benchmark --sites fixture --no-ai` manually or weekly, and uploads `.benchmark/` as the `benchmark` artifact. It is never a pull request check and uses no secrets.
- **Optional live targets** (they change or block, so they never gate):
  - Swag Labs: `pnpm benchmark --sites saucedemo`. Runs in product mode with its published public test login from the key file; needs the OpenRouter key, or add `--no-ai`.
  - TodoMVC: `pnpm benchmark --sites todomvc`. Safe-public mode, read-only.

### Record results

Paste a row after each run.

| Date | Commit | Site      | Detection rate | False positive rate | Notes |
| ---- | ------ | --------- | -------------- | ------------------- | ----- |
| 2026-10-09 | working tree (ADR 0020, S11) | fixture   | 6 of 6 | 46% (29 of 54 real) | After fixture additions (admin role, Create user, /slow, docs, saved-session mint). Passed; thresholds unchanged. |
|      |        | saucedemo |                |                     |       |
|      |        | todomvc   |                |                     |       |

## Writing tests

- **Deterministic first.** Scoring, verdicts, safety filters and checkers are pure logic: test them with fixed inputs and exact outputs. Same findings must give the same grades.
- **No real AI calls.** Use `MockAIProvider` (or `TEST_MOCK_AI`). Test the validator and fallbacks with bad AI output rather than hoping for it.
- **No real internet.** Use the fixture app or small local servers; the safety and robots rules should be tested against local pages.
- **Safety changes need a test that fails without them**: a destructive button is skipped, a token is redacted, a private address is refused in beta.
- Name tests after behavior a person would recognize, using glossary terms (`CONTEXT.md`).
- A bug fix starts with a test that reproduces it.
- Visual diff (ADR 0019): `packages/core/tests/visual-capture.test.ts` (stabilise and mask, browser), `visual-baseline-compat.test.ts` (old baselines, sidecar, evidence images; fixture app on port 3087), `html-report-visual.test.ts` (old/new/difference in the Report), `visual-redaction.test.ts`, and `packages/checkers/tests/visual-diff-finding.test.ts`. Select them with the title filter "visual" on the core package.

- Sources, saved sessions and pipelined planning (ADR 0020, 0021): types `judgement-verdict`, `issue-type`; core `context-parser-multi`, `docs-fetch` (local servers), `ai-budget-pacing`, `openrouter-limits`, `preflight-session` and `role-failure-run` (browser, local login server), `ai-planner-sources`, `plan-sources-live-site`, `issues-document`, `issues-html-selfcontained`, `judgement-flow`, `mismatch-wording`, `plan-pipeline`, `group-tracker`, `pipelined-discovery` (browser), `sources-e2e` (browser); runner `sources-endpoints`, `saved-session-secrecy`, `docs-url-beta`, `ai-estimate-cap`, `issues-download`; wizard `context-files`, `session-file`, `cap-estimate`, `plan-sources-view`. Only the files marked browser need Chromium. Sentinel tests plant a fake cookie value and scan every output for it.

## Known fragile areas

- Browser tests depend on the installed Playwright browser; the Playwright version must match the Docker image (`packages/runner/Dockerfile`).
- `wizard-e2e` is slow and can time out on a cold start (see README troubleshooting).
