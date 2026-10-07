# T-15: Run our own check-up on our landing page

## Goal
Run our own check-up on our landing page.

## Gaps covered
G47

## In scope
Run, fix, document.

## Out of scope
Marketing items needing the owner (testimonials).

## Acceptance criteria
- [ ] Check-up of the landing page is run and a summary saved under `docs/research/`.
- [ ] Findings are fixed or filed as tickets with reasons.
- [ ] A repeatable command is documented in `docs/TESTING.md`.
- [ ] What could not be verified is stated.

## Dependencies
T-13, T-14

## ADR needed
none

## Verification commands
```
pnpm start, then run a check-up on the landing page
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Needs a running app; happens in the verify phase.

## Status
todo (wave 2)
