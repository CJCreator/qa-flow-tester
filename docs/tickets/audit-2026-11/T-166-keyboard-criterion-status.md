# T-166: WCAG 2.1.1 is marked violated when the only finding is an unconfirmed guess

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | todo |

**Files you may edit (no others):**
- `packages/checkers/src/keyboard-a11y.ts`
- `packages/checkers/tests/keyboard-a11y.test.ts`

**Do not build in parallel with:** none.

## Problem
`checkKeyboard` reports the status of three WCAG criteria. A criterion is marked `violated` when any finding of its kind exists. Some Tab findings are only guesses: an element with a click handler that "may not be reachable with the Tab key" carries `needsConfirmation: true` and does not count as a defect. Yet it still marks WCAG 2.1.1 (Keyboard) as violated in the WCAG coverage table. The glossary says a WCAG criterion status must not claim more than was found.

## Current code
`packages/checkers/src/keyboard-a11y.ts:184-189` (branch `worktree-audit-cleanup`)
```ts
      const has = (kind: string) => findings.some((f) => f.id.startsWith(`F-A11Y-${kind}-`));
      reportCriteria(context, [
        { tag: 'wcag211', violated: has('TAB') },
        { tag: 'wcag212', violated: has('TRAP') },
        { tag: 'wcag2411', violated: has('FOCUS-OBSCURED') },
      ]);
```

## Change
Replace the `const has = ...` line with:
```ts
      // A finding that still needs a person to confirm it is a guess: it does not make a criterion violated.
      const has = (kind: string) =>
        findings.some((f) => f.id.startsWith(`F-A11Y-${kind}-`) && !f.needsConfirmation);
```
Nothing else changes.

## Tests
Edit `packages/checkers/tests/keyboard-a11y.test.ts`. This file drives real Chromium (it is in the `browser` tier), so run it with the browser project. Inside `describe('keyboard traversal', ...)`, after the existing test `onclick-only div is needsConfirmation`, add these two tests. They use the file's own `open(html)` helper, `checker` and `ctx`:
```ts
    it('an unconfirmed onclick-only guess does not mark WCAG 2.1.1 violated', async () => {
      const page = await open('<a href="/x">Link</a><div onclick="void 0" id="clicky">Click me</div>');
      const seen: Array<{ criterion: string; status: string }> = [];
      const f = await checker.checkKeyboard(page, { ...ctx, onCoverage: (entries) => seen.push(...entries) });
      await page.close();
      expect(f.some((x) => x.needsConfirmation && x.where.cssSelector === '#clicky')).toBe(true);
      expect(seen.find((e) => e.criterion.includes('2.1.1'))?.status).toBe('none-found');
    });

    it('a confirmed unreachable control marks WCAG 2.1.1 violated', async () => {
      const page = await open('<a href="/x">Link</a><div role="button" id="fake">Save</div>');
      const seen: Array<{ criterion: string; status: string }> = [];
      await checker.checkKeyboard(page, { ...ctx, onCoverage: (entries) => seen.push(...entries) });
      await page.close();
      expect(seen.find((e) => e.criterion.includes('2.1.1'))?.status).toBe('violated');
    });
```
If `criterion` is not a string containing `2.1.1` (print `seen` once to check its shape), match the entry by whatever field holds the criterion number and keep the two expected statuses.

Run: `pnpm exec vitest run --project browser packages/checkers/tests/keyboard-a11y.test.ts`
If Chromium is not installed, run `pnpm --filter @qa/core exec playwright install chromium` first.

## Done when
- [ ] The new test passes; existing tests in `keyboard-a11y.test.ts` pass unchanged.
- [ ] `pnpm build` passes.

## Notes
- The finding itself is not changed: it is still listed for a person to confirm.
- `reportCriteria` (top of the same source file) calls `context.onCoverage(entries, [])`; each entry is `{ criterion, status: 'violated' | 'none-found', pages: 1 }`.
