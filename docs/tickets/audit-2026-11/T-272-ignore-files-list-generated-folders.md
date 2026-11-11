# T-272: ESLint and Docker ignore the generated folders; `.gitignore` loses redundant lines

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | config | inconsistency | todo |

**Files you may edit (no others):**

- `eslint.config.mjs`
- `.dockerignore`
- `.gitignore`

**Do not build in parallel with:** nothing.

## Problem

1. `eslint.config.mjs` says its ignore list "mirrors `.gitignore`", but it lacks `coverage/**`, `qa-report/**` and `.ai-eos/**`. ESLint does not read `.gitignore`, so it would lint generated JavaScript in those folders if they exist (`qa-report/` is written by the generated workflow, `.ai-eos/` by the AI-EOS tool).
2. `.dockerignore` lacks `docs`, `coverage`, `.qa-data`, `.qa-tunnel-data`, `.benchmark`, `.ai-eos`. `docker build` sends the whole folder to the daemon (`packages/runner/Dockerfile` and `site/Dockerfile` use `.` as context), so a developer's local data folders and the docs tree slow every build. Neither Dockerfile copies them.
3. `.gitignore` has three `.claude/...` lines that the later `.claude/` line already covers.

## Current code

Branch from `main`.

`eslint.config.mjs` (first config object; find with `grep -n "ignores" eslint.config.mjs`):

```js
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'public/**',
      'sites/**',
      '.qa-*/**',
      '.tmp-*/**',
      '.benchmark/**',
      '.kilo/**',
      '.playwright-mcp/**',
      '.claude/**',
      '.scratch/**',
      '.review-shots/**',
      '.vscode/**',
    ],
```

`.dockerignore` (21 lines; its last lines):

```
.tmp-*
.env
npm-debug.log
yarn-error.log
pnpm-debug.log
.DS_Store
*.local
```

`.gitignore`:

```
# Claude Code folder is local only (owner decision 2026-10-09)
.claude/worktrees/
.claude/settings.local.json
# Hand-off files between the pipeline agents (/ship)
.claude/work/
.scratch/
```

and, further down, the line `.claude/` (under "Local design review screenshots and editor settings").

## Change

1. `eslint.config.mjs`: add three strings to the `ignores` array, after `'.vscode/**',`:

```js
      'coverage/**',
      'qa-report/**',
      '.ai-eos/**',
```

2. `.dockerignore`: add these lines directly after `.qa-ai-models.json`:

```
.qa-data
.qa-tunnel-data
.qa-tunnel-report
.ai-eos
.benchmark
coverage
qa-report
docs
```

Do not add `site`, `public`, `templates` or `packages`: `site/Dockerfile` copies `site/nginx.conf` and `public`, and `packages/runner/Dockerfile` copies `templates` and the packages.

3. `.gitignore`: delete the three lines `.claude/worktrees/`, `.claude/settings.local.json` and `.claude/work/`, and the comment line `# Hand-off files between the pipeline agents (/ship)`. Keep the comment `# Claude Code folder is local only (owner decision 2026-10-09)` and move it so it sits directly above the existing `.claude/` line (delete it from its old place). Keep `.scratch/`.

4. Run `pnpm exec prettier --check eslint.config.mjs`.

## Tests

- `pnpm lint` must pass.
- `pnpm exec vitest run packages/wizard/tests/repo-hygiene.test.ts` (it checks that `.gitignore` has `qa-report/` and no duplicate line).
- No Docker run is needed. The image builds run in CI (`build-secret-scan` in `ci.yml` builds the runner image); check that job after the pull request opens.
- `git check-ignore -v .claude/work/x .claude/worktrees/x .claude/settings.local.json` must show all three still ignored (by the `.claude/` line).

## Done when

- [ ] `grep -c "coverage/\*\*\|qa-report/\*\*\|.ai-eos/\*\*" eslint.config.mjs` prints 3.
- [ ] `.dockerignore` contains the eight new lines and not `site` or `templates`.
- [ ] `grep -c "^\.claude/" .gitignore` prints 1.
- [ ] `pnpm lint` and `repo-hygiene.test.ts` pass.

## Notes

- Not in this ticket, on purpose: `.prettierignore` already skips these folders, because Prettier 3 reads `.gitignore` too. `/sites/` stays: `moveLegacyData` in `packages/runner/src/server.ts` still moves old data out of a `sites` folder. `.kilo` stays: it costs nothing and an editor tool may create it. `.vercel` stays (harmless).
- T-229 removes the coverage setup. The `coverage` entries are still right then: they only ignore a folder that no longer appears.
