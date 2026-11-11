# T-245: Re-planning keeps the Plan Items that came from documents

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/replan.ts`
- `packages/core/tests/replan-documented.test.ts` (new)

**Do not build in parallel with:** nothing. (T-246 edits `ai-planner.ts` only; either order is fine.)

## Problem

Plan Items written from the person's documents carry a `docSource` (the document, section and requirement they came from). Fixed rules write them at scan time from the parsed requirements (`planFromSpec`). The parsed requirements are not kept after the scan. So every re-plan that rewrites a page or the journeys loses them:

- "Re-plan everything" (`replanAll`) replaces `plan.pages` with freshly planned pages that have no `docSource` tests, and `replanJourneys` replaces `draft.flows`, which drops the journeys that have a `docSource`. This includes Denial Plan Items (the tests with `intent: 'denied'`, "this role cannot open this page"). The person's documented coverage disappears after one click.
- "Re-plan this page" (`replanPage`) overwrites that page's `tests` with fresh ones, with the same loss for that page.

(T-126 left this open: "needs a decision on where to keep them and has no ticket yet".)

## Owner decision (settled)

**Settled by the owner on 2026-11-11:** carry the document Plan Items over into the new Plan as they are. No new stored data. Build the Change below as written; the options are kept for the record.

Where do the document items live between a scan and a re-plan?

- **A. Carry them over (recommended default).** On a re-plan, keep every test and journey that already has a `docSource` and was not rewritten. No new stored data. A re-plan never adds or removes document items; to change them, the person re-scans with the changed documents. Small, safe.
- **B. Keep the parsed requirements** on the draft (a new field on `DiscoveryDraft` in `@qa/types`, saved with the stored Plan) and run `planFromSpec` again on every re-plan. It follows document changes and the current crawl, but needs a type change, a stored-data change and the old plans without the field to be handled.
- **C. Leave it** and word the Re-plan button to say it drops document items. Not recommended: the loss is silent today.

This ticket builds A. `notFound` ("Not found in app") and `documentedItems` are on `plan`, and `replanAll` never touches them, so they already survive.

## Current code

Branch from `main`. `packages/core/src/plan/replan.ts`.

`replanPage`, at its end (`grep -n "Object.assign(planned" packages/core/src/plan/replan.ts`):

```ts
const fresh = out.pages[0];
Object.assign(planned, {
  coverage,
  coveredBy: undefined,
  tests: fresh.tests,
  source: fresh.source,
  fallbackReason: fresh.fallbackReason,
  skipped: false,
});
```

`replanJourneys` (`grep -n "draft.flows = out.flows" packages/core/src/plan/replan.ts`):

```ts
const off = new Set(draft.flows.filter((f) => f.outOfScope).map((f) => f.id));
draft.flows = out.flows.map((f) => (off.has(f.id) ? { ...f, outOfScope: true } : f));
```

`replanAll` (`grep -n "plan.pages = keepSwitchedOff" packages/core/src/plan/replan.ts`):

```ts
const added = new Set(plan.pages.filter((p) => p.added).map((p) => p.urlPath));
plan.pages = keepSwitchedOff(
  out.pages.map((p) => (added.has(p.urlPath) ? { ...p, added: true } : p)),
  plan.pages
);
```

Types (`@qa/types`): `PlanPageTest` and `DiscoveredFlow` both have `docSource?: DocSource`; `PlanPage` has `tests: PlanPageTest[]`.

## Change

1. In `replan.ts` extend the type import to `import type { DiscoveredFlow, DiscoveryDraft, NavigationCheck, PageInventoryItem, PlanPage, PlanPageTest, RoleCredential } from '@qa/types';` (keep it on lines Prettier accepts).

2. After `keepSwitchedOff`, add three exported helpers:

```ts
/** `fresh` plus the tests in `before` that came from a document and are not in `fresh`. */
export function withDocumentedTests(fresh: PlanPageTest[], before: PlanPageTest[]): PlanPageTest[] {
  const have = new Set(fresh.map((t) => t.id));
  return [...fresh, ...before.filter((t) => t.docSource && !have.has(t.id))];
}

/** `fresh` plus the journeys in `before` that came from a document and are not in `fresh`. */
export function withDocumentedFlows(fresh: DiscoveredFlow[], before: DiscoveredFlow[]): DiscoveredFlow[] {
  const have = new Set(fresh.map((f) => f.id));
  return [...fresh, ...before.filter((f) => f.docSource && !have.has(f.id))];
}

/**
 * The pages after a re-plan, with the document tests of the pages before. A page the re-plan did not
 * produce (a documented address the crawl never found) stays, holding only its document tests.
 */
export function withDocumentedPages(fresh: PlanPage[], before: PlanPage[]): PlanPage[] {
  const out = fresh.map((page) => {
    const old = before.find((b) => pathOf(b.urlPath) === pathOf(page.urlPath));
    return old ? { ...page, tests: withDocumentedTests(page.tests, old.tests) } : page;
  });
  for (const old of before) {
    if (out.some((p) => pathOf(p.urlPath) === pathOf(old.urlPath))) continue;
    const documented = old.tests.filter((t) => t.docSource);
    if (documented.length > 0) out.push({ ...old, tests: documented });
  }
  return out;
}
```

3. `replanPage`: change `tests: fresh.tests,` to `tests: withDocumentedTests(fresh.tests, planned.tests),`. (`Object.assign` evaluates its argument object before it assigns, so `planned.tests` is still the old list.)

4. `replanJourneys`: after the `draft.flows = out.flows.map(...)` line add:

```ts
draft.flows = withDocumentedFlows(draft.flows, before);
```

and before the `planJourneys` call add `const before = draft.flows;` (the old list, read before it is replaced).

5. `replanAll`: keep the old list and merge after the `keepSwitchedOff` assignment. Before `plan.pages = keepSwitchedOff(` add `const pagesBefore = plan.pages;` and after the assignment add:

```ts
plan.pages = withDocumentedPages(plan.pages, pagesBefore);
```

6. Run `pnpm exec prettier --write packages/core/src/plan/replan.ts packages/core/tests/replan-documented.test.ts`, then `pnpm build`.

## Tests

New file `packages/core/tests/replan-documented.test.ts`. It tests the three pure helpers (no AI, no browser):

```ts
import { describe, it, expect } from 'vitest';
import type { DiscoveredFlow, PlanPage, PlanPageTest } from '@qa/types';
import { withDocumentedFlows, withDocumentedPages, withDocumentedTests } from '../src/plan/replan.js';

const doc = { document: 'Spec', section: '4 > 4.1', requirementId: 'R-1' };
const test = (id: string, over: Partial<PlanPageTest> = {}): PlanPageTest =>
  ({ id, name: id, role: 'visitor', steps: [], source: 'fallback', ...over }) as PlanPageTest;
const page = (urlPath: string, tests: PlanPageTest[]): PlanPage =>
  ({
    id: `page:${urlPath}`,
    urlPath,
    title: urlPath,
    coverage: 'tested',
    reachedBy: ['visitor'],
    tests,
    source: 'ai',
  }) as PlanPage;

describe('withDocumentedTests', () => {
  it('keeps document tests the fresh list lacks, and the denied one', () => {
    const before = [
      test('a'),
      test('route:1', { docSource: doc }),
      test('denial:1', { docSource: doc, intent: 'denied' }),
    ];
    const out = withDocumentedTests([test('b')], before);
    expect(out.map((t) => t.id)).toEqual(['b', 'route:1', 'denial:1']);
  });
  it('does not repeat a test the fresh list already has', () => {
    const out = withDocumentedTests([test('route:1')], [test('route:1', { docSource: doc })]);
    expect(out).toHaveLength(1);
  });
});

describe('withDocumentedFlows', () => {
  it('keeps document journeys the fresh list lacks', () => {
    const flow = (id: string, docSource?: typeof doc) =>
      ({ id, name: id, steps: [], docSource }) as unknown as DiscoveredFlow;
    const out = withDocumentedFlows([flow('new')], [flow('old'), flow('spec', doc)]);
    expect(out.map((f) => f.id)).toEqual(['new', 'spec']);
  });
});

describe('withDocumentedPages', () => {
  it('puts document tests back on a re-planned page', () => {
    const out = withDocumentedPages([page('/a', [test('x')])], [page('/a', [test('d', { docSource: doc })])]);
    expect(out[0].tests.map((t) => t.id)).toEqual(['x', 'd']);
  });
  it('keeps a documented page the re-plan did not produce, with only its document tests', () => {
    const before = [page('/admin', [test('plain'), test('d', { docSource: doc })])];
    const out = withDocumentedPages([page('/a', [])], before);
    expect(out.map((p) => p.urlPath)).toEqual(['/a', '/admin']);
    expect(out[1].tests.map((t) => t.id)).toEqual(['d']);
  });
  it('drops a page with no document tests that the re-plan did not produce', () => {
    const out = withDocumentedPages([page('/a', [])], [page('/gone', [test('plain')])]);
    expect(out.map((p) => p.urlPath)).toEqual(['/a']);
  });
});
```

Run: `pnpm exec vitest run packages/core/tests/replan-documented.test.ts packages/core/tests/replan-coverage.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -c "withDocumentedTests\|withDocumentedFlows\|withDocumentedPages" packages/core/src/plan/replan.ts` is at least 6 (three definitions, three uses).
- [ ] The two test files pass; `pnpm build` passes.

## Notes

- This does not make re-plan notice a changed document. For that the owner picks option B above, as a new ticket.
- Not in this ticket: another `replan.ts` defect from the audit. After "Include host", `pathOf('https://other.com/')` returns `/` and can overwrite the site's own `/` in the click-path maps. That needs its own ticket and test.
- The `PlanPage` type has `docSource?` too (a page made for a documented address). The merge keeps `...old` for such a page, so its `docSource` stays.
