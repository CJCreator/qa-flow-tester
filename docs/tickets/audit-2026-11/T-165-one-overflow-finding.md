# T-165: one sideways-scroll problem is reported twice with different titles and severities

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | checkers, types | inconsistency | built |

**Files you may edit (no others):**
- `packages/checkers/src/ux-quality.ts`
- `packages/types/src/problems.ts`
- `packages/types/tests/problems-title.test.ts` (created by T-164; create it if it does not exist yet)

**Do not build in parallel with:** T-164, T-167 (same file `ux-quality.ts`), T-164, T-180 (same file `problems.ts`).

## Problem
A page wider than the screen is reported by two checkers:
- `ux-quality` rule 4: "Horizontal page overflow detected (375px)", severity Major at every screen size, tolerance 2px, no element named, counted in the Accessible area.
- `performance` rule 5: "Content overflows the screen horizontally at 375px", Major at 375px and Minor otherwise, tolerance 5px, names the element that sticks out, counted in Fast and mobile.

The same fault lowers two areas and shows as two problems. The performance finding is the better one (it names the element). `plainTitleText` also has no plain sentence for the performance title.

(The 320px reflow check in `keyboard-a11y.ts` is a different test, WCAG 1.4.10 at a different width, and stays.)

## Current code
`packages/checkers/src/ux-quality.ts:445-476` (branch `worktree-audit-cleanup`)
```ts
    // 4. Rule: Horizontal Scroll Overflow
    try {
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 2;
      });

      if (hasOverflow) {
        findings.push({
          id: `F-UX-OVERFLOW-${context.testCaseId || 'GEN'}-${counter++}`,
          testCaseId: context.testCaseId,
          severity: 'Major',
          checker: 'ux-quality',
          title: `Horizontal page overflow detected (${context.breakpoint})`,
          where: {
            urlPath: context.urlPath,
            role: context.role,
            breakpoint: context.breakpoint,
          },
          expectedVsActual: {
            expected: `Page content fits within viewport width (${context.breakpoint}) without horizontal scrolling`,
            actual: 'Page triggers horizontal scrollbar (scrollWidth > innerWidth)',
          },
          stepsToReproduce: [
            `Navigate to ${context.urlPath} at ${context.breakpoint}`,
            `Check for horizontal scrollbar`,
          ],
          evidence: {},
          resolution: 'Ensure broad containers use max-w-full and overflow-x-hidden.',
        });
      }
```
The block continues with the closing `} catch { ... }` of this `try`. Read the file to find its end before deleting.

`packages/types/src/problems.ts:52`
```ts
  if (/^Horizontal page overflow/.test(t)) return 'The page is wider than the screen and scrolls sideways';
```

## Change
1. In `packages/checkers/src/ux-quality.ts`, delete rule 4 completely: from the comment line `// 4. Rule: Horizontal Scroll Overflow` to the closing brace of that `try { ... } catch { ... }`. Leave the rule before it (the Dead End Page rule) and whatever follows untouched. If a later rule is numbered `5.` in its comment, leave the number as it is.
2. In `packages/types/src/problems.ts`, replace line 52 with:
```ts
  if (/^Horizontal page overflow/.test(t) || /^Content overflows the screen horizontally/.test(t))
    return 'The page is wider than the screen and scrolls sideways';
```
   Keep the old pattern: saved reports from earlier Check-ups still carry the old title.

## Tests
1. In `packages/types/tests/problems-title.test.ts` add (create the file with the standard vitest imports and `import { plainTitleText } from '../src/problems.js';` if T-164 has not created it):
```ts
describe('plainTitleText: sideways scrolling', () => {
  it('reads both overflow titles as one plain sentence', () => {
    const plain = 'The page is wider than the screen and scrolls sideways';
    expect(plainTitleText('Content overflows the screen horizontally at 375px')).toBe(plain);
    expect(plainTitleText('Horizontal page overflow detected (375px)')).toBe(plain);
  });
});
```
2. Run:
   `pnpm exec vitest run packages/types/tests/problems-title.test.ts packages/core/tests/recommendations.test.ts`
   `pnpm exec vitest run --project browser packages/checkers/tests/performance.test.ts packages/checkers/tests/design-ux-checkers.test.ts` (browser tier; needs Chromium: `pnpm --filter @qa/core exec playwright install chromium`)
3. Search the tests for the removed title and fix any that expected it: `Grep` for `Horizontal page overflow` and `F-UX-OVERFLOW` under `packages/*/tests`. At the time of writing there are no matches.
4. `pnpm build`

## Done when
- [x] `ux-quality.ts` no longer contains `F-UX-OVERFLOW`.
- [x] The new test passes; `performance.test.ts` and `recommendations.test.ts` pass unchanged.
- [x] `pnpm build` passes.

## Notes
- Do not touch `packages/checkers/src/performance.ts` or `keyboard-a11y.ts`.
- Effect on grades: a sideways-scroll fault now lowers Fast and mobile only, not Accessible as well. That is the intent.
