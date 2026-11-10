# T-210: `pnpm tunnel` stops the tunnel on Windows and builds the Wizard

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | scripts | bug | todo |

**Files you may edit (no others):**
- `scripts/tunnel.mjs`

**Do not build in parallel with:** none.

## Problem
Two faults in `scripts/tunnel.mjs`:

1. **The tunnel outlives the script on Windows.** The tunnel is started with `shell: true` on Windows, so
   `tunnelProc` is `cmd.exe`. `tunnelProc.kill()` ends `cmd.exe` only. `pnpm dlx untun` and the `cloudflared`
   process it started keep running, and the public link keeps pointing at port 3001 after Ctrl-C.
2. **A fresh checkout serves no Wizard.** The build step builds `@qa/runner` only (not the packages it depends
   on, and not the Wizard). `scripts/start.mjs` builds `@qa/runner...` and then `@qa/wizard`. After
   `pnpm install` and `pnpm tunnel`, the runner starts with no page to serve.

## Current code
`scripts/tunnel.mjs:102-115` (branch `worktree-audit-cleanup`)
```js
// ── 1. Ensure runner is built ──────────────────────────────────────────────
if (!noBuild && !existsSync(path.join(root, 'packages/runner/dist/cli.js'))) {
  log('Runner not built yet — building now (run with --no-build to skip)…');
  const result = spawnSync('pnpm', ['--filter', '@qa/runner', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
  });
  if (result.status !== 0) {
    err('Build failed. Run `pnpm bootstrap` to reinstall and rebuild everything.');
    process.exit(1);
  }
}
```

`scripts/tunnel.mjs:219-227` (inside `function shutdown()`)
```js
  log('Shutting down…');
  try {
    tunnelProc?.kill();
  } catch {}
  try {
    runnerProc?.kill();
  } catch {}
```

For reference, `scripts/start.mjs:70-79` (do not edit):
```js
// 1. Build whatever is missing: the libraries it runs on, then the Wizard it serves.
const libraries = ['types/dist/index.js', 'checkers/dist/index.js', 'core/dist/index.js', 'runner/dist/cli.js'];
if (!libraries.every((file) => built(`packages/${file}`))) {
  console.log('[QA Tool] Building the QA Tool (first start only)…');
  pnpm(['--filter', '@qa/runner...', 'run', 'build']);
}
if (!built('packages/wizard/dist/index.html')) {
  console.log('[QA Tool] Building the Wizard…');
  pnpm(['--filter', '@qa/wizard', 'run', 'build']);
}
```

## Change
1. Replace lines 102-115 with exactly:
   ```js
   // ── 1. Ensure the runner and the Wizard it serves are built (the same two steps as scripts/start.mjs) ──
   function buildOrExit(args) {
     const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit', shell: isWin });
     if (result.status !== 0) {
       err('Build failed. Run `pnpm bootstrap` to reinstall and rebuild everything.');
       process.exit(1);
     }
   }
   if (!noBuild) {
     const libraries = ['types/dist/index.js', 'checkers/dist/index.js', 'core/dist/index.js', 'runner/dist/cli.js'];
     if (!libraries.every((file) => existsSync(path.join(root, 'packages', file)))) {
       log('Runner not built yet — building now (run with --no-build to skip)…');
       buildOrExit(['--filter', '@qa/runner...', 'run', 'build']);
     }
     if (!existsSync(path.join(root, 'packages/wizard/dist/index.html'))) {
       log('Wizard not built yet — building now…');
       buildOrExit(['--filter', '@qa/wizard', 'run', 'build']);
     }
   }
   ```
2. In `function shutdown()`, replace
   ```js
     try {
       tunnelProc?.kill();
     } catch {}
   ```
   with
   ```js
     try {
       // On Windows tunnelProc is cmd.exe (shell: true): kill() would leave `pnpm dlx untun` and cloudflared
       // running. taskkill /T ends the whole tree.
       if (isWin && tunnelProc?.pid) {
         spawnSync('taskkill', ['/pid', String(tunnelProc.pid), '/T', '/F'], { stdio: 'ignore' });
       } else {
         tunnelProc?.kill();
       }
     } catch {}
   ```
3. Change nothing else. Leave `runnerProc?.kill()` as it is (it is `node`, started without a shell).

## Tests
There is no unit test for this script.
```
node --check scripts/tunnel.mjs
pnpm lint
pnpm format:check
```
`pnpm lint` must report no new errors for `scripts/tunnel.mjs` (two `no-control-regex` warnings at about lines
136 and 148 exist already and stay).

Do not run `pnpm tunnel` to test: it opens a public link to this computer.

## Done when
- [ ] The build step builds `@qa/runner...` and then `@qa/wizard`, each only when its output is missing.
- [ ] `shutdown()` uses `taskkill /T /F` on Windows.
- [ ] `node --check scripts/tunnel.mjs` passes; `pnpm lint` has 0 errors; `pnpm format:check` passes.

## Notes
- `spawnSync`, `existsSync`, `path`, `root`, `isWin`, `noBuild`, `log` and `err` are all defined above line 102
  already. Add no import.
- `buildOrExit` is a function declaration at module level: it must not be placed inside the `if`.
