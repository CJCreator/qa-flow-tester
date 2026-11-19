# T-398: The AI Request Budget covers the audit AI stages and the Improved version

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

## Problem (rescoped)

The Check-up budget is already a hard stop. `PacedAI` (`packages/core/src/plan/ai-budget.ts:190-196`) refuses a request when `used >= allowance` (`BudgetSpentError`), when the person's request cap is reached (`CapSpentError('requests')`), and when the dollar cap is reached. The first version of this ticket assumed no such code. What is missing:
- The audit AI stages (assessment, recommendations, preview) and the Improved version do not share that counter with the Check-up planner, so a run can pass the budget through them.
- The estimate shown before an audit step does not count with the same counter.

Verify first: read `PacedAI` and `audit/ai/stage-ai.ts`, and list which audit stages call the provider outside a `PacedAI`.

## Change

- Extend the one existing counter to every audit AI stage (assessment, recommendations, preview) and to the Improved version, by sending their calls through `PacedAI`.
- A call past the budget is not sent:
  - the audit stage records "not done: AI Request Budget reached" (`notDone`, `audit/ai/assessment.ts`);
  - the Check-up keeps its Fixed-Rule Fallback.
- The estimate shown before an audit step counts with the same counter.
- Do not change how `PacedAI` refuses a call.

## Tests

With a budget of 3, exactly 3 calls are sent across the audit stages, and the 4th stage is "not done" with that reason.

## Done when

The test passes, and the progress screen shows "AI requests: 3 of 3".
