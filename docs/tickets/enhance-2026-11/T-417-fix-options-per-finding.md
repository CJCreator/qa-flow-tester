# T-417: Fix options per finding

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core, wizard | feature | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/improve/fix-options.ts` (new), `packages/core/src/audit/improve/fix-rules.ts` (new)
- `packages/core/src/audit/documents/findings.ts`, `packages/core/src/audit/documents/roadmap.ts`
- `packages/wizard/src/screens/audit/improved/ImprovedVersionScreen.tsx`
- tests

**Depends on:** T-390 (`findings.ts`) and T-412.

## Change

- **Rule options:** for each of the top 10 findings (ranked by impact, then lower effort), 2 or 3 fix options, each with an effort size (S, M or L) and a trade-off. Fixed rule text per `rule` in `fix-rules.ts`, labelled "decided by rule". These work without an AI key.
- **AI options (with a key):** one call per batch of 5 findings adds site-specific options. Each option cites its finding id, uses no claim words, and gives no score.
- **Where they appear:** in the Findings document, under each finding, and on the Improved version screen. Roadmap rows link to the chosen option.

## Tests

- Without a key, every top finding has at least 2 options by rule.
- With the mock AI, every option cites its finding.

## Done when

The tests pass, and the Findings document of mghealthtech.com shows options under each of its top 10 findings.
