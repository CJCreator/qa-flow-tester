# T-345: The UX check names every WCAG criterion it reports and reports a small target once

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/ux-quality.ts`
- `packages/checkers/tests/ux-wcag-names.test.ts` (new)
- `packages/checkers/tests/design-ux-checkers.test.ts`

**Do not build in parallel with:** none.

## Problem

Three small faults in the UX check (`packages/checkers/src/ux-quality.ts`).

First, the table that turns axe tags into names (`WCAG_NAMES`, `:31`) has 18 criteria. Axe also reports 1.3.5, 1.4.11, 1.4.12, 2.4.6, 3.3.1, 3.3.3 and 4.1.3. Those show as a bare number ("WCAG 1.4.11") in finding titles and in the coverage list, while their neighbours have names. `keyboard-a11y.ts` uses the same table.

Second, a small touch target can be reported twice. The axe scan runs with the `wcag22aa` tag (`:140`), so axe's `target-size` rule (WCAG 2.5.8, 24 px) can produce an `F-A11Y-...` finding. At 375 px the checker also runs its own target check (`:312-379`) and writes `F-UX-TARGET-...` for the same elements below 24 px (`belowAA`, `:388`). Nothing downstream joins them: the only other mention of the prefix is `core/src/audit/phone-layout.ts:18`, which just recognises it. (Suspected from reading; the browser test below proves it.) The comments disagree too: `:312` says 44 px, `:386-387` says 24 px.

Third, `new (AxeBuilder as any)({ page })` (`:139`) turns off type checking for the axe call.

## Current code

Branch from `main`.

`packages/checkers/src/ux-quality.ts` (`grep -n "WCAG_NAMES\|AxeBuilder as any\|belowAA" packages/checkers/src/ux-quality.ts`):

```ts
const WCAG_NAMES: Record<string, string> = {
  '1.1.1': 'Non-text Content',
  ...
  '4.1.2': 'Name, Role, Value',
};
```

```ts
      const axeResults = await new (AxeBuilder as any)({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
```

```ts
          const belowAA = (target.width < WCAG_MIN_TARGET_PX || target.height < WCAG_MIN_TARGET_PX) && !target.spaced;
```

## Change

1. Add the missing names to `WCAG_NAMES`: `'1.3.5': 'Identify Input Purpose'`, `'1.4.11': 'Non-text Contrast'`, `'1.4.12': 'Text Spacing'`, `'2.4.6': 'Headings and Labels'`, `'3.3.1': 'Error Identification'`, `'3.3.3': 'Error Suggestion'`, `'4.1.3': 'Status Messages'`. Keep the keys in numeric order.
2. Replace `AxeBuilder as any` with a small interface above the call: `interface AxeRunner { withTags(tags: string[]): { analyze(): Promise<unknown> } }` and `type AxeBuilderCtor = new (opts: { page: Page }) => AxeRunner;`. Cast the `AxeBuilder` constant once to `AxeBuilderCtor` (lines 13-17) and call `new AxeBuilder({ page })`. No `any` is left in the file.
3. Remove the double report. In `check()`, declare `let axeFoundTargetSize = false;` before the axe block and set it to `axeResults.violations.some((v) => v.id === 'target-size')` after the scan. In the rule-2 loop (`:386`), skip a target whose `belowAA` is true when `axeFoundTargetSize` is true (`continue`). Suggestion-level targets (24 to 43 px) are the tool's own recommendation and stay. Make the comment at `:312` say what the code does: the AA minimum (24 px) is axe's job when axe ran; this check adds the 44 px recommendation and covers runs with axe switched off (`enableAxe: false`).
4. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- New unit file `packages/checkers/tests/ux-wcag-names.test.ts`: `wcagCriteria(['wcag1411'])` gives `['WCAG 1.4.11 Non-text Contrast']`; one assertion for each of the other six new tags; an unknown tag (`wcag999`) still gives `WCAG 9.9.9`. Pure function, no Chromium.
- In `packages/checkers/tests/design-ux-checkers.test.ts` (already in the `checkers` browser list in `vitest.workspace.ts`, so no workspace edit): a `setContent` page at 375 px with a 10x10 px button. Run `check()` with the axe cache holding a fake scan that has a `target-size` violation: the result has the `F-A11Y` finding and no `Minor` `F-UX-TARGET` finding. Run again with `enableAxe: false`: the `Minor` `F-UX-TARGET` finding is there.

Run: `pnpm exec vitest run packages/checkers/tests/ux-wcag-names.test.ts`, `pnpm exec vitest run --project browser packages/checkers/tests/design-ux-checkers.test.ts`, then the checkers unit tests, then `pnpm build`.

## Done when

- [ ] `grep -c "as any" packages/checkers/src/ux-quality.ts` is `0`.
- [ ] `grep -n "'4.1.3'" packages/checkers/src/ux-quality.ts` finds the new entry.
- [ ] A page with a tiny target and an axe `target-size` violation gives one finding for it, not two (browser test).
- [ ] The new test, the browser test and `pnpm build` pass.

## Notes

- Audit findings L7 and L9 (part) (audit of 11 Nov 2026 on `d225418`).
- `keyboard-a11y.ts` only reads `wcagCriteria`, so its output gains the names without an edit there.
