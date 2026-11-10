# T-197: Website Audit text: one "busy" message without "run", and the documents line names what the seven are

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | inconsistency | todo |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/saved/saved-api.ts`
- `packages/wizard/src/screens/audit/saved/share-api.ts`
- `packages/wizard/src/screens/audit/results/DocumentsReady.tsx`
- `packages/wizard/tests/audit-saved.test.tsx`
- `packages/wizard/tests/audit-documents-ready.test.tsx`

**Do not build in parallel with:** T-201 (edits `saved-api.ts` and `share-api.ts`).

## Problem

1. The message for a busy runner says "Another run is in progress". `CONTEXT.md` lists "run" under `_Avoid_` for both **Check-up** (line 61: `_Avoid_: Run, scan or check (in UI text; …)`) and **Website Audit** (line 340: `_Avoid_: Check-up (that is for a team's own App), scan, run, site review, teardown, project`). The same sentence is written twice (`saved-api.ts`, `share-api.ts`) and differs from the start screen's wording (`audit-start-api.ts:34-35`).
2. Under the heading "Audit Documents ready" the line reads "The 7 documents prepared for this Website Audit version." `CONTEXT.md` line 351 defines an **Audit Document** as "One of the five documents a Website Audit produces"; the **Pitch Glimpse** and the **Owner Audit** are separate terms. Seven is right only as five plus those two.

## Current code

`packages/wizard/src/screens/audit/saved/saved-api.ts:54-60` (branch `worktree-audit-cleanup`)

```ts
/** Shown when a re-run is refused because the run slot is busy (REQ-028 AC-3). */
export const RUN_IN_PROGRESS_TEXT =
  'Another run is in progress: a Check-up, a benchmark or a Website Audit. Wait for it to finish, then try again.';

const REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_RUN_IN_PROGRESS: RUN_IN_PROGRESS_TEXT,
```

`packages/wizard/src/screens/audit/saved/share-api.ts:46-47`

```ts
  ERR_RUN_IN_PROGRESS:
    'Another run is in progress: a Check-up, a benchmark or a Website Audit. Wait for it to finish, then try again.',
```

`packages/wizard/src/screens/audit/results/DocumentsReady.tsx:39` and `:59`

```tsx
/** Lists the 7 documents produced by a Website Audit with their readiness state (T-88, ADR
```

```tsx
          <p className="text-sm text-ink-soft">The 7 documents prepared for this Website Audit version.</p>
```

`packages/wizard/tests/audit-saved.test.tsx:344` and `:348`

```ts
    expect(RUN_IN_PROGRESS_TEXT).toMatch(/^Another run is in progress/);
    ...
    expect(textOf(html)).toContain('Another run is in progress');
```

## Change

1. `saved-api.ts`: replace the constant's text (keep the name, it is imported by the test):

```ts
/** Shown when a request is refused because the runner is busy (REQ-028 AC-3). */
export const RUN_IN_PROGRESS_TEXT =
  'Another Check-up, benchmark or Website Audit is in progress. Wait for it to finish, then try again.';
```

2. `share-api.ts`: add `RUN_IN_PROGRESS_TEXT` to the things it imports from `'./saved-api'` (add `import { RUN_IN_PROGRESS_TEXT } from './saved-api';` after the existing imports if it does not import from that file), and replace lines 46-47 with:

```ts
  ERR_RUN_IN_PROGRESS: RUN_IN_PROGRESS_TEXT,
```

   `saved-api.ts` does not import `share-api.ts`, so this adds no import cycle.
3. `DocumentsReady.tsx` line 59: replace the paragraph text with

```tsx
          <p className="text-sm text-ink-soft">
            The 5 Audit Documents, the Pitch Glimpse and the Owner Audit prepared for this Website Audit version.
          </p>
```

4. `DocumentsReady.tsx` line 39: in the comment, replace `the 7 documents` with `the 5 Audit Documents, the Pitch Glimpse and the Owner Audit`.

## Tests

`packages/wizard/tests/audit-saved.test.tsx`:

- line 344: `expect(RUN_IN_PROGRESS_TEXT).toMatch(/^Another Check-up, benchmark or Website Audit is in progress/);`
- line 348: `expect(textOf(html)).toContain('Another Check-up, benchmark or Website Audit is in progress');`
- add in the same test: `expect(RUN_IN_PROGRESS_TEXT).not.toMatch(/\brun\b/i);`

`packages/wizard/tests/audit-documents-ready.test.tsx`: in the test at line 95-98 (it already checks `Audit Documents ready`), add:

```ts
    expect(textOf(html)).toContain('The 5 Audit Documents, the Pitch Glimpse and the Owner Audit');
    expect(textOf(html)).not.toContain('The 7 documents');
```

Run: `pnpm exec vitest run packages/wizard/tests/audit-saved.test.tsx packages/wizard/tests/audit-documents-ready.test.tsx packages/wizard/tests/audit-preview-share.test.tsx` then `pnpm build`.

## Done when

- [ ] The busy text is written once and holds no "run".
- [ ] The documents line names the five Audit Documents, the Pitch Glimpse and the Owner Audit.
- [ ] The heading "Audit Documents ready" is unchanged (tests and `RESULT_SECTIONS` in `AnalysisScreen.tsx:297` use it).
- [ ] Tests and `pnpm build` pass.

## Notes

- Do not change `audit-start-api.ts:34-35`: its sentence ends differently on purpose ("Start this Website Audit when it has finished.").
- Dropped from this ticket: pointing AI-key notes at Settings instead of Audit settings. `audit-analysis-summary.test.tsx:234-246` pins the Audit settings link as intended (T-88).
