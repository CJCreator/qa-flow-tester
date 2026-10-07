# T-06: Make open work trackable in the repo

## Goal
Make open work trackable in the repo.

## Gaps covered
G39

## In scope
Docs only.

## Out of scope
GitHub issues (separate yes).

## Acceptance criteria
- [ ] `docs/tickets/INDEX.md` is the tracker and is linked from `docs/README.md`.
- [ ] `CONTRIBUTING.md` states the TODO convention (`TODO(T-nn)`).
- [ ] `.claude/work/backlog.md` stays git-ignored; INDEX statuses are the committed record.
- [ ] `docs/AGENT_WORKFLOW.md` mentions the ticket flow.

## Dependencies
none

## ADR needed
none

## Verification commands
```
grep -n "tickets" docs/README.md CONTRIBUTING.md
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Two trackers drifting; INDEX wins.

## Status
todo (wave 0)
