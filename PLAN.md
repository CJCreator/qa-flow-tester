# Architecture clean-up: progress and task pool

Branch `worktree-entropy-reduction`, based on `c36b837`. Rules: behaviour stays the same unless a row says
otherwise; every merge deletes the old copies in the same round; every merged helper gets a row in
`packages/runner/tests/architecture.test.ts` (ADR 0051). Commits wait for the owner's yes, so each round lists
its files for a separate commit.

Baseline (c36b837): `pnpm test` 5160/5161 (the failure, `config-docs.test.ts`, is fixed in round 0), lint 94
warnings (cap 107), build and typecheck clean, 2 import cycles.

## Done

**Round 0: dead doc links.** `docs/README.md` linked to files deleted in 7367901. Proof: `config-docs.test.ts` 7/7.
Files: `docs/README.md`.

**Round 1: one `isPrivateHost`.** Four copies (`safe-crawler.ts`, `same-site.ts`, `safe-net.ts` as
`isLocalOriginHost`, inline in `browser.ts`) → `core/src/address-class.ts`. Redundant second check in
`runner/src/beta.ts` dropped. Breaks the `live-site` ↔ `safe-crawler` cycle. Proof: 30-case equivalence script
(no differences), host tests 136/136. Files: `core/src/{address-class,browser,live-site,post-deploy-smoke,safe-net,same-site}.ts`,
`core/src/competitive/{safe-crawler,robots}.ts`, `core/src/discovery/discovery-agent.ts`,
`core/src/audit/pipeline/{page-recorder,pipeline}.ts`, `runner/src/beta.ts`, `core/tests/private-host.test.ts`.

**Round 2: guard rails.** `fix-rules` moved from core to `@qa/types` (the wizard no longer reaches into core);
unused `export *` in wizard `lib/translate.ts` removed (last cycle gone); architecture test + ADR 0051. Proof:
architecture test fails on each injected violation, passes clean. Files: `types/src/{fix-rules,index,browser}.ts`,
`types/tests/browser-entry.test.ts`, `core/src/audit/documents/{findings,generate,roadmap,roadmap-document}.ts`,
`core/src/audit/documents/labels/{index,fix-rules-ta}.ts`, `core/src/audit/improve/{fix-options,fix-options-store,index}.ts`,
`core/tests/audit-fix-options.test.ts`, `wizard/src/lib/translate.ts`,
`wizard/src/screens/audit/improved/FixOptionsPanel.tsx`, `runner/tests/architecture.test.ts`, `docs/adr/0051-*`,
`docs/adr/README.md`.

**Round 3: four merges in parallel.**

- Core `concurrency.ts`: one `mapInFlight` (6 worker pools) and one `createLimiter` (`LabQueue`, `createAiLimiter`).
  Files: `core/src/concurrency.ts`, `core/tests/concurrency.test.ts`, `core/src/audit/store/{audit-store,gcs-backend}.ts`,
  `core/src/audit/ai/{page-recommendation,assessment}.ts`, `core/src/plan/ai-planner.ts`,
  `core/src/audit/pipeline/{page-recorder,pipeline,index}.ts`.
- Wizard: one `Fetch` type (was 14), `helper-api` and `share-api` on `callAudit`, one `jsonInit`. Five copies kept
  on purpose (different result shapes). Files: `wizard/src/screens/audit/**` (35), `wizard/src/screens/AccountSignInScreen.tsx`, 4 wizard tests.
- Small: `parseCsp` (checkers), document limits and `parseDailyLimit` (runner), `LAB_CHROMIUM_ARGS` →
  `core/src/audit/lab-browser.ts`. Files: `checkers/src/security-depth.ts`, `runner/src/{checkup,server}.ts`,
  `runner/src/helpers/helper-access.ts`, `core/src/audit/{lab-browser,documents/render-pdf,improve/quality-gate,improve/variants}.ts`.
- Scale rank from `AUDIT_SCALE` (two copied maps). Files: `core/src/audit/ai/ranking.ts`, `core/src/audit/documents/roadmap.ts`.

Proof: independent review found no behaviour change; full `pnpm test` 5179/5179; build, typecheck, lint (94),
format clean.

Dropped after a closer look: a `severityRank` wrapper (`SEVERITY_ORDER.indexOf` already uses one source; a
wrapper would be a shallow layer).

**Round 4: four merges in parallel (behaviour kept).**

- Core `ai/json-answer.ts`: `parseJsonAnswer` out of the planner (5 importers); `context-parser.ts` forwarding
  re-exports deleted (core and runner import `@qa/types` directly). `stripFences` and the competitor array parse
  differ on purpose and stay.
- Core `timing.ts`: one `sleep` (5 copies) and `settleOrGiveUp` (4 close/abandon races); frontier
  `normalizeRoute` renamed `crawlRouteKey` (it clashed with a different `@qa/types` function). Races that reject
  on timeout or wait on Playwright stay where they are.
- Runner: `readRawBody` in `routes/body.ts` replaces 3 hand-written body readers; unused `notFound` and
  `fallbackNotFound` aliases deleted.
- Wizard: plan `Badge` wrapper deleted; `BenchmarkScreen` uses the shared `count`; one `isSerious` (in
  `@qa/types` `problems.ts`, was 4 copies); `SEVERITY_ORDER` replaces two re-declared lists; `lib/storage.ts` for
  the release gates and plan view tab.

**Round 5: owner-approved behaviour changes (2026-11-28).**

- `RUNNER_BETA` accepts `1` or `true` everywhere (`isBetaEnv` in `runner/src/beta.ts`).
- `Retry-After` read the strict way in both places (`page-recorder.ts` uses `navigate.ts` `parseRetryAfter`).
- One `escapeHtml` (`core/src/html-escape.ts`); the preview page now escapes quotes too.
- One `isInside`/`resolveInside` (`core/src/fs-inside.ts`): names like `..notes` are accepted, `..` and `../x`
  refused; the runner shim deleted. URL checks (`hasDotDotSegment`, the screenshot query check) stay stricter on
  purpose.
- Error replies: one `refuse`/`refuseStoreFailure` pair (unknown audit id is 404 everywhere; no raw error text);
  every request 500 is a fixed sentence with the detail in the server log; oversized bodies answer 413 "The
  request is too large." and bad JSON stays 400. `docs/API.md` updated. The wizard reads code and text, not the
  status, so it needed no change.
- A browser that cannot launch fails the audit with a fixed sentence (the launch error, which can hold file paths,
  goes to the server log only). The Word converter's refusals get their own type (`DocxRefusedError`), so the
  sender still sees "not a Word file" or "expands to more than 20 MB", while library errors stay in the log.
- An oversized sign-in request answers 413 "too large" like every other route (a bad body is still a failed
  sign-in). Every 413 now closes the connection: the body is not read to its end, and a keep-alive client
  (every browser, Node's default agent) otherwise waited forever on its next request.
- Live updates, the status page's last error, Plan updates and comparison jobs: a typed `ERR_` error keeps its
  sentence (sign-in failed, site blocked...); anything else is a fixed sentence, with the detail in the server
  log (`failureText` in `runner/src/session/checkup-run.ts`).
- `CLAUDE.md` and `AGENTS.md` point at this file for open work.

## Round 6: owner's decisions of 2026-11-28 (running)

- [ ] Split `runner/src/server.ts` (about 4,500 lines) into route and session modules.
- [ ] Move the wizard's data loading (`api.ts` and its callers) to TanStack Query.
- [ ] Same-site rule counts the port everywhere (the audit crawl compares hostname only today).
- [ ] One env number parser (`envInt`) for every whole-number setting.
- [ ] One "server not responding" message in the wizard.
- [ ] Benchmark screen dates in day-month-year (`formatWhen`, `en-GB`).
- [ ] The audit-screen API helpers return one result shape.
- Kept on purpose: one shared browser policy slot; email hashes stay separate.

## Left as is, on purpose

- Email hashing: three copies give different hashes because they key different stored data. Merging would
  change stored keys (a data migration), so they stay distinct.
- One browser policy slot shared by concurrent runs (`core/src/browser.ts`): kept (owner, 2026-11-28).
- Large wizard screens (`PlanDocument.tsx`, `ReportScreen.tsx`, `NewCheckupScreen.tsx`): split when next touched.
