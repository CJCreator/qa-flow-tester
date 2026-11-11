# T-334: One `guessFillValue` for page tests and journeys

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | core | duplication | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/fill-values.ts`
- `packages/core/src/plan/journeys.ts`
- `packages/core/tests/fill-values.test.ts`

**Do not build in parallel with:** T-333 (edits `journeys.ts`).

## Problem

Two functions named `guessFillValue` choose a test value for a form field. One is exported from `packages/core/src/plan/fill-values.ts:10` and used by page tests (`ai-planner.ts:584`) and Rejects (`rejects.ts:115`). The other is a private copy in `packages/core/src/plan/journeys.ts:63-85`, used to fill a journey step the AI left empty (`journeys.ts:292`). They give different values for the same field: a phone is `5555550123` in one and `+15555550123` in the other, a price is `1` or `49.99`, and only the journeys copy knows search, date, zip, first name and last name. The same field is filled differently depending on which part of the Plan reaches it.

## Current code

Branch from `main`.

`grep -n "guessFillValue" packages/core/src/plan/*.ts`:

```
fill-values.ts:10:export function guessFillValue(target: string): string {
journeys.ts:63:function guessFillValue(step: { selector?: string; name: string }): string {
journeys.ts:292:          step.value = guessFillValue(step);
ai-planner.ts:584:            : guessFillValue(`${s.selector} ${target.name}`)
rejects.ts:115:  } else value = guessFillValue(`${input.selector} ${input.label ?? ''}`);
```

`journeys.ts` already imports `fieldHint` from `./fill-values.js` (line 19).

## Change

1. `fill-values.ts`: make `guessFillValue(target)` the richer of the two, keeping the order that avoids wrong matches: email, password, search/query/find (`test`), date/birth/dob (`2026-11-01`), zip/postal (`90210`), price/cost/total (`49.99`), url/address/site/domain/host (`https://example.com`), phone/tel/mobile (`+15555550123`), number/amount/qty/quantity/count (`1`), first+name (`Alex`), last+name (`Smith`), name (`Test User`), else `Test Value`. Keep the `quantity` and `price` words from the old exported version (`qty|quantity|price` gave `1`; price now gives `49.99`, check `fill-values.test.ts` and `rejects` tests still hold).
2. `journeys.ts`: delete the private `guessFillValue` (lines ~62-85) and import the shared one: `import { fieldHint, guessFillValue } from './fill-values.js';` (drop `fieldHint` from the import if it is no longer used). The call becomes `guessFillValue(`${step.selector || ''} ${step.name}`)`.
3. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

`packages/core/tests/fill-values.test.ts`: keep the four existing cases. Add: `[name="search"]` gives `test`; `input[type=date] Date of birth` gives `2026-11-01`; `#zip Postal code` gives `90210`; `[name="phone"] Mobile` gives `+15555550123`; `[name="first_name"]` gives `Alex`; `[name="last_name"]` gives `Smith`; `[name="price"] Price` gives `49.99`; `input[name="quantity"] Quantity` still gives `1`.

Run: `pnpm exec vitest run packages/core/tests/fill-values.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -rn "function guessFillValue" packages/core/src` finds one definition.
- [ ] The core unit tests pass (including the Rejects tests); `pnpm build` passes.

## Notes

- Audit finding L13, duplicated helper (audit of 11 Nov 2026 on `d225418`).
- A Reject test may use the value as a valid entry (`rejects.ts:115`); if a Reject case fails because a phone or price value changed, fix the case, not the shared function.
- Related open ticket: T-333 (same `journeys.ts`, builds first).
