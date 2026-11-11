# T-335: The HTML report's headings follow order and its tables have header scope

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | accessibility | todo |

**Files you may edit (no others):**

- `packages/core/src/html-report.ts`
- `packages/core/src/issues-html.ts`
- `packages/core/tests/html-report.test.ts`
- `packages/core/tests/issues-html-selfcontained.test.ts`

**Do not build in parallel with:** none.

## Problem

The tool tells people to fix accessibility problems, so its own report should pass its own checks. The HTML report (`html-report.ts`) puts `h2` section titles and then jumps to `h4` (the group headings at lines 245 and 254, and "Not found in app" at line 121), and inside each finding card (a `<summary>`) it uses an `h5` (line 675). A screen-reader user who moves by heading levels finds levels missing. Two group headings start with an emoji (a lightning bolt and a building crane) that a screen reader reads out by name.

The Issues page (`issues-html.ts:78`) writes a table with `<th>` cells that have no `scope`, so assistive technology cannot tell the column headers from data.

## Current code

Branch from `main`.

`grep -n "<h4\|<h5" packages/core/src/html-report.ts`:

```
121:  <h4 style="margin: 1rem 0 0.5rem; ...">Not found in app (...)
224:  <h4 class="rec-title">...
245:  <h4 class="group-heading">⚡ Quick Wins (High Return, Low Effort)</h4>
254:  <h4 class="group-heading" ...>🏗️ Bigger Changes (Architectural / High Effort)</h4>
675:  <h5>Perceptual Visual Diff: old, new and difference</h5>
```

`grep -n "<th" packages/core/src/issues-html.ts`: `<table><tr><th>Role</th><th>Result</th></tr>`.

## Change

1. `html-report.ts`: line 121 `h4` to `h3` (it sits under the `h2` "Documented items"). Lines 245 and 254: `h4` to `h3`, and wrap the emoji in `<span aria-hidden="true">...</span>` so the heading reads "Quick Wins (High Return, Low Effort)". Line 224 `rec-title` stays `h4` (under the new `h3` group). Line 675 `h5` to `h3` (it sits inside a finding card under the `h2` "Every finding behind ..."). Update the CSS selectors if any rule targets `h4` or `h5` by tag (`grep -n "h4\|h5" packages/core/src/html-report.ts` in the style block; the visible size must not change).
2. `issues-html.ts:78`: `<th scope="col">Role</th><th scope="col">Result</th>`.
3. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- `packages/core/tests/html-report.test.ts`: a report with recommendations (quick wins and bigger changes) and documented-not-found items has no heading that skips a level. Write a small helper in the test that reads `<h[1-6]` tags in order and asserts each level is at most one deeper than the one before. Assert the emoji sits inside `aria-hidden="true"`.
- `packages/core/tests/issues-html-selfcontained.test.ts`: the access table has `<th scope="col">` twice and no bare `<th>`.

Run: `pnpm exec vitest run packages/core/tests/html-report.test.ts packages/core/tests/html-report-visual.test.ts packages/core/tests/issues-html-selfcontained.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "<h4\|<h5" packages/core/src/html-report.ts` shows only `rec-title`.
- [ ] `grep -n "<th>" packages/core/src/issues-html.ts` finds nothing.
- [ ] The heading-order test passes; `pnpm build` passes.

## Notes

- Audit finding L15 (audit of 11 Nov 2026 on `d225418`).
- `issues-html.ts` headings (`h1`, `h2`, `h3`, `h4`) already follow order; only the table is changed there.
