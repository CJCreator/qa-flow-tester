# T-19: Version 0.1.0 and a release workflow

## Goal
Version 0.1.0 and a release workflow.

## Gaps covered
G31

## In scope
Versions, workflow, template, docs.

## Out of scope
Publishing.

## Acceptance criteria
- [ ] Root and packages carry version 0.1.0 and CHANGELOG matches.
- [ ] A release workflow builds on tag push; it does not run on this branch.
- [ ] The generated workflow template uses a real version ref instead of `__QA_TOOL_REF__`, with a test.
- [ ] The agent creates and pushes no tag; steps are in HUMAN_TODO.

## Dependencies
T-01

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/wizard/tests/workflow.test.ts packages/runner/tests/release-workflow.test.ts
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Template change affects users; test it.

## Status
built (wave 3). Verification waits on T-01 and /verify-all.
