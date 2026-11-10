# T-204: Spinner: remove the ignored `announce` prop and its 26 uses

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | wizard | dead-code | todo |

**Files you may edit (no others):**
- `packages/wizard/src/components/text.tsx`
- every file under `packages/wizard/src` that contains `announce={false}` (14 files, listed below)

**Do not build in parallel with:** any other wizard ticket. It touches 15 files with a one-token change each; build it last, alone.

## Problem

`Spinner` accepts an `announce` prop that it ignores (marked `@deprecated`). 26 call sites still pass `announce={false}`, which reads as if the spinner were silent to screen readers. It is not: every spinner is a labelled `role="status"`.

## Current code

`packages/wizard/src/components/text.tsx:37-45` (branch `worktree-audit-cleanup`)

```tsx
export function Spinner({
  label,
}: {
  label: string;
  /** @deprecated Ignored: every indicator is a labelled status. Kept so existing callers still compile. */
  announce?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-label={label}>
```

Call sites (count per file, from `grep -rn "announce={false}" packages/wizard/src`):

| File | Uses |
|---|---|
| `components/DeveloperDetails.tsx` | 1 |
| `components/KeyField.tsx` | 2 |
| `components/WakeNote.tsx` | 1 |
| `screens/audit/ai/AuditAiModelsPanel.tsx` | 1 |
| `screens/audit/documents/DocumentSettingsScreen.tsx` | 1 |
| `screens/audit/documents/ReviewDocumentsScreen.tsx` | 1 |
| `screens/audit/saved/HelperSignInScreen.tsx` | 1 |
| `screens/audit/saved/HelpersScreen.tsx` | 1 |
| `screens/audit/saved/PreviewShareScreen.tsx` | 2 |
| `screens/audit/start/AuditStartScreen.tsx` | 1 |
| `screens/NewCheckupScreen.tsx` | 2 |
| `screens/PlanReviewScreen.tsx` | 2 |
| `screens/ReportScreen.tsx` | 6 |
| `screens/SettingsScreen.tsx` | 4 |

Every use has the form `<Spinner label="…" announce={false} />`. No call site passes any other value (checked: `grep -rn "announce=" packages/wizard/src | grep -v "announce={false}"` prints nothing).

## Change

1. In each of the 14 files, delete the text ` announce={false}` (the leading space included) from every `<Spinner …>`. Example:

```tsx
{approving ? <Spinner label="Starting the tests…" announce={false} /> : 'Approve with these details'}
```

becomes

```tsx
{approving ? <Spinner label="Starting the tests…" /> : 'Approve with these details'}
```

2. `components/text.tsx`: make the props:

```tsx
export function Spinner({ label }: { label: string }) {
```

   (delete the `announce?: boolean;` line and its `@deprecated` comment).
3. Run `pnpm exec prettier --write packages/wizard/src` so lines that got shorter are laid out again.

## Tests

No new test; TypeScript proves no caller still passes the prop.

Run: `pnpm build`, then `pnpm exec vitest run --project unit packages/wizard`, then `pnpm lint` (0 errors).

## Done when

- [ ] `grep -rn "announce" packages/wizard/src` prints only the two comment lines in `components/text.tsx` that use the word in prose (lines 3 and 35), or nothing.
- [ ] `pnpm build`, the wizard unit tests and `pnpm lint` pass.

## Notes

- Do not change any spinner's `label` text.
- If a test file under `packages/wizard/tests` passes `announce`, remove it there too (none does today).
