## Shard S3: packages/core/**

Coverage: structural survey (manifest, barrel, export signatures, file sizes, key-resolver read in full). Large files (orchestrator, ai-planner, spider) were not read end to end. Tests not run. Env-var greps were blocked by the AI-EOS guard, so env names are limited to those read directly.

### Stack
- `@qa/core` 0.1.0, ESM (`"type": "module"`), `tsc` build to `dist/`, `main ./dist/index.js` (packages/core/package.json:4-9). tsconfig extends `../../tsconfig.base.json`, rootDir `src` (packages/core/tsconfig.json).
- Deps: `@napi-rs/keyring`, `@qa/checkers`, `@qa/types` (workspace), `mammoth` 1.12.3 (docx), `playwright` 1.63.0, `pngjs` (package.json:11-16). No test runner declared here; vitest runs from the root (`vitest.config.ts`, new untracked `vitest.workspace.ts`).
- Size: about 21k lines in src (tracked non-test files), 135 test files under tests/ (git ls-files count).

### Entry point and public API
- `src/index.ts:1-73` is a barrel of `export *` over about 60 modules. Exceptions with named exports: `SendGuard, watchSends` (send-guard), `buildIssuesModel, renderIssuesMarkdown` (issues-document), `renderIssuesHtml` (issues-html). Not exported from the barrel: `access-control`, `debug-log`, `flaky-cause`, `not-checked`, `source-wording`, `json-schema-lite`, `visual-capture`, `navigate`, `plan/fill-values`, `plan/selector-order`, `plan/spec-roles`, `plan/sources`, `discovery/{guard,overlay,frontier,crud-facts,interactive-states}`. Tests or runner may deep-import them (verify in S-runner).
- No CLI or server in this package: it is a library consumed by `packages/runner`.

### Modules
| Module | Files | Evidence / role |
|---|---|---|
| Orchestrator | `src/orchestrator.ts` (1661 lines) | `class FlowTestOrchestrator` (:343) holds one instance each of BrowserManager, PreFlightChecker and the checkers (Bug, Spec, UX, Design, Security, SecurityDepth, KeyboardA11y, Performance, Seo) (:344-354). `run(options: RunOptions): Promise<ReleaseReport>` (:356). All emitted events pass through `Redactor.deep` (:362-366). Default output `.qa-report`, with `evidence/` and `auth/` subfolders (:367-370). Expands validation rules into synthetic test cases first (:379). Retry attempts at :687. Exports `OrchestratorEvent` (:83), `RunOptions` (:262), `sitePathOf` (:193), `removeVideosExcept` (:165). |
| Browser / navigation | `browser.ts` (347), `navigate.ts`, `visual-capture.ts`, `retry-runner.ts`, `step-budget.ts`, `send-guard.ts` | Playwright wrapper (BrowserManager) and request-send guard. |
| Preflight | `preflight.ts` (828) | PreFlightChecker: reachability, sign-in and session checks (tests: preflight-*.test.ts). |
| Discovery / spider | `discovery/deterministic-spider.ts` (1196; `DeterministicSpider` :300), `discovery-agent.ts` (911; `DiscoveryAgent` :330, `mergeCrawls` :167, `restoreSession` :302), `frontier`, `element-inventory`, `page-sweep`, `crud-facts`, `interactive-states`, `site-type`, `docs-fetch`, `docx-to-markdown`, `context-parser`, `questions`, `interpret`, `plan-validator`, `safety-filter`, `test-planner`, `guard`, `overlay` | Crawl, element inventory, forms (`readPageForms` :218), safety filtering. |
| Planning | `plan/pipeline.ts` (`PlanPipeline` :50), `plan/build.ts` (`buildPlan` :146, `emptyPlan` :61), `plan/ai-planner.ts` (1202; `planPagesAndMenus` :852, `planBatch` :926, `assemblePlan` :995, `askWithOneRepair` :689, `parseJsonAnswer` :228), `plan/spec-plan.ts` (`planFromSpec` :108), plus `ai-budget`, `expand`, `journeys`, `replan`, `rejects`, `sampling`, `narrow-look`, `site-graph`, `sources`, `markdown`, `playwright-export` (612), `zip` | Builds the Plan (ReviewPlan) from discovery plus an AI Provider; deterministic fallbacks (`fallbackPageTests` :328, `fallbackReasonOf` :740). Exports a Plan as Markdown, Playwright code and zip. |
| AI providers | `ai/ai-provider.ts` (interface `AIProvider` :3, `completeWith` :11, `AITruncatedError` :21, `createAIProvider` :40), `providers/{anthropic,openai,gemini,mock}.ts`, `openrouter.ts` (298), `default-models.ts`, `visual-review.ts` | Factory switch: anthropic, openai and openrouter (OpenAI client with base URL `https://openrouter.ai/api/v1`), gemini, and `mock` as the default for unknown types (ai-provider.ts:40-55). Default models: anthropic `claude-sonnet-5-5`, openai `gpt-4o`, gemini `gemini-3.8-flash`, openrouter `openrouter/free` (default-models.ts:4-9). |
| Key resolver | `ai/key-resolver.ts` (382 lines, uncommitted modification of +257/-22 vs HEAD) | `KeyResolver` (:84). Resolution order: explicit key, then keychain, then encrypted `.qa-keys.json`, then env, for the preferred provider, then anthropic, openai, gemini, openrouter (:153-187). `OsKeychainStore` via `@napi-rs/keyring`, service `qa-flow-tester` (:42,65). The fallback file is AES-256-GCM with scrypt (:1,45); key from env `QA_KEYS_ENCRYPTION_KEY` (:40) or a generated `key-file.key` in a user config dir, not the data dir (:31-34, 46). Service keys (`pagespeed`, env `PAGESPEED_API_KEY`) are handled the same way (:14,23,111-128). Env names for AI keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY (:189-198). Sign-in passwords go to the keychain only, never a file (`saveSecret` :134). Governed by ADR 0034 (untracked). |
| Scoring | `scoring.ts` (235; `scoreToGrade` :40, `calculateSiteAspectGrades` :88, re-exports `ASPECT_CHECKERS` :12), `finding-groups`, `recommendations`, `speed-change`, `suppressions`, `findings-contract` | Grades per aspect from Findings. |
| Reports | `reporter.ts` (363, ReportGenerator), `html-report.ts` (699), `issues-document.ts` (218; `buildIssuesModel` :64, `renderIssuesMarkdown` :182, `pageCoverageLines` :156), `issues-html.ts`, `evidence.ts`, `repro-generator.ts`, `source-locator.ts` | Writes the ReleaseReport, HTML report, issues markdown/HTML, repro scripts. issues-document.ts has a +3 uncommitted diff. |
| Competitive | `competitive/{safe-crawler (522), robots, benchmarking-engine, ux-gap-synthesizer}` | Safe crawl of competitor sites with robots.txt respect, UX gap synthesis. |
| Safety / network | `safe-net.ts`, `address-class.ts`, `domain-verification.ts`, `same-site.ts`, `redact.ts`, `safe-scan.ts`, `access-control.ts` | SSRF/address classes, domain ownership checks, redaction of sign-in details. |
| Other | `site-memory.ts` (368), `site-history.ts`, `live-site.ts`, `post-deploy-smoke.ts`, `api-spec-checks.ts`, `figma-sync.ts`, `account-pool.ts`, `credentials.ts`, `entity-namespacing.ts`, `validator-expander.ts`, `abort.ts`, `debug-log.ts`, `flaky-cause.ts`, `not-checked.ts` | See file names; not read in depth. |

### Data and persistence
- No database. File persistence only: report folder `.qa-report/{evidence,auth}` (orchestrator.ts:367-370), `.qa-keys.json` (key-resolver.ts:95), suppressions, site memory and history under `options.stateDir || outputDir` (orchestrator.ts:376). Atomic JSON writes via `writeJsonAtomic` / `readJsonSafe` (atomic-write.ts:16,35).
- Secrets: OS keychain first; encrypted file only as a fallback.
- Generated code: none checked in under src. `dist/` is build output (ignore).

### Tests
- 135 files in `packages/core/tests/` (vitest, run from the repo root: `pnpm test`, or `pnpm exec vitest run packages/core/tests/<file>`). The package has no own test script.
- Helpers: `tests/helpers/{audit-site-server,issues-fixtures,json-schema-lite,spec-crawl}.ts`; fixture `tests/fixtures/checkindaily`.
- Browser-using tests (spider-*, e2e-*, fixture-*, browser-*) need Chromium. `audit-site-fixture.test.ts` and `audit-site-server.ts` serve `../../../../fixtures/audit-site` (untracked) on 127.0.0.1 (helpers/audit-site-server.ts:6,98).
- Many core tests are modified (uncommitted): auth-crawl-e2e, discovery-agent-headers, e2e-orchestrator, element-inventory, orchestrator-session, plan-validator, spider-form-facts, spider-signin-walls. Untracked: `key-resolver-encryption.test.ts`, `audit-site-fixture.test.ts`.
- Baseline: not run (instructed).

### Health findings
- Size and complexity: `orchestrator.ts` 1661, `ai-planner.ts` 1202, `deterministic-spider.ts` 1196, `discovery-agent.ts` 911, `preflight.ts` 828. Each is a god-file candidate.
- No TODO/FIXME/@ts-ignore/@ts-nocheck in src (Grep returned none). Debt shows up as size, not markers.
- Barrel inconsistency: some modules are not exported while their siblings are (see Entry point). `export *` of about 60 modules risks name collisions. `ai-provider.ts:28-33` re-exports `KeyResolver` and providers while the barrel also does `export *` from `key-resolver.js` (duplicate path, same binding, so allowed).
- `createAIProvider` silently returns `MockAIProvider` for any unknown type (ai-provider.ts:50-52). A bad provider name yields fake AI answers rather than an error.
- `resolveKey` with `explicitKey` and no provider assumes `anthropic` (key-resolver.ts:157).
- Key-resolver security: `forgetSecret` writes an empty string rather than deleting (:150). Key-file secret minimum length 16 (:47). The change is uncommitted and covered by a new, uncommitted test, so review before merge.
- Doc drift check: the model id `claude-sonnet-5-5` and `gemini-3.8-flash` in default-models.ts could not be verified against provider docs.
- `@qa/core` depends on `playwright` 1.63.0 pinned exactly while `mammoth` is pinned; `pngjs` and keyring use caret ranges. Mixed policy, low impact.

### Cross-shard
- `@qa/types` (shared types, plan types, verdict, `AIProviderType`, `ReleaseReport`, `Finding`, `ASPECT_CHECKERS`): used throughout src. Uncommitted changes in `packages/types/src/{ai,aspects,browser,discovery,index,route-telemetry}.ts` and new `website-audit.ts` may affect core compile and the new website-audit work. Build order requires types first.
- `@qa/checkers`: orchestrator.ts:344-354 instantiate Bug/Spec/UX/Design/Security/SecurityDepth/KeyboardA11y/Performance/Seo checkers.
- `packages/runner` consumes the `@qa/core` barrel (HTTP + SSE server, `checkup.ts`), including `KeyResolver`, `FlowTestOrchestrator`, plan pipeline. Runner has new `scan-build-secrets` and `scan-commit-secrets` tests unrelated to core directly.
- `fixtures/audit-site` (untracked) and `fixtures/test-app`: used by core tests (helpers/audit-site-server.ts:6).
- Root: `vitest.config.ts` (modified), `vitest.workspace.ts` (untracked), `.github/workflows/ci.yml` (modified) govern how core tests run.
- Docs: `docs/adr/0033-website-audit-entry-point.md` and `0034-encrypted-key-fallback.md` (both untracked) cover the new work touching types and key-resolver.
