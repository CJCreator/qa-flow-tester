# T-346: Keyboard check selectors are CSS-escaped and built by one helper

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/keyboard-a11y.ts`
- `packages/checkers/tests/keyboard-a11y.test.ts`

**Do not build in parallel with:** T-231 (edits `keyboard-a11y.ts`, `keyboard-a11y.test.ts`).

## Problem

The keyboard check names an element in a finding with a CSS selector, built inside the page by a function called `sel`. It writes `#${e.id}` and `[data-testid="${t}"]` with no escaping. A React `useId()` id such as `:r1:` gives `#:r1:`, which is not a valid selector: the person who copies it into the browser console or a test gets an error, and any later `querySelector` on it throws. A `data-testid` that holds a double quote breaks the attribute selector the same way.

The same 20-line `sel` function is pasted three times: `packages/checkers/src/keyboard-a11y.ts:81-99` (the Tab walk), `:221-239` (clickable elements with no keyboard route) and `:390-408` (the 320 px reflow check). A fix has to be made three times, which is how they drift.

## Current code

Branch from `main`.

`packages/checkers/src/keyboard-a11y.ts` (`grep -n "e.id}\|data-testid=\\\\\"" packages/checkers/src/keyboard-a11y.ts`):

```ts
    const sel = (e: Element): string => {
      const t = e.getAttribute('data-testid');
      if (t) return `[data-testid="${t}"]`;
      if (e.id) return `#${e.id}`;
      const parts: string[] = [];
      ...
      return parts.join(' > ');
    };
```

It sits at `:83-84`, `:223-224` and `:392-393`, each inside a `page.evaluate(() => { ... })` callback. A callback runs in the browser and cannot call a Node-side function, so the helper has to be sent into the page as text.

## Change

1. In `keyboard-a11y.ts`, add one module-level constant `CSS_PATH_SOURCE`: the text of `function qaCssPath(e) { ... }`, with the id and test id escaped (`#${CSS.escape(e.id)}`, `[data-testid="${CSS.escape(t)}"]`; `CSS.escape` exists in every page). Keep the nth-of-type path logic as it is today.
2. Add `declare const qaCssPath: (e: Element) => string;` and a helper `evaluateWithCssPath<R>(page: Page, body: () => R): Promise<R>` that calls `page.evaluate(\`(() => { ${CSS_PATH_SOURCE}; return (${body.toString()})(); })()\`)`. A string expression is used on purpose: `new Function` inside a page can be blocked by the page's own Content-Security-Policy, a string given to `page.evaluate` is not.
3. Change the three `page.evaluate(() => {...})` calls that define `sel` to `evaluateWithCssPath(page, () => {...})`, delete the three local `sel` copies, and call `qaCssPath(el)` where `sel(el)` was called.
4. Keep the rest of each callback as it is (T-231 changes the Tab walk; build after it).
5. Run `pnpm exec prettier --write` on the two files, then `pnpm build`.

## Tests

In `packages/checkers/tests/keyboard-a11y.test.ts` (already in the `checkers` browser list in `vitest.workspace.ts`; the file launches Chromium, so no workspace edit):

- A `setContent` page with a button whose id is `:r1:` that the Tab key cannot reach (`tabindex="-1"` on a clickable `div` with that id): the finding's `where.cssSelector` is `#\:r1\:`, and `document.querySelector` of it in the page returns the element.
- A clickable `div` with `data-testid='say "hi"'`: the selector round-trips the same way.
- The three existing groups (traversal, focus trap, reflow) still pass, which proves all three call sites still get the helper.

Run: `pnpm exec vitest run --project browser packages/checkers/tests/keyboard-a11y.test.ts`, then the checkers unit tests, then `pnpm build`.

## Done when

- [ ] `grep -c "const sel = " packages/checkers/src/keyboard-a11y.ts` is `0`.
- [ ] `grep -n "CSS.escape" packages/checkers/src/keyboard-a11y.ts` finds the one helper.
- [ ] The ids `:r1:` and a quoted test id give selectors that `querySelector` accepts (browser test).
- [ ] The keyboard browser tests and `pnpm build` pass.

## Notes

- Audit finding L7 (audit of 11 Nov 2026 on `d225418`).
- If the string-expression helper cannot keep a callback's types, keep the body typed with a local `type` and a cast on the result; do not fall back to `new Function`.
