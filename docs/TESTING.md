# Testing

Runner: vitest. Node environment, 30 s test and hook timeouts, tests in `packages/*/tests/**/*.test.ts(x)` (`vitest.config.ts`). Worker count is one per 4 GB of memory, at most CPUs minus one; `--maxWorkers` overrides it.

## Tiers

`vitest.workspace.ts` assigns every test file to one project. Select one with `--project <name>`.

| Tier      | Command             | Runs                                                                                                                | Needs    | Where                                                                                                                  |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `unit`    | `pnpm test`         | No Chromium, no external network: fake pages, in-memory inputs. A loopback server on an OS-assigned port is allowed | Node     | Pull requests (`ci.yml`, 2 shards), `deploy.yml` before publishing, local                                              |
| `browser` | `pnpm test:browser` | Chromium on `setContent` or `route().fulfill()` pages, alone or through a started runner; never a site              | Chromium | Nightly (`e2e-nightly.yml`, 4 shards) and on pull requests that touch browser code (`browser-pr.yml`, 4 shards), local |

`pnpm test:all` runs both. A file is `browser` only if the `BROWSER_TESTS` list in `vitest.workspace.ts` names it; every other file is `unit`. Add a file to that list when it launches Chromium. A unit test may start a `RunnerServer` or an `http.createServer` stub on `127.0.0.1`, on a port the OS picks (`packages/runner/tests/helpers/free-port.ts`, or `listen(0)`), never on a fixed port.

Other commands: `pnpm test:watch`; one file: `pnpm exec vitest run <file>`; `pnpm typecheck` (`tsc -p tsconfig.test.json --noEmit`, includes tests; blocking in `ci.yml`); `pnpm test:plugin` (the `plugins/repo-orchestrator` checks; blocking in `ci.yml`).

`release.yml` runs `pnpm exec vitest run --project unit` (the unit tier; the browser tier runs nightly).

## No fabricated websites

No fixture site, no inline `http.createServer` page to crawl. Do not add one ([ADR 0040](adr/0040-test-tiers-no-fabricated-websites.md)). A loopback stub that answers one fetch-level check, with no Chromium and no crawl, is not a fabricated website. Use:

- a fake `{ evaluate }` Page for checkers;
- recorded inputs and fakes for network paths (`fakeNet()` in `packages/core/tests/audit-pagespeed.test.ts`);
- `setContent` or `context.route().fulfill()` when a real DOM is needed.

## Checking against real websites

Whole-site behavior is checked by hand: Spider crawl, sign-in and saved sessions end to end, discovery to Plan to run, the Website Audit crawl, the wizard driven in a browser. Do it before a release and after changes there. Pick a public site you may scan, or your own staging App.

1. `pnpm build`, then `pnpm start --no-open` (http://localhost:3001; `RUNNER_PORT` changes the port), or run the CI entry point directly: `node packages/runner/dist/checkup.js <url> --fail-on none --max-pages 20 --output .tmp-checkup`.
2. Read the Plan, the Report and `findings.json`; compare with what you know of the site.

Without `--staging` a Check-up is read-only. Exit code is 0 with `--fail-on none`; 2 means it could not run. Without `QA_AI_API_KEY` the Plan is the fixed-rule Plan.

### Our own landing page

After `pnpm bootstrap`:

1. Terminal 1: `pnpm start --no-open`.
2. Terminal 2: `node packages/runner/dist/checkup.js http://localhost:3001/ --fail-on none --max-pages 20 --output .tmp-self-checkup`.

Output (`report.html`, `report.md`, `findings.json`) lands in `.tmp-self-checkup`, which git ignores. The crawl also reaches the app's own routes, which are noindex by design: treat only findings on `/` and `/sample-report.html` as landing findings. Speed numbers are lab numbers on localhost.

## What to run

| Situation             | Command                                                   |
| --------------------- | --------------------------------------------------------- |
| While editing         | `pnpm test:watch` or `pnpm exec vitest run <file>`        |
| Before a pull request | `pnpm build`, then `pnpm test`                            |
| Before a release      | `pnpm test:all`, `pnpm smoke`, and the real-website check |

Browser files: run only the changed ones with `--no-file-parallelism`. A parallel `pnpm test:browser` can time out under load; re-run the file alone before calling it a failure.

## Exported Playwright project

Plan Review's "Export as Playwright tests" (`GET /api/runner/plan/export`, `packages/runner/src/routes/plan.ts`) returns the approved Plan as a zip. Check by hand: start a Check-up with review on, `curl -o plan.zip http://localhost:3001/api/runner/plan/export`, unzip into an empty directory, `npm install`, install Chromium for Playwright, run its `test` script. Skipped and fixme tests are allowed; failures are not. The README inside the zip lists what the export leaves out.

## Writing tests

- Deterministic first: scoring, verdicts, safety filters and checkers are pure logic. Fixed inputs, exact outputs.
- No real AI calls: use `MockAIProvider` (`@qa/core`). Test the validator and fallbacks with bad AI output.
- No real internet, no fabricated website (above).
- A safety change needs a test that fails without it: a destructive button is skipped, a token is redacted, a private address is refused in beta.
- Name tests after behavior, in `CONTEXT.md` terms. A bug fix starts with a test that reproduces it.
- `findings.json` is checked against `docs/findings.schema.json` (`packages/core/tests/findings-contract.test.ts`) with an in-repo validator (`packages/core/tests/helpers/json-schema-lite.ts`, no `ajv`). A schema keyword the validator lacks fails the test.
- Tests create their own `.tmp-*` folders; there is no global setup file.

## Browser setup

`pnpm bootstrap` installs the Chromium that the installed Playwright expects. Playwright is pinned to match the Docker image (`packages/runner/Dockerfile`); `node scripts/check-playwright-version.mjs` checks it (CI runs it). Do not bump Playwright to fix a browser error. `Executable doesn't exist` means the build is missing or `PLAYWRIGHT_BROWSERS_PATH` points elsewhere: run `pnpm --filter @qa/core exec playwright install chromium`.
