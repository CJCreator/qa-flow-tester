# T-247: The source locator does not search the tool's own repository

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/source-locator.ts`
- `packages/core/src/orchestrator.ts`
- `packages/core/tests/source-locator-own-repo.test.ts` (new)

**Do not build in parallel with:** T-252 (edits `orchestrator.ts`).

## Problem

After a Check-up finds a problem on an element with a `data-testid`, the orchestrator looks for that `data-testid` in source files under `repoRoot` and writes the file and line into the finding (`sourceLocation`). The runner passes `repoRoot: process.cwd()` (`runner/src/session/checkup-run.ts`). When the QA tool is started from its own repository (`pnpm start`), the search walks the tool's own wizard code, and a `data-testid` that the checked site shares with the wizard (`submit`, `email`, `menu`) points the finding at the tool's own source file. The report then tells the person to fix a file in the wrong project.

When the Check-up is run from CI inside the checked app's own repository (`checkup.ts`), `process.cwd()` is the right folder and the lookup is useful. That must keep working.

## Owner decision (settled)

**Settled by the owner on 2026-11-11:** skip the source locator only when the repository root is the tool's own repository. Build the Change below as written; the options are kept for the record.

Which folder should the lookup search?

- **A. Skip it when the folder is the QA tool's own repository (recommended default).** Detect by the file `packages/core/src/orchestrator.ts` under `repoRoot`. CI inside an app repository keeps the lookup. A local run from the tool's folder stops guessing.
- **B. Search only a folder the person names** (a new setting such as `QA_APP_SOURCE_DIR`). The most exact. But CI users lose the lookup until they set it, and the setting needs docs, a wizard field and runner wiring.
- **C. Leave it.** Findings can name the tool's own files.

This ticket builds A. An explicit `repoRoot` passed by a caller is still honoured unless it is the tool's repository.

## Current code

Branch from `main`.

`packages/core/src/orchestrator.ts` (`grep -n "sourceLocator" packages/core/src/orchestrator.ts`):

```ts
    const repoRoot = options.repoRoot || process.cwd();
    ...
    const sourceLocator = new SourceLocator(repoRoot);
```

and in the finding loop:

```ts
            if (f.where.dataTestId) {
              const srcLoc = await sourceLocator.findByTestId(f.where.dataTestId);
```

`packages/core/src/source-locator.ts` starts:

```ts
import { promises as fs } from 'fs';
import path from 'path';
import type { SourceLocation } from '@qa/types';

export class SourceLocator {
```

## Change

1. `source-locator.ts`: add `import { existsSync } from 'fs';` (merge with the existing `fs` import line if you like: `import { existsSync, promises as fs } from 'fs';`) and, above the class:

```ts
/** True when the folder is a checkout of this tool itself: its own code is not the checked site's code. */
export function isQaToolRepo(dir: string): boolean {
  return existsSync(path.join(dir, 'packages', 'core', 'src', 'orchestrator.ts'));
}
```

2. `orchestrator.ts`: import it with the existing `SourceLocator` import (`import { SourceLocator, isQaToolRepo } from './source-locator.js';`). Replace the `new SourceLocator(repoRoot)` line with:

```ts
// The tool's own repository is not the checked site's source: never point a finding at it.
const sourceLocator = isQaToolRepo(repoRoot) ? undefined : new SourceLocator(repoRoot);
```

3. In the finding loop change `if (f.where.dataTestId) {` to `if (f.where.dataTestId && sourceLocator) {`.

4. Run `pnpm exec prettier --write` on the two source files and the new test, then `pnpm build`.

## Tests

New file `packages/core/tests/source-locator-own-repo.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { isQaToolRepo } from '../src/source-locator.js';

let dir = '';
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = '';
});

describe('isQaToolRepo', () => {
  it('is true for a folder holding the tool core source', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-repo-'));
    await fs.mkdir(path.join(dir, 'packages', 'core', 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'packages', 'core', 'src', 'orchestrator.ts'), '');
    expect(isQaToolRepo(dir)).toBe(true);
  });
  it('is false for any other folder', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-app-'));
    await fs.writeFile(path.join(dir, 'index.html'), '<div data-testid="x"></div>');
    expect(isQaToolRepo(dir)).toBe(false);
  });
});
```

Run: `pnpm exec vitest run packages/core/tests/source-locator-own-repo.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "new SourceLocator" packages/core/src/orchestrator.ts` shows the line guarded by `isQaToolRepo`.
- [ ] `grep -n "&& sourceLocator" packages/core/src/orchestrator.ts` finds the guarded loop.
- [ ] The new test and the core unit tests pass; `pnpm build` passes.

## Notes

- `packages/runner/src/session/checkup-run.ts` is not edited: it keeps passing `process.cwd()` and the orchestrator decides.
- A Docker image of the tool has the same layout, so it counts as the tool's repository too. That is right: its code is not the site's.
