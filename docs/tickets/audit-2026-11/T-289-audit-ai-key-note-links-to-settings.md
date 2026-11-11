# T-289: Website Audit AI-key notes point to Settings, and two unused test names go

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | bug | todo |

**Files you may edit (no others):**

- `packages/wizard/src/screens/audit/results/AuditSummary.tsx`
- `packages/wizard/src/screens/audit/start/AuditStatusChips.tsx`
- `packages/wizard/tests/audit-analysis-summary.test.tsx`
- `packages/wizard/tests/audit-progress.test.tsx`
- `packages/wizard/tests/audit-start-form.test.ts`

**Do not build in parallel with:** T-189 and T-196 (edit `audit-progress.test.tsx`).

## Problem

1. When a Website Audit's notes mention the AI (no key, key expired, quota, timeout), the notes banner shows a link "Audit settings". That page holds only the PageSpeed key and the document settings. The AI keys are on the Settings screen (section `id="ai"`). Every other AI-key prompt in the Website Audit screens already says "Add an AI key in Settings" (`rewrite-api.ts:26`, `share-api.ts:32`, `PreviewShareScreen.tsx`, `ReviewDocumentsScreen.tsx`, `analysis-text.ts:187`). The status chip "AI: key expired: update in Audit settings" has the same wrong target. T-197 left this alone because `audit-analysis-summary.test.tsx:234-246` pinned the link (T-88); the test is wrong too.
2. Two lint leftovers in tests: `NOT_DONE_REASON_TEXT` is imported but never used in `audit-analysis-summary.test.tsx` (line 18), and `AuditPageState` is imported but never used in `audit-start-form.test.ts` (line 2).

## Current code

Find with `grep -n "auditSettings\|Audit settings" packages/wizard/src/screens/audit/results/AuditSummary.tsx packages/wizard/src/screens/audit/start/AuditStatusChips.tsx` and `grep -n "NOT_DONE_REASON_TEXT\|AuditPageState" packages/wizard/tests/audit-analysis-summary.test.tsx packages/wizard/tests/audit-start-form.test.ts`.

`AuditSummary.tsx` (`NotesBanner`, lines 60 to 75):

```tsx
  // Any note about AI links to Audit settings (T-88).
  const aboutAi = notes.some(isAiNote);
  ...
        aboutAi && (
          <Link to={PATHS.auditSettings} className="btn-link">
            Audit settings
          </Link>
        )
```

`AuditStatusChips.tsx` line 15: `return 'AI: key expired: update in Audit settings';`

`audit-analysis-summary.test.tsx` line 18: `import { NOT_DONE_REASON_TEXT, fixFirst } from '../src/screens/audit/results/analysis-text';` and lines 234 to 248:

```tsx
  it('shows result.notes in a banner that links to Audit settings for any AI reason', () => {
    expect(text).toContain('AI notes need an AI key.');
    expect(html).toMatch(/<a [^>]*href="\/audit-settings"[^>]*>Audit settings<\/a>/);

    // Any AI note links to Audit settings (T-88)
    for (const aiNote of [ ... ]) {
      const banner = renderToStaticMarkup(createElement(NotesBanner, { notes: [aiNote] }));
      expect(banner).toContain('Audit settings');
      expect(banner).toContain('/audit-settings');
    }
```

`audit-progress.test.tsx` lines 64 and 240 expect `'AI: key expired: update in Audit settings'`.

`audit-start-form.test.ts` line 2: `import { validateAuditStartBody, type AuditPageState, type AuditProgressEvent } from '@qa/types/src/browser.js';`

`PATHS.settings` is `'/settings'` (`lib/router.ts:45`).

## Change

1. `AuditSummary.tsx`: replace the comment and the link:

```tsx
  // Any note about AI links to Settings, where the AI key is kept (T-88).
  ...
          <Link to={PATHS.settings} className="btn-link">
            Settings
          </Link>
```

2. `AuditStatusChips.tsx`: change the text to `'AI: key expired: update in Settings'`.
3. `audit-analysis-summary.test.tsx`: change line 18 to `import { fixFirst } from '../src/screens/audit/results/analysis-text';`. Replace the test at lines 234 to 248 with this (keep the second half of the test, the "Non-AI notes" loop, exactly as it is):

```tsx
  it('shows result.notes in a banner that links to Settings (where the AI key is kept) for any AI reason', () => {
    expect(text).toContain('AI notes need an AI key.');
    expect(html).toMatch(/<a [^>]*href="\/settings"[^>]*>Settings<\/a>/);
    expect(html).not.toContain('href="/audit-settings"');

    // Any AI note links to Settings (T-88)
    for (const aiNote of [
      'AI notes need an AI key.',
      'The AI key expired. Update it in Audit settings.',
      'The AI quota was reached.',
      'The AI did not answer in time.',
    ]) {
      const banner = renderToStaticMarkup(createElement(NotesBanner, { notes: [aiNote] }));
      expect(banner).toContain('href="/settings"');
      expect(banner).not.toContain('href="/audit-settings"');
    }
```

In the "Non-AI notes" loop below it, add `expect(other).not.toContain('href="/settings"');` after the existing `not.toContain('Audit settings')` line. 4. `audit-progress.test.tsx`: change both expected strings (lines 64 and 240) to `'AI: key expired: update in Settings'`. 5. `audit-start-form.test.ts`: change line 2 to `import { validateAuditStartBody, type AuditProgressEvent } from '@qa/types/src/browser.js';`. 6. Run `pnpm exec prettier --write` on the five files.

## Tests

The edited tests above are the tests. Run:

`pnpm exec vitest run packages/wizard/tests/audit-analysis-summary.test.tsx packages/wizard/tests/audit-progress.test.tsx packages/wizard/tests/audit-start-form.test.ts`

Then `pnpm build`.

## Done when

- [ ] `grep -n "auditSettings" packages/wizard/src/screens/audit/results/AuditSummary.tsx` prints nothing.
- [ ] `grep -rn "update in Audit settings" packages/wizard` prints nothing.
- [ ] `grep -rn "NOT_DONE_REASON_TEXT\|AuditPageState" packages/wizard/tests/audit-analysis-summary.test.tsx packages/wizard/tests/audit-start-form.test.ts` prints nothing.
- [ ] The three tests and `pnpm build` pass.

## Notes

- Not in this ticket (core, other area): the sentence the pipeline writes, `The AI key expired. Update it in Audit settings.` (`packages/core/src/audit/pipeline/pipeline.ts:227`, pinned by `packages/core/tests/audit-pipeline.test.ts:1092`). It should say "Update it in Settings." Until that is changed, the banner shows that sentence next to a "Settings" link. File a core ticket for it.
- `audit-progress.test.tsx` still uses `AuditPageState` (line 4 and 87); only `audit-start-form.test.ts` has the unused import.
- The speed notes (PageSpeed key) legitimately belong to Audit settings, but they are not AI notes and show no link today; do not add one here.
