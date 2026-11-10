# T-134: One copy of the area list, the changing-methods list and two plan helpers

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | inconsistency | built |

**Files you may edit (no others):**
- `packages/core/src/scoring.ts`
- `packages/core/src/site-history.ts`
- `packages/core/src/html-report.ts`
- `packages/core/src/competitive/safe-crawler.ts`
- `packages/core/src/plan/sources.ts`
- `packages/core/src/plan/spec-plan.ts`
- `packages/core/src/plan/markdown.ts`
- `packages/core/src/plan/ai-planner.ts`

**Do not build in parallel with:** T-114 (edits `safe-crawler.ts`), T-133 (edits `html-report.ts`).

Eight files, but each edit is two or three lines of the same kind: delete a local copy, import the shared one.

## Problem

The same constant or helper is declared in several files. The copies are equal today; they will drift.

| What | Shared original | Copies to remove |
|---|---|---|
| The six areas, in order | `ASPECTS` in `packages/types/src/problems.ts:21` (exported from `@qa/types`) | `scoring.ts:101-108` (`aspectList`), `site-history.ts:75-82` (`aspectList`), `html-report.ts:47-54` (`aspects`) |
| HTTP methods that change data | `MUTATING_METHODS` in `packages/core/src/live-site.ts:15` | `competitive/safe-crawler.ts:49` |
| Kinds of documented unit | `UNIT_KINDS` in `plan/sources.ts:134` (not exported yet) | `plan/spec-plan.ts:71` |
| Host of an address | `hostOf` in `plan/markdown.ts:3` (not exported yet) | `plan/ai-planner.ts:251` |

## Current code

`packages/types/src/problems.ts:21-28` (the original; do not edit)

```ts
export const ASPECTS: AspectType[] = [
  'Works',
  'Accessible',
  'Fast and mobile',
  'Findable',
  'Protected',
  'Looks and reads well',
];
```

Each of the three copies is the same six strings in the same order, for example `scoring.ts:101-108`:

```ts
  const aspectList: AspectType[] = [
    'Works',
    'Accessible',
    'Fast and mobile',
    'Findable',
    'Protected',
    'Looks and reads well',
  ];
```

`competitive/safe-crawler.ts:49`

```ts
const MUTATING_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];
```

`plan/spec-plan.ts:71` and `plan/sources.ts:134` (identical)

```ts
const UNIT_KINDS = new Set(['journey', 'route', 'negative']);
```

`plan/markdown.ts:3-9` and `plan/ai-planner.ts:251-257` (identical)

```ts
function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}
```

## Change

1. **Areas.** In each of `scoring.ts`, `site-history.ts`, `html-report.ts`:
   - add `ASPECTS` to the existing value import from `'@qa/types'` (the line that starts `import {` without
     `type`; `site-history.ts` line 4 and `html-report.ts` line 4, `scoring.ts` line 10);
   - replace the eight-line array with one line: `const aspectList = ASPECTS;` (in `html-report.ts`:
     `const aspects = ASPECTS;`).
   - If `AspectType` is then unused in that file, remove it from the type import.

2. **Changing methods.** `competitive/safe-crawler.ts`: delete line 49 and add
   `import { MUTATING_METHODS } from '../live-site.js';` to the imports. (`live-site.ts` imports
   `isPrivateHost` from `safe-crawler.ts`; the two-way import is safe because `MUTATING_METHODS` is read only
   inside the route handler, never while the module loads.)

3. **Unit kinds.** `plan/sources.ts:134`: add `export`. `plan/spec-plan.ts`: delete line 71 and add
   `UNIT_KINDS` to its import from `'./sources.js'` (add the import line if there is none).

4. **Host of an address.** `plan/markdown.ts:3`: add `export`. `plan/ai-planner.ts`: delete the local `hostOf`
   (lines 251-257) and add `import { hostOf } from './markdown.js';`. If that creates an import cycle error at
   build or test time (`markdown.ts` imports nothing from `ai-planner.ts` today, so it should not), stop and
   leave `hostOf` as it was; say so in the PR.

## Tests

No new test: the values do not change. Run:

- `pnpm build`
- `pnpm exec vitest run packages/core/tests`
- `pnpm exec eslint packages/core/src` (no new warnings in the eight files)

## Done when

- [x] The six area names appear as a literal list nowhere in `packages/core/src`
- [x] `MUTATING_METHODS`, `UNIT_KINDS` and `hostOf` are each declared once in `packages/core/src`
- [x] `pnpm build` and the core unit tests pass

## Notes

Not in this ticket (each changes behaviour and needs its own decision):
- `isPrivateHost` in `safe-crawler.ts` is a weaker copy of the address classifier in `address-class.ts` (it
  misses 169.254/16, 0.0.0.0, fc00::/7).
- Four severity-rank tables (`scoring.ts`, `finding-groups.ts`, `findings-contract.ts`, `issues-document.ts`).
- `docSourceOf` in `spec-plan.ts` takes a `section` argument the shared one in `sources.ts` does not.
