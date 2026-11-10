# T-122: Form field and submit selectors read by the Spider are valid and point at the right form

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/discovery/deterministic-spider.ts`
- `packages/core/tests/form-selectors.test.ts` (new)

**Do not build in parallel with:** T-121, T-123, T-135 (all edit `deterministic-spider.ts`).

## Problem

`readPageForms` builds selectors inside the page with no escaping, and its submit fallback is not tied to the form.

1. `#${id}`: a React id such as `:r1:` gives `#:r1:`, an invalid selector. Every later step on that field fails.
2. `label[for="${id}"]`, `[name="${name}"]`, `[aria-label="..."]`, `[placeholder="..."]`, and the test-id
   selector: a value containing `"` makes `document.querySelector` throw inside the page, so `$$eval` rejects and
   **the whole page is dropped** from the scan.
3. The submit button is found with `button[type="submit"], input[type="submit"], button:not([type])`, but the
   selector written for it is always `button[type="submit"]` (or `input[type="submit"]`). For a button with no
   `type` attribute that selector matches nothing. On a page with two forms it matches the **first** submit
   button on the page, which may belong to the other form.

## Current code

`packages/core/src/discovery/deterministic-spider.ts:299-321` (branch `worktree-audit-cleanup`), inside `$$eval`:

```ts
        const testIdSelector = (el: Element) => {
          const attr = testIdAttributes.find((a) => el.hasAttribute(a));
          return attr ? `[${attr}="${el.getAttribute(attr)}"]` : null;
        };
        ...
          const selector =
            testIdSelector(inp) ||
            (id
              ? `#${id}`
              : name
                ? `[name="${name}"]`
                : ariaLabel
                  ? `[aria-label="${ariaLabel}"]`
                  : placeholder
                    ? `[placeholder="${placeholder}"]`
                    : `${inp.tagName.toLowerCase()}[type="${type}"]`);
          const required = inp.hasAttribute('required');
          const forLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
```

`deterministic-spider.ts:351-363`

```ts
        const submitBtn = f.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        let submitSelector: string | undefined;
        if (submitBtn) {
          const sTestId = testIdSelector(submitBtn);
          const sId = submitBtn.getAttribute('id');
          submitSelector = sTestId
            ? sTestId
            : sId
              ? `#${sId}`
              : submitBtn.tagName.toLowerCase() === 'input'
                ? 'input[type="submit"]'
                : 'button[type="submit"]';
        }
```

## Change

All edits are inside the `$$eval` callback (code there runs in the page: it cannot call module functions, so
the helpers are declared inside it).

1. Directly above `const testIdSelector = ...` add:

```ts
        // Quoted attribute value: a backslash or a double quote in it would end the selector early.
        const quoted = (v: string | null) => `"${(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        // An id as a selector; ids like ":r1:" (React) need escaping.
        const byId = (v: string) => `#${CSS.escape(v)}`;
```

2. `testIdSelector`:

```ts
          return attr ? `[${attr}=${quoted(el.getAttribute(attr))}]` : null;
```

3. The field selector:

```ts
          const selector =
            testIdSelector(inp) ||
            (id
              ? byId(id)
              : name
                ? `[name=${quoted(name)}]`
                : ariaLabel
                  ? `[aria-label=${quoted(ariaLabel)}]`
                  : placeholder
                    ? `[placeholder=${quoted(placeholder)}]`
                    : `${inp.tagName.toLowerCase()}[type=${quoted(type)}]`);
```

4. The label lookup:

```ts
          const forLabel = id ? document.querySelector(`label[for=${quoted(id)}]`) : null;
```

5. The submit selector. Replace the whole `if (submitBtn) { ... }` body with:

```ts
        if (submitBtn) {
          const sTestId = testIdSelector(submitBtn);
          const sId = submitBtn.getAttribute('id');
          // Tied to this form, so a page with two forms does not press the other one's button.
          const formId = f.getAttribute('id');
          const formAction = f.getAttribute('action');
          const formScope = formId ? `form${byId(formId)} ` : formAction ? `form[action=${quoted(formAction)}] ` : '';
          const kind =
            submitBtn.tagName.toLowerCase() === 'input'
              ? 'input[type="submit"]'
              : submitBtn.hasAttribute('type')
                ? 'button[type="submit"]'
                : 'button:not([type])';
          submitSelector = sTestId ? sTestId : sId ? byId(sId) : `${formScope}${kind}`;
        }
```

## Tests

The code runs in the page, so a real test needs Chromium. Add a **browser-tier** test:

1. Create `packages/core/tests/form-selectors.test.ts`. Copy the Chromium set-up (launch in `beforeAll`, close in
   `afterAll`, `page.setContent(...)`) from `packages/checkers/tests/keyboard-a11y.test.ts`. Import
   `readPageForms` from `../src/discovery/deterministic-spider.js` (it is already exported; if it is not, export it).
2. Cases, each with `await page.setContent(html)` then `const forms = await readPageForms(page)`:
   - `<form><input id=":r1:"><button>Go</button></form>`: `forms[0].inputs[0].selector` is `#\:r1\:`;
     `await page.locator(forms[0].inputs[0].selector).count()` is 1; `forms[0].submitButtonSelector` is
     `button:not([type])` and its locator count is 1.
   - `<form><input name='a"b'><button type="submit">Go</button></form>`: the call does not throw;
     `page.locator(forms[0].inputs[0].selector).count()` is 1.
   - Two forms: `<form action="/a"><input name="x"><button type="submit">A</button></form><form action="/b"><input name="y"><button type="submit">B</button></form>`:
     `page.locator(forms[1].submitButtonSelector!).innerText()` is `B`.
3. Add `'form-selectors'` to the `core` list of `BROWSER_TESTS` in `vitest.workspace.ts`. (This is the one file
   outside the list above that you may edit, for this single line.)

Commands: `pnpm build`, `pnpm exec vitest run --project browser packages/core/tests/form-selectors.test.ts`
(needs Chromium: `pnpm --filter @qa/core exec playwright install chromium`), and
`pnpm exec vitest run packages/core/tests/audit-crawl-retry.test.ts`.

## Done when

- [x] No `"${` remains inside the `readPageForms` `$$eval` callback
- [x] The three cases pass
- [x] `pnpm build` passes

## Notes

Existing Plans store the old selectors; nothing migrates them. New scans get the new ones.
