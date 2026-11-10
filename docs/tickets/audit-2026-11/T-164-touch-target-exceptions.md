# T-164: touch-target check ignores the WCAG 2.5.8 spacing and inline exceptions, and its plain title is stale

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | checkers, types | bug | todo |

**Files you may edit (no others):**
- `packages/checkers/src/ux-quality.ts`
- `packages/types/src/problems.ts`
- `packages/types/tests/problems-title.test.ts` (new)

**Do not build in parallel with:** T-165, T-167 (same file `ux-quality.ts`), T-165, T-180 (same file `problems.ts`).

## Problem
At 375px the checker titles any link or button narrower or shorter than 24px "Touch target below WCAG 2.5.8 minimum". WCAG 2.2 success criterion 2.5.8 has two exceptions the check ignores:
- **Inline:** a link inside a sentence is exempt.
- **Spacing:** an undersized target passes when a 24px circle centred on it touches no other target.

So an ordinary header link "Home (39x17px)" with space around it, and every link inside a paragraph, is reported as a WCAG failure.

Second fault: `plainTitleText` in `@qa/types` still matches the old title "Touch target too small: ...". The checker now writes "Touch target below WCAG 2.5.8 minimum: ..." and "Touch target smaller than recommended: ...", so the report shows the technical title instead of the plain sentence.

## Current code
`packages/checkers/src/ux-quality.ts:314-348` (branch `worktree-audit-cleanup`)
```ts
        const smallTargets = await page.evaluate(() => {
          const interactive = Array.from(
            document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')
          );
          return interactive
            .filter((el) => {
              if (el.classList.contains('sr-only') || el.closest('.sr-only')) return false;
              if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) return false;
              if (el.closest('details:not([open])')) return false;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
              if (
                typeof el.checkVisibility === 'function' &&
                !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
              )
                return false;
              return true;
            })
            .map((el) => {
              const rect = el.getBoundingClientRect();
              const testId = el.getAttribute('data-testid');
              const text = (el.textContent || '').trim().substring(0, 30);
              const ariaLabel = el.getAttribute('aria-label');
              return {
                width: rect.width,
                height: rect.height,
                testId,
                text,
                ariaLabel,
                tagName: el.tagName.toLowerCase(),
                visible: rect.width > 0 && rect.height > 0,
              };
            })
            .filter((item) => item.visible && (item.width < 44 || item.height < 44));
        });
```
`packages/checkers/src/ux-quality.ts:355`
```ts
          const belowAA = target.width < WCAG_MIN_TARGET_PX || target.height < WCAG_MIN_TARGET_PX;
```
`packages/types/src/problems.ts:48-50`
```ts
  if ((m = t.match(/^Touch target too small: (.+?) \(\d+x\d+px\)$/)))
    return `“${m[1].replace(/^["“]|["”]$/g, '')}” is too small to tap easily on a phone`;
  if (/^Touch target too small/.test(t)) return 'A button is too small to tap easily on a phone';
```

## Change
1. In `packages/checkers/src/ux-quality.ts`, replace the `.map(...)` and the final `.filter(...)` of the evaluate (from `.map((el) => {` to `.filter((item) => item.visible && (item.width < 44 || item.height < 44));`) with:
```ts
            .map((el) => {
              const rect = el.getBoundingClientRect();
              const testId = el.getAttribute('data-testid');
              const text = (el.textContent || '').trim().substring(0, 30);
              const ariaLabel = el.getAttribute('aria-label');
              // WCAG 2.5.8 inline exception: a link inside a sentence (its parent holds other text too).
              const parentText = (el.parentElement?.textContent || '').trim();
              const inSentence =
                el.tagName === 'A' &&
                window.getComputedStyle(el).display === 'inline' &&
                parentText.length > (el.textContent || '').trim().length + 20;
              return {
                width: rect.width,
                height: rect.height,
                left: rect.left,
                top: rect.top,
                testId,
                text,
                ariaLabel,
                tagName: el.tagName.toLowerCase(),
                visible: rect.width > 0 && rect.height > 0,
                inSentence,
                spaced: false,
              };
            })
            .filter((item) => item.visible && !item.inSentence)
            .map((item, index, all) => {
              // WCAG 2.5.8 spacing exception: a 24px circle centred on an undersized target must not
              // touch another target, nor the 24px circle of another undersized target.
              if (item.width >= 24 && item.height >= 24) return item;
              const cx = item.left + item.width / 2;
              const cy = item.top + item.height / 2;
              const touches = all.some((other, j) => {
                if (j === index) return false;
                const otherSmall = other.width < 24 || other.height < 24;
                if (otherSmall) {
                  const ox = other.left + other.width / 2;
                  const oy = other.top + other.height / 2;
                  return Math.hypot(cx - ox, cy - oy) < 24;
                }
                const nearestX = Math.max(other.left, Math.min(cx, other.left + other.width));
                const nearestY = Math.max(other.top, Math.min(cy, other.top + other.height));
                return Math.hypot(cx - nearestX, cy - nearestY) < 12;
              });
              return { ...item, spaced: !touches };
            })
            .filter((item) => item.width < 44 || item.height < 44);
```
2. Same file, replace the `belowAA` line with:
```ts
          const belowAA =
            (target.width < WCAG_MIN_TARGET_PX || target.height < WCAG_MIN_TARGET_PX) && !target.spaced;
```
   Nothing else in the loop changes. A spaced target under 24px is now reported with the existing "smaller than recommended" title at severity Suggestion. A link inside a sentence is not reported at all.
3. In `packages/types/src/problems.ts`, replace the three lines shown above with:
```ts
  if (
    (m = t.match(
      /^Touch target (?:too small|below WCAG 2\.5\.8 minimum|smaller than recommended): (.+?) \(\d+x\d+px\)$/
    ))
  )
    return `“${m[1].replace(/^["“]|["”]$/g, '')}” is too small to tap easily on a phone`;
  if (/^Touch target/.test(t)) return 'A button is too small to tap easily on a phone';
```

## Tests
1. Create `packages/types/tests/problems-title.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { plainTitleText } from '../src/problems.js';

describe('plainTitleText: touch targets', () => {
  it('reads all three touch-target titles as one plain sentence', () => {
    const plain = '“Home” is too small to tap easily on a phone';
    expect(plainTitleText('Touch target too small: Home (37x18px)')).toBe(plain);
    expect(plainTitleText('Touch target below WCAG 2.5.8 minimum: Home (20x18px)')).toBe(plain);
    expect(plainTitleText('Touch target smaller than recommended: Home (39x30px)')).toBe(plain);
  });
  it('falls back to a general sentence when the title has no size', () => {
    expect(plainTitleText('Touch target too small')).toBe('A button is too small to tap easily on a phone');
  });
});
```
   Run: `pnpm exec vitest run packages/types/tests/problems-title.test.ts`
2. The in-page code of step 1 runs inside `page.evaluate`, which unit tests replace with a mock, so it gets no unit test. Check it by reading, then run the existing suites that touch these titles:
   `pnpm exec vitest run packages/core/tests/finding-groups.test.ts packages/wizard/tests/translate.test.ts packages/wizard/tests/context-url-summary.test.ts`
3. `pnpm exec vitest run --project browser packages/checkers/tests/design-ux-checkers.test.ts` (browser tier, real Chromium; install with `pnpm --filter @qa/core exec playwright install chromium`). If a test there expects a touch-target finding for a link inside a sentence or for a small target with clear space around it, update that expectation to the new rule (no finding for the sentence link; `Touch target smaller than recommended` at Suggestion for the spaced target).
4. `pnpm build`

## Done when
- [ ] The new types test passes.
- [ ] The three existing suites in step 2 pass unchanged.
- [ ] `pnpm build` passes.

## Notes
- `WCAG_MIN_TARGET_PX` is 24 and already defined in `ux-quality.ts`. The numbers 24 and 12 inside the evaluate are written out because code inside `page.evaluate` cannot read variables from outside it.
- Two findings that differ only in title prefix now share one plain title, so the report groups them. That is intended.
- Out of scope: the 44px recommendation and the limit of 10 findings per page.
