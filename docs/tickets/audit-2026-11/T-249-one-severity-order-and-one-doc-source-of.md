# T-249: One severity order and one `docSourceOf` in core

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | duplication | todo |

**Files you may edit (no others):**

- `packages/core/src/scoring.ts`
- `packages/core/src/finding-groups.ts`
- `packages/core/src/findings-contract.ts`
- `packages/core/src/issues-document.ts`
- `packages/core/src/plan/spec-plan.ts`
- `packages/core/tests/findings-contract.test.ts`

**Do not build in parallel with:** T-232 (edits `scoring.ts`, `finding-groups.ts`), T-251 (edits `findings-contract.ts` and its test).

## Problem

Two leftovers from T-134.

1. The severity order `Blocker, Major, Minor, Suggestion` is written four times in core, in four shapes: `SEVERITY_RANK` object in `scoring.ts` and `finding-groups.ts`, `SEVERITY_ORDER` record in `findings-contract.ts`, `SEVERITY_ORDER` array in `issues-document.ts`. `@qa/types` already exports `SEVERITY_ORDER: FindingSeverity[]` (in `problems.ts`), and `recommendations.ts` uses it. A new severity added in one place would be missed in the others.
2. `spec-plan.ts` has its own `docSourceOf(h, section = h.section)`. `plan/sources.ts` exports the same function without the second argument. Every call in `spec-plan.ts` passes one argument, so the two are the same and the copy can go.

## Current code

Branch from `main`.

`scoring.ts`:

```ts
import { ASPECT_CHECKERS, ASPECTS, aspectOfFinding, problemKey } from '@qa/types';
...
const SEVERITY_RANK: Record<FindingSeverity, number> = { Blocker: 0, Major: 1, Minor: 2, Suggestion: 3 };
...
      if (!entry.graded || SEVERITY_RANK[f.severity] < SEVERITY_RANK[entry.severity]) entry.severity = f.severity;
```

`finding-groups.ts`:

```ts
import { normalizeRoute, normalizeSelector, type Finding } from '@qa/types';

const SEVERITY_RANK = { Blocker: 0, Major: 1, Minor: 2, Suggestion: 3 } as const;
...
    if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[first.severity]) first.severity = f.severity;
```

`findings-contract.ts`:

```ts
import { FINDINGS_SCHEMA_VERSION, findingFingerprint, isActiveFinding } from '@qa/types';
...
const SEVERITY_ORDER: Record<string, number> = { Blocker: 0, Major: 1, Minor: 2, Suggestion: 3 };
...
        (SEVERITY_ORDER[a.f.severity] ?? 9) - (SEVERITY_ORDER[b.f.severity] ?? 9) ||
...
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
```

`issues-document.ts`:

```ts
import { ISSUE_TYPES, issueTypeOf } from '@qa/types';
...
const SEVERITY_ORDER: FindingSeverity[] = ['Blocker', 'Major', 'Minor', 'Suggestion'];
```

(its uses are `SEVERITY_ORDER.indexOf(...)`, so only the declaration goes.)

`plan/spec-plan.ts`:

```ts
import { UNIT_KINDS } from './sources.js';
...
const docSourceOf = (h: ParsedRequirementHint, section = h.section): DocSource => ({
  document: h.document ?? 'Product Context',
  section,
  requirementId: h.id,
});
```

`plan/sources.ts`:

```ts
export function docSourceOf(req: ParsedRequirementHint): DocSource {
  return { document: req.document ?? 'Product Context', section: req.section, requirementId: req.id };
}
```

## Change

1. `scoring.ts`: add `SEVERITY_ORDER` to the `@qa/types` value import. Delete the `SEVERITY_RANK` line. Replace the comparison with `SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(entry.severity)`.

2. `finding-groups.ts`: change the import to `import { normalizeRoute, normalizeSelector, SEVERITY_ORDER, type Finding } from '@qa/types';`. Delete the `SEVERITY_RANK` line. Replace the comparison with `SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(first.severity)`.

3. `findings-contract.ts`: add `SEVERITY_ORDER` to the `@qa/types` value import. Delete the local `const SEVERITY_ORDER: Record<string, number> = ...` line and add this helper in its place:

```ts
/** Position in the shared SEVERITY_ORDER; a severity it does not list sorts last. */
function severityRank(severity: string): number {
  const at = SEVERITY_ORDER.indexOf(severity as FindingSeverity);
  return at < 0 ? SEVERITY_ORDER.length : at;
}
```

Replace `(SEVERITY_ORDER[a.f.severity] ?? 9) - (SEVERITY_ORDER[b.f.severity] ?? 9)` with `severityRank(a.f.severity) - severityRank(b.f.severity)`, and `(SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)` with `severityRank(a.severity) - severityRank(b.severity)`.

4. `issues-document.ts`: add `SEVERITY_ORDER` to the `@qa/types` value import (`import { ISSUE_TYPES, SEVERITY_ORDER, issueTypeOf } from '@qa/types';`) and delete the local array. If `FindingSeverity` is then unused in that file, leave the type import alone when something else still uses it; remove it only if `pnpm build` or ESLint reports it unused.

5. `spec-plan.ts`: change `import { UNIT_KINDS } from './sources.js';` to `import { UNIT_KINDS, docSourceOf } from './sources.js';` and delete the local `docSourceOf` arrow function. The `DocSource` type import stays (it is used elsewhere in the file).

6. Run `pnpm exec prettier --write` on the five source files, then `pnpm build`.

## Tests

In `packages/core/tests/findings-contract.test.ts` add `githubAnnotations` to the import list from `'../src/findings-contract.js'` and add inside the top `describe`:

```ts
it('githubAnnotations lists Blockers before Majors', () => {
  const lines = githubAnnotations([
    finding({ id: 'F-1', severity: 'Major', title: 'Slow page' }),
    finding({ id: 'F-2', severity: 'Blocker', title: 'Crash' }),
  ]);
  expect(lines.map((l) => l.split(' ')[0])).toEqual(['::error', '::warning']);
});
```

Run: `pnpm exec vitest run packages/core/tests/findings-contract.test.ts packages/core/tests/scoring.test.ts packages/core/tests/issues-document.test.ts packages/core/tests/finding-groups-scope.test.ts packages/core/tests/spec-plan.test.ts packages/core/tests/spec-plan-integration.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -rn "SEVERITY_RANK\|Blocker: 0" packages/core/src` prints nothing.
- [ ] `grep -n "const docSourceOf" packages/core/src/plan/spec-plan.ts` prints nothing.
- [ ] The six test files pass; `pnpm build` passes.

## Notes

- `finding-groups.test.ts` is a browser-tier test (listed in `BROWSER_TESTS`); do not run it here. `finding-groups-scope.test.ts` is the unit test.
- `findings-contract.ts` sorted an unknown severity string last (`?? 9`). `severityRank` keeps that (it returns 4). Do not use bare `indexOf` there: `-1` would sort an unknown severity first.
- The wizard keeps its own copies (`ReportScreen.tsx`); that is a wizard ticket.
