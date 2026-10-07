# Architecture

A developer's map of the code. The product-level description is in `PRODUCT_GUIDE.md`; the reasons behind the
shape are in `adr/`.

## Packages

pnpm workspace (`packages/*`, `fixtures/*`), TypeScript (`strict`, NodeNext modules), Node 22.

| Package        | Role                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@qa/types`    | Shared types and pure logic: `Finding`, plan types (`plan.ts`), `releaseVerdict` (`verdict.ts`), grouping findings into problems (`problems.ts`), structural fingerprints. Browser-safe parts are imported by the wizard from source (`@qa/types/src/x.js`), so keep Node-only code (e.g. `node:crypto`) out of those files                                                                                                     |
| `@qa/checkers` | Deterministic audits, one file each: `bug-detection`, `security`, `seo`, `aeo`, `geo`, `performance`, `design-standards`, `ux-quality`, `marketing`, `permission-matrix`, `spec-conformance`, `site-root`                                                                                                                                                                                                                       |
| `@qa/core`     | The engine: `orchestrator.ts` (runs a Plan), `discovery/` (spider, discovery agent, safety filter, page sweep), `plan/` (AI planner, expansion, sampling, re-plan, site graph), `ai/` (providers, key resolver, OpenRouter, visual review), `scoring.ts`, `recommendations.ts`, `reporter.ts`, `html-report.ts`, `site-memory.ts`, `site-history.ts`, `evidence.ts`, `redact.ts`, `safe-scan.ts`, `competitive/` (benchmarking) |
| `@qa/runner`   | The server (`server.ts`) that exposes the engine over HTTP + server-sent events and serves the built wizard on one port (3001). `cli.ts` starts it. `checkup.ts` runs one check-up with no UI, for CI. `beta.ts` holds per-session secrets for the shared beta. `scheduler.ts` runs scheduled check-ups                                                                                                                         |
| `@qa/wizard`   | The Vite + React UI. Screens in `src/screens/` follow the flow: new check-up, scanning, Plan Review, report, past check-ups, benchmark. `src/api.ts` is the runner client                                                                                                                                                                                                                                                       |

Build order follows the dependency chain: `types` → `checkers` and `core` → `runner`; `wizard` builds after `types`.

## Life of a check-up

1. **Start.** The wizard (or `checkup.ts` in CI) posts the address and options to `POST /api/runner/run`.
2. **Preflight.** `core/preflight.ts` checks the address answers (and that any sign-in details work) before a scan starts. Same-site and robots.txt rules live in `core/same-site.ts` and `competitive/robots.ts`; beta mode also refuses private addresses.
3. **Discovery.** The Deterministic Spider crawls the site per role, recording pages, links, buttons and forms (up to 200 pages in the UI; `QA_MAX_PAGES` caps CI runs, default 50). It gathers facts and never decides what to test. The safety filter (`discovery/safety-filter.ts`) skips destructive actions deterministically.
4. **Planning.** The AI Planner (`plan/ai-planner.ts`) writes every Plan Item from those facts, batched by Layout Group, within an AI request budget (`plan/ai-budget.ts`). Output is validated for coverage, real selectors and safety (`discovery/plan-validator.ts`). Anything the AI could not plan becomes a Fixed-Rule Fallback item. With no AI key the whole plan is written by fixed rules.
5. **Plan Review.** The plan waits for the person to read, edit (`PATCH /api/runner/plan`), answer questions, re-plan and approve (`POST /api/runner/plan/approve`). Nothing runs that is not in the plan. Waiting plans survive restarts in the data folder.
6. **Run.** `core/orchestrator.ts` executes each Test (one Plan Item, one role, one screen size) with Playwright, calling the checkers, retrying flaky steps (`retry-runner.ts`), and capturing evidence (`evidence.ts`). Progress streams over `GET /api/runner/stream`.
7. **Judge.** Findings are de-duplicated and grouped into problems; `scoring.ts` grades six areas A to F deterministically (same findings, same grades); `releaseVerdict` produces the single "Ready to release" or "Not ready yet" verdict from the release gate (`strict`, `standard`, `lenient`). Findings marked intended or false positive, and unconfirmed AI guesses, do not count.
8. **Report.** `reporter.ts` and `html-report.ts` write `report.md`, `findings.json` and a self-contained `report.html`. Sensitive values are removed by `redact.ts` before anything is emitted or written.
9. **Remember.** `site-memory.ts` and `site-history.ts` keep per-site memory and past check-ups so "Test again" can reuse the approved plan and show whether a fix worked.

## State and storage

- **Data folder** (`RUNNER_DATA_DIR`, default `.qa-data/`): per-site memory and history, waiting plans, saved model choices. Git-ignored.
- **Report output** (`RUNNER_OUTPUT_DIR`, default `.qa-runner-report`; CI default `qa-report`). Git-ignored.
- **Baselines** (`.qa-baselines/`): approved visual baselines. These are committed on purpose.
- **Secrets:** a saved AI key goes to the OS keychain through `core/ai/key-resolver.ts`. Only when no keychain exists (e.g. headless Linux) does it fall back to the plaintext `.qa-keys.json` (git-ignored). Site sign-ins go through `core/credentials.ts`. In beta mode both live only in process memory per session (`runner/src/beta.ts`).

## Boundaries worth protecting

- The AI plans; it never drives the browser and never decides pass or fail. Verdicts and grades are deterministic (ADRs 0001, 0003, 0009).
- The wizard must work as a static site with no runner (ADR 0012), so it cannot import Node-only modules.
- One run at a time per runner (single run slot).
