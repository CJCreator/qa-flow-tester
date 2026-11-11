# T-191: Visual Baselines: offer the Slider only when there is a new screenshot to compare

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/VisualBaselinesScreen.tsx`
- `packages/wizard/tests/visual-baselines-view.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

A baseline's `currentUrl` (the screenshot from the latest Check-up) is optional, and the runner does not send it today (`packages/runner/src/server.ts` declares the field and never fills it). The screen still offers the "Slider" view, which then shows only the baseline with a slider that moves nothing.

## Current code

`packages/wizard/src/screens/VisualBaselinesScreen.tsx` (branch `worktree-audit-cleanup`)

Lines 149-152:

```tsx
  // "What changed" carries over from the last baseline; one without a diff falls back to side by side.
  const shownMode: ViewMode = viewMode === 'diff-only' && !activeItem?.diffUrl ? 'split' : viewMode;

  const viewButton = (mode: ViewMode, label: string) => (
```

Lines 339-343:

```tsx
                    <div className="segmented [&>button]:min-h-[44px]" role="group" aria-label="How to compare">
                      {viewButton('split', 'Side by side')}
                      {viewButton('overlay', 'Slider')}
                      {activeItem.diffUrl && viewButton('diff-only', 'What changed')}
                    </div>
```

## Change

1. Above the component (module level), add and export:

```tsx
/** The view to show: a chosen view the baseline cannot offer falls back to side by side. */
export function viewFor(
  chosen: 'split' | 'overlay' | 'diff-only',
  item: { currentUrl?: string; diffUrl?: string } | null
): 'split' | 'overlay' | 'diff-only' {
  if (chosen === 'diff-only' && !item?.diffUrl) return 'split';
  if (chosen === 'overlay' && !item?.currentUrl) return 'split';
  return chosen;
}
```

2. Replace lines 149-150 with:

```tsx
  // A view carries over from the last baseline; one this baseline cannot offer falls back to side by side.
  const shownMode: ViewMode = viewFor(viewMode, activeItem);
```

3. Replace the Slider button line with:

```tsx
                      {activeItem.currentUrl && viewButton('overlay', 'Slider')}
```

## Tests

New file `packages/wizard/tests/visual-baselines-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { viewFor } from '../src/screens/VisualBaselinesScreen';

describe('Visual Baselines view', () => {
  it('keeps side by side always', () => {
    expect(viewFor('split', null)).toBe('split');
    expect(viewFor('split', {})).toBe('split');
  });
  it('offers the slider only with a new screenshot', () => {
    expect(viewFor('overlay', {})).toBe('split');
    expect(viewFor('overlay', { currentUrl: '/x.png' })).toBe('overlay');
  });
  it('offers what changed only with a diff', () => {
    expect(viewFor('diff-only', { currentUrl: '/x.png' })).toBe('split');
    expect(viewFor('diff-only', { diffUrl: '/d.png' })).toBe('diff-only');
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/visual-baselines-view.test.ts` then `pnpm build`.

## Done when

- [x] A baseline without `currentUrl` shows no Slider button.
- [x] Choosing Slider on one baseline, then opening one without `currentUrl`, shows side by side with "Side by side" pressed.
- [x] New test and `pnpm build` pass.

## Notes

- If `ViewMode` is not exactly `'split' | 'overlay' | 'diff-only'`, use `ViewMode` in `viewFor`'s signature instead (it is declared near the top of the file).
- Out of scope (runner ticket): filling `currentUrl` so "Keep the new screenshot as the baseline" can appear. The wizard side is already guarded (`handleAccept`, lines 94-98).
