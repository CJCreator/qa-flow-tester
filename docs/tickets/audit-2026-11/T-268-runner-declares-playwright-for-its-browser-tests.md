# T-268: The runner declares Playwright, and its browser tests import it by name

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | test-hygiene | todo |

**Files you may edit (no others):**

- `packages/runner/package.json`
- `pnpm-lock.yaml`
- `packages/runner/tests/audit-documents-flow.test.ts`
- `packages/runner/tests/audit-flow-browser.test.ts`
- `packages/runner/tests/audit-preview-browser.test.ts`

**Do not build in parallel with:** nothing (no other ticket edits `packages/runner/package.json` or these three tests). If another ticket changes dependencies in `pnpm-lock.yaml`, build one after the other.

## Problem

Three runner tests reach into another package's `node_modules` by a relative path:

- `import type { ... } from '../../core/node_modules/playwright'` (three files, one type import each)
- `typeof import('../../core/node_modules/playwright')` (three files, one each)

That is six references. They only work while pnpm keeps `core/node_modules/playwright` in that place, and they run a hand-made `createRequire` to load Playwright. The comment in `audit-preview-browser.test.ts` says the runner "does not depend on Playwright (a new dependency needs its own planned task)". This is that task.

How the others do it: every browser test in `packages/core/tests` and `packages/checkers/tests` writes `import { chromium, type Browser } from 'playwright';`. `packages/core/package.json` and `packages/checkers/package.json` both declare `"playwright": "1.63.0"` (exact version, no range). The runner declares neither, so a plain `import 'playwright'` from `packages/runner/tests` would not resolve under pnpm.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -rn "core/node_modules/playwright" packages/runner/tests`.

`packages/runner/package.json`:

```json
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2"
  }
```

`audit-documents-flow.test.ts`:

```ts
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
...
import type { Request } from '../../core/node_modules/playwright';
...
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Playwright is a dependency of @qa/core, not of the runner: load the copy core's printer uses, so the spy
// below sees the very same `chromium` object.
const corePlaywright = createRequire(path.resolve(HERE, '../../core/package.json'))(
  'playwright'
) as typeof import('../../core/node_modules/playwright');
const { chromium } = corePlaywright;
```

`audit-flow-browser.test.ts`:

```ts
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Browser } from '../../core/node_modules/playwright';
...
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.resolve(HERE, '../../core/package.json'))(
  'playwright'
) as typeof import('../../core/node_modules/playwright');
```

`audit-preview-browser.test.ts`:

```ts
import { createRequire } from 'module';
// The runner package does not depend on Playwright (a new dependency needs its own planned task); core does, so it
// is resolved from core's folder. Same module the core and wizard browser tests use.
import type { Browser, BrowserContext, Page } from '../../core/node_modules/playwright';
...
const { chromium } = createRequire(path.resolve(__dirname, '../../core/package.json'))(
  'playwright'
) as typeof import('../../core/node_modules/playwright');
```

## Change

1. `packages/runner/package.json`: add `"playwright": "1.63.0"` to `devDependencies` (keep the keys in alphabetical order; same exact version as core and checkers). Then from the repository root run `pnpm install --lockfile-only --offline`. If that fails because a package is not in the local store, run `pnpm install --lockfile-only`. The only lockfile change must be a new `playwright` entry (specifier `1.63.0`, version `1.63.0`) under `packages/runner:` `devDependencies`. Check with `git diff --stat pnpm-lock.yaml`: a handful of added lines, nothing else. If other lines change, undo and report.

2. `audit-documents-flow.test.ts`: replace `import type { Request } from '../../core/node_modules/playwright';` with `import { chromium, type Request } from 'playwright';`. Delete the `HERE` line, the two comment lines, the `corePlaywright` statement and `const { chromium } = corePlaywright;`. Delete the `createRequire` and `fileURLToPath` imports if nothing else in the file uses them (`grep -n "createRequire\|fileURLToPath\|HERE" packages/runner/tests/audit-documents-flow.test.ts`; `path` stays: other code uses it).

3. `audit-flow-browser.test.ts`: replace the type import with `import { chromium, type Browser } from 'playwright';`. Delete the `HERE` line and the `const { chromium } = createRequire(...) as typeof import(...);` statement. Delete `createRequire` and `fileURLToPath` imports if no longer used.

4. `audit-preview-browser.test.ts`: replace the type import and the comment above it with `import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';`. Delete the `const { chromium } = createRequire(...)...;` statement and the `createRequire` import if no longer used.

5. Run `pnpm exec prettier --write` on the three test files and `pnpm exec eslint packages/runner/tests/audit-documents-flow.test.ts packages/runner/tests/audit-flow-browser.test.ts packages/runner/tests/audit-preview-browser.test.ts 2>&1 | grep "never used"` (remove what it names).

## Tests

No new test. The point of the ticket is that the same tests still work with the new import. Two checks, neither needs a browser:

1. One module instance. `audit-documents-flow.test.ts` spies on `chromium.launch` and needs the same object core's printer uses. Check both resolve to the same file: from the repository root run

   `node -e "const {createRequire}=require('module');const a=createRequire(process.cwd()+'/packages/runner/package.json').resolve('playwright');const b=createRequire(process.cwd()+'/packages/core/package.json').resolve('playwright');console.log(a===b?'SAME':'DIFFERENT',a,b)"`

   It must print `SAME`. If it prints `DIFFERENT`, stop and set the ticket to `blocked`.

2. The three files still type-check and load: `pnpm build` (the runner build does not include `tests/`, so also run `pnpm exec tsc -p packages/runner/tests/tsconfig.typecheck.json --noEmit`; the file exists).

If Chromium is installed on this machine, run the three files once as a last check: `pnpm exec vitest run packages/runner/tests/audit-documents-flow.test.ts packages/runner/tests/audit-flow-browser.test.ts packages/runner/tests/audit-preview-browser.test.ts`. They are browser-tier (listed in `BROWSER_TESTS.runner` in `vitest.workspace.ts`; no change to that list). Say in the ticket notes whether you ran them.

## Done when

- [ ] `grep -rn "core/node_modules" packages/runner/tests` prints nothing.
- [ ] `grep -n "playwright" packages/runner/package.json` shows `"playwright": "1.63.0"` under `devDependencies`.
- [ ] The `node -e` check prints `SAME`; the typecheck command passes.

## Notes

- Keep the exact version `1.63.0`. `scripts` or CI may check that all packages use one Playwright version (see `packages/runner/tests/playwright-version-check.test.ts`); run it: `pnpm exec vitest run packages/runner/tests/playwright-version-check.test.ts`.
- The Docker image and `pnpm bootstrap` install Chromium through core (`pnpm --filter @qa/core exec playwright install chromium`). A runner-level dev dependency does not change what is installed.
- This adds Playwright to the runner's `devDependencies`, not `dependencies`: the runner's source does not import it.
