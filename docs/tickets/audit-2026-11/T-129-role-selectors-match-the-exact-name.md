# T-129: A role selector presses the control with exactly that name ("Move", never "Remove")

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | todo |

**Files you may edit (no others):**
- `packages/core/src/plan/playwright-export.ts`
- `packages/core/src/plan/selector-order.ts` (only if step 3 says so)
- `packages/core/tests/role-selector-exact.test.ts` (new)
- `vitest.workspace.ts` (one line: add the new test to `BROWSER_TESTS`)

**Do not build in parallel with:** none.

## Problem

The Plan prefers selectors of the form `role=button[name="Move"]` (`pickSelector` in `plan/selector-order.ts`).
They are used in two places, and the two do not agree on what the name means:

1. **Exported Playwright project** (`plan/playwright-export.ts`, the generated `locatorFor` helper): it calls
   `page.getByRole(role, { name })`. Without `exact: true`, Playwright matches the name as a
   case-insensitive **substring**. `name: 'Move'` also matches a button called "Remove". This is certain.
2. **The Check-up itself** (`locateElement` in `browser.ts`): it passes the string to `page.locator(selector)`
   and takes the first visible match. Whether Playwright's `role=...[name="..."]` string form is exact or a
   substring has not been confirmed; step 2 below settles it with a test.

A step planned for "Move" pressing "Remove" is a safety problem, not only a wrong result.

## Current code

`packages/core/src/plan/playwright-export.ts:351-353` (branch `worktree-audit-cleanup`), lines of the generated helper:

```ts
  `export function locatorFor(page: Page, selector: string): Locator {`,
  `  const role = /^role=([\\w-]+)\\[name="(.*)"\\]$/.exec(selector);`,
  `  if (role) return page.getByRole(role[1] as Parameters<Page['getByRole']>[0], { name: role[2] });`,
```

`packages/core/src/plan/selector-order.ts:52`

```ts
  if (facts.role && NAMED_ROLES.has(facts.role) && name) return { selector: `role=${facts.role}[name="${name}"]` };
```

## Change

1. **Export (certain).** In `playwright-export.ts` change the generated line to pass `exact: true`:

```ts
  `  if (role) return page.getByRole(role[1] as Parameters<Page['getByRole']>[0], { name: role[2], exact: true });`,
```

2. **Find out what the Check-up does.** Add the browser-tier test below and run it.

3. **Only if the test in step 2 fails** (the string form matched "Remove"): make the selector explicit.
   - `selector-order.ts:52`: emit the exact flag: `` `role=${facts.role}[name="${name}"s]` ``.
   - `playwright-export.ts`: accept both spellings in the generated regex:
     `` `  const role = /^role=([\\w-]+)\\[name="(.*)"s?\\]$/.exec(selector);` ``
   - Update `packages/core/tests/selector-order.test.ts` expectations that contain `[name="..."]` to
     `[name="..."s]` (add that file to your edits and list it in the PR).
   If the test passes without step 3, do **not** do step 3.

## Tests

Add `packages/core/tests/role-selector-exact.test.ts` (browser tier). Copy the Chromium set-up (launch in
`beforeAll`, close in `afterAll`) from `packages/checkers/tests/keyboard-a11y.test.ts`.

```ts
it('role=button[name="Move"] is the Move button, not Remove', async () => {
  await page.setContent('<button>Remove</button><button>Move</button>');
  const found = await locateElement(page, 'role=button[name="Move"]');
  expect(await found.innerText()).toBe('Move');
  expect(await page.locator('role=button[name="Move"]').count()).toBe(1);
});
```

Import `locateElement` from `../src/browser.js`. Add `'role-selector-exact'` to the `core` list of
`BROWSER_TESTS` in `vitest.workspace.ts`.

For step 1, add to the existing unit test of the export (search `packages/core/tests` for `locatorFor`; if a
test file asserts the generated helper text, add there, otherwise add to `packages/core/tests/playwright-export.test.ts`):
the generated project text contains `{ name: role[2], exact: true }`.

Commands: `pnpm build`, `pnpm exec vitest run --project browser packages/core/tests/role-selector-exact.test.ts`
(needs Chromium), `pnpm exec vitest run packages/core/tests/selector-order.test.ts`.

## Done when

- [ ] The exported helper passes `exact: true`
- [ ] The browser test passes (with or without step 3) and the PR says which
- [ ] `pnpm build` passes

## Notes

Plans saved before this change keep their selectors. If step 3 was needed, old selectors without the `s` flag
still work (they are only less strict).
