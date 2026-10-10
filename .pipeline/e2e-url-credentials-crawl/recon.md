# Recon: URL + credentials crawl, find all issues

## Stack
pnpm 11 workspaces, TypeScript 5.7, Node 22, Vitest 2, ESLint 9, Prettier 3, Playwright (core/checkers ^1.49.1, wizard ^1.63.0: version split), React 18 + Vite 6 (wizard).
Packages: types, checkers, core, runner (HTTP+SSE, :3001), wizard.

## Commands
- build: `pnpm build` (type-check happens here; no root typecheck script)
- test: `pnpm test` (vitest run); focused: `pnpm test:url-first`; single: `pnpm exec vitest run <file>`
- lint: `pnpm lint`; format: `pnpm format:check`; smoke: `pnpm smoke`
- CI (ci.yml): frozen install, playwright version check, lint, format:check, vercel-build, vitest excluding wizard-e2e with coverage, audit, gitleaks.
- Tests: 142 files (core 76, checkers 13, runner 24, wizard 24, types 5).

## Feature already largely exists
| Need | Where |
|---|---|
| Crawl | core/src/discovery/{discovery-agent,deterministic-spider (maxPages 200),element-inventory,page-sweep,safety-filter}.ts |
| Login with test credentials | core/src/preflight.ts (signIn, storageState), credentials.ts, redact.ts, account-pool.ts; types/src/signin.ts; runner/src/server.ts (keychain only if "remember", saved sessions memory-only, ADR 0021) |
| Plan | core/src/plan/pipeline.ts, ai-planner.ts (fixed-rule fallback, no-AI path), journeys.ts, replan.ts |
| Run | core/src/orchestrator.ts, retry-runner.ts, runner/src/scheduler.ts |
| Findings | types/evidence-finding.ts, run-report.ts; core/findings-contract.ts, issues-document.ts, reporter.ts, html-report.ts; checkers/* |
| API | POST /api/runner/run (targetUrl, roles[], owner, stagingHost, maxPages, mode), GET /api/runner/stream (SSE), /preflight, /plan/*, /api/report |
| UI | wizard/src/screens/NewCheckupScreen.tsx (URL, owner/test-copy, role credentials, session upload) |

## Constraints found
- Live (non-test) hosts: read-only checks only. Full interaction needs owner box + test host (core/src/live-site.ts isTestHost; ADR 0014 Verified Domain).
- Sign-in "needs-more" (MFA/CAPTCHA/SSO) unsupported.
- Relevant ADRs: 0001, 0003, 0009, 0014, 0016, 0017, 0020, 0021. No 0013/0015.

## Open gaps (docs/GAP_ANALYSIS.md, docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md)
G2 CI runs a slice only; G4 Phase 1 exit gate (no recorded live end-to-end result); G6 AI plan quality on free models; G14 API traffic; G16 a11y/security depth; G18 WebKit/Firefox; G19 re-run changed only; G21 TLS/DNS/OpenAPI/SARIF; G22 self-healing selectors; G23 security probes. URL-first plan: only Task 2.9 open.

## Baseline tests
Docs claim 915/920 passing on 2026-10-09. Fresh baseline: running (`pnpm test`, exceeded 10 min foreground, moved to background). Result to be appended below.

### Baseline result (2026-10-10, branch ship/adr-0020-sources, `pnpm test`, 777s)
Test files: 17 failed, 125 passed (142). Tests: 23 failed, 1046 passed (1069).
Only the last 40 lines were captured, so the full failing list is not recorded; one confirmed failure is `packages/wizard/tests/wizard-e2e.test.ts:814` (browser back/forward URL wait). Docs claimed 915/920 on 2026-10-09, so this baseline is worse than documented. Phase 6 must re-run with full output saved to compare per-file.
