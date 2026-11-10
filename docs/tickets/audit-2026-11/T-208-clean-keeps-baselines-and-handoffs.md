# T-208: `pnpm clean` must not delete approved baselines or hand-off files

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | scripts | bug | todo |

**Files you may edit (no others):**
- `scripts/clean.mjs`

**Do not build in parallel with:** none.

## Problem
`scripts/clean.mjs` treats two folders as throw-away that are not:

- `.qa-baselines`: approved Visual Baselines. `CLAUDE.md` says "approved `.qa-baselines/` are committed on
  purpose". `pnpm clean` deletes them, and the next Check-up has nothing to compare against.
- `.claude/work`: the hand-off files of the agent pipeline (`backlog.md`, the per-ticket briefs and plans, the
  `DEFER_TESTS` flag). `pnpm clean` deletes work in progress.

## Current code
`scripts/clean.mjs:18-32` (branch `worktree-audit-cleanup`)
```js
const PROTECTED = new Set(['.env', '.git', '.github', '.pipeline', 'node_modules']);

const EPHEMERAL_DIRS = [
  '.scratch',
  '.qa-baselines',
  '.qa-runner-report',
  '.qa-report',
  '.qa-tunnel-report',
  '.qa-tunnel-data',
  '.qa-hub-storage',
  '.qa-cache',
  '.benchmark',
  'sites',
  path.join('.claude', 'work'),
];
```

## Change
1. Replace lines 18-32 with exactly:
   ```js
   // Never removed, whatever the lists below say. .qa-baselines holds approved Visual Baselines (committed on
   // purpose) and .claude/work holds the agent pipeline's hand-off files.
   const PROTECTED = new Set([
     '.env',
     '.git',
     '.github',
     '.pipeline',
     'node_modules',
     '.qa-baselines',
     path.join('.claude', 'work'),
   ]);

   const EPHEMERAL_DIRS = [
     '.scratch',
     '.qa-runner-report',
     '.qa-report',
     '.qa-tunnel-report',
     '.qa-tunnel-data',
     '.qa-hub-storage',
     '.qa-cache',
     '.benchmark',
     'sites',
   ];
   ```
2. Change nothing else in the file.

## Tests
There is no unit test for this script. Check by hand, from the repository root:
```
node --check scripts/clean.mjs
mkdir -p .qa-baselines/keep-me .scratch/remove-me
node scripts/clean.mjs
ls -d .qa-baselines/keep-me
ls -d .scratch 2>/dev/null || echo "scratch removed"
rm -rf .qa-baselines/keep-me
pnpm lint
pnpm format:check
```
Expected: `.qa-baselines/keep-me` is still listed, and the last `ls` prints `scratch removed`.
Remove `.qa-baselines` afterwards only if it did not exist before this test (`rmdir .qa-baselines`).

## Done when
- [ ] `.qa-baselines` and `.claude/work` are not in `EPHEMERAL_DIRS` and are in `PROTECTED`.
- [ ] The hand check above leaves `.qa-baselines/keep-me` in place and removes `.scratch`.
- [ ] `pnpm lint` and `pnpm format:check` pass.

## Notes
- `removeSafe` already returns early for a `PROTECTED` path, so the two entries are safe even if someone adds
  them back to a list later.
- `path` is already imported at the top of the file, and is used before line 18 only as an import: moving the
  `path.join` call into `PROTECTED` is fine.
- Run the hand check in your worktree, never in the owner's main checkout.
