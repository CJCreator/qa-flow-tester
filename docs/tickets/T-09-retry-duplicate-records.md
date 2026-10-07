# T-09: Retried flow on a Test Copy cannot create duplicates

## Goal
Retried flow on a Test Copy cannot create duplicates.

## Gaps covered
G8

## In scope
Core flow runner and namespacing.

## Out of scope
Cleanup of records on the user's site.

## Acceptance criteria
- [ ] Form values entered during a flow carry a per-run namespace (via `entity-namespacing.ts`).
- [ ] A retry reuses the namespace and does not submit a form already submitted (fixture counts posts).
- [ ] Read-only default and Test Copy switch behave as before (test).
- [ ] `docs/CONFIGURATION.md` explains namespacing.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/core -t "namespac"
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Never loosen the read-only default.

## Status
todo (wave 1)
