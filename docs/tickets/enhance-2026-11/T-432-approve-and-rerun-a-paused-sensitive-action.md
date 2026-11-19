# T-432: Approve and re-run a paused Sensitive Action

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | core, runner, wizard | feature | later |

**Files you may edit (no others):** `packages/core/src/orchestrator.ts`, `packages/runner/src/routes/plan.ts`, `packages/wizard/src/screens/ReportScreen.tsx`, tests.

## Problem

When the Safety Filter pauses an unapproved Sensitive Action (T-421 and T-422), the Test is marked Skipped with the note "Sensitive Action: paused by the Safety Filter". The person can only approve the action by editing the Plan and testing again.

## Change

- The report shows **Approve and re-run** beside each paused Test.
- Approving it marks that Plan Item's action as approved (`sensitiveApproved`) and re-runs only that Test, on a Test Copy only.

## Owner decision

2026-11-19: keep the note for now and add the button later. The status is `later` until the owner schedules it.

## Done when

A paused Test can be approved from the report, re-runs, and records the action as approved.
