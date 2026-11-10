# T-184: Plan: "Show" reaches a Plan Item inside a closed section, and a bad address hash cannot crash the Plan

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/components/plan/parts.tsx`
- `packages/wizard/src/components/plan/PlanDocument.tsx`
- `packages/wizard/tests/plan-show-item.test.ts` (new)

**Do not build in parallel with:** T-185, T-198, T-200 (all edit `PlanDocument.tsx`).

## Problem

Two faults in jumping to a Plan Item.

1. `showItem` gives up when the item's element is not in the page. Sections and groups render their children only while open, and long lists render only the first 35 items. On a Plan with many pages, the "Show" links in the approval summary and in "Won't run", and a page click on the map (`PlanReviewScreen.tsx:339`), do nothing.
2. The address-hash handler calls `decodeURIComponent(raw)` unguarded and puts the result inside a selector string. A hash such as `#%` throws `URIError`; a hash containing `"` throws a selector syntax error. Both break the effect.

## Current code

`packages/wizard/src/components/plan/parts.tsx:10-21` (branch `worktree-audit-cleanup`)

```tsx
/** Scrolls to a Plan Item and briefly marks it. */
export function showItem(itemId: string): void {
  const el = document.getElementById(itemDomId(itemId));
  if (!el) return;
  // A collapsed section opens first so the item can be seen.
  let parent = el.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
}
```

`packages/wizard/src/components/plan/PlanDocument.tsx:2007-2020`

```tsx
export function PlanDocument({ plan, actions }: { plan: ReviewPlan; actions: PlanActions }) {
  const [view, setView] = useState<View>({ query: '', needsMe: false });
  usePlanKeyboardNavigation();

  useEffect(() => {
    const handleHash = () => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      const decoded = decodeURIComponent(raw);
      const target =
        document.getElementById(decoded) ||
        document.getElementById(itemDomId(decoded)) ||
        document.querySelector<HTMLElement>(`[data-plan-item="${decoded}"]`);
```

`ChunkedList` (line 280) already shows every item when `view.expandAll` is true, and `Section` / `CollapsibleGroup` already open when `view.expandAll` is true (lines 178-191, 239-250).

## Change

1. In `parts.tsx`, replace `showItem` with:

```tsx
/** Fired when a Plan Item is not on the page yet: the Plan opens every section, then the item is found. */
export const OPEN_ALL_EVENT = 'plan:open-all';

/** Decodes an address hash; null when it is not valid percent-encoding. */
export function safeDecodeHash(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function reveal(el: HTMLElement): void {
  // A collapsed section opens first so the item can be seen.
  let parent = el.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
}

/** Scrolls to a Plan Item. An item inside a closed section or past the first 35 is opened first. */
export function showItem(itemId: string): void {
  const el = document.getElementById(itemDomId(itemId));
  if (el) {
    reveal(el);
    return;
  }
  window.dispatchEvent(new Event(OPEN_ALL_EVENT));
  // Two frames: one for the Plan to open its sections, one for their children to render.
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const later = document.getElementById(itemDomId(itemId));
      if (later) reveal(later);
    })
  );
}
```

2. In `PlanDocument.tsx` line 42, add `OPEN_ALL_EVENT` and `safeDecodeHash` to the import from `'./parts'`.
3. In `PlanDocument`, directly after `usePlanKeyboardNavigation();`, add:

```tsx
  useEffect(() => {
    const openAll = () => setView((v) => ({ ...v, expandAll: true }));
    window.addEventListener(OPEN_ALL_EVENT, openAll);
    return () => window.removeEventListener(OPEN_ALL_EVENT, openAll);
  }, []);
```

4. In `handleHash`, replace the `const decoded = …` line and the `const target = …` statement with:

```tsx
      const decoded = safeDecodeHash(raw);
      if (decoded === null) return;
      const target =
        document.getElementById(decoded) ||
        document.getElementById(itemDomId(decoded)) ||
        Array.from(document.querySelectorAll<HTMLElement>('[data-plan-item]')).find(
          (el) => el.dataset.planItem === decoded
        );
```

## Tests

New file `packages/wizard/tests/plan-show-item.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { itemDomId, safeDecodeHash } from '../src/components/plan/parts';

describe('Plan item addresses', () => {
  it('decodes a valid hash', () => {
    expect(safeDecodeHash('page%3A%2Fpricing')).toBe('page:/pricing');
  });
  it('returns null for a malformed hash instead of throwing', () => {
    expect(safeDecodeHash('%')).toBeNull();
    expect(safeDecodeHash('%E0%A4%A')).toBeNull();
  });
  it('keeps element ids free of selector characters', () => {
    expect(itemDomId('page:/a"b')).toBe('item-page_a_b');
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/plan-show-item.test.ts` then `pnpm build`.

## Done when

- [x] `showItem` on an item inside a closed section opens every section and scrolls to it.
- [x] `#%` and a hash containing `"` no longer throw.
- [x] No template string builds a `[data-plan-item="…"]` selector from the hash in `handleHash`.
- [x] New test and `pnpm build` pass.

## Notes

- Leave line 1995 (`usePlanKeyboardNavigation`'s selector) alone: `activeItemId` comes from the page's own `data-plan-item` values, not from the address.
- Do not render closed sections' children eagerly; that is why they are lazy.
