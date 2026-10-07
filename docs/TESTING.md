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

## Planted-defect benchmark

Scores the Check-up against sites whose problems are known. This is not the Competitive Benchmark (ADR 0007).

```
pnpm build
pnpm benchmark [--sites fixture,todomvc] [--no-ai] [--score-only]
```

- `--sites`: file names in `fixtures/benchmarks/` without `.json` (default: all). `--no-ai`: no AI journeys; the page sweep and checks still run. `--score-only`: re-score the last run's reports in `.benchmark/<site>/` after labelling an answer key.
- Outputs (not committed): `.benchmark/results.json` (per-site and overall rates, thresholds, failures), `.benchmark/summary.md`, per-site reports in `.benchmark/<site>/`.
- **Detection rate** = planted defects found / planted defects due (defects for later phases are listed, not counted). **False positive rate** = 1 - real / reported = (known false + unlabelled) / reported. Unlabelled issues count as false, so the rate is an upper bound until the answer key is labelled. Needs-confirmation findings are not counted. The overall rates add up the sites that finished; they are reported, never gated.
- **Thresholds**: `fixtures/benchmarks/thresholds.json`, `{ "sites": { "<site>": { "minDetectionRate", "maxFalsePositiveRate" } } }`. Only listed sites gate. A miss, or an error on a gated site, exits 1; other sites only print a warning. The first values are uncalibrated: calibrate them from the first real run at `/verify-all`.
- **CI**: `.github/workflows/benchmark.yml` runs `pnpm benchmark --sites fixture --no-ai` manually or weekly, and uploads `.benchmark/` as the `benchmark` artifact. It is never a pull request check and uses no secrets.
- **Optional live targets** (they change or block, so they never gate):
  - Swag Labs: `pnpm benchmark --sites saucedemo`. Runs in product mode with its published public test login from the key file; needs the OpenRouter key, or add `--no-ai`.
  - TodoMVC: `pnpm benchmark --sites todomvc`. Safe-public mode, read-only.

### Record results

Paste a row after each run.

| Date | Commit | Site      | Detection rate | False positive rate | Notes |
| ---- | ------ | --------- | -------------- | ------------------- | ----- |
|      |        | fixture   |                |                     |       |
|      |        | saucedemo |                |                     |       |
|      |        | todomvc   |                |                     |       |

## Writing tests

- **Deterministic first.** Scoring, verdicts, safety filters and checkers are pure logic: test them with fixed inputs and exact outputs. Same findings must give the same grades.
- **No real AI calls.** Use `MockAIProvider` (or `TEST_MOCK_AI`). Test the validator and fallbacks with bad AI output rather than hoping for it.
- **No real internet.** Use the fixture app or small local servers; the safety and robots rules should be tested against local pages.
- **Safety changes need a test that fails without them**: a destructive button is skipped, a token is redacted, a private address is refused in beta.
- Name tests after behavior a person would recognize, using glossary terms (`CONTEXT.md`).
- A bug fix starts with a test that reproduces it.

## Known fragile areas

- Browser tests depend on the installed Playwright browser; the Playwright version must match the Docker image (`packages/runner/Dockerfile`).
- `wizard-e2e` is slow and can time out on a cold start (see README troubleshooting).
