# T-183: Visibility screen: show "Not checked" instead of 100% when search checks did not run

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/VisibilityScreen.tsx`
- `packages/wizard/tests/visibility-not-checked.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

When a Check-up ran with search checks off, the `Findable` area comes back with `checked: false` (`packages/core/src/scoring.ts:191-198`), but its `subBreakdown` (seo, aeo, geo) is still filled with score 100. The Visibility tabs read only the sub-parts, so "SEO", "AI answers" and "AI search" each show `100%` with grade A for something nothing checked. A missing part also shows `100%` (`part?.score ?? 100`).

## Current code

`packages/wizard/src/screens/VisibilityScreen.tsx` (branch `worktree-audit-cleanup`)

Lines 113-114:

```tsx
  const findable = report.grades?.aspects['Findable'];
  const subBreakdown = findable?.subBreakdown;
```

Lines 176-177 (inside `TABS.map`):

```tsx
          const scoreDisplay = part?.checked === false ? 'Not checked' : `${part?.score ?? 100}%`;
          const grade = part?.score !== undefined && part.checked !== false ? gradeForScore(part.score) : undefined;
```

## Change

1. Above the `VisibilityScreen` component (module level, after the imports), add and export this pure helper:

```tsx
/** The text on a Visibility tab: a part nothing checked is "Not checked", never 100%. */
export function tabScoreText(part: { score: number; checked?: boolean } | null | undefined): string {
  return !part || part.checked === false ? 'Not checked' : `${part.score}%`;
}
```

2. Replace line 114 with:

```tsx
  // An area nothing checked has no sub-scores to show, even though scoring still fills them in.
  const subBreakdown = findable?.checked === false ? undefined : findable?.subBreakdown;
```

3. Replace line 176 with:

```tsx
          const scoreDisplay = tabScoreText(part);
```

   Leave line 177 (`grade`) as it is: with `part` null it is already `undefined`.

## Tests

New file `packages/wizard/tests/visibility-not-checked.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tabScoreText } from '../src/screens/VisibilityScreen';

describe('Visibility tab score', () => {
  it('says Not checked when there is no part', () => {
    expect(tabScoreText(null)).toBe('Not checked');
    expect(tabScoreText(undefined)).toBe('Not checked');
  });
  it('says Not checked when the part was not checked', () => {
    expect(tabScoreText({ score: 100, checked: false })).toBe('Not checked');
  });
  it('shows the score otherwise', () => {
    expect(tabScoreText({ score: 82 })).toBe('82%');
    expect(tabScoreText({ score: 0, checked: true })).toBe('0%');
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/visibility-not-checked.test.ts` then `pnpm build`.

## Done when

- [x] A report whose `Findable.checked` is `false` shows "Not checked" on all four tabs and no grade.
- [x] No `?? 100` remains in `VisibilityScreen.tsx`.
- [x] New test and `pnpm build` pass.

## Notes

- Do not change `packages/core/src/scoring.ts`.
- "Not checked" is the wording already used on this screen for the marketing tab; keep it exactly.
