# T-194: Report and command palette: a failed Undo or download shows a message

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/ReportScreen.tsx`
- `packages/wizard/src/components/CommandPalette.tsx`
- `packages/wizard/tests/report-settings-text.test.ts`

**Do not build in parallel with:** T-190, T-195, T-198, T-203 (edit `ReportScreen.tsx`).

## Problem

Three calls are started with `void` and have no `catch`. When the runner refuses or is down, the promise rejects, nothing is shown, and the browser logs an unhandled rejection.

1. Report, "Hidden problems" list: Undo (`void triage([title], null)`).
2. Report, "Details for developers": the four Download buttons (`void downloadRunFile(...)`).
3. Command palette: "Download the plan as Markdown" (`void downloadPlanMarkdown()`).

## Current code

`packages/wizard/src/screens/ReportScreen.tsx` (branch `worktree-audit-cleanup`)

Lines 1036-1038 (inside `function Problems`, which starts at line 989):

```tsx
  const triage = async (titles: string[], status: 'Intended' | 'False Positive' | null, reason?: string) => {
    onReportChanged(await triageProblem(report.runId, titles, status, reason));
  };
```

Lines 1044-1046:

```tsx
      <h2 id="problems-title" className="mb-4 text-xl font-bold">
        Problems found
      </h2>
```

Line 1204:

```tsx
                    <button type="button" className="btn-link text-sm" onClick={() => void triage([title], null)}>
```

Lines 519-527 (inside `export function Report`, which starts at line 250):

```tsx
              {(['report.md', 'findings.json', 'issues.md', 'issues.html'] as const).map((file) => (
                <button
                  key={file}
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={() => void downloadRunFile(report.runId, file)}
                >
                  Download {file}
                </button>
              ))}
```

`ErrorMessage` is already imported in `ReportScreen.tsx` (line 17) and used like this at line 687: `{downloadError && <ErrorMessage>{downloadError}</ErrorMessage>}`.

`packages/wizard/src/components/CommandPalette.tsx:330`

```tsx
          run: () => void downloadPlanMarkdown(),
```

## Change

1. `ReportScreen.tsx`, in `Problems`: add state next to its other `useState` calls (line 1004-1005):

```tsx
  const [undoError, setUndoError] = useState<string | null>(null);
```

2. Line 1204: replace the `onClick` with:

```tsx
                      onClick={() => {
                        setUndoError(null);
                        triage([title], null).catch((err: unknown) =>
                          setUndoError(err instanceof Error ? err.message : 'That couldn’t be undone. Try again.')
                        );
                      }}
```

   (Keep `type="button" className="btn-link text-sm"`; let Prettier lay out the tag.)
3. Directly after the `</h2>` of `problems-title` (line 1046), add:

```tsx
      {undoError && <ErrorMessage>{undoError}</ErrorMessage>}
```

4. In `Report`: add state next to its other `useState` calls at the top of the component:

```tsx
  const [fileError, setFileError] = useState<string | null>(null);
```

5. Lines 519-527: replace the `onClick` with:

```tsx
                  onClick={() => {
                    setFileError(null);
                    downloadRunFile(report.runId, file).catch((err: unknown) =>
                      setFileError(err instanceof Error ? err.message : 'That file couldn’t be downloaded. Try again.')
                    );
                  }}
```

   and directly after the closing `</div>` of that `<div className="flex flex-wrap gap-3">`, add:

```tsx
            {fileError && <ErrorMessage>{fileError}</ErrorMessage>}
```

6. `CommandPalette.tsx` line 330: the palette has no message area, so a failure is logged instead of left unhandled. Replace with:

```tsx
          run: () => {
            downloadPlanMarkdown().catch((err: unknown) => {
              console.warn('[Release check-up] The plan could not be downloaded:', err instanceof Error ? err.message : err);
            });
          },
```

## Tests

Edit `packages/wizard/tests/report-settings-text.test.ts` (reads sources as text; copy its `readFileSync` pattern, adding the `node:fs` / `node:path` imports if absent). Add:

```ts
it('never starts a triage or a download without handling its failure', () => {
  const report = readFileSync(resolve(__dirname, '../src/screens/ReportScreen.tsx'), 'utf8');
  const palette = readFileSync(resolve(__dirname, '../src/components/CommandPalette.tsx'), 'utf8');
  expect(report).not.toMatch(/void triage\(/);
  expect(report).not.toMatch(/void downloadRunFile\(/);
  expect(palette).not.toMatch(/void downloadPlanMarkdown\(/);
});
```

Run: `pnpm exec vitest run packages/wizard/tests/report-settings-text.test.ts packages/wizard/tests/coverage-view.test.tsx` then `pnpm build`.

## Done when

- [ ] A failed Undo shows the runner's reason under "Problems found".
- [ ] A failed developer download shows a message under the buttons.
- [ ] No `void triage(`, `void downloadRunFile(` or `void downloadPlanMarkdown(` remains.
- [ ] Tests and `pnpm build` pass.

## Notes

- `Report` is rendered with `renderToStaticMarkup` in tests; `useState` works there.
- Do not change `ReportActionsBar` (lines 660-688): it already handles its own download failure.
- `console.warn` is allowed by the lint rules used in this repo (other files use it with the `[...]` prefix).
