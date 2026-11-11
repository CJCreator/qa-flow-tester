# T-200: Settings: repeated row buttons name the schedule or sign-in they act on

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/SettingsScreen.tsx`
- `packages/wizard/tests/wizard-terminology-a11y.test.tsx`

**Do not build in parallel with:** T-192, T-195, T-204 (edit `SettingsScreen.tsx`).

## Problem

In Settings, each scheduled Check-up has buttons that read only "Pause" / "Resume" and "Delete", and each remembered sign-in has "Test it" and "Forget". A screen-reader user moving by button hears the same word once per row with nothing to tell the rows apart (WCAG 2.4.6 Headings and Labels, 4.1.2 Name, Role, Value). The Helpers list in the same app already does this right (`HelpersScreen.tsx`: `aria-label={`Remove access for ${helper.email}`}`).

## Current code

`packages/wizard/src/screens/SettingsScreen.tsx:1114-1121` (branch `worktree-audit-cleanup`); the row's address is `s.targetUrl` (line 1103):

```tsx
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void handleToggle(s)} className="btn-quiet btn-sm min-h-[44px]">
                  {s.enabled ? 'Pause' : 'Resume'}
                </button>
                <button type="button" onClick={() => void handleDelete(s)} className="btn-link min-h-[44px] text-fail">
                  Delete
                </button>
              </div>
```

`SettingsScreen.tsx:1405-1418`; the row's site is `site.host` and its Role is `s.role`:

```tsx
                        <button
                          type="button"
                          className="btn-link min-h-[44px] text-sm"
                          onClick={() => void test(site.host, s.role)}
                        >
                          Test it
                        </button>
                        <button
                          type="button"
                          className="btn-link min-h-[44px] text-sm text-fail"
                          onClick={() => void forget(site.host, s.role)}
                        >
                          Forget
                        </button>
```

## Change

Add one `aria-label` to each of the four buttons. The visible text stays the same and must stay the first words of the label (WCAG 2.5.3 Label in Name).

1. Pause / Resume button:

```tsx
                <button
                  type="button"
                  onClick={() => void handleToggle(s)}
                  className="btn-quiet btn-sm min-h-[44px]"
                  aria-label={`${s.enabled ? 'Pause' : 'Resume'} the scheduled check-up of ${s.targetUrl}`}
                >
                  {s.enabled ? 'Pause' : 'Resume'}
                </button>
```

2. Delete button:

```tsx
                <button
                  type="button"
                  onClick={() => void handleDelete(s)}
                  className="btn-link min-h-[44px] text-fail"
                  aria-label={`Delete the scheduled check-up of ${s.targetUrl}`}
                >
                  Delete
                </button>
```

3. "Test it" button: add `aria-label={`Test it: the ${s.role} sign-in for ${site.host}`}`.
4. "Forget" button: add `aria-label={`Forget the ${s.role} sign-in for ${site.host}`}`.

## Tests

Edit `packages/wizard/tests/wizard-terminology-a11y.test.tsx` (add `readFileSync` from `node:fs` and `resolve` from `node:path` if not imported):

```ts
describe('Settings row buttons name their row', () => {
  const settings = readFileSync(resolve(__dirname, '../src/screens/SettingsScreen.tsx'), 'utf8');
  it.each([
    'the scheduled check-up of ${s.targetUrl}`}',
    'aria-label={`Delete the scheduled check-up of ${s.targetUrl}`}',
    'aria-label={`Test it: the ${s.role} sign-in for ${site.host}`}',
    'aria-label={`Forget the ${s.role} sign-in for ${site.host}`}',
  ])('has %s', (label) => {
    expect(settings).toContain(label);
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/wizard-terminology-a11y.test.tsx packages/wizard/tests/checkup-schedules.test.tsx` then `pnpm build`.

## Done when

- [x] All four buttons have an `aria-label` that starts with the visible text and names the row.
- [x] Visible text is unchanged.
- [x] Tests and `pnpm build` pass.

## Notes

- Labels use "check-up" and "sign-in" and "role" words from `CONTEXT.md`; do not write "run", "account" or "user".
- Out of scope, needs a design decision: `BulkSwitch` rendered inside a `<summary>` in `PlanDocument.tsx:258-261` (a button inside an interactive element). Moving it changes the group header layout.
- Out of scope: the Helpers email error (`HelpersScreen.tsx:161`) is already announced through `role="alert"`.
