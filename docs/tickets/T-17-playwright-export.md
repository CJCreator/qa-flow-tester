# T-17: Export the approved Plan as Playwright tests

## Goal
Export the approved Plan as Playwright tests.

## Gaps covered
G13

## In scope
Core exporter, runner endpoint, wizard button.

## Out of scope
Round-trip import.

## Acceptance criteria
- [ ] Export produces a project that passes `npx playwright test` against the fixture (run in verify).
- [ ] Per-role storage state supported; no secrets written.
- [ ] Read-only default respected in the export.
- [ ] Documented, with limits.

## Dependencies
T-16 (soft)

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/core -t "export"
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Generated code quality; keep selectors from the Plan.

## Status
built (wave 3, tests deferred)
