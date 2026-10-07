# T-08: Missing element fails fast, not after about 35 s

## Goal
Missing element fails fast, not after about 35 s.

## Gaps covered
G7

## In scope
Step executor wait logic.

## Out of scope
Changing selector fallback order.

## Acceptance criteria
- [ ] A step whose element is absent fails within a configured cap (default 10 s across the fallback chain) with the same failure kind as today.
- [ ] Retry of a failing flow completes within 2x the cap in a fixture test.
- [ ] Elements that appear late still work (test).
- [ ] `docs/CONFIGURATION.md` documents the setting if configurable.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/core packages/runner -t "missing"
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Slow pages need a per-run override.

## Status
todo (wave 1)
