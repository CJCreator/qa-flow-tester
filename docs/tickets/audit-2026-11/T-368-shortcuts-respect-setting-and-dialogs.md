# T-368: The `?` shortcut follows the single-key setting, and j/k stop behind a dialog

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | wizard | accessibility | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/shortcuts.ts`
- `packages/wizard/src/components/CommandPalette.tsx`
- `packages/wizard/src/components/plan/PlanDocument.tsx`
- `packages/wizard/tests/wizard-shortcuts.test.ts`

**Do not build in parallel with:** T-287 (edits `PlanDocument.tsx`).

## Problem

WCAG 2.1.4 (Character Key Shortcuts) asks that a shortcut made of one printable character can be turned off, or only works while its control has focus. The wizard has a setting for this, "Single-key shortcuts (j, k, g, G) on the plan" (`CommandPalette.tsx:80-97`, `lib/shortcuts.ts:21-27`), but two keys slip past it:

1. **`?` opens the shortcuts list everywhere and ignores the setting.** `CommandPalette.tsx:159` checks only its own `isInput` (`:147-149`: `input`, `textarea`, `contentEditable`). It misses `select` and ARIA text boxes (`role="combobox"`, `role="searchbox"`...), which `isTypingTarget` in `lib/shortcuts.ts:55-64` already knows. With focus on a `select` or on a text-entry element that is not an `input` (a `div` with `role="textbox"` or `"combobox"`), "?" opens the shortcuts dialog and the key is swallowed (`e.preventDefault()`). And a person who switched single-key shortcuts off (for example a speech-input user) still has `?` on.
2. **j, k, g and G move the plan behind an open confirm dialog.** `PlanDocument.tsx:1881` skips its keys only while `document.querySelector('[role="dialog"]')` finds something. The command palette sets `role="dialog"` (`CommandPalette.tsx:448`), but `ConfirmDialog` renders a native `<dialog>` opened with `showModal()` and no `role` attribute (`ConfirmDialog.tsx:42-46`). Focus sits on its Cancel button; a `j` keydown still bubbles to `window`, and the plan behind the modal moves its active item.

## Current code

Branch from `main`.

`grep -n "const isInput" -A2 packages/wizard/src/components/CommandPalette.tsx` and `grep -n "e.key === '?'" packages/wizard/src/components/CommandPalette.tsx`:

```ts
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isInput =
        activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable;
      ...
      if (e.key === '?' && !isInput && !e.metaKey && !e.ctrlKey) {
```

`grep -n 'role="dialog"' packages/wizard/src/components/plan/PlanDocument.tsx`:

```ts
      if (isTypingTarget(activeEl) || document.querySelector('[role="dialog"]') !== null) {
```

`packages/wizard/src/lib/shortcuts.ts:6`: `export const SINGLE_KEY_SHORTCUTS = ['j', 'k', 'g', 'G'] as const;`

## Change

1. `lib/shortcuts.ts`:
   - Add a selector for any open dialog:

```ts
/** An open dialog of either kind: a native <dialog> opened with showModal (ConfirmDialog) or role="dialog" (the palette). */
export const OPEN_DIALOG_SELECTOR = 'dialog[open], [role="dialog"]';
```

   - Add a pure check for the `?` key:

```ts
/** True when `?` should open the shortcuts list: no modifier, not typing, and single-key shortcuts are on. */
export function opensShortcutList(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  active: FocusLike | null,
  enabled: boolean = readSingleKeyShortcuts()
): boolean {
  return e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && enabled && !isTypingTarget(active);
}
```

   - Update the file's top comment: `?` follows the same setting.
2. `CommandPalette.tsx`:
   - Remove `activeTag` and `isInput`. Replace the `?` branch condition with `opensShortcutList(e, document.activeElement)`. Import `opensShortcutList` with the existing shortcuts import.
   - The toggle label (`:94`) becomes "Single-key shortcuts (j, k, g, G on the plan, and ? for this list)". Cmd+K and Ctrl+K stay as they are (they use a modifier, so 2.1.4 does not apply), and the palette's "Show keyboard shortcuts" action still opens the list when the setting is off.
3. `PlanDocument.tsx:1881`: `document.querySelector(OPEN_DIALOG_SELECTOR) !== null`, with `OPEN_DIALOG_SELECTOR` added to the existing `../../lib/shortcuts` import (`:68`).
4. `pnpm exec prettier --write` on the changed files.

## Tests

`packages/wizard/tests/wizard-shortcuts.test.ts`, add:

- `'? opens the list only when allowed'`: with `key: '?'` and no modifiers, `opensShortcutList(e, el('BUTTON'), true)` is true; with `enabled` false it is false; with `el('SELECT')`, `el('DIV', { role: 'combobox' })` and `el('INPUT')` it is false; with `ctrlKey: true` it is false; `key: '/'` is false.
- `'the dialog selector finds a native open dialog and a role dialog'`: `OPEN_DIALOG_SELECTOR` contains `dialog[open]` and `[role="dialog"]`.
- `'the plan skips its keys behind any open dialog'`: read `src/components/plan/PlanDocument.tsx` as text; it contains `querySelector(OPEN_DIALOG_SELECTOR)` and no longer `querySelector('[role="dialog"]')`.
- `'the palette uses the shared check'`: `src/components/CommandPalette.tsx` contains `opensShortcutList(` and no `const isInput`.

Run: `pnpm exec vitest run packages/wizard/tests/wizard-shortcuts.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "isInput" packages/wizard/src/components/CommandPalette.tsx` finds nothing.
- [ ] `grep -n "OPEN_DIALOG_SELECTOR" packages/wizard/src/components/plan/PlanDocument.tsx` finds the check.
- [ ] The test file and the wizard unit tests pass; `pnpm build` passes.

## Notes

- Audit finding L14 (part) (audit of 11 Nov 2026 on `d225418`).
- `PlanDocument.tsx` is also edited by T-287: build after it (one line here).
- T-364 does not edit `CommandPalette.tsx` (the palette's actions go through `navigate()`, which T-364 changes), so this ticket need not wait for it.
- `isSingleKeyShortcut` stays j, k, g, G: `?` is handled by the palette, not by the plan.
