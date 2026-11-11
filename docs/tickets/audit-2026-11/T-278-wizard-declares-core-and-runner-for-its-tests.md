# T-278: The wizard declares `@qa/core` and `@qa/runner`, which its tests import

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | config | inconsistency | todo |

**Files you may edit (no others):**

- `packages/wizard/package.json`
- `pnpm-lock.yaml` (only through `pnpm install`)

**Do not build in parallel with:** T-229, T-271 (both run `pnpm install`; build one at a time).

## Problem

Two wizard tests import workspace packages that `packages/wizard/package.json` does not list:

- `packages/wizard/tests/landing-audit-browser.test.ts`: `import { RunnerServer } from '@qa/runner';` and `import { KeyResolver, type SecretStore } from '@qa/core';`
- `packages/wizard/tests/sample-report-format.test.ts`: `import { generateSingleFileHtmlReport } from '@qa/core';`

They work only because `vitest.config.ts` aliases both names to source (`sharedResolve`). With pnpm's strict `node_modules`, the wizard folder cannot resolve them by itself, so any tool that does not use the alias (an editor, `tsc` run in the wizard folder) fails to find them.

## Current code

Branch from `main`. `grep -rn "from '@qa/" packages/wizard/tests packages/wizard/src | grep -v "@qa/types"`.

`packages/wizard/package.json` devDependencies:

```json
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
```

## Change

1. In `packages/wizard/package.json`, add two lines to `devDependencies`, keeping the keys in alphabetical order, so the start of the block reads:

```json
  "devDependencies": {
    "@qa/core": "workspace:*",
    "@qa/runner": "workspace:*",
    "@types/react": "^18.3.18",
```

Do not add them to `dependencies`: the wizard bundle must stay free of Node-only code (`CLAUDE.md`). 2. Run `pnpm install`. Do not edit `pnpm-lock.yaml` by hand. `git diff --stat pnpm-lock.yaml` must show a change only in the `packages/wizard` importer block. If other packages change version, stop and set `blocked`. 3. Check there is no cycle and the build order still works: `pnpm build`.

## Tests

`pnpm build`, then `pnpm run site-build` (the site build must still work), then `pnpm exec vitest run --project unit packages/wizard/tests`.

## Done when

- [ ] `grep -c '"@qa/core"\|"@qa/runner"' packages/wizard/package.json` prints 2.
- [ ] `pnpm build`, `pnpm run site-build` and the wizard unit tests pass.
- [ ] The lock diff touches only the wizard importer.
- [ ] `@qa/core` and `@qa/runner` appear in the `devDependencies` block and not in the `dependencies` block.

## Notes

- `packages/runner/Dockerfile` installs with `--filter "@qa/wizard..."`. That now also selects `@qa/core` and `@qa/runner` for the wizard, but the Dockerfile already installs both through the `@qa/runner...` filter, so the image does not change.
- Not in this ticket: the repeated version pins of `typescript`, `@types/node` and `playwright` across packages. The `playwright` pin is already guarded by `scripts/check-playwright-version.mjs`, the `overrides:` block and `packages/core/tests/playwright-export.test.ts`, and the other two ranges are identical everywhere. A pnpm catalog would add one more place to keep in step for no gain.
