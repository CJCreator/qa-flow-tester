# T-182: Plan Review: save pending Plan Item switches before approving

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/PlanReviewScreen.tsx`

**Do not build in parallel with:** none.

## Problem

Switching a Plan Item off is saved 300 ms later (a debounce). Approve does not wait for it and is not disabled while a switch is unsaved. Scenario: switch an item off, press "Approve and test" within 300 ms. The Plan is approved with the item still on, so it runs. The screen then unmounts, the cleanup sends the PATCH to a Plan that is no longer under review, and the change is lost with no message.

## Current code

`packages/wizard/src/screens/PlanReviewScreen.tsx` (branch `worktree-audit-cleanup`)

Line 154:

```tsx
  const busy = pending || update.running;
```

Lines 178-202:

```tsx
  const flushToggles = async () => {
    if (pendingTogglesRef.current.size === 0) return;
    const items = Array.from(pendingTogglesRef.current.entries()).map(([id, skipped]) => ({ id, skipped }));
    pendingTogglesRef.current.clear();
    const affectedIds = items.map((i) => i.id);
    const ok = await edit(() => patchPlan({ items }));
    if (!ok) {
      setError('That change wasn’t saved, so it’s back as it was. Try it again.');
    }
    setSwitched((s) => Object.fromEntries(Object.entries(s).filter(([id]) => !affectedIds.includes(id))));
  };

  const switchItems = (ids: string[], skipped: boolean) => {
    // 1. Optimistic UI update immediately
    setSwitched((s) => ({ ...s, ...Object.fromEntries(ids.map((id) => [id, skipped])) }));

    // 2. Add to batch queue
    ids.forEach((id) => pendingTogglesRef.current.set(id, skipped));

    // 3. Clear existing debounce timer and schedule flush
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void flushToggles();
    }, 300);
  };
```

Line 442 and line 476 (the two approve calls):

```tsx
                onSubmit={(roles) => onApprove(roles)}
```

```tsx
            onClick={() => onApprove()}
```

## Change

1. Make `flushToggles` report success. Replace its first line and its ending so it reads:

```tsx
  /** Saves the queued switches now. True when nothing was queued or the save worked. */
  const flushToggles = async (): Promise<boolean> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingTogglesRef.current.size === 0) return true;
    const items = Array.from(pendingTogglesRef.current.entries()).map(([id, skipped]) => ({ id, skipped }));
    pendingTogglesRef.current.clear();
    const affectedIds = items.map((i) => i.id);
    const ok = await edit(() => patchPlan({ items }));
    if (!ok) {
      setError('That change wasn’t saved, so it’s back as it was. Try it again.');
    }
    setSwitched((s) => Object.fromEntries(Object.entries(s).filter(([id]) => !affectedIds.includes(id))));
    return ok;
  };
```

2. Directly after `flushToggles`, add:

```tsx
  /** Approves only after every switch is saved: an unsaved switch-off would still run. */
  const approve = async (roles?: RoleCredential[]) => {
    if (!(await flushToggles())) return;
    onApprove(roles);
  };
```

3. Line 442: change `onSubmit={(roles) => onApprove(roles)}` to `onSubmit={(roles) => void approve(roles)}`.
4. Line 476: change `onClick={() => onApprove()}` to `onClick={() => void approve()}`.
5. In the unmount cleanup (lines 204-211) keep the behaviour, but call the new function without the outer check:

```tsx
  useEffect(() => {
    return () => {
      void flushToggles();
    };
  }, []);
```

## Tests

There is no DOM test harness for this screen (wizard tests run in `node` and use `renderToStaticMarkup`). Add a source-level guard to a new file `packages/wizard/tests/plan-review-approve.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../src/screens/PlanReviewScreen.tsx'), 'utf8');

describe('Plan Review approve', () => {
  it('never calls onApprove straight from a button: it goes through approve(), which saves switches first', () => {
    expect(src).not.toMatch(/onClick=\{\(\) => onApprove\(\)\}/);
    expect(src).not.toMatch(/onSubmit=\{\(roles\) => onApprove\(roles\)\}/);
    expect(src).toMatch(/if \(!\(await flushToggles\(\)\)\) return;\s*onApprove\(roles\);/);
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/plan-review-approve.test.ts` then `pnpm build`.

## Done when

- [x] `flushToggles` returns `Promise<boolean>` and clears the debounce timer itself.
- [x] Both approve controls call `approve`, not `onApprove`.
- [x] A failed save shows the existing error and does not approve.
- [x] The new test and `pnpm build` pass.

## Notes

- `RoleCredential` is already imported in this file (it types `onApprove` at line 51).
- Do not change the 300 ms debounce or the optimistic update.
- Out of scope: adding the unsaved state to `busy`. Flushing before approve already closes the gap.
