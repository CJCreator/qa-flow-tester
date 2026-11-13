# T-271: `@qa/core` stops declaring `pngjs`; clean the typecheck config

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | config | dead | done |

**Result (2026-11-13):** already done before this ticket was worked. `packages/core/package.json` has no `pngjs` entry and `tsconfig.test.json` has no `pngjs` path, so no change was needed. Checked in the dead-code-removal worktree (branch `worktree-dead-code-removal`).

**Files you may edit (no others):**

- `packages/core/package.json`
- `pnpm-lock.yaml` (only through `pnpm install`)
- `tsconfig.test.json`

**Do not build in parallel with:** T-229, T-278 (all run `pnpm install`; build one at a time), T-270 (edits root `package.json`; build T-270 first).

## Problem

1. `packages/core/package.json` lists `pngjs` as a dependency, but no file in `packages/core` imports it (`grep -rn "pngjs" packages/core/src packages/core/tests` finds nothing). Only `@qa/checkers` imports it (`src/design-standards.ts`, `tests/design-ux-checkers.test.ts`) and declares it.
2. `tsconfig.test.json` has a `pngjs` path with a comment "Core tests import pngjs". That is wrong: the importers are checkers files.
3. `tsconfig.test.json` has `"scripts/**/*"` in `include`. `scripts/` holds only `.mjs` files and the config does not set `allowJs`, so the pattern matches nothing.

## Current code

Branch from `main`.

`packages/core/package.json`:

```json
    "playwright": "1.63.0",
    "pngjs": "^7.0.0"
  },
```

`tsconfig.test.json`:

```json
      "@qa/runner": ["packages/runner/src/index.ts"],
      // Core tests import pngjs; its types are installed by @qa/checkers (devDependency @types/pngjs).
      "pngjs": ["packages/checkers/node_modules/@types/pngjs/index.d.ts"]
    }
  },
```

and the last line of the file:

```json
  "include": ["packages/*/tests/**/*", "scripts/**/*"]
```

## Change

1. `packages/core/package.json`: delete the `"pngjs": "^7.0.0"` line and the comma after `"playwright": "1.63.0"` on the line above it, so the JSON stays valid.
2. Run `pnpm install`. Do not edit `pnpm-lock.yaml` by hand. Run `git diff --stat pnpm-lock.yaml`: only the `packages/core` importer block may change. If other packages change version, stop and set `blocked`.
3. `tsconfig.test.json`: change the last line to `  "include": ["packages/*/tests/**/*"]`.
4. `tsconfig.test.json`: delete the comment line and the `"pngjs": [...]` line, and the comma after the `"@qa/runner"` line, so it ends `"@qa/runner": ["packages/runner/src/index.ts"]`. Then run `pnpm typecheck`.
   - If it passes, keep the deletion. (A test file resolves `pngjs` from its own `packages/checkers/node_modules`.)
   - If it fails with `Cannot find module 'pngjs'`, put both lines back and only change the comment to: `// Checkers tests import pngjs; its types are installed by @qa/checkers (devDependency @types/pngjs).`

## Tests

`pnpm typecheck` (needs `NODE_OPTIONS=--max-old-space-size=8192`, as in `ci.yml`), `pnpm build`, then `pnpm exec vitest run --project unit packages/checkers/tests packages/core/tests`.

## Done when

- [ ] `grep -c pngjs packages/core/package.json` prints 0.
- [ ] `grep -c pngjs pnpm-lock.yaml` still prints more than 0 (checkers keeps it), and the lock diff touches only the core importer.
- [ ] `grep -c "scripts" tsconfig.test.json` prints 0.
- [ ] `pnpm typecheck` and `pnpm build` pass.

## Notes

- Do not remove `pngjs` or `@types/pngjs` from `packages/checkers/package.json`.
- `tsconfig.test.json` is extended by each `packages/*/tests/tsconfig.typecheck.json`; do not edit those.
