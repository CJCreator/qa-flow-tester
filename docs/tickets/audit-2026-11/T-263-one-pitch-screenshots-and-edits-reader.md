# T-263: One `pitchScreenshots` and one reader of a version's edits

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | runner | duplication | todo |

**Files you may edit (no others):**

- `packages/runner/src/routes/audit-common.ts`
- `packages/runner/src/routes/audit-export.ts`
- `packages/runner/src/routes/audit-share.ts`
- `packages/runner/src/routes/audit-documents.ts`
- `packages/runner/src/routes/audit-preview.ts`
- `packages/runner/src/routes/audit-store.ts`
- `packages/runner/tests/audit-common.test.ts`

**Do not build in parallel with:** T-257 (edits `audit-share.ts`), T-262 (edits `audit-common.ts`, `audit-store.ts`, `audit-documents.ts`, `audit-export.ts`, `audit-share.ts`), T-264 (edits `audit-export.ts`). Build after T-262.

## Problem

1. `pitchScreenshots` (turns the top findings' screenshots into `data:` URIs for the Pitch Glimpse) exists in `audit-export.ts` and `audit-share.ts`. The loop body, the `IMAGE_TYPES` table and the 3 MB limit are copied. Only the argument list differs: `(store, l: Loaded)` against `(store, auditId, version, result, contents, edits)`.
2. The key `'edits'` (the edit overlay file beside a version's result) is a constant named `EDITS_NAME` in three files and a bare string in two more, and the read `(await store.readVersionJson<EditOverlay>(auditId, version, 'edits')) ?? emptyOverlay()` is written out five times.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "EDITS_NAME\|'edits'\|function pitchScreenshots\|const IMAGE_TYPES\|const MAX_SCREENSHOT_BYTES" packages/runner/src/routes/*.ts`.

`audit-export.ts`:

```ts
const MAX_SCREENSHOT_BYTES = 3_000_000;
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
```

```ts
  const edits = (await store.readVersionJson<EditOverlay>(auditId, version, EDITS_NAME)) ?? emptyOverlay();
  return { auditId, version, result, contents, edits };
}

/** Screenshots of the findings the Pitch Glimpse shows, as data: URIs. A missing or odd one is left out. */
async function pitchScreenshots(store: AuditStore, l: Loaded): Promise<Record<string, string>> {
  const shots: Record<string, string> = {};
  const top = editedViewOf({ result: l.result, contents: l.contents, edits: l.edits }).result.findings.slice(
    0,
    PITCH_TOP_FINDINGS
  );
  for (const finding of top) {
    const name = finding.screenshotPath;
    if (!name || Object.prototype.hasOwnProperty.call(shots, name)) continue;
    const type = IMAGE_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
    if (!type) continue;
    try {
      const bytes = await store.getVersionFile(l.auditId, l.version, name);
      if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_SCREENSHOT_BYTES) {
        shots[name] = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
      }
    } catch {
      // A path the store refuses is shown as "no screenshot", never as an error.
    }
  }
  return shots;
}
```

(`Loaded` is the interface in `audit-export.ts` with `auditId`, `version`, `result`, `contents`, `edits`.)

`audit-share.ts` has the same loop, with `IMAGE_TYPES` and `MAX_SCREENSHOT_BYTES` of its own, the function taking `(store, auditId, version, result, contents, edits)` and calling `store.getVersionFile(auditId, version, name)`; the call site is:

```ts
const edits = (await store.readVersionJson<EditOverlay>(auditId, version, EDITS_NAME)) ?? emptyOverlay();
const screenshots = await pitchScreenshots(store, auditId, version, result, contents, edits);
```

The edits read and key, elsewhere:

- `audit-documents.ts`: `const EDITS_NAME = 'edits';`, `readOverlay(store, t)` returning `(await store.readVersionJson<EditOverlay>(t.auditId, t.version, EDITS_NAME)) ?? emptyOverlay()`, and `await store.writeVersionJson(auditId, version, EDITS_NAME, next);`
- `audit-preview.ts` line near 195 and `audit-store.ts` line near 135: `(await store.readVersionJson<EditOverlay>(auditId, version.version, 'edits')) ?? emptyOverlay()`

## Change

1. In `audit-common.ts`, add (imports: `import type { EditOverlay, AuditResult, PageContent } from '@qa/types';` and `import { PITCH_TOP_FINDINGS, editedViewOf, emptyOverlay, type AuditStore } from '@qa/core';`; merge with the imports T-262 or T-111 already put there):

```ts
/** The edit overlay beside a version's result. */
export const EDITS_NAME = 'edits';

/** A version's edits; an empty overlay when none were saved. */
export async function readEdits(store: AuditStore, auditId: string, version: number): Promise<EditOverlay> {
  return (await store.readVersionJson<EditOverlay>(auditId, version, EDITS_NAME)) ?? emptyOverlay();
}

/** Largest screenshot embedded in a Pitch Glimpse. */
const MAX_SCREENSHOT_BYTES = 3_000_000;
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** What a Pitch Glimpse needs to pick its screenshots. */
export interface PitchSource {
  auditId: string;
  version: number;
  result: AuditResult;
  contents: PageContent[];
  edits: EditOverlay;
}

/** Screenshots of the findings the Pitch Glimpse shows, as data: URIs. A missing or odd one is left out. */
export async function pitchScreenshots(store: AuditStore, source: PitchSource): Promise<Record<string, string>> {
  const shots: Record<string, string> = {};
  const { auditId, version } = source;
  const top = editedViewOf({
    result: source.result,
    contents: source.contents,
    edits: source.edits,
  }).result.findings.slice(0, PITCH_TOP_FINDINGS);
  for (const finding of top) {
    const name = finding.screenshotPath;
    if (!name || Object.prototype.hasOwnProperty.call(shots, name)) continue;
    const type = IMAGE_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
    if (!type) continue;
    try {
      const bytes = await store.getVersionFile(auditId, version, name);
      if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_SCREENSHOT_BYTES) {
        shots[name] = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
      }
    } catch {
      // A path the store refuses is shown as "no screenshot", never as an error.
    }
  }
  return shots;
}
```

2. `audit-export.ts`: delete `MAX_SCREENSHOT_BYTES`, `IMAGE_TYPES`, `EDITS_NAME` and the local `pitchScreenshots`. Import `{ pitchScreenshots, readEdits }` from `./audit-common.js`. Replace the edits line with `const edits = await readEdits(store, auditId, version);`. The call `pitchScreenshots(store, loaded)` stays as it is (`Loaded` has every `PitchSource` field).

3. `audit-share.ts`: delete `MAX_SCREENSHOT_BYTES` (and its comment), `IMAGE_TYPES`, `EDITS_NAME` (with its comment) and the local `pitchScreenshots`. Import the same two names. Replace the two lines with:

```ts
const edits = await readEdits(store, auditId, version);
const screenshots = await pitchScreenshots(store, { auditId, version, result, contents, edits });
```

4. `audit-documents.ts`: delete `const EDITS_NAME = 'edits';`; import `{ EDITS_NAME, readEdits }`. Change `readOverlay` to `return readEdits(store, t.auditId, t.version);` (keep the function: other lines call it). The `writeVersionJson(..., EDITS_NAME, next)` line stays.

5. `audit-preview.ts` and `audit-store.ts`: replace the long read with `const edits = await readEdits(store, auditId, version.version);` and import `readEdits` from `./audit-common.js`.

6. Run `pnpm exec eslint packages/runner/src/routes 2>&1 | grep "never used"` and remove imports that are now unused (`emptyOverlay`, `editedViewOf`, `PITCH_TOP_FINDINGS`, `EditOverlay` in some files). Run `pnpm exec prettier --write` on the seven files and `pnpm build`.

## Tests

Edit `packages/runner/tests/audit-common.test.ts`. Add a test group for `pitchScreenshots` and `readEdits` with a fake store (an object cast `as unknown as AuditStore` that has only the methods used):

- `'readEdits returns an empty overlay when nothing was saved'`: fake `readVersionJson: async () => null`; result toEqual `emptyOverlay()` (import `emptyOverlay` from `@qa/core`).
- `'readEdits asks for the edits file'`: fake `readVersionJson` records its arguments; expect it was called with `('audit_00001', 2, 'edits')`.
- `'pitchScreenshots embeds a small png and skips the rest'`: build `source` from `auditDocResult` and `auditDocContents` in `packages/core/tests/helpers/audit-doc-fixture.ts` (see how `audit-documents-flow.test.ts` imports `auditDocResult`, `auditDocContents`, `PATHS` and gives the top findings a `screenshotPath`); fake `getVersionFile` returns a 1x1 PNG `Buffer` for a `.png` name, a buffer larger than 3,000,000 bytes for another, and throws for a third. Expect the first as `data:image/png;base64,...`, and the other two absent from the result.
- `'pitchScreenshots ignores a file with an unknown type'`: a finding whose `screenshotPath` ends `.svg` is not read: the fake `getVersionFile` must not be called for it.

If building a result with screenshot paths takes more than a few lines, copy a finding from the fixture and set `screenshotPath` on it.

Run: `pnpm exec vitest run packages/runner/tests/audit-common.test.ts packages/runner/tests/audit-export-routes.test.ts packages/runner/tests/audit-share-routes.test.ts packages/runner/tests/audit-edits-routes.test.ts packages/runner/tests/audit-preview-routes.test.ts packages/runner/tests/audit-store-routes.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "function pitchScreenshots\|const IMAGE_TYPES\|const MAX_SCREENSHOT_BYTES\|const EDITS_NAME" packages/runner/src/routes/*.ts` lists only `audit-common.ts`.
- [ ] `grep -n "'edits'" packages/runner/src/routes/*.ts` lists only `audit-common.ts`.
- [ ] The listed tests pass and `pnpm build` passes.

## Notes

- Not in this ticket: the loop that reads every page's Page Content (`Promise.all` over `result.pages`), which `audit-export.ts` and `audit-share.ts` also repeat. Leave it.
- `audit-documents-flow.test.ts` and `audit-flow-browser.test.ts` drive the export and share rows with Chromium. They are browser-tier: do not run them here.
