# T-287: Plan Review: the group "Switch off" button leaves the `<summary>`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | wizard | accessibility | todo |

**Files you may edit (no others):**

- `packages/wizard/src/components/plan/PlanDocument.tsx`
- `packages/wizard/tests/plan-group-header.test.ts` (new)

**Do not build in parallel with:** T-184, T-185, T-195, T-198, T-200 (all edit `PlanDocument.tsx`). T-203 is built.

## Problem

`CollapsibleGroup` puts its `headerRight` content inside the `<summary>` of a `<details>`. Both uses pass a `BulkSwitch`, which is a `<button>` ("Switch off this group’s pages", "Switch off every link on this page"). A button inside a `<summary>` is an interactive control inside interactive content: screen readers announce it badly, and `BulkSwitch` needs `e.preventDefault()` so the click does not also toggle the group.

## Owner decision (settled)

**Settled by the owner on 2026-11-11:** move the "Switch off" button inside the opened group. Build the Change below as written; the options are kept for the record.

Where should the group button go?

- A. Inside the opened group, as the first line above the list. The button is then only visible while the group is open. Simple, no layout trick. **Recommended default.**
- B. Beside the `<details>` (outside it, same row). Always visible, but the header row layout changes and a wrapper element is needed.
- C. Leave as is.

This ticket writes option A. If the owner picks B or C, change or drop this ticket.

## Current code

Find with `grep -n "headerRight\|function BulkSwitch\|CollapsibleGroup" packages/wizard/src/components/plan/PlanDocument.tsx`.

`CollapsibleGroup` (about lines 235 to 273):

```tsx
function CollapsibleGroup({
  title,
  startOpen,
  headerRight,
  children,
}: {
  title: React.ReactNode;
  startOpen: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
...
      <summary className="flex min-h-[48px] cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-base text-ink">
        <span>{title}</span>
        {headerRight}
      </summary>
      {open && <div className="p-3">{children}</div>}
    </details>
```

The two callers pass `headerRight={<BulkSwitch ... />}`: in `PagesSection` (about line 1180, `what="this group’s pages"`) and in the Navigation section (about line 1344, `what="every link on this page"`).

`BulkSwitch` (about line 1114):

```tsx
    <button
      type="button"
      className="btn-link text-sm disabled:cursor-not-allowed disabled:text-ink-soft"
      disabled={actions.busy}
      onClick={(e) => {
        e.preventDefault();
        actions.setSkippedMany(ids, !allOff);
      }}
    >
```

## Change

1. In `CollapsibleGroup`, rename the prop `headerRight` to `actions` (in the destructuring, the type, and both callers). Replace the `<summary>` and the body line with:

```tsx
<summary className="flex min-h-[48px] cursor-pointer items-center px-3 py-2 text-base text-ink">
  <span>{title}</span>
</summary>;
{
  open && (
    <div className="p-3">
      {actions && <div className="mb-3 flex justify-end">{actions}</div>}
      {children}
    </div>
  );
}
```

2. Both callers: change `headerRight={` to `actions={`. Nothing else in them changes.
3. In `BulkSwitch`, the button no longer sits in a summary: replace the `onClick` with `onClick={() => actions.setSkippedMany(ids, !allOff)}`. (The third `BulkSwitch`, "Shared menus", was never in a summary; it is unaffected.)
4. Run `pnpm exec prettier --write packages/wizard/src/components/plan/PlanDocument.tsx`.

## Tests

Add `packages/wizard/tests/plan-group-header.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/components/plan/PlanDocument.tsx'), 'utf8');

describe('Plan group header', () => {
  it('keeps every control out of the <summary>', () => {
    const summaries = [...source.matchAll(/<summary[\s\S]*?<\/summary>/g)].map((m) => m[0]);
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      expect(s).not.toMatch(/<button|<BulkSwitch|actions\}/);
    }
  });
  it('no longer has a headerRight prop', () => {
    expect(source).not.toContain('headerRight');
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/plan-group-header.test.ts packages/wizard/tests/plan-rename.test.ts packages/wizard/tests/wizard-terminology-a11y.test.tsx` then `pnpm build`.

## Done when

- [ ] `grep -c "headerRight" packages/wizard/src/components/plan/PlanDocument.tsx` prints 0.
- [ ] The `<summary>` in `CollapsibleGroup` holds only the title.
- [ ] The three tests and `pnpm build` pass.

## Notes

- Behavior change to tell the owner: the group switch now shows only when the group is open.
- Do not change any label text (`Switch off ...` / `Switch on ...`).
