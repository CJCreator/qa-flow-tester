# T-116: The Delete probe never presses a link that goes somewhere

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | core | security | built |

**Files you may edit (no others):**
- `packages/core/src/discovery/crud-facts.ts`
- `packages/core/tests/crud-facts.test.ts`

**Do not build in parallel with:** T-135 (also edits `crud-facts.ts`).

## Problem

During the scan, `readCrudStructure` marks the first per-row control named "Delete" / "Remove" / "Trash" with
`data-qa-delete-probe`, and the Spider then presses it to see whether a confirmation appears (ADR 0025). The
safety net, `blockChanges`, aborts only POST, PUT, PATCH and DELETE requests.

The marked control can be an `<a href="/items/42/delete">Delete</a>`. Pressing it is a **GET** navigation, which
`blockChanges` lets through. On an app that deletes on GET, the scan deletes a real record, even on a site set
to read-only.

## Current code

`packages/core/src/discovery/crud-facts.ts:63-75` (branch `worktree-audit-cleanup`), inside the `page.evaluate` callback:

```ts
        const re = new RegExp(rowDelete, 'i');
        for (const row of rows) {
          for (const c of controlsIn(row)) {
            const n = nameOf(c);
            if (!n) continue;
            rowControlNames.push(n);
            if (!marked && re.test(n)) {
              c.setAttribute('data-qa-delete-probe', '1');
              marked = true;
            }
          }
        }
```

## Change

1. Inside the same `evaluate` callback, directly above `const re = new RegExp(rowDelete, 'i');`, add:

```ts
        // A link that goes somewhere is a GET the change-blocker cannot stop: never probe it.
        const goesSomewhere = (el: Element) => {
          if (el.tagName !== 'A') return false;
          const href = (el.getAttribute('href') || '').trim();
          return href !== '' && !href.startsWith('#') && !/^javascript:/i.test(href);
        };
```

2. Change the marking condition to:

```ts
            if (!marked && !goesSomewhere(c) && re.test(n)) {
```

Nothing else changes: the name is still pushed to `rowControlNames`, so `inferCrud` still sees that the list
has a delete control.

## Tests

`readCrudStructure` runs in the page, so it needs Chromium. Do **not** add a browser test to the unit file.
Instead make the rule testable without a browser:

1. In `crud-facts.ts`, export a pure helper next to `inferCrud`:

```ts
/** Whether a control's tag and href make it a link that navigates (never probed: a GET cannot be blocked). */
export function isNavigatingLink(tagName: string, href: string | null | undefined): boolean {
  if (tagName.toUpperCase() !== 'A') return false;
  const value = (href || '').trim();
  return value !== '' && !value.startsWith('#') && !/^javascript:/i.test(value);
}
```

   The in-page `goesSomewhere` stays as written above (code inside `page.evaluate` cannot call module functions);
   add the comment `// Same rule as isNavigatingLink.` above it.

2. In `packages/core/tests/crud-facts.test.ts` add:

```ts
describe('isNavigatingLink', () => {
  it('is true only for a link with a real address', () => {
    expect(isNavigatingLink('A', '/items/42/delete')).toBe(true);
    expect(isNavigatingLink('a', 'https://example.com/x')).toBe(true);
    expect(isNavigatingLink('A', '#')).toBe(false);
    expect(isNavigatingLink('A', '#row-2')).toBe(false);
    expect(isNavigatingLink('A', 'javascript:void(0)')).toBe(false);
    expect(isNavigatingLink('A', '')).toBe(false);
    expect(isNavigatingLink('A', null)).toBe(false);
    expect(isNavigatingLink('BUTTON', '/x')).toBe(false);
  });
});
```

   and add `isNavigatingLink` to the import on line 3.

Command: `pnpm exec vitest run packages/core/tests/crud-facts.test.ts`, then `pnpm build`.

## Done when

- [x] A row control that is `<a href="/something">Delete</a>` is never given `data-qa-delete-probe`
- [x] `<a href="#">Delete</a>` and `<button>Delete</button>` are still marked
- [x] The test passes; `pnpm build` passes

## Notes

The probe's other guards (the Safety Filter's forbidden-action keywords, cancelling at the confirm) are unchanged.
