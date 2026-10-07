# T-18: Sign-in robustness

## Goal
Sign-in robustness.

## Gaps covered
G17

## In scope
Core sign-in handling and wizard.

## Out of scope
OAuth/SSO.

## Acceptance criteria
- [ ] A test-sign-in action reports success or one of four named failure reasons.
- [ ] Two-step and modal logins work on fixture pages (tests).
- [ ] Credentials never appear in logs, reports or the Plan (redaction test).
- [ ] Docs updated.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/core packages/runner -t "sign"
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Redaction must not weaken.

## Status
todo (wave 3)
