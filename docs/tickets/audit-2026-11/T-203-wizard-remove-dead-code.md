# T-203: Wizard: remove code, styles and a file that nothing uses

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | wizard | dead-code | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/results/analysis-text.ts`
- `packages/wizard/src/components/text.tsx`
- `packages/wizard/src/lib/form.ts`
- `packages/wizard/src/screens/audit/start/audit-start-form.ts`
- `packages/wizard/tailwind.config.js`
- `packages/wizard/tailwind.config.d.ts`
- `packages/wizard/src/index.css`
- `packages/wizard/public/og-image.svg` (delete)
- `packages/wizard/src/screens/ReportScreen.tsx`
- `packages/wizard/src/components/plan/PlanDocument.tsx`
- `packages/wizard/src/screens/BenchmarkScreen.tsx`

**Do not build in parallel with:** T-184, T-185, T-190, T-193, T-194, T-195, T-198 (same files). Build this ticket after them.

## Problem

Each item below has no reference anywhere in `packages/wizard/src`, `packages/wizard/tests`, `packages/wizard/public`, `packages/wizard/index.html`, `scripts/` or `docs/` (checked with grep on branch `worktree-audit-cleanup`). They add reading cost and, for the CSS, bytes in the bundle.

## Current code and change

Do the steps in order. After each step run `pnpm build`; if it fails, the item is used after all: undo that one step and say so in your report.

1. `packages/wizard/src/screens/audit/results/analysis-text.ts:252-280`. Delete these four functions and their doc comments (they are copies of the runner's note text; the wizard only displays notes the runner sends):

```ts
/** "Only 1 page was read" note text (T-88, ADR 0042). */
export function onlyOnePageNoteText(): string {
...
/** "The site stopped answering after N pages" note text (T-88, ADR 0042). */
export function siteStoppedAnsweringNoteText(pages: number): string {
...
/** Speed source note text (T-88, ADR 0042). */
export function speedSourceNoteText(source: 'pagespeed-insights' | 'this-tool' | 'not-measured'): string {
...
/** AI status note text with its reason (T-88, ADR 0042). */
export function aiStatusNoteText(status: AuditAiStatus, reason?: string): string {
...
}
```

   Keep `isAiNote` (lines 247-250): it is used. Then remove `type AuditAiStatus,` from the import at line 11 (it was used only by `aiStatusNoteText`).

2. `packages/wizard/src/components/text.tsx:21-23`. Delete:

```tsx
export function Lead({ children }: { children: ReactNode }) {
  return <p className="mb-8 max-w-prose text-lg text-ink-soft">{children}</p>;
}
```

3. `packages/wizard/src/lib/form.ts:77-82`. Delete (keep the `VisibilityChoice` interface above it):

```ts
export const DEFAULT_VISIBILITY: VisibilityChoice = {
  search: true,
  answers: true,
  aiSearch: true,
  marketing: true,
};
```

4. `packages/wizard/src/screens/audit/start/audit-start-form.ts:16`. The comment is wrong: the defaults come from `AUDIT_LIMIT_DEFAULTS` (`packages/types/src/website-audit.ts:72-78`), 50 pages and depth 5. Replace the line with:

```ts
/** The defaults the shared check fills in for a bare address: 50 pages and depth 5 (AUDIT_LIMIT_DEFAULTS). */
```

5. `packages/wizard/tailwind.config.js:63-64`. Delete:

```js
/** @deprecated The light palette is now the default; kept as a name for the print rules. */
export const lightPalette = palette;
```

   and `packages/wizard/tailwind.config.d.ts:32`:

```ts
export declare const lightPalette: Record<PaletteToken, string>;
```

6. `packages/wizard/src/index.css`. Delete these rule blocks (each from its selector line to its closing `}`), and the comment line directly above a block when it only describes that block:
   - `.card-2`, `.card-3`, `.card-4` (lines 84-92). Keep `.card-1` and the comment above it.
   - `.bg-blueprint-grid-dense` (lines 101-106) and `.bg-blueprint-dots` (lines 107-110). Keep `.bg-blueprint-grid`.
   - `/* Older names for the same badges. */` and `.badge-tech`, `.badge-tech-stamp`, `.badge-tech-pass`, `.badge-tech-warn`, `.badge-tech-fail` (lines 128-143). Keep `.badge`, `.badge-stamp`, `.badge-pass`, `.badge-warn`, `.badge-fail`.
   - `.blueprint-card` (lines 145-147).
   - `/* Registration ticks are retired: … */` and `.corner-ticks` (lines 148-151).

7. Delete the file `packages/wizard/public/og-image.svg`. The share image is `og-image.png`; `tests/share-image.test.ts:16` already asserts nothing refers to the `.svg`.

8. Remove the `export` keyword only (the declarations stay) from things used solely inside their own file:
   - `packages/wizard/src/screens/ReportScreen.tsx:145` `export interface ProblemRow` → `interface ProblemRow`
   - `packages/wizard/src/screens/ReportScreen.tsx:153` `export function mergeSameProblem` → `function mergeSameProblem`
   - `packages/wizard/src/components/plan/PlanDocument.tsx:298` `export function EditableTitle` → `function EditableTitle`

9. `packages/wizard/src/screens/BenchmarkScreen.tsx:14-20` re-declares a function that `lib/url.ts:55-61` already exports with the same body. Delete:

```tsx
function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}
```

   and add, with the other `../lib/...` imports: `import { hostOf } from '../lib/url';`

## Tests

No new test. Run the suite that guards styles, text and the share image, then the whole wizard:

`pnpm exec vitest run packages/wizard/tests/style-tokens.test.ts packages/wizard/tests/share-image.test.ts packages/wizard/tests/contrast.test.ts packages/wizard/tests/theme.test.ts packages/wizard/tests/repo-hygiene.test.ts`
then `pnpm exec vitest run --project unit packages/wizard` and `pnpm build`, `pnpm lint` (0 errors).

## Done when

- [x] All nine steps are applied (or a skipped step is reported with the build error that showed it is used).
- [x] `grep -rn "lightPalette\|DEFAULT_VISIBILITY\|aiStatusNoteText\|badge-tech\|corner-ticks\|blueprint-card" packages/wizard --include=*.ts --include=*.tsx --include=*.js --include=*.css` (excluding `node_modules`, `dist`) prints nothing.
- [x] Tests, `pnpm build` and `pnpm lint` pass.

## Notes

- If T-185 was built before this ticket, its test imports `staysInForm`, not `EditableTitle`; step 8 is still safe.
- Not in this ticket (owner call, each has its own tests that would have to go too): `translateReviewPlan`, `flowToJourney`, `defaultSiteWideChecks`, `groupPagesBySectionAndLayout` in `lib/plan-translate.ts`; `buildProductContext` in `lib/context.ts`; `hasNonDefaultOptions` in `lib/onboarding.ts`.
