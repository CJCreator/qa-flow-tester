# T-267: The Visual Baselines list sends the new screenshot, so it can be kept

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/evidence-url.ts` (new)
- `packages/runner/src/server.ts`
- `packages/runner/tests/evidence-url.test.ts` (new)
- `packages/runner/tests/baseline-accept.test.ts`

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265 (all edit `server.ts`, about 3,900 lines; T-259 also removes the `isInside` copy in `server.ts` that this ticket does not use directly).

## Problem

`GET /api/runner/baselines` (`handleListBaselines` in `server.ts`) declares `let currentUrl: string | undefined;` and never fills it. The wizard's Visual Baselines screen (`packages/wizard/src/screens/VisualBaselinesScreen.tsx`) needs `currentUrl` for three things (T-191 guarded the screen for its absence):

- the "Slider" view (before and after on top of each other) is offered only with `currentUrl`;
- the side-by-side view shows the new screenshot only with `currentUrl`;
- "Keep the new screenshot as the baseline" (`handleAccept`) says "This check-up has no new screenshot to keep as the baseline." without it, so a baseline can never be accepted from the screen.

Two more defects in the same code, found while reading it, which would break the feature the moment `currentUrl` is filled:

1. The wizard calls `acceptVisualBaseline(item.id, item.currentUrl)`, which sends the address as `currentEvidencePath`. The accept handler treats that value as a file path under the output folder (`path.resolve(this.outputDir, ...)`). An address such as `/api/evidence/runs/run-1/evidence/x.png` is not a path in the output folder, so nothing is copied, and the handler still answers `200 { ok: true }`. The screen would say "New baseline kept" and keep the old baseline.
2. `diffUrl` is built as `/api/evidence/${screenshotPath}`. The report on disk stores evidence paths relative to the run folder (`evidence/TC-1-1440px/visual-diff.png`), but `/api/evidence/` is rooted at the output folder, whose files are under `runs/<runId>/`. After a restart (the latest report is loaded from disk) the diff image address is wrong. Right after a run, the in-memory report has absolute paths and the address only works by luck of `path.resolve`.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "private async handleListBaselines\|private async handleAcceptBaseline" packages/runner/src/server.ts`.

The finding the check writes (`packages/checkers/src/design-standards.ts`, `visualDiffFinding`) already carries both images:

```ts
      evidence: {
        screenshotPath: result.diffImagePath,
        ...(context.baselineImagePath ? { baselineScreenshotPath: context.baselineImagePath } : {}),
        ...(context.currentImagePath ? { currentScreenshotPath: context.currentImagePath } : {}),
      },
```

(`currentScreenshotPath` is `visual-current.png` in the test case's evidence folder, written by `orchestrator.ts` next to `visual-baseline.png` and `visual-diff.png`.)

`server.ts`, `handleListBaselines`:

```ts
let diffPercent: number | undefined;
let diffUrl: string | undefined;
let currentUrl: string | undefined;

if (matchingFinding) {
  const matchPercent = matchingFinding.expectedVsActual.actual?.match(/([\d.]+)%\s+of pixels differ/);
  if (matchPercent) diffPercent = parseFloat(matchPercent[1]);
  if (matchingFinding.evidence?.screenshotPath) {
    diffUrl = `/api/evidence/${matchingFinding.evidence.screenshotPath}`;
  }
}
```

`server.ts`, `handleAcceptBaseline`:

```ts
if (body.currentEvidencePath) {
  const src = path.resolve(this.outputDir, String(body.currentEvidencePath));
  if (isInside(this.outputDir, src) && !isSavedSession(this.outputDir, src)) {
    await fs.copyFile(src, dest);
  }
}
```

The report on disk keeps evidence paths relative to its run folder (`withPortablePaths` in `packages/core/src/reporter.ts`); the report in memory right after a run can hold absolute paths. The evidence route (`GET /api/evidence/*`) resolves its path under `this.outputDir`, and the wizard builds run file addresses as `/api/evidence/runs/<runId>/<relative path>` (`runFileUrl` in `packages/wizard/src/api.ts`).

## Change

1. Create `packages/runner/src/evidence-url.ts`:

```ts
import path from 'path';

/**
 * The address (`/api/evidence/...`) of a file a report points at. An absolute path must be inside the output
 * folder; a relative path is relative to the run's own folder (`runs/<runId>/`), as saved reports store it.
 * Undefined when there is no path, or it leaves the output folder.
 */
export function evidenceUrl(outputDir: string, runId: string, file: string | undefined): string | undefined {
  if (!file) return undefined;
  let rel: string;
  if (path.isAbsolute(file)) {
    rel = path.relative(outputDir, file);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  } else {
    rel = `runs/${runId}/${file}`;
  }
  const parts = rel.split(/[\\/]+/).filter((part) => part !== '');
  if (parts.some((part) => part === '..' || part === '.')) return undefined;
  return `/api/evidence/${parts.map(encodeURIComponent).join('/')}`;
}
```

2. `server.ts`, `handleListBaselines`: add `import { evidenceUrl } from './evidence-url.js';`. Replace the body of `if (matchingFinding) { ... }` with:

```ts
if (matchingFinding) {
  const matchPercent = matchingFinding.expectedVsActual.actual?.match(/([\d.]+)%\s+of pixels differ/);
  if (matchPercent) diffPercent = parseFloat(matchPercent[1]);
  const runId = this.lastReport?.runId ?? '';
  diffUrl = evidenceUrl(this.outputDir, runId, matchingFinding.evidence?.screenshotPath);
  currentUrl = evidenceUrl(this.outputDir, runId, matchingFinding.evidence?.currentScreenshotPath);
}
```

(`let currentUrl` stays declared as it is.)

3. `server.ts`, `handleAcceptBaseline`: let the field carry the address the list now sends. Replace the `if (body.currentEvidencePath) { ... }` block with:

```ts
if (body.currentEvidencePath) {
  // The Visual Baselines screen sends the address it showed (`/api/evidence/...`); a plain path under the
  // output folder is accepted too.
  const given = String(body.currentEvidencePath);
  const EVIDENCE_PREFIX = '/api/evidence/';
  const rel = given.startsWith(EVIDENCE_PREFIX) ? decodePath(given.slice(EVIDENCE_PREFIX.length)) : given;
  const src = rel === null ? null : path.resolve(this.outputDir, rel);
  if (src && isInside(this.outputDir, src) && !isSavedSession(this.outputDir, src)) {
    await fs.copyFile(src, dest);
  }
}
```

4. Run `pnpm exec prettier --write packages/runner/src/evidence-url.ts packages/runner/src/server.ts` and `pnpm build`.

## Tests

Add `packages/runner/tests/evidence-url.test.ts` (unit):

```ts
import { describe, it, expect } from 'vitest';
import path from 'path';
import { evidenceUrl } from '../src/evidence-url.js';

const out = path.resolve('/data/out');
```

- `'a path relative to the run folder gets the runs/<runId> prefix'`: `evidenceUrl(out, 'run-1', 'evidence/TC-1-1440px/visual-current.png')` toBe `'/api/evidence/runs/run-1/evidence/TC-1-1440px/visual-current.png'`.
- `'an absolute path inside the output folder is made relative to it'`: `evidenceUrl(out, 'run-1', path.join(out, 'runs', 'run-1', 'evidence', 'a.png'))` toBe `'/api/evidence/runs/run-1/evidence/a.png'`.
- `'an absolute path outside the output folder gives nothing'`: `evidenceUrl(out, 'run-1', path.resolve('/etc/passwd'))` toBeUndefined.
- `'a path that climbs out gives nothing'`: `evidenceUrl(out, 'run-1', '../../secret.png')` toBeUndefined.
- `'no path gives nothing'`: `evidenceUrl(out, 'run-1', undefined)` and `''` toBeUndefined.
- `'segments are encoded'`: `evidenceUrl(out, 'run-1', 'evidence/a b#1.png')` toBe `'/api/evidence/runs/run-1/evidence/a%20b%231.png'`.

Edit `packages/runner/tests/baseline-accept.test.ts` (it is in the `runner` list of `BROWSER_TESTS`; run it by file name). The `beforeAll` already makes `runs/run-1/evidence/shot.png` and `auth/admin.json` in `outputDir`. Add inside the `describe`:

- `'copies the screenshot named by its /api/evidence/ address'`: first `await fs.rm(path.join(baselineDir, \`${ID}.png\`), { force: true })`; `accept({ id: ID, currentEvidencePath: '/api/evidence/runs/run-1/evidence/shot.png' })` gives status 200 and the baseline file now exists.
- `'never copies a saved sign-in session named by its address'`: remove the baseline file first; `accept({ id: ID, currentEvidencePath: '/api/evidence/auth/admin.json' })` gives 200 and the file does not exist.
- `'never copies a file outside the output folder named by its address'`: remove first; `currentEvidencePath: '/api/evidence/..%2F..%2Fpackage.json'` gives 200 and the file does not exist.
- `'the baselines list sends the new screenshot and the diff'`: write a small PNG file `path.join(baselineDir, 'tmp-t267-TC-1-1440px.png')` (any bytes), set the report: `(server as unknown as { lastReport: unknown }).lastReport = { runId: 'run-1', findings: [{ checker: 'design-standards', title: 'Visual regression against baseline at 1440px', testCaseId: 'tmp-t267-TC-1', where: { breakpoint: '1440px' }, expectedVsActual: { actual: '2.00% of pixels differ (10 px)' }, evidence: { screenshotPath: 'evidence/TC-1-1440px/visual-diff.png', currentScreenshotPath: 'evidence/TC-1-1440px/visual-current.png' } }] }`. `GET /api/runner/baselines` (write a `get` helper like `accept` with `method: 'GET'`), find the item with `id === 'tmp-t267-TC-1-1440px'`; expect `currentUrl` toBe `'/api/evidence/runs/run-1/evidence/TC-1-1440px/visual-current.png'` and `diffUrl` toBe `'/api/evidence/runs/run-1/evidence/TC-1-1440px/visual-diff.png'`. In `afterAll` remove `tmp-t267-TC-1-1440px.png` from `baselineDir`.

Run: `pnpm exec vitest run packages/runner/tests/evidence-url.test.ts packages/runner/tests/baseline-accept.test.ts packages/runner/tests/beta-privacy.test.ts`, then `pnpm build`. Then `pnpm exec vitest run packages/wizard/tests/visual-baselines-view.test.ts`; it must still pass, since the wizard is not changed.

## Done when

- [ ] `grep -n "let currentUrl" packages/runner/src/server.ts` is followed in the same method by an assignment to `currentUrl` (`grep -n "currentUrl = " packages/runner/src/server.ts` prints one line).
- [ ] The accept handler decodes `/api/evidence/` addresses (`grep -n "EVIDENCE_PREFIX" packages/runner/src/server.ts` prints lines).
- [ ] The listed tests pass and `pnpm build` passes.

## Notes

- No wizard change: `acceptVisualBaseline(item.id, item.currentUrl)` already sends what the list now provides, and the runner now understands it.
- Not in this ticket: making accept answer an error when nothing was copied (today it answers `200 { ok: true }` for a path it refused). The existing tests `never copies a saved sign-in session` and `never copies a file outside the output folder` expect `200`. If the owner wants a 4xx there, that is a separate ticket that changes those two tests and the wizard's message.
- Beta copies offer no shared baselines (`GET /api/runner/baselines` answers `[]` and accept 403, see `beta-privacy.test.ts`). Unchanged.
