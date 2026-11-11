# T-264: One loader for the stored Website Audit settings

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | duplication | todo |

**Files you may edit (no others):**

- `packages/runner/src/routes/audit-settings.ts`
- `packages/runner/src/routes/audit-export.ts`
- `packages/runner/src/routes/index.ts`
- `packages/runner/tests/audit-settings-routes.test.ts`

**Do not build in parallel with:** T-262, T-263 (edit `audit-export.ts`).

## Problem

Three functions read the saved Website Audit settings and check them again (so a hand-edited file cannot reach a reply). Each re-implements the same four steps:

- `loadStored` in `audit-settings.ts` (the original, returns the stored settings);
- `loadSettings` in `audit-export.ts` (same steps, then resolves them);
- `storedSettings` inside `buildAuditRoutes` in `routes/index.ts` (same steps, then resolves them).

I compared them: nothing saved, or an object that fails the check, reads as the defaults in all three. The only difference is how "nothing saved" is tested (`raw === null || raw === undefined`, or `raw ? ... : null`), which gives the same result for every stored value the store can return (an object, or null).

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "loadStored\|function loadSettings\|const storedSettings" packages/runner/src/routes/*.ts`.

`routes/audit-settings.ts`:

```ts
async function loadStored(store: AuditSettingsStore): Promise<StoredAuditSettings> {
  const raw = await store.load();
  if (raw === null || raw === undefined) return emptyAuditSettings();
  const checked = applySettingsUpdate(emptyAuditSettings(), raw);
  return checked.ok ? checked.settings : emptyAuditSettings();
}
```

`routes/audit-export.ts`:

```ts
/** The saved settings over the defaults. A damaged stored object reads as the defaults. */
async function loadSettings(settings: AuditSettingsStore) {
  const raw = await settings.load();
  const checked = raw === null || raw === undefined ? null : applySettingsUpdate(emptyAuditSettings(), raw);
  const stored = checked && checked.ok ? checked.settings : emptyAuditSettings();
  return resolveAuditSettings(stored, false);
}
```

`routes/index.ts`:

```ts
const storedSettings = async () => {
  const raw = await settings.load();
  const checked = raw ? applySettingsUpdate(emptyAuditSettings(), raw) : null;
  return resolveAuditSettings(checked?.ok ? checked.settings : emptyAuditSettings(), false);
};
```

Uses: `audit-export.ts` calls `loadSettings(settings)` twice; `index.ts` uses `storedSettings()` for `optOutText` (share rows) and `rewriteOverlapWords` (AI rows).

## Change

1. `audit-settings.ts`: export `loadStored` and add below it:

```ts
/** The saved settings over the defaults, as every reader sees them. A damaged stored object reads as the defaults. */
export async function loadResolvedSettings(store: AuditSettingsStore) {
  return resolveAuditSettings(await loadStored(store), false);
}
```

2. `audit-export.ts`: delete `loadSettings` (and its comment). Import `loadResolvedSettings` from `./audit-settings.js` (the file already has `import type { AuditSettingsStore } from './audit-settings.js';`: make it `import { loadResolvedSettings, type AuditSettingsStore } from './audit-settings.js';`). Replace the two calls `loadSettings(settings)` with `loadResolvedSettings(settings)`.

3. `index.ts`: replace the `storedSettings` body with `const storedSettings = () => loadResolvedSettings(settings);` and import `loadResolvedSettings` from `./audit-settings.js` (it already imports `auditSettingsStoreOn` from there).

4. Run `pnpm exec eslint packages/runner/src/routes/audit-export.ts packages/runner/src/routes/index.ts 2>&1 | grep "never used"` and drop imports that are now unused (`applySettingsUpdate`, `emptyAuditSettings`, `resolveAuditSettings`). Run `pnpm exec prettier --write` on the three files and `pnpm build`.

## Tests

Edit `packages/runner/tests/audit-settings-routes.test.ts`. Import `loadResolvedSettings` from `../src/routes/audit-settings.js` and `emptyAuditSettings`, `resolveAuditSettings` from `@qa/core`. Add:

- `'loadResolvedSettings gives the defaults when nothing was saved'`: store `{ load: async () => null, save: async () => {} }`; result toEqual `resolveAuditSettings(emptyAuditSettings(), false)`.
- `'loadResolvedSettings gives the defaults for a damaged object'`: `load: async () => ({ company: 42 })`; result toEqual the same defaults.
- `'loadResolvedSettings keeps a valid saved value'`: save a valid body first the way the neighbouring tests do (or use `load: async () => ({ optOutText: { en: 'No thanks.' } })` if that passes `applySettingsUpdate`; open `packages/core/src/audit/documents/settings.ts` to pick a field it accepts); the resolved result carries that value.

Run: `pnpm exec vitest run packages/runner/tests/audit-settings-routes.test.ts packages/runner/tests/audit-export-routes.test.ts packages/runner/tests/audit-share-routes.test.ts packages/runner/tests/audit-route-registration.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "function loadSettings\|const storedSettings = async" packages/runner/src/routes/*.ts` prints nothing.
- [ ] `grep -c "applySettingsUpdate" packages/runner/src/routes/audit-export.ts packages/runner/src/routes/index.ts` shows 0 for both.
- [ ] The listed tests pass and `pnpm build` passes.

## Notes

- `replyFor` in `audit-settings.ts` resolves with `await port.saved()` (whether a PageSpeed key is saved) instead of `false`. Leave it: it is the settings screen's own reply.
