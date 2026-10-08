# T-14: Close remaining landing audit items

## Goal
Close remaining landing audit items.

## Gaps covered
G46

## In scope
Landing screen and tests.

## Out of scope
Re-design.

## Acceptance criteria
- [x] A test checks the sample report against the current report format.
- [x] The form is not the long block above the fold; developer shortcuts are hidden from first-time visitors.
- [x] Wake-time limit is configurable.
- [x] Areas list links to the sample; theme toggle works.
- [x] axe finds no serious or critical issue on landing (test).

## Dependencies
T-13

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/wizard
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
The staleness check must not be brittle.

## Status
built (wave 2). Tests written, run in /verify-all.
