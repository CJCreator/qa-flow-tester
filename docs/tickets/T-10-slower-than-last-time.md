# T-10: "Slower than last time" rule (20% and 300 ms)

## Goal
"Slower than last time" rule (20% and 300 ms).

## Gaps covered
G9

## In scope
Performance comparison in checkers/core.

## Out of scope
Changing scores or grades.

## Acceptance criteria
- [ ] Flagged only when slower by both 20% and 300 ms versus the stored previous run (tests just under and just over).
- [ ] No flag without history.
- [ ] Wording follows `CONTEXT.md` and ADR 0018; shows in report and `findings.json`.
- [ ] `docs/API.md` updated if `findings.json` changes.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/checkers packages/core -t "slower"
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Noise on short runs: both thresholds required.

## Status
todo (wave 1)
