# T-216: Delete the `agent-dashboard/` and `dev-pipeline/` folders

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | config | dead-code | built |

**Files you may edit (no others):**
- `agent-dashboard/` (delete the whole folder)
- `dev-pipeline/` (delete the whole folder)
- `eslint.config.mjs`

**Do not build in parallel with:** T-228 (also edits `eslint.config.mjs`).

## Problem
Two top-level folders are run, built and referenced by nothing:

- Not in `pnpm-workspace.yaml` (`packages/*` only).
- Not in `.claude-plugin/marketplace.json` (it lists `plugins/repo-orchestrator` only).
- No script in `package.json` and no workflow in `.github/workflows` names them.
- Their tests (`agent-dashboard/dashboard.test.ts`, `dev-pipeline/build.test.ts`) are matched by no vitest
  project (`packages/*/tests/**` only) and import `claude-code/testing`, which is not a dependency.
- Both `tsconfig.json` files extend `./.claude-plugin/types/tsconfig.json`, which is not in the repository.

The only reference is one block in `eslint.config.mjs`. Owner decision (2026-11-10): delete them.

Tracked files (14):
```
agent-dashboard/.claude-plugin/plugin.json
agent-dashboard/dashboard.test.ts
agent-dashboard/hooks/hooks.json
agent-dashboard/hooks/register.js
agent-dashboard/tsconfig.json
agent-dashboard/types/index.d.ts
dev-pipeline/.claude-plugin/plugin.json
dev-pipeline/agents/architect.md
dev-pipeline/agents/code-reviewer.md
dev-pipeline/agents/impact-analyst.md
dev-pipeline/build.test.ts
dev-pipeline/hooks/hooks.json
dev-pipeline/hooks/register.js
dev-pipeline/tsconfig.json
```

## Current code
`eslint.config.mjs:89-98` (branch `worktree-audit-cleanup`), the end of the file
```js
  },
  {
    files: ['agent-dashboard/**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        h: 'readonly',
      },
    },
  },
];
```

## Change
1. Delete both folders:
   ```
   git rm -r agent-dashboard dev-pipeline
   ```
   If untracked files remain in either folder afterwards, list them in your report and leave them.
2. `eslint.config.mjs`: delete the last config object (lines 90-97), so the file ends:
   ```js
       rules: {
         '@typescript-eslint/no-floating-promises': 'warn',
         '@typescript-eslint/no-misused-promises': 'warn',
       },
     },
   ];
   ```

## Tests
```
pnpm lint
pnpm format:check
pnpm test:plugin
```
This grep must print nothing:
```
grep -rn "agent-dashboard\|dev-pipeline" --include=*.md --include=*.mjs --include=*.ts --include=*.json --include=*.yml --include=*.yaml . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.claude --exclude-dir=tickets
```

## Done when
- [x] `git ls-files agent-dashboard dev-pipeline` prints nothing.
- [x] `eslint.config.mjs` has no `agent-dashboard` block.
- [x] `pnpm lint` has 0 errors; `pnpm test:plugin` passes.

## Notes
- Do not touch `plugins/repo-orchestrator/` or `.claude-plugin/marketplace.json`: that plugin is in use.
- `--exclude-dir=tickets` in the grep skips `docs/tickets/`: the ticket files themselves name the folders.
