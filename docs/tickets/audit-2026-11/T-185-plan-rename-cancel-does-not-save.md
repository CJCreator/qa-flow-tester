# T-185: Plan: Cancel on a rename no longer saves the new name

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/components/plan/PlanDocument.tsx`
- `packages/wizard/tests/plan-rename.test.ts` (new)

**Do not build in parallel with:** T-184, T-198, T-200 (all edit `PlanDocument.tsx`).

## Problem

In `EditableTitle`, leaving the rename field always saves. Pressing Cancel moves focus out of the field first, so `onBlur` saves the typed name and closes the form before Cancel's click arrives: Cancel saves. Pressing Tab also saves and closes, so the Save and Cancel buttons cannot be reached by keyboard.

## Current code

`packages/wizard/src/components/plan/PlanDocument.tsx:350-372` (branch `worktree-audit-cleanup`)

```tsx
          onBlur={() => {
            const trimmed = text.trim();
            if (trimmed && trimmed !== value) {
              onSave(trimmed);
            }
            setEditing(false);
          }}
          disabled={disabled}
        />
        <button type="submit" className="btn-quiet btn-sm" disabled={disabled || !text.trim()}>
          Save
        </button>
        <button
          type="button"
          className="btn-link text-sm"
          onClick={() => {
            setText(value);
            setEditing(false);
          }}
        >
          Cancel
        </button>
```

## Change

1. Above `EditableTitle` (module level), add and export:

```tsx
/** True when focus moved to another control of the same rename form (Save or Cancel): not a reason to save. */
export function staysInForm(form: { contains(node: Node | null): boolean } | null, next: EventTarget | null): boolean {
  return !!form && !!next && form.contains(next as Node);
}
```

2. Replace the `onBlur` handler with:

```tsx
          onBlur={(e) => {
            // Focus going to Save or Cancel is handled by that button, not by leaving the field.
            if (staysInForm(e.currentTarget.form, e.relatedTarget)) return;
            const trimmed = text.trim();
            if (trimmed && trimmed !== value) {
              onSave(trimmed);
            }
            setEditing(false);
          }}
```

3. On the Cancel button, add this prop before `onClick` (Safari does not focus a button on click, so `relatedTarget` would be null there):

```tsx
          onMouseDown={(e) => e.preventDefault()}
```

## Tests

New file `packages/wizard/tests/plan-rename.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { staysInForm } from '../src/components/plan/PlanDocument';

describe('Plan rename field', () => {
  const inside = {} as EventTarget;
  const form = { contains: (n: Node | null) => n === (inside as unknown as Node) };

  it('does not treat focus moving to Save or Cancel as leaving', () => {
    expect(staysInForm(form, inside)).toBe(true);
  });
  it('treats focus leaving the form as leaving', () => {
    expect(staysInForm(form, {} as EventTarget)).toBe(false);
    expect(staysInForm(form, null)).toBe(false);
    expect(staysInForm(null, inside)).toBe(false);
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/plan-rename.test.ts` then `pnpm build`.

## Done when

- [x] Typing a new name and pressing Cancel leaves the old name.
- [x] Tab from the field reaches Save, then Cancel, without closing the form.
- [x] Clicking elsewhere on the page still saves (unchanged).
- [x] New test and `pnpm build` pass.

## Notes

- Do not change the Escape handler or the form's `onSubmit`.
- `EditableTitle` keeps its `export` in this ticket; T-203 removes it.
