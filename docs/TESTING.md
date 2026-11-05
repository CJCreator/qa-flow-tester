# Testing

Runner: vitest (`vitest.config.ts`), Node environment, tests in `packages/*/tests/**/*.test.ts(x)`.

## Layout

| Package          | What its tests cover                                                                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkers/tests` | One file per checker: bug detection and grouping, security, SEO, performance, design/UX, marketing, permission matrix, spec URL patterns                                                                                                                                                              |
| `core/tests`     | Scoring, recommendations, plan building and validation (`test-planner`, `plan-validator`, `complete-plan`, `plan-reuse`), the spider and safety filter, robots and same-site rules, redaction, reports, site memory and history, AI providers, flaky retries, discovery and orchestrator (with fakes) |
| `runner/tests`   | The server (`runner-server`, `wizard-endpoints`, `single-server`), access token, beta mode and privacy, check-ups, Competitive Benchmark endpoints, static SEO                                                                                                                                        |
| `types/tests`    | Structural fingerprints                                                                                                                                                                                                                                                                               |
| `wizard/tests`   | Router, translation of plan text, contrast, landing prefill, run start, online wake                                                                                                                                                                                                                   |

`findings.json` is checked against `docs/findings.schema.json` (`core/tests/findings-contract.test.ts`) with a small in-repo validator (`core/tests/helpers/json-schema-lite.ts`, no `ajv`). It supports only `type, required, properties, items, enum, const, pattern, minimum`; a test fails if the schema uses another keyword.

## Test tiers

`vitest.workspace.ts` splits the files into two projects. Select one with `--project <name>`.

| Tier      | Command             | What it runs                                                                                 | Needs                  | When it runs                                              |
| --------- | ------------------- | -------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------- |
| `unit`    | `pnpm test`         | No website and no browser. Fake pages, recorded or in-memory inputs, local API sockets only  | Node only, no Chromium | Every pull request (2 shards), the deploy workflow, local |
| `browser` | `pnpm test:browser` | Launches Chromium on `setContent` or `context.route().fulfill()` pages only; never a website | Chromium               | Nightly (`.github/workflows/e2e-nightly.yml`), local      |

`pnpm test:all` runs both. There is no end-to-end tier. Run one file with `pnpm exec vitest run <file>`; a file belongs to the tier whose list in `vitest.workspace.ts` names it (unlisted files are `unit`).

**Rule: no fabricated websites.** The repo has no fixture site and no test starts a site: no `fixtures/` app, no inline `http.createServer` page to crawl. A new test must not add one. Use the fake `{ evaluate }` Page for checkers, recorded inputs through `AuditPipelineDeps.readPage`, `NetDeps` / `fakeNet()` for network paths, and `setContent` or `context.route().fulfill()` when a real DOM is needed. Reasons: [ADR 0040](adr/0040-test-tiers-no-fabricated-websites.md).

## Checking against real websites

Behaviour that needs a whole site is checked by hand against real websites, not by tests. Pick a public site you may scan (read-only, no `--staging`), or your own staging App:

- `pnpm build`, then `pnpm start --no-open`, or `node packages/runner/dist/checkup.js <url> --fail-on none --max-pages 20 --output .tmp-checkup`.
- Read the Plan, the Report and `findings.json`; compare with what you know about the site.
- Do this before a release, and after changes to the areas below.

Areas with no automated coverage since the fixture sites were removed: Spider crawling of a whole site, sign-in and saved sessions end to end, discovery to Plan to run, the Website Audit crawl, and the wizard end to end (screens driven in a browser). The pure logic inside them (frontier, safety filter, robots, Plan building, scoring, reports, endpoints with fakes) is still unit tested.

## What to run

| Situation                 | Command                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| While editing             | `pnpm test:watch`, or `pnpm exec vitest run <file>`                                                                                                                                                                                                                                                                                                                                                                                           |
| Before a pull request     | `pnpm build` then `pnpm test` (unit tier, no Chromium)                                                                                                                                                                                                                                                                                                                                                                                        |
| Before a release          | `pnpm test:all`, plus `pnpm smoke` and the real-website check above (browser tests need Chromium: `pnpm --filter @qa/core exec playwright install chromium`)                                                                                                                                                                                                                                                                                  |
| CI                        | Pull requests (`.github/workflows/ci.yml`): both builds, then the `unit` project only, in 2 shards, no Chromium install. The deploy workflow tests with `unit` too. Nightly (`.github/workflows/e2e-nightly.yml`): `test:browser`. Also prints a coverage summary, runs non-blocking `pnpm typecheck`, `pnpm audit --prod --audit-level high` gate and a gitleaks secret scan. Dependabot (`.github/dependabot.yml`) opens weekly update PRs. |
| Touching the landing page | see Check-up of our own landing page                                                                                                                                                                                                                                                                                                                                                                                                          |

### Verifying a change

Run only the changed or failing files: `pnpm exec vitest run <file> [<file>...]`. For browser tests (Chromium) add `--no-file-parallelism`. A parallel `pnpm test:browser` or `pnpm test:all` can time out under load; if a browser test times out there, re-run that file alone before treating it as a failure.

### Check-up of our own landing page

Prerequisite: `pnpm bootstrap` (all packages built, Chromium installed, `packages/wizard/dist` present). Same syntax in PowerShell and bash.

1. Terminal 1: `pnpm start --no-open` (serves the landing page on http://localhost:3001/).
2. Terminal 2: `node packages/runner/dist/checkup.js http://localhost:3001/ --fail-on none --max-pages 20 --output .tmp-self-checkup`
3. Stop terminal 1 when done.

Notes:

- Read-only: no `--staging`, so nothing is sent from forms. No `QA_AI_API_KEY` is needed; the Plan is the fixed-rule Plan.
- Exit code 0 with `--fail-on none` whatever the verdict; 2 means the Check-up could not run.
- Output goes to `.tmp-self-checkup` (ignored by git): `report.html`, `report.md`, `findings.json`. Paste the verdict and the landing findings into the pull request or a ticket.
- The crawl also reaches the app's own routes, which are noindex by design. Treat only findings on `/` and `/sample-report.html` as landing findings.
- Speed numbers are lab measurements on localhost; see `docs/research/lab-lcp-noise.md` before filing a performance finding.
- If port 3001 is busy, set `RUNNER_PORT` and change the URL.

## Exported Playwright project

Plan Review has "Export as Playwright tests" (`GET /api/runner/plan/export`): the approved Plan as a zip with `playwright.config.ts`, one Playwright project per role, `tests/<role>/*.spec.ts` and a README. Sign-in state is a path (`auth/<role>.json`), never a value; see the README inside the zip.

Verify by hand (deferred to `/verify-all`):

1. `pnpm build`, `pnpm start --no-open`.
2. Start a Check-up of a real site you may scan (or your own staging App) with review on and no AI key.
3. `curl -o t17.zip http://localhost:3001/api/runner/plan/export`; unzip into a new empty directory.
4. In that directory: `npm install`, install Chromium for Playwright, then run its `test` script. Expect no failures (skipped and fixme tests are allowed).
5. For the Rejects check, use a site with a sign-up form and open the generated Rejects spec: it calls `expectRefused`. A form that refuses bad input passes; a form that accepts anything fails as accepted (a toast with no `role` is not a signal, a documented limit).

## Intent and refusal rule (ADR 0024)

Tests, by area (browser tests need Chromium; add `--no-file-parallelism`):

- Intent and saved Plans: `packages/types/tests/intent.test.ts`, `intent-types.test.ts`, `issue-type.test.ts`; `packages/core/tests/plan-intent-compat.test.ts`; `packages/wizard/tests/plan-sources-view.test.ts` (a legacy item shows as Denied).
- Rejects and Limits planning, gating, cap: `packages/core/tests/rejects-plan.test.ts`, `rejects-gating.test.ts`, `ai-planner-limits.test.ts`, `spider-form-facts.test.ts`. Also core `expand-intents-off.test.ts`, `spider-crud.test.ts`, `crud-facts.test.ts`, `refusal-verdict.test.ts`, `refusal-run.test.ts`, `refusal-parity.test.ts`, `test-cap.test.ts`, `intent-question.test.ts`; checkers `refusal-rule.test.ts`; runner `test-cap-endpoints.test.ts`; wizard `intent-view.test.ts`, `no-banned-words.test.ts`.
- Refusal rule and export: `packages/checkers/tests/refusal-rule.test.ts` (browser), `packages/core/tests/playwright-export.test.ts`, `refusal-parity.test.ts` (the exported helper and the checker agree), `refusal-run.test.ts`, `opening-missing.test.ts`.
- Spider deep exploration and CRUD facts: `packages/core/tests/interactive-states.test.ts`, `crud-facts.test.ts` (browser/pure). The safety case (mutating requests aborted during the Delete probe) must fail without the guard.

Limits of the export (also in the README of the zip):

- Checkers and findings are not exported, only steps and expectations.
- No fuzzy or quoted-text selector fallback, no closest-option select.
- No Clean Flow Retry, Entity Namespacing, per-step retries or budgets.
- One screen size per test; menu steps appear only through their size.
- AI-judged and AI-guess expectations are comments, not checks.
- URL expectations support the `*` wildcard only, not regular expressions.
- No evidence, screenshots or visual baselines.

## Writing tests

- **Deterministic first.** Scoring, verdicts, safety filters and checkers are pure logic: test them with fixed inputs and exact outputs. Same findings must give the same grades.
- **No real AI calls.** Use `MockAIProvider` (or `TEST_MOCK_AI`). Test the validator and fallbacks with bad AI output rather than hoping for it.
- **No real internet, no fabricated website.** Unit tests use fake Pages, recorded inputs and `fakeNet()`; browser tests use `setContent` or `context.route().fulfill()`. Real sites are checked by hand.
- **Safety changes need a test that fails without them**: a destructive button is skipped, a token is redacted, a private address is refused in beta.
- Name tests after behavior a person would recognize, using glossary terms (`CONTEXT.md`).
- A bug fix starts with a test that reproduces it.
- Visual diff (ADR 0019): `packages/core/tests/visual-capture.test.ts` (stabilise and mask, browser), `visual-baseline-compat.test.ts` (old baselines, sidecar, evidence images), `html-report-visual.test.ts` (old/new/difference in the Report), `visual-redaction.test.ts`, and `packages/checkers/tests/visual-diff-finding.test.ts`. Select them with the title filter "visual" on the core package.

- Sources, saved sessions and pipelined planning (ADR 0020, 0021): types `judgement-verdict`, `issue-type`; core `context-parser-multi`, `docs-fetch` (local servers), `ai-budget-pacing`, `openrouter-limits`, `preflight-session` and `role-failure-run` (browser), `ai-planner-sources`, `plan-sources-live-site`, `issues-document`, `issues-html-selfcontained`, `judgement-flow`, `mismatch-wording`, `plan-pipeline`, `group-tracker`, `pipelined-discovery` (browser), `sources-e2e` (browser); runner `sources-endpoints`, `saved-session-secrecy`, `docs-url-beta`, `ai-estimate-cap`, `issues-download`; wizard `context-files`, `session-file`, `cap-estimate`, `plan-sources-view`. Word and document-driven fixed-rule planning (ADR 0023): types `context-parse`; core `context-parser-structures`, `docx-to-markdown`, `spec-plan`, `spec-fixtures-sources`, `spec-fixtures-no-secrets`, `spec-plan-integration`; runner `context-docx-route`, `run-inputs-docx`, `checkup-docs`; wizard `context-read-report`, `import-roles`. Only the files marked browser need Chromium. Sentinel tests plant a fake cookie value and scan every output for it.

## Browser requirement and baseline

- `pnpm bootstrap` installs the Chromium build the installed Playwright expects (`playwright install chromium`, run from `@qa/core`), then `scripts/check-browser.mjs` fails if the launch path is not that build (`chromium_headless_shell-<rev>`, the revision in Playwright's `browsers.json`). Playwright stays pinned (1.63.0, see the Docker image); do not bump it to fix a browser error.
- Browser tests need that build on the machine. An `Executable doesn't exist` error means the build is missing or `PLAYWRIGHT_BROWSERS_PATH` points elsewhere: run `pnpm --filter @qa/core exec playwright install chromium`, then `node scripts/check-browser.mjs`.
- Tests create the `.tmp-*` folders they write to themselves; there is no global setup file.
- Baseline (2026-10-21, sandbox, historical): 234 files, 1736 tests. The suite now has 366 files (2026-11-04: 122 `browser`, about 244 `unit` before the tier moves). Most failures then were browser launch errors from a Playwright build mismatch (expected `chromium_headless_shell-1243`, sandbox had `-1194`); linking the browser paths fixed them.

## Known fragile areas

- Browser tests depend on the installed Playwright browser; the Playwright version must match the Docker image (`packages/runner/Dockerfile`).
