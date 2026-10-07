# T-22: Accessibility and security depth

## Goal
Accessibility and security depth.

## Gaps covered
G16

## In scope
Checkers.

## Out of scope
CrUX panel (external API; split out).

## Acceptance criteria
- [ ] Keyboard traversal, focus-obscured and trap checks, and 320 px reflow each have a checker and a passing and failing fixture test.
- [ ] SRI, source maps, `security.txt` and fuller CSP checks each have a unit test.
- [ ] Claim wording follows ADR 0018; scoring tests still pass.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/checkers
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Benchmark after; false positives.

## Status
todo (wave 4)
