# T-418: Competitor examples in the Improved version

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core, wizard | feature | todo |

**Files you may edit (no others):** `packages/core/src/audit/competitors/examples.ts` (new), `packages/core/src/audit/improve/variants.ts` (prompt input only), `packages/wizard/src/screens/audit/improved/ImprovedVersionScreen.tsx`, tests.

**Depends on:** T-416 and T-413.

## Change

- **Examples per finding:** for each top finding, show what each competitor does on the same page type. The text comes from the comparison facts. It states only what was seen, on which page of which competitor (ADR 0018), for example: "competitor.example shows a phone number in the header on /contact".
- **Optional input to variants:** design variants can take the competitor facts as input ("borrow what works"), with each borrowed idea cited by competitor and page.
- **No copying:** competitor text and images are never copied into a variant. The `rewrite.ts` overlap check runs against competitor text too.

## Tests

- Examples cite the competitor and the page.
- A variant that copies a competitor sentence fails the overlap check.

## Done when

The tests pass, and the screen shows competitor examples beside the top findings.
