# T-391: Every export prints the same count

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core, runner | correctness | todo |

**Files you may edit (no others):**
- `packages/core/src/reporter.ts`, `packages/core/src/html-report.ts`, `packages/core/src/issues-document.ts`, `packages/core/src/issues-html.ts`
- `packages/runner/src/checkup.ts` (the summary line only)
- `docs/findings.schema.json`
- tests

**Depends on:** T-389.

## Problem (verify first)

The review checked only that these outputs call `releaseVerdict`, not which number each one prints.

## Change

1. List the number each file prints today.
2. Point every headline at `countSummary(...).problems`, labelled "Problems that count", with the same breakdown line as the report screen.
3. `findings.json` keeps every finding and gains an optional `summary` object, added to the schema (ADR 0017).

## Tests

`packages/core/tests/export-counts.test.ts`: `report.md`, `report.html`, `issues.md`, the stamp and the CI summary all print the same number for one fixture result.

## Done when

For one run, all five outputs print the same "Problems that count".
