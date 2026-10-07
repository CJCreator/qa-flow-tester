# T-23: Split large files by area

## Goal
Split large files by area.

## Gaps covered
G35

## In scope
Pure moves.

## Out of scope
New features.

## Acceptance criteria
- [ ] Becomes sub-tickets T-23a.. one per file (`server.ts`, `orchestrator.ts`, `types/src/index.ts`, `App.tsx`).
- [ ] Each split: no behaviour change, public exports unchanged, full suite green before and after.
- [ ] Each file ends at an agreed smaller size.

## Dependencies
T-01

## ADR needed
maybe

## Verification commands
```
pnpm build; the full suite
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Highest conflict risk; one at a time.

## Status
todo (wave 4)
