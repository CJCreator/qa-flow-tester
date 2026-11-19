# T-390: Website Audit counts say findings and rules

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core, wizard | correctness | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/pipeline/pipeline.ts` (the saved counts only)
- `packages/types/src/website-audit.ts` (`AuditVersion` counts)
- `packages/wizard/src/screens/audit/saved/saved-api.ts`
- `packages/wizard/src/screens/audit/results/AuditSummary.tsx`, `packages/wizard/src/screens/audit/results/FindingsList.tsx`
- `packages/core/src/audit/documents/findings.ts`
- tests

**Do not build in parallel with:** T-404, T-405, T-406, T-407 (`pipeline.ts`); T-417 (`findings.ts`).

## Problem

Three numbers disagree:
- Saved audits show "N findings" from `findings: findings.length` (`pipeline.ts:925`, `saved-api.ts:269-275`): one per rule × page.
- The Findings list groups findings (`FindingsList.tsx:32,98`).
- Grades count one rule as one problem (`grades.ts:56`).

## Change

- Save both `findings` and `rules`, where `rules` counts distinct `rule` values that are not advisory.
- Show "312 findings · 41 rules" in Saved audits, on the summary and in the Findings document header.
- When edits remove pages, the document header shows the counts after the edits and says so.

## Tests

- `packages/core/tests/audit-pipeline.test.ts`: the saved counts.
- `packages/wizard/tests/audit-counts.test.tsx`: the label.

## Done when

Saved audits, the summary and the document header show the same two numbers for one version.
