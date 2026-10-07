# T-21: Visual baseline polish

## Goal
Visual baseline polish.

## Gaps covered
G15

## In scope
Core visual review.

## Out of scope
AI judging visuals.

## Acceptance criteria
- [ ] Page stabilising before capture and automatic masking of dates and ads, with tests.
- [ ] Old/new/diff visible in the HTML report (test on report output).
- [ ] Approved baselines still compare as before.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/core -t "visual"
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Benchmark after.

## Status
todo (wave 4)
