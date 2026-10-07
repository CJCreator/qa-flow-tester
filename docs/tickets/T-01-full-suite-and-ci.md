# T-01: Run and fix the full suite; CI runs every non-browser test

## Goal
Run and fix the full suite; CI runs every non-browser test.

## Gaps covered
G1, G2

## In scope
Edit `.github/workflows/ci.yml` and `deploy.yml`; fix real failures in source or stale tests; update `docs/TESTING.md`.

## Out of scope
Running `wizard-e2e` in CI; new tests beyond fixes.

## Acceptance criteria
- [ ] Every package test file (checkers, core, types, runner, wizard) runs in pull-request CI and in the deploy test job; only `wizard-e2e.test.ts` is excluded.
- [ ] `pnpm build` exits 0.
- [ ] `pnpm exec vitest run --exclude "**/wizard-e2e.test.ts"` exits 0 (run by /verify-all).
- [ ] Phase 0 exit gate in `docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md` records the result and date.
- [ ] No test is skipped, weakened or deleted; list any fixed test with the reason.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm build; pnpm exec vitest run --exclude "**/wizard-e2e.test.ts" --reporter=dot
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Deferred: the run happens in /verify-all. Windows pnpm problems noted in G1 may block local runs; CI result then counts.

## Status
todo (wave 0)
