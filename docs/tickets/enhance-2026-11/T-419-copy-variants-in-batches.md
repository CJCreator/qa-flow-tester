# T-419: Copy variants in batches

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core, runner, wizard | feature | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/ai/rewrite.ts`, `packages/core/src/audit/ai/rewrite-store.ts`
- `packages/runner/src/routes/audit-ai.ts`
- `packages/wizard/src/screens/audit/ai/RewriteReview.tsx`, `packages/wizard/src/screens/audit/improved/ImprovedVersionScreen.tsx`
- tests

**Depends on:** T-417.

## Problem

Today a rewrite covers one Section, and each Section needs approval before it is written (`rewrite.ts`, `audit-ai.ts:139` "Approve this Section for a rewrite first.").

## Change

- **Suggested Sections:** the Improved version screen lists the Sections linked to the top findings.
- **Batch approval:** **Approve these Sections** approves the ticked ones in one step. The approval rule stays; only the clicking gets easier.
- **Drafts:** each approved Section gets 2 copy variants, written in one batch call per 5 Sections.
- **Checks kept:** the overlap check (`DEFAULT_REWRITE_OVERLAP_WORDS`) and the claim-word check. Accepting a draft still writes to the edit overlay only.

## Tests

- Approving 5 Sections gives 10 drafts from 1 call.
- A draft that copies the original fails with `ERR_OVERLAP`.

## Done when

The tests pass, and on techgramam.com the top 5 Sections get drafts in one step.
