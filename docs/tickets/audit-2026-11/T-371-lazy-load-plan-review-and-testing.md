# T-371: Plan Review, Testing and Scanning load on demand

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | wizard | speed | todo |

**Files you may edit (no others):**

- `packages/wizard/src/App.tsx`
- `packages/wizard/tests/app-lazy-screens.test.ts` (new)

**Do not build in parallel with:** T-357, T-362, T-363, T-365, T-369, T-372 (all edit `App.tsx`).

## Problem

LAT-11 says screens a first visit does not need load when first opened (`App.tsx:76-77`), and most screens follow it with `lazy(() => import(...))` (`App.tsx:78-126`). Three of the heaviest do not. They are imported statically (`App.tsx:62-65`):

- `PlanReviewScreen`, which pulls in `components/plan/PlanDocument.tsx` (about 2,090 lines) and `@dnd-kit`;
- `ScanningScreen`;
- `TestingScreen`.

So every page that opens the app (a first visit to `/check`, Settings, a report) downloads the Plan Review editor before anything is shown. The audit's build measured the App chunk at 270 KB (83 KB gzip).

## Current code

Branch from `main`.

`grep -n "from './screens/PlanReviewScreen'\|from './screens/ScanningScreen'\|from './screens/TestingScreen'" packages/wizard/src/App.tsx`:

```ts
import { PlanReviewScreen, type PlanNotice, type PlanUpdateState } from './screens/PlanReviewScreen';
import { ScanningScreen, isScanProgress, type ScanProgress } from './screens/ScanningScreen';
...
import { TestingScreen } from './screens/TestingScreen';
```

`isScanProgress` and `ScanProgress` live in `src/lib/scan-progress.ts:1-33`; `ScanningScreen.tsx:12-13` only re-exports them. `App.tsx` uses `isScanProgress` at run time in `onEvent` (`App.tsx:322`), so it must not come from the lazy file.

The pattern to copy (`App.tsx:80-82`):

```ts
const PastCheckupsScreen = lazy(() =>
  import('./screens/PastCheckupsScreen').then((m) => ({ default: m.PastCheckupsScreen }))
);
```

All three screens already render inside `<Suspense fallback={<Loading label="Opening…" />}>` (`App.tsx:1023`).

## Change

1. `App.tsx`:
   - Replace the three static imports with type-only imports and the run-time helper from its own module:

```ts
import type { PlanNotice, PlanUpdateState } from './screens/PlanReviewScreen';
import { isScanProgress, type ScanProgress } from './lib/scan-progress';
```

   - Add, next to the other lazy screens:

```ts
// The Check-up's own screens: only a person who starts or resumes a Check-up needs them (LAT-11).
const ScanningScreen = lazy(() => import('./screens/ScanningScreen').then((m) => ({ default: m.ScanningScreen })));
const PlanReviewScreen = lazy(() =>
  import('./screens/PlanReviewScreen').then((m) => ({ default: m.PlanReviewScreen }))
);
const TestingScreen = lazy(() => import('./screens/TestingScreen').then((m) => ({ default: m.TestingScreen })));
```

   - The JSX that renders them does not change.
2. Leave `ScanningScreen.tsx`'s re-exports in place (`tests/scanning-progress.test.tsx:5` imports from there).
3. `pnpm exec prettier --write packages/wizard/src/App.tsx`, then `pnpm build`. Compare `pnpm --filter @qa/wizard run build` output before and after: the `App-*.js` chunk is smaller and three new chunks appear.

## Tests

New file `packages/wizard/tests/app-lazy-screens.test.ts` (unit; reads `src/App.tsx` as text):

- `'the Check-up screens are not imported statically'`: no line matches `/^import \{[^}]*\b(PlanReviewScreen|ScanningScreen|TestingScreen)\b[^}]*\} from/m` (an `import type` line is allowed).
- `'each is loaded with lazy'`: for each name, the text matches `` new RegExp(`const ${name} = lazy\\(\\(\\) =>\\s*import\\('\\./screens/${name}'\\)`) ``.
- `'the scan progress check comes from lib'`: the text contains `from './lib/scan-progress'`.

Run: `pnpm exec vitest run packages/wizard/tests/app-lazy-screens.test.ts packages/wizard/tests/scanning-progress.test.tsx packages/wizard/tests/audit-routing.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "lazy(() => import('./screens/PlanReviewScreen')" packages/wizard/src/App.tsx` finds the line (or its wrapped form).
- [ ] `pnpm --filter @qa/wizard run build` lists `PlanReviewScreen-*.js`, `ScanningScreen-*.js` and `TestingScreen-*.js` chunks, and the `App-*.js` chunk is smaller than before (write both sizes in the PR).
- [ ] The new test and the wizard unit tests pass; `pnpm build` passes.

## Notes

- Audit finding L16 (audit of 11 Nov 2026 on `d225418`).
- Starting a Check-up now shows "Opening…" for a moment while the scan screen's code loads. If that is noticeable, a later ticket can warm the chunk on the new check-up screen; not here.
- `App.tsx` is also edited by T-357, T-362, T-363, T-365, T-369 and T-372; build after T-363 and before T-372.
