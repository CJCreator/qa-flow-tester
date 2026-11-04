# Quality checks

> **Generated from evidence records** in `engineering/.ai-eos/evidence/`. Do not edit by hand. The file is
> write-protected, and rows exist only for commands `aieos check run` actually executed (PASS/FAIL from
> the real exit code) or verdicts `aieos check record` registered with a reason
> (SKIPPED / NOT APPLICABLE / BLOCKED).

## Latest verdict per check

<!-- ai-eos:begin summary -->
| Check | Name | Category | Mandatory | Requirements | Latest verdict | Evidence | At |
|---|---|---|---|---|---|---|---|
| CHK-BE-001-UNIT | ADR 0031 outbound path tests | security | yes | REQ-003, REQ-004, REQ-014 | NOT RUN | — | — |
| CHK-BE-002-BUILD | types package build | build | yes | REQ-001, REQ-002, REQ-008, REQ-009, REQ-018, REQ-023, REQ-036, REQ-039 | NOT RUN | — | — |
| CHK-BE-002-UNIT | audit contract tests | unit | yes | REQ-001, REQ-002, REQ-008, REQ-009, REQ-018, REQ-023, REQ-036, REQ-039 | NOT RUN | — | — |
| CHK-BE-003-UNIT | crawl control tests | unit | yes | REQ-002, REQ-006, REQ-034, REQ-035, REQ-036 | NOT RUN | — | — |
| CHK-BE-004-UNIT | page content extraction tests | unit | yes | REQ-005, REQ-007, REQ-008, REQ-009, REQ-010, REQ-013, REQ-044 | NOT RUN | — | — |
| CHK-BE-005-UNIT | language detection tests | unit | yes | REQ-013, REQ-032, REQ-044 | NOT RUN | — | — |
| CHK-BE-006-UNIT | technology detection tests | unit | yes | REQ-010 | NOT RUN | — | — |
| CHK-BE-007-UNIT | checker extension tests | unit | yes | REQ-014, REQ-015, REQ-038 | NOT RUN | — | — |
| CHK-BE-008-UNIT | site checks and hierarchy tests | unit | yes | REQ-007, REQ-014, REQ-015, REQ-038 | NOT RUN | — | — |
| CHK-BE-009-UNIT | PageSpeed adapter tests | unit | yes | REQ-012, REQ-043 | NOT RUN | — | — |
| CHK-BE-010-UNIT | key encryption tests | security | yes | REQ-040, REQ-011 | PASS | EV-0009 | 2026-10-31T12:21:55.309Z |
| CHK-BE-011-UNIT | secret scanner tests | security | yes | REQ-041 | PASS | EV-0010 | 2026-10-31T12:22:19.000Z |
| CHK-BE-012-UNIT | per-stage model tests | unit | yes | REQ-039 | NOT RUN | — | — |
| CHK-BE-013-UNIT | ranking tests | unit | yes | REQ-017, REQ-026 | NOT RUN | — | — |
| CHK-BE-014-UNIT | AI assessment tests | unit | yes | REQ-016, REQ-045, REQ-011 | NOT RUN | — | — |
| CHK-BE-015-INT | audit pipeline on the fixture site | integration | yes | REQ-001, REQ-003, REQ-006, REQ-012, REQ-015, REQ-035, REQ-037, REQ-038 | NOT RUN | — | — |
| CHK-BE-015-UNIT | audit pipeline unit tests | unit | yes | REQ-001, REQ-003, REQ-006, REQ-012, REQ-015, REQ-035, REQ-037, REQ-038 | NOT RUN | — | — |
| CHK-BE-016-UNIT | audit store tests | unit | yes | REQ-020, REQ-028, REQ-029 | NOT RUN | — | — |
| CHK-BE-017-UNIT | audit document tests | unit | yes | REQ-018, REQ-020, REQ-021, REQ-026, REQ-027 | NOT RUN | — | — |
| CHK-BE-018-UNIT | render and language tests | unit | yes | REQ-044, REQ-032, REQ-013 | NOT RUN | — | — |
| CHK-BE-019-INT | export tests | integration | yes | REQ-021, REQ-022 | NOT RUN | — | — |
| CHK-BE-020-INT | pitch glimpse tests | integration | yes | REQ-019 | NOT RUN | — | — |
| CHK-BE-021-UNIT | owner audit tests | unit | yes | REQ-025 | NOT RUN | — | — |
| CHK-BE-022-INT | shared link tests | security | yes | REQ-019, REQ-024 | NOT RUN | — | — |
| CHK-BE-023-INT | preview tests | integration | yes | REQ-024 | NOT RUN | — | — |
| CHK-BE-024-UNIT | rewrite tests | unit | yes | REQ-030 | NOT RUN | — | — |
| CHK-BE-025-UNIT | shortlist tests | unit | yes | REQ-023 | NOT RUN | — | — |
| CHK-BE-026-INT | helper access tests | security | yes | REQ-033 | NOT RUN | — | — |
| CHK-BE-027-INT | audit route tests | integration | yes | REQ-001, REQ-020, REQ-027, REQ-028, REQ-029 | NOT RUN | — | — |
| CHK-BE-031-SYNTAX | deploy script syntax | other | yes | REQ-029, REQ-028, REQ-033 | NOT RUN | — | — |
| CHK-FE-001-UNIT | audit start and router tests | unit | yes | REQ-001, REQ-002 | NOT RUN | — | — |
| CHK-FE-002-UNIT | results panel tests | unit | yes | REQ-007, REQ-008, REQ-009, REQ-010, REQ-012, REQ-013, REQ-016, REQ-017, REQ-037, REQ-045 | NOT RUN | — | — |
| CHK-FE-003-UNIT | review and export panel tests | unit | yes | REQ-020, REQ-021, REQ-022, REQ-044 | NOT RUN | — | — |
| CHK-FE-004-UNIT | pitch and share panel tests | unit | yes | REQ-019, REQ-024, REQ-025 | NOT RUN | — | — |
| CHK-FE-005-UNIT | past audits and shortlist tests | unit | yes | REQ-023, REQ-028 | NOT RUN | — | — |
| CHK-FE-006-UNIT | rewrite panel tests | unit | yes | REQ-030 | NOT RUN | — | — |
| CHK-FE-007-UNIT | audit settings tests | unit | yes | REQ-039, REQ-012, REQ-019, REQ-027 | NOT RUN | — | — |
| CHK-FE-008-UNIT | helper panel tests | unit | yes | REQ-033 | NOT RUN | — | — |
| CHK-NODE-BUILD | full build | build | yes | REQ-018, REQ-029 | PASS | EV-0001 | 2026-10-31T06:06:15.427Z |
| CHK-NODE-LINT | eslint | lint | yes | — | PASS | EV-0002 | 2026-10-31T06:07:45.420Z |
| CHK-NODE-TYPECHECK | typecheck (package sources) | typecheck | yes | — | PASS | EV-0008 | 2026-10-31T10:01:04.881Z |
| CHK-NODE-UNIT | full vitest suite | unit | yes | — | FAIL | EV-0006 | 2026-10-31T06:52:57.509Z |
| CHK-QA-001-UNIT | audit fixture sanity | unit | yes | REQ-003, REQ-013, REQ-034, REQ-036, REQ-044 | PASS | EV-0012 | 2026-10-31T12:22:35.901Z |
| CHK-QA-002-E2E | Website Audit journey | e2e | yes | REQ-001, REQ-018, REQ-019, REQ-021, REQ-029, REQ-044 | NOT RUN | — | — |
| CHK-QA-003-UNIT | previously failing test files | unit | yes | REQ-046 | NOT RUN | — | — |
| CHK-SECRETS | secret scan | security | yes | REQ-041 | PASS | EV-0011 | 2026-10-31T12:22:24.580Z |
<!-- ai-eos:end summary -->

## Execution history

<!-- ai-eos:begin history -->
| Evidence | Requirement IDs | Test | Command | Status | Actual result | Evidence location | Failure details | Timestamp |
|---|---|---|---|---|---|---|---|---|
| EV-0001 | REQ-018, REQ-029 | CHK-NODE-BUILD — full build | `pnpm run build` | PASS | exit code 0; packages/runner build: Done · $ pnpm -r run build | engineering/.ai-eos/evidence/logs/EV-0001.log | — | 2026-10-31T06:06:15.427Z |
| EV-0002 | — | CHK-NODE-LINT — eslint | `pnpm run lint` | PASS | exit code 0; ✖ 214 problems (0 errors, 214 warnings) · $ eslint . | engineering/.ai-eos/evidence/logs/EV-0002.log | — | 2026-10-31T06:07:45.420Z |
| EV-0003 | — | CHK-NODE-TYPECHECK — typecheck | `pnpm run typecheck` | FAIL | exit code 2; [ELIFECYCLE] Command failed with exit code 2. · $ tsc -p tsconfig.test.json --noEmit | engineering/.ai-eos/evidence/logs/EV-0003.log |  Projects/QA Tool/fixtures/test-app/server.js' implicitly has an 'any' type. [ELIFECYCLE] Command failed with exit code 2.  $ tsc -p tsconfig.test.json --noEmit | 2026-10-31T06:08:21.429Z |
| EV-0004 | — | CHK-SECRETS — secret scan | `node "C:/Users/HP/.claude/plugins/cache/ai-eos-marketplace/ai-eos/1.0.0/scripts/aieos.mjs" scan secrets --fail-on-findings` | FAIL | exit code 1;   [medium] generic-secret-assignment packages/wizard/tests/signin-form.test.ts:75 secr…(15 chars) ·   [medium] generic-secret-assignment packages/wizard/tests/signin-reason.test.ts:38 type…(15 chars) | engineering/.ai-eos/evidence/logs/EV-0004.log | packages/wizard/tests/signin-form.test.ts:75 secr…(15 chars)   [medium] generic-secret-assignment packages/wizard/tests/signin-reason.test.ts:38 type…(15 chars) | 2026-10-31T06:09:27.772Z |
| EV-0005 | — | CHK-NODE-UNIT — full vitest suite | `pnpm test` | FAIL | timed out; stderr \| packages/core/tests/complete-plan.test.ts > PacedAI > asks for fewer, shorter journeys when the answer is cut off, instead of repeating the same request · [JourneyPlanner] The answer was cut off; asking for fewer, shorter journeys... | engineering/.ai-eos/evidence/logs/EV-0005.log | horter journeys when the answer is cut off, instead of repeating the same request [JourneyPlanner] The answer was cut off; asking for fewer, shorter journeys... | 2026-10-31T06:19:33.975Z |
| EV-0006 | — | CHK-NODE-UNIT — full vitest suite | `pnpm test` | FAIL | exit code 1; Test Files  29 failed \| 219 passed (248) | engineering/.ai-eos/evidence/logs/EV-0006.log |       ^     815\|     await page.getByText(FREE_MODEL.id).waitFor();     816\|     expectPlain(await plainText(page), 'settings');  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[40/68]⎯ | 2026-10-31T06:52:57.509Z |
| EV-0007 | REQ-041 | CHK-SECRETS — secret scan | `node scripts/scan-commit-secrets.mjs --aieos "C:/Users/HP/.claude/plugins/cache/ai-eos-marketplace/ai-eos/1.0.0/scripts/aieos.mjs"` | FAIL | exit code 1; } · Node.js v24.1.0 | engineering/.ai-eos/evidence/logs/EV-0007.log | Main] (node:internal/modules/run_main:152:5)     at node:internal/main/run_main_module:33:47 {   code: 'MODULE_NOT_FOUND',   requireStack: [] }  Node.js v24.1.0 | 2026-10-31T06:35:21.191Z |
| EV-0008 | — | CHK-NODE-TYPECHECK — typecheck (package sources) | `for p in types checkers core runner wizard; do npx --no-install tsc --noEmit -p packages/$p/tsconfig.json \|\| exit 1; done` | PASS | exit code 0 | engineering/.ai-eos/evidence/logs/EV-0008.log | — | 2026-10-31T10:01:04.881Z |
| EV-0009 | REQ-040, REQ-011 | CHK-BE-010-UNIT — key encryption tests | `pnpm exec vitest run packages/core/tests/key-resolver-encryption.test.ts` | PASS | exit code 0; Test Files  1 passed (1) | engineering/.ai-eos/evidence/logs/EV-0009.log | — | 2026-10-31T12:21:55.309Z |
| EV-0010 | REQ-041 | CHK-BE-011-UNIT — secret scanner tests | `pnpm exec vitest run packages/runner/tests/scan-build-secrets.test.ts packages/runner/tests/scan-commit-secrets.test.ts` | PASS | exit code 0; Test Files  2 passed (2) | engineering/.ai-eos/evidence/logs/EV-0010.log | — | 2026-10-31T12:22:19.000Z |
| EV-0011 | REQ-041 | CHK-SECRETS — secret scan | `node scripts/scan-commit-secrets.mjs --aieos "C:/Users/HP/.claude/plugins/cache/ai-eos-marketplace/ai-eos/1.0.0/scripts/aieos.mjs"` | PASS | exit code 0; Scanned 449 file(s) that would be committed (300 left out by the .gitleaks.toml allowlist, 1 {{...}} placeholder(s) ignored): 0 finding(s). Values are not printed. | engineering/.ai-eos/evidence/logs/EV-0011.log | — | 2026-10-31T12:22:24.580Z |
| EV-0012 | REQ-003, REQ-013, REQ-034, REQ-036, REQ-044 | CHK-QA-001-UNIT — audit fixture sanity | `pnpm exec vitest run packages/core/tests/audit-site-fixture.test.ts` | PASS | exit code 0; Test Files  1 passed (1) | engineering/.ai-eos/evidence/logs/EV-0012.log | — | 2026-10-31T12:22:35.901Z |
<!-- ai-eos:end history -->
