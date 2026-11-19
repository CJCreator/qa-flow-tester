# T-389: One count, live and final (`countSummary`)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | types, core, wizard | correctness | todo |

**Files you may edit (no others):**
- `packages/types/src/problems.ts`, `packages/types/src/verdict.ts`, `packages/types/src/count-summary.ts` (new), `packages/types/src/index.ts`
- `packages/core/src/orchestrator.ts`
- `packages/wizard/src/lib/translate.ts`, `packages/wizard/src/screens/TestingScreen.tsx`, `packages/wizard/src/lib/summary.ts`, `packages/wizard/src/screens/ReportScreen.tsx`
- `docs/API.md` (the event shape)
- the tests below

**Do not build in parallel with:** T-393, T-409, T-408 (orchestrator chain); T-396 (wizard screens).

## Problem

The live "Found so far: N problems" and the report count different things, so the numbers never match.

## Current code

- **Live:** `FINDINGS_UPDATED.totalFindings = allFindings.length` (`orchestrator.ts:1537-1548`). These are raw findings, one per Test point × screen size. `latest` carries only id, title, severity, checker, urlPath and breakpoint.
- **Wizard:** `found` keeps the 50 newest raw findings (`translate.ts:69,303`, `FOUND_KEPT = 50`). `TestingScreen.tsx:93-112,244` groups them **by title** and shows "Found so far: {problems.length} problems". Older titles drop out, so the number can go down.
- **Access-check findings** are pushed after the last live event (`orchestrator.ts:1585`).
- **Final:**
  - `mergeDuplicateFindings` (`:1642`), then suppressions;
  - then `releaseVerdict` drops advisory, `ai-review` and `toConfirm` findings (`verdict.ts:118,126`);
  - it reports `total` and `findings` (`:225-227`).

## Change

- **Types:** add `countSummary(findings): { raw, merged, problems, dismissed, advisory, toConfirm }` to `packages/types`, built on the merge key and on `groupIntoProblems`. `releaseVerdict` uses it for `total`, `toConfirm` and `findings`.
- **Orchestrator:**
  - Send `summary: countSummary(allFindings)` with every `FINDINGS_UPDATED`.
  - Send one more event after the access checks.
  - `latest` gains `issueKey`, `advisory`, `needsConfirmation` and `triageStatus`.
  - Suppressions are applied only after the run. The live breakdown labels that step "dismissed after the run".
- **Wizard:**
  - The headline is `summary.problems`, labelled **Problems that count**.
  - Under it, a breakdown line: "142 raw → 61 merged → 9 dismissed, 4 AI notes, 3 to confirm → 45".
  - `FOUND_KEPT` limits only the visible list, never the count.
- **Report screen:** the same breakdown line.

## Tests

- `packages/types/tests/count-summary.test.ts`: one set of findings gives the same numbers through `countSummary` and `releaseVerdict`.
- `packages/wizard/tests/live-count.test.tsx`:
  - 120 findings at 3 sizes give the same headline as the report;
  - the headline never goes down when old items leave the list.

## Done when

On a Check-up of techgramam.com, the last live "Problems that count" equals the report headline.
