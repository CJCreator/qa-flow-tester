# T-133: Report wording follows the glossary

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | inconsistency | built |

**Files you may edit (no others):**
- `packages/core/src/html-report.ts`
- `packages/core/src/reporter.ts`
- `packages/core/src/plan/build.ts`
- `packages/core/tests/plan-build.test.ts`
- `packages/core/tests/plan-quality-baseline.test.ts`

**Do not build in parallel with:** T-127 (edits `reporter.ts`), T-134 (edits `html-report.ts`).

## Problem

`CONTEXT.md` fixes the words shown to people and lists words to avoid. Three places in core break it:

1. `report.html` (documented-items section) says "Living Spec Conformance", "documented requirements reached in
   live app", "Product Context spec items", "Unreached Requirements", "Documented Requirement" and "Record a spec
   override". The glossary says: Product Context (_Avoid_: spec); the count reads "N of M documented items
   reached"; items that were not reached are "Not found in app".
2. `report.md` has a warning that says "Test cases below came from the generic template fallback". The glossary
   avoids "Test case" (the term is Test) and "template plan" (the term is Fixed-Rule Fallback). The branch is
   also dead: `report.usedFallbackDiscovery` is never set anywhere in the code.
3. The default Test uses the Role `'anonymous'`. The glossary's name for the signed-out Role is `visitor`
   (every other default in core uses `'visitor'`).

## Current code

`packages/core/src/html-report.ts:115-141` (branch `worktree-audit-cleanup`), the strings to change:

```ts
        <h2 class="section-title">Living Spec Conformance</h2>
...
            <div ...>${d.reached} of ${d.total} documented requirements reached in live app</div>
            <div ...>Coverage based on Product Context spec items matched against live crawl routes & controls.</div>
...
          <h4 ...>Unreached Requirements (${d.notFound.length})</h4>
...
                  <strong ...>${escapeHtml(item.docSource?.section || item.docSource?.document || 'Documented Requirement')}</strong>
...
                  Did this feature change or move? Record a spec override in .qa-data/spec-overrides.json.
...
            : '<p ...>✓ All documented requirements were reached in the live application.</p>'
```

`packages/core/src/reporter.ts:140-146`

```ts
    if (report.usedFallbackDiscovery) {
      lines.push(`> [!WARNING]`);
      lines.push(
        `> **AI discovery did not run for this release.** Test cases below came from the generic template fallback, not real AI-driven flow analysis. This verdict may not reflect the app's actual behavior — check your AI provider/API key and re-run.`
      );
      lines.push(``);
    }
```

`packages/core/src/plan/build.ts:53`

```ts
    role: 'anonymous',
```

## Change

1. `html-report.ts`: change only the text, never the markup or styles.

| Current text | New text |
|---|---|
| `Living Spec Conformance` | `Documented items` |
| `${d.reached} of ${d.total} documented requirements reached in live app` | `${d.reached} of ${d.total} documented items reached` |
| `Coverage based on Product Context spec items matched against live crawl routes & controls.` | `Items from your Product Context, matched against the pages and controls found in the App.` |
| `Unreached Requirements (${d.notFound.length})` | `Not found in app (${d.notFound.length})` |
| `'Documented Requirement'` (the fallback label) | `'Documented item'` |
| `Did this feature change or move? Record a spec override in .qa-data/spec-overrides.json.` | `Did this feature change or move? Record an override in .qa-data/spec-overrides.json.` |
| `✓ All documented requirements were reached in the live application.` | `✓ Every documented item was reached in the App.` |

   The file name `.qa-data/spec-overrides.json` and the code `SPEC_GAP_NO_PAGE` stay: they are identifiers, not wording.

2. `reporter.ts`: delete the whole `if (report.usedFallbackDiscovery) { ... }` block (seven lines). Do not
   touch the `usedFallbackDiscovery` field in `packages/types`.

3. `build.ts:53`: `role: 'visitor',`

4. Tests that pin the old Role name:
   - `packages/core/tests/plan-build.test.ts:30`: `expect(tc.role).toBe('visitor');`
   - `packages/core/tests/plan-quality-baseline.test.ts:73`: `expect(defaultTc.role).toBe('visitor');`

## Tests

- Search `packages/core/tests`, `packages/runner/tests` and `packages/wizard/tests` for each old string
  (`Living Spec`, `Unreached Requirements`, `documented requirements reached`, `generic template fallback`). If
  a test asserts one, change the assertion to the new text and add that file to your edits (list it in the PR).
- `packages/wizard/public/sample-report.html` is a generated sample; do not edit it.

Commands: `pnpm exec vitest run packages/core/tests/plan-build.test.ts packages/core/tests/plan-quality-baseline.test.ts packages/core/tests/reporter.test.ts`,
then `pnpm exec vitest run packages/core/tests` and `pnpm build`.

## Done when

- [x] None of the old strings remains in `packages/core/src`
- [x] `defaultTestCase().role` is `'visitor'`
- [x] Core unit tests and `pnpm build` pass

## Notes

Other tests use `role: 'anonymous'` as arbitrary fixture data (`suppressions.test.ts`, `flaky-rerun.test.ts`,
`reapproval-roles.test.ts`). Leave them.
