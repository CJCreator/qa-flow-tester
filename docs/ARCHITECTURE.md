# Architecture

Developer map of the code. Product description: `PRODUCT_GUIDE.md`. Reasons behind the shape: `adr/`. Terms: `../CONTEXT.md`.

## Packages

pnpm workspace (`pnpm-workspace.yaml`: `packages/*`), TypeScript, Node.js 22.9.0 or newer. Build order: types, then checkers and core, then runner.

- `@qa/types` (`packages/types/src`): shared types and pure logic. `index.ts` re-exports the area files. Notable: `plan.ts` and `review-plan.ts` (Plan), `evidence-finding.ts` (`Finding`), `verdict.ts` (`releaseVerdict`), `problems.ts`, `checkup-api.ts`, `website-audit.ts` (Website Audit types, `AUDIT_API`, access levels, error codes), `ai.ts` (`AUDIT_AI_API`). The wizard imports single browser-safe modules from `@qa/types/src/...`, so keep Node-only code out of them.
- `@qa/checkers` (`packages/checkers/src`): deterministic audits, one file per area (`bug-detection`, `security`, `security-depth`, `keyboard-a11y`, `seo`, `aeo`, `geo`, `performance`, `design-standards`, `ux-quality`, `marketing`, `permission-matrix`, `spec-conformance`, `site-root`).
- `@qa/core` (`packages/core/src`): the engine.
  - Check-up: `orchestrator.ts`, `discovery/` (spider, discovery agent, safety filter), `plan/` (AI planner, expansion, re-plan), `ai/` (providers, `key-resolver.ts`, OpenRouter, visual review), `preflight.ts`, `scoring.ts`, `reporter.ts`, `html-report.ts`, `site-memory.ts`, `site-history.ts`, `evidence.ts`, `redact.ts`.
  - Website Audit: `audit/` with `crawl/`, `analysis/`, `ai/`, `speed/`, `documents/`, `preview/`, `pipeline/`, `store/`.
  - Shared network safety: `safe-net.ts`, `host-pacer.ts`, `checker-fetch.ts` (ADR 0031).
- `@qa/runner` (`packages/runner/src`): one HTTP + server-sent-events server (`server.ts`) on port 3001 that also serves the built wizard (`ui-static.ts`). `routes/` is the route table, `session/` holds the run slot, Check-up Session, audit runs and run events, `helpers/` Helper sign-in (Google ID token, session cookie), `beta.ts` per-visitor sessions and limits, `scheduler.ts` schedules, `host-policy.ts` and `bind-host.ts` address rules. `cli.ts` starts the server; `checkup.ts` runs one Check-up with no UI, for CI.
- `@qa/wizard` (`packages/wizard/src`): Vite + React UI. `api.ts` is the client of the runner API; `screens/` has one file per screen, `screens/audit/` the Website Audit screens.

## Life of a Check-up

1. Start: `POST /api/runner/run`. The runner claims the run slot (`session/run-slot.ts`: one run at a time, kinds `checkup`, `benchmark`, `audit`).
2. Preflight (`preflight.ts`): the address answers and any sign-in works.
3. Discovery: the Deterministic Spider (`discovery/deterministic-spider.ts`), driven per Role by `discovery/discovery-agent.ts`, records pages, links, forms. `discovery/safety-filter.ts` skips destructive actions.
4. Planning: `plan/ai-planner.ts` writes every Plan Item from those facts, validated by `discovery/plan-validator.ts`; with no AI key, fixed rules write the Plan. Planning overlaps discovery (`plan/pipeline.ts`, ADR 0020).
5. Plan Review: the Plan waits in the Check-up Session until approved (`POST /api/runner/plan/approve`). Nothing runs that is not in the Plan.
6. Run: `orchestrator.ts` executes each Test with Playwright, calls the checkers, retries flaky steps (`retry-runner.ts`), captures evidence. Progress streams on `GET /api/runner/stream`.
7. Judge: findings are grouped into problems; `scoring.ts` grades the areas deterministically; `releaseVerdict` gives the verdict from the release gate.
8. Report: `reporter.ts` and `html-report.ts` write `report.md`, `findings.json`, `report.html`, `issues.md`, `issues.html` into the run folder. `redact.ts` strips secrets first.
9. Remember: `site-memory.ts` and `site-history.ts` keep per-site memory and past Check-ups.

The AI plans and reads; it never drives the browser or decides pass or fail (ADRs 0001, 0003, 0009).

## Life of a Website Audit (ADR 0033, 0042)

No Plan, no verdict. `POST /api/audits` (owner) validates the request, claims the run slot and starts a version. Progress streams on `GET /api/audits/:id/stream` (`AuditStage` in `@qa/types`).

1. `checking-address`: reachability and address rules (`audit/crawl/reachability.ts`, `limits.ts`).
2. `crawling` (`audit/crawl/crawl.ts`): pages fetched in parallel (ADR 0043), robots and Crawl-delay honoured. While each page is open, `pipeline/page-recorder.ts` reads it, runs accessibility basics and the phone layout check (`phone-layout.ts`).
3. `checking-pages`: `analysis/analyse-site.ts` (links, content problems, SEO basics, marketing signals, technology), paced by the crawl's `HostPacer`.
4. `measuring-speed`: `ai/pagespeed.ts` on the Sample Pages.
5. `assessing`: deterministic area grades (`pipeline/grades.ts`), then AI `assessPages`, `assessSite`, `recommendPages` (`audit/ai/`). Without an AI key these steps are recorded as not done.
6. `ranking`: `scoreFindings` and `rankFindings`, then `documents/roadmap.ts`.
7. `writing-documents`: `documents/write-all.ts` writes the seven audit documents.
8. `saving`: Page Content, phone screenshots and the result go through the audit store.

`pipeline/pipeline.ts` records a failed stage as not done, never as a clean result; later stages still run. A stop ends the run and saves nothing. On start-up the runner marks versions left running as stopped, reason `tool-restarted` (`recoverRunningAudits` in `server.ts`). Later steps are separate routes: edits overlay, rewrites, improved-homepage preview (`audit/preview/`), exports, Shared Links, Shortlist, Helpers (`docs/API.md`). AI model per stage is chosen with `GET/PUT /api/audit-ai/models`; on a local runner, Google sign-in (ADC) stands in when no key works (ADR 0042).

Not yet built (ADR 0042, T-86): signed-in owner access on the hosted copy (`AUDIT_OWNER_EMAILS`).

## Routes and access

`routes/index.ts` builds `allRoutes`: plan rows (`plan.ts`), schedule rows (`schedules.ts`), and one row per `AUDIT_API` and `AUDIT_AI_API` entry. Every row declares an access level and a beta policy; a row without one is refused (`authorizeRoute`, `routes/route.ts`, ADR 0037). Endpoints not yet in the table stay inline in `server.ts` and sit behind the access-key gate. Full list: `API.md`.

## State and storage

Paths and variables: `CONFIGURATION.md`.

- Data folder (`RUNNER_DATA_DIR`, default `.qa-data/`): per-site memory and history under `sessions/`, waiting Plans, `.qa-ai-models.json`, `.qa-settings.json`, `schedules.json`, `audit-store/` (local Website Audits). Git-ignored.
- Report output (`RUNNER_OUTPUT_DIR`, default `.qa-runner-report`): one folder per run.
- Visual baselines: `.qa-baselines/`, committed on purpose.
- Website Audits: `audit/store/` has two backends behind one interface, chosen by `select-backend.ts`: local files, or a Cloud Storage bucket when `AUDIT_STORE_BUCKET` is set (ADR 0036). One folder per audit, one sub-folder per version; Shared Link and Helper-grant records live under the audit. Schedules use the same bucket when set (ADR 0039).
- Secrets: AI keys go to the OS keychain via `core/ai/key-resolver.ts`, falling back to `.qa-keys.json` only without a keychain. In beta they live in process memory per visitor session (`beta.ts`).
- Run state is in memory (one run slot, `session/run-events.ts` keeps the last 200 events for reconnecting pages).

## Local and hosted

- Local (ADR 0008): one process serves API and wizard on port 3001, bound to loopback. Only loopback `Host` headers are answered unless `RUNNER_ALLOWED_ORIGINS` lists more. The local user is the owner and may audit localhost and LAN addresses.
- Hosted beta (ADR 0032): Google Cloud Run service `qa-check-up` runs the runner with `RUNNER_BETA=1`; `qa-check-up-site` serves the static site. Deploys: `.github/workflows/deploy.yml`, see `DEPLOYMENT.md`. Render and Vercel are not used.
- Beta behaviour (`beta.ts`, `server.ts`): each visitor gets a session cookie and sees only their own run; only public addresses are accepted (ADR 0014); starts are limited per visitor and per day; routes that change shared state answer `ERR_BETA`; Website Audit rows are closed except Shared Links (`public`) and Helper rows for a signed-in Helper (ADR 0037).
- Hosted instance (ADR 0038): `--min-instances 1 --max-instances 1`, because beta limits and sessions are in memory. Schedules on the hosted copy are fired by Cloud Scheduler calling `POST /api/runner/schedules/tick` with a Google OIDC token (ADR 0039); locally a 60-second timer does it.
- CI: `checkup.ts` runs one Check-up in the user's own GitHub Actions (ADR 0012).

## Boundaries

- The wizard works with no Node-only imports.
- The Check-up Session owns state and operations, not policy; tokens, origins, beta limits and host policy stay in the transport (ADR 0027).
- Every outbound request from a checker or the audit uses the pinned resolver (ADR 0031).
