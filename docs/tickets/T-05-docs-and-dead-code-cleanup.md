# T-05: Bring docs in line with code; remove dead code

## Goal
Bring docs in line with code; remove dead code.

## Gaps covered
G33, G34

## In scope
Docs edits; deletions only from the approved list.

## Out of scope
Deleting anything not approved; rewriting ADRs.

## Acceptance criteria
- [ ] `PRODUCT_GUIDE.md` and README no longer describe the `qa-test` CLI, Report Hub, PostgreSQL/S3, dashboard or port 4000.
- [ ] E2E plan status lines match the deploy workflow; `URL_FIRST_IMPLEMENTATION_PLAN.md` has no dead `GAP_REVIEW.md` link and correct status.
- [ ] `.env.example` lists only current variables, matching `docs/CONFIGURATION.md`.
- [ ] A list of deletion candidates (empty packages, `hub-client.ts`, `hub-push.ts`, `outbox-queue.ts` with their tests and exports, `.claude/worktrees` copies) is approved by the owner before anything is deleted.
- [ ] After approved deletions `pnpm build` passes and grep shows no references.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm build; grep -rn "hub-client\|hub-push\|outbox-queue" packages docs
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
The tests for deleted code go with it; the owner must approve that explicitly in the list.

## Status
todo (wave 0)
