# T-121: The Spider reports each page's own forms when pages load in parallel

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/discovery/deterministic-spider.ts`

**Do not build in parallel with:** T-122, T-123, T-135 (all edit `deterministic-spider.ts`).

## Problem

Several workers record pages at once and share the `forms` array. For one page the code:

1. pushes the page's forms onto the shared `forms` array,
2. awaits the layout fingerprint and the screenshot,
3. calls `options.onPage(pageItem, pages.length, forms.slice(forms.length - pageForms.length))`.

Between 1 and 3 another worker can push its own forms, so the `slice` in step 3 hands the caller **another
page's forms**. The Plan then ties a form to the wrong page.

Also, step 1 happens before the page-limit guard (`if (skipForPageLimit()) return;`), so a page that is dropped
for the limit still leaves its forms in the shared list.

## Current code

`packages/core/src/discovery/deterministic-spider.ts:1264-1275` (branch `worktree-audit-cleanup`)

```ts
        // 3. Discover Forms
        const pageForms = (await readPageForms(page)).map(({ visible: _v, ...f }) => f);

        for (const f of pageForms) {
          forms.push({
            action: f.action,
            method: f.method,
            urlPath: currentPath,
            inputs: f.inputs,
            submitButtonSelector: f.submitButtonSelector,
          });
        }
```

`deterministic-spider.ts:1293-1296`

```ts
        // Race guard for the limit (workers share `pages`): the slot is taken before anything is written, so
        // `pages.length` never passes the limit and no screenshot is left for a page that is not in `pages`.
        if (skipForPageLimit()) return;
        pages.push(pageItem);
```

`deterministic-spider.ts:1322`

```ts
        options.onPage?.(pageItem, pages.length, forms.slice(forms.length - pageForms.length));
```

## Change

1. Replace the `for (const f of pageForms) { forms.push({...}); }` loop with a local list (nothing is pushed
   to the shared array yet):

```ts
        // Kept local until the page has its slot: workers share `forms`, so its tail is not this page's.
        const recordedForms = pageForms.map((f) => ({
          action: f.action,
          method: f.method,
          urlPath: currentPath,
          inputs: f.inputs,
          submitButtonSelector: f.submitButtonSelector,
        }));
```

2. Directly after `pages.push(pageItem);` add:

```ts
        forms.push(...recordedForms);
```

3. Change the `onPage` call to:

```ts
        options.onPage?.(pageItem, pages.length, recordedForms);
```

4. If TypeScript complains about the element type of `recordedForms` versus the third parameter of `onPage`,
   annotate it with the element type of `forms` (find the declaration of `forms` near the top of `crawl`; use
   the same type, for example `const recordedForms: typeof forms = ...`).

## Tests

`packages/core/tests/audit-crawl-retry.test.ts` is the only unit test that drives the Spider (with a fake
`launchBrowser`). It must still pass. No new test: reproducing the race needs two real pages loading at once.

Commands: `pnpm build`, then `pnpm exec vitest run packages/core/tests/audit-crawl-retry.test.ts`.

## Done when

- [x] `forms.slice(` no longer appears in the file
- [x] `forms.push(` for a page happens only after `pages.push(pageItem)`
- [x] `pnpm build` passes and the test file passes

## Notes

Forms found later while exploring tabs, dialogs and drawers (`exploreInteractiveStates`, `allForms: forms`) are
pushed to the shared list after `onPage` has fired, so `onPage` never sees them. That is a separate, known gap
and is **out of scope** here (it needs a design decision: `onPage` also drives live progress).
