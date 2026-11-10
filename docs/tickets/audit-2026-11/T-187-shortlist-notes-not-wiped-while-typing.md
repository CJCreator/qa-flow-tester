# T-187: Website Audit shortlist: notes being typed are not wiped by a background re-read

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/saved/ShortlistPanel.tsx`
- `packages/wizard/tests/audit-shortlist.test.tsx`

**Do not build in parallel with:** none.

## Problem

`ShortlistPanel` resets its draft whenever the `entry` prop is a new object. `AuditHistoryScreen` re-reads the Website Audit while a version is running and passes a new `summary.shortlist` object each time, with the same content. Scenario: type notes while an audit runs; the next re-read replaces the draft with the saved entry and the typed notes vanish.

## Current code

`packages/wizard/src/screens/audit/saved/ShortlistPanel.tsx:154-163` (branch `worktree-audit-cleanup`)

```tsx
export function ShortlistPanel({ auditId, entry, onSaved, fetchImpl }: ShortlistPanelProps) {
  const [saved, setSaved] = useState<ShortlistEntry | null>(entry);
  const [draft, setDraft] = useState<ShortlistDraft>(() => draftFromEntry(entry));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<ShortlistPanelViewProps['message']>(null);

  useEffect(() => {
    setSaved(entry);
    setDraft(draftFromEntry(entry));
  }, [entry]);
```

`ShortlistEntry` (`packages/types/src/website-audit.ts:847-855`) has `updatedAt: string`, which changes only when the entry is saved.

## Change

1. Above `ShortlistPanel` (module level), add and export:

```tsx
/** What tells two shortlist entries apart: the save time, or nothing when there is no entry. */
export function entryVersion(entry: ShortlistEntry | null): string | null {
  return entry?.updatedAt ?? null;
}
```

2. Replace the effect with:

```tsx
  // Reset only when the saved entry really changed (a new save time), not on every re-read of the audit.
  const version = entryVersion(entry);
  useEffect(() => {
    setSaved(entry);
    setDraft(draftFromEntry(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entry` is a new object on every re-read.
  }, [version]);
```

   If ESLint reports that the `react-hooks/exhaustive-deps` rule is unknown (the rule is not installed), delete the `eslint-disable-next-line` comment line.

## Tests

Edit `packages/wizard/tests/audit-shortlist.test.tsx`. Add `entryVersion` to its existing import from `'../src/screens/audit/saved/ShortlistPanel'` (add a new import line if the file imports only from `saved-api`). Add:

```ts
describe('entryVersion', () => {
  const entry = { auditId: 'a1', mark: null, notes: 'x', outcome: null, outcomeNote: '', updatedAt: '2026-11-01T00:00:00.000Z' };
  it('is the same for two copies of one saved entry', () => {
    expect(entryVersion({ ...entry })).toBe(entryVersion({ ...entry }));
  });
  it('changes when the entry is saved again', () => {
    expect(entryVersion({ ...entry, updatedAt: '2026-11-02T00:00:00.000Z' })).not.toBe(entryVersion(entry));
  });
  it('is null without an entry', () => {
    expect(entryVersion(null)).toBeNull();
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/audit-shortlist.test.tsx` then `pnpm lint` (0 errors).

## Done when

- [x] The effect depends on the entry's save time, not on the object.
- [x] Typing notes during a running audit keeps the text across re-reads.
- [x] After Save, the panel still shows the values the runner saved.
- [x] Test and lint pass.

## Notes

- Do not change `AuditHistoryScreen.tsx`.
- `save()` already calls `setSaved(outcome.value)`; leave it.
