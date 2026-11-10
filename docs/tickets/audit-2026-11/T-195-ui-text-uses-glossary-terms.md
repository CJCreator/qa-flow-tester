# T-195: UI text: eight strings use words the glossary says to avoid

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | inconsistency | todo |

**Files you may edit (no others):**
- `packages/wizard/src/screens/ScanningScreen.tsx`
- `packages/wizard/src/screens/NewCheckupScreen.tsx`
- `packages/wizard/src/screens/SettingsScreen.tsx`
- `packages/wizard/src/screens/ReportScreen.tsx`
- `packages/wizard/src/components/plan/parts.tsx`
- `packages/wizard/src/components/plan/PlanDocument.tsx`
- `packages/wizard/src/api.ts`
- `packages/wizard/tests/wizard-terminology-a11y.test.tsx`

**Do not build in parallel with:** T-184, T-185, T-190, T-192, T-193, T-194, T-198, T-199, T-200, T-203 (same files). Build this ticket alone, last among them, or first.

## Problem

`CONTEXT.md` is the glossary; each term has an `_Avoid_` list that UI text must respect (`CLAUDE.md`, "Read first"). Eight strings break it. The rules, quoted from `CONTEXT.md`:

- **Check-up** (line 61): `_Avoid_: Run, scan or check (in UI text; "check" means a Navigation Check or a graded check)`
- **Product Context** (line 41): `_Avoid_: Spec, documentation, requirements doc`
- **Plan** (line 69): `_Avoid_: Test case matrix, test suite, spec`
- **Role** (line 177): `_Avoid_: User, account, persona`

No test pins any of the old strings (checked with grep over `packages/wizard/tests`).

## Current code and change

Each row is one exact text replacement. Change only the quoted words; keep the surrounding code. Line numbers are for branch `worktree-audit-cleanup`.

| # | File:line | Current text | New text | Rule |
|---|---|---|---|---|
| 1 | `screens/ScanningScreen.tsx:101` | `', and the AI uses the specs you added to write it'` | `', and it is written with the Product Context you added'` | Product Context: avoid Spec. Also true when the Plan is written without AI. |
| 2 | `screens/NewCheckupScreen.tsx:521` | `so the check-up acts as that user.` | `so the check-up acts as that role.` | Role: avoid User |
| 3 | `screens/SettingsScreen.tsx:1351` | `won’t sign in as this account until you add it again.` | `won’t sign in as this role until you add it again.` | Role: avoid account |
| 4 | `screens/ReportScreen.tsx:1575` | ``*Reported in run: \`${report.runId}\` for ${report.targetUrl}*`` | ``*Reported in check-up: \`${report.runId}\` for ${report.targetUrl}*`` | Check-up: avoid Run |
| 5 | `components/plan/parts.tsx:72` | `'Included: uncheck to leave it out of the run'` | `'Included: uncheck to leave it out of the check-up'` | Check-up: avoid Run |
| 6 | `components/plan/PlanDocument.tsx:725` | `Make it a quick check: desktop only, and only the shared menus’ links` | `Make it a shorter check-up: desktop only, and only the shared menus’ links` | Check-up: avoid check. Settings already says "Shorter check-up". |
| 7 | `api.ts:1079` | `'Couldn’t record the spec override.'` | `'The override couldn’t be saved. Try again.'` | Plan / Product Context: avoid spec |
| 8 | `screens/SettingsScreen.tsx:853` | `Every accessibility check must pass (WCAG AA)` | `Accessibility area must reach grade A` | See below |

Row 8: the option is `strictAccessibility`. In `packages/types/src/verdict.ts:179-186` it means the Accessible area must reach grade A with a score of at least 90. It does not mean every check passed, and "pass" is a WCAG criterion status in the glossary, not an area result.

For rows 1-3 and 8 the apostrophes are typographic (`’`). Copy them from the current line.

## Tests

Edit `packages/wizard/tests/wizard-terminology-a11y.test.tsx`. Add (with `readFileSync` from `node:fs` and `resolve` from `node:path` if the file does not import them):

```ts
describe('glossary words in UI text (CONTEXT.md _Avoid_ lists)', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../src', p), 'utf8');
  it.each([
    ['screens/ScanningScreen.tsx', 'the specs you added'],
    ['screens/NewCheckupScreen.tsx', 'acts as that user'],
    ['screens/SettingsScreen.tsx', 'as this account'],
    ['screens/SettingsScreen.tsx', 'Every accessibility check must pass'],
    ['screens/ReportScreen.tsx', 'Reported in run:'],
    ['components/plan/parts.tsx', 'out of the run'],
    ['components/plan/PlanDocument.tsx', 'a quick check'],
    ['api.ts', 'spec override'],
  ])('%s no longer says "%s"', (file, phrase) => {
    expect(read(file)).not.toContain(phrase);
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/wizard-terminology-a11y.test.tsx packages/wizard/tests/no-banned-words.test.ts packages/wizard/tests/report-settings-text.test.ts` then `pnpm build`.

## Done when

- [ ] All eight strings read as in the "New text" column.
- [ ] The three test files pass; `pnpm build` passes.

## Notes

- Text only. Do not rename `quickCheck`, `strictAccessibility`, or any identifier.
- The Markdown in row 4 is copied into an issue tracker by the person; only the label word changes.
- Out of scope: "Compare sites" in the area navigation (pinned by `sources-screens.test.tsx:426`).
