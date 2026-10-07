# T-07: Automate the planted-defect benchmark

## Goal
Automate the planted-defect benchmark.

## Gaps covered
G3

## In scope
`scripts/benchmark.ts`, fixture defects, workflow, docs.

## Out of scope
Tuning checkers to hit numbers.

## Acceptance criteria
- [ ] `pnpm benchmark` runs against the fixture app with planted defects and writes detection rate and false-positive rate.
- [ ] A threshold file makes the script exit non-zero when missed.
- [ ] A CI job (manual dispatch or nightly, not blocking PRs) runs it.
- [ ] Swag Labs and TodoMVC runs are documented as optional live targets; results go in `docs/TESTING.md` after a run.
- [ ] Output goes to `.benchmark/` (not committed).

## Dependencies
T-01

## ADR needed
none

## Verification commands
```
pnpm benchmark
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Live sites change or block; the fixture run is the gate.

## Status
todo (wave 0)
