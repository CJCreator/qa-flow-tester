# T-398: The AI Request Budget is a hard stop

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core, runner | cost control | todo |

**Files you may edit (no others):**
- `packages/core/src/plan/ai-budget.ts`
- `packages/core/src/ai/ai-provider.ts`
- `packages/core/src/audit/ai/stage-ai.ts`
- `packages/runner/src/session/checkup-run.ts` (the budget wiring only)
- tests

**Do not build in parallel with:** T-406, T-413 (AI calls).

## Problem (verify first)

The guide describes an AI Request Budget the user sets. The review found no code that refuses a call once the budget is reached. `ai-budget.ts` only tunes the estimate (`MAX_CONCURRENCY = 4`, `TYPICAL_TESTED_PAGES = 24`). Check whether `discovery-agent.ts`, `routes/plan.ts` or `server.ts` already enforce it.

## Change

- Keep one counter per run, shared by the Check-up planner and every audit stage (assessment, recommendations, preview, Improved version).
- A call past the budget is not sent:
  - the audit stage records "not done: AI Request Budget reached" (`notDone`, `audit/ai/assessment.ts`);
  - the Check-up uses the Fixed-Rule Fallback.
- The estimate shown before a run counts with the same counter.

## Tests

With a budget of 3, exactly 3 calls are sent, and the 4th stage is "not done" with that reason.

## Done when

The test passes, and the progress screen shows "AI requests: 3 of 3".
