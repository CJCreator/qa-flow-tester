# T-211: Playwright version check reads the overrides in `pnpm-workspace.yaml`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | scripts | bug | built |

**Files you may edit (no others):**
- `scripts/check-playwright-version.mjs`
- `packages/runner/tests/playwright-version-check.test.ts`

**Do not build in parallel with:** none.

## Problem
`scripts/check-playwright-version.mjs` fails CI when the Playwright version in the manifests differs from the
runner Docker image tag. It looks for overrides at `pnpm.overrides.playwright` in each `package.json`. The
overrides moved to `pnpm-workspace.yaml`:

```yaml
overrides:
  playwright: '1.63.0'
  playwright-core: '1.63.0'
```

So that branch never matches, and nobody checks the workspace overrides. Change the override to `1.62.0` and
the script still prints "matches" as long as the lockfile was not regenerated.

## Current code
`scripts/check-playwright-version.mjs:39-54` (branch `worktree-audit-cleanup`)
```js
  const results = [];
  for (const m of manifests) {
    try {
      const data = JSON.parse(readFileSync(m.path, 'utf8'));
      const deps = data.dependencies?.playwright;
      const devDeps = data.devDependencies?.playwright;
      const override = data.pnpm?.overrides?.playwright;
      if (deps) results.push({ file: m.relPath, field: 'dependencies.playwright', version: deps });
      if (devDeps) results.push({ file: m.relPath, field: 'devDependencies.playwright', version: devDeps });
      if (override) results.push({ file: m.relPath, field: 'pnpm.overrides.playwright', version: override });
    } catch {
      // ignore parse error if any
    }
  }
  return results;
}
```

`packages/runner/tests/playwright-version-check.test.ts:1-7`
```ts
import { describe, expect, it } from 'vitest';
import {
  checkVersions,
  parseDockerfileVersion,
  parseLockfileVersions,
  // @ts-expect-error plain .mjs script without type declarations
} from '../../../scripts/check-playwright-version.mjs';
```
The file's last `describe` block ends with `});` on the final line.

## Change
1. `scripts/check-playwright-version.mjs`: insert this function immediately before the comment line
   `/** Finds Playwright versions or overrides in root and workspace package.json files. */` (line 21):
   ```js
   /** `playwright` and `playwright-core` entries of the top-level `overrides:` block in pnpm-workspace.yaml. */
   export function parseWorkspaceOverrides(text) {
     const out = [];
     let inOverrides = false;
     for (const line of text.split(/\r?\n/)) {
       if (/^\S/.test(line)) {
         inOverrides = /^overrides:\s*$/.test(line);
         continue;
       }
       if (!inOverrides) continue;
       const m = /^\s+['"]?(playwright(?:-core)?)['"]?:\s*['"]?([^'"\s#]+)['"]?/.exec(line);
       if (m) out.push({ name: m[1], version: m[2] });
     }
     return out;
   }

   ```
2. Same file, in `parseManifestVersions`: delete the two lines that mention `override`
   (`const override = data.pnpm?.overrides?.playwright;` and
   `if (override) results.push({ file: m.relPath, field: 'pnpm.overrides.playwright', version: override });`).
3. Same function: insert between the closing `}` of the `for` loop and `return results;`:
   ```js
     const workspacePath = path.join(root, 'pnpm-workspace.yaml');
     if (existsSync(workspacePath)) {
       for (const o of parseWorkspaceOverrides(readFileSync(workspacePath, 'utf8'))) {
         results.push({ file: 'pnpm-workspace.yaml', field: `overrides.${o.name}`, version: o.version });
       }
     }
   ```
4. Same file, line 1: change the header comment to
   `// Fails when the Playwright version in pnpm-lock.yaml, a package manifest or the pnpm-workspace.yaml overrides differs from the tag of the runner Docker image.`
5. `playwright-version-check.test.ts`: add `parseWorkspaceOverrides,` to the import list, on its own line
   after `parseLockfileVersions,` and before the `// @ts-expect-error` comment line.
6. Same test file: append at the end of the file:
   ```ts

   describe('pnpm-workspace.yaml overrides', () => {
     const workspace = [
       'packages:',
       "  - 'packages/*'",
       'allowBuilds:',
       '  esbuild: true',
       'overrides:',
       "  playwright: '1.63.0'",
       "  playwright-core: '1.63.0'",
       "  '@grpc/grpc-js': '>=1.13.6'",
       '',
     ].join('\n');

     it('reads playwright and playwright-core from the overrides block', () => {
       expect(parseWorkspaceOverrides(workspace)).toEqual([
         { name: 'playwright', version: '1.63.0' },
         { name: 'playwright-core', version: '1.63.0' },
       ]);
     });

     it('ignores the same names outside the overrides block', () => {
       expect(parseWorkspaceOverrides('allowBuilds:\n  playwright: false\npackages:\n  - x\n')).toEqual([]);
     });

     it('fails the check when an override differs from the Docker image tag', () => {
       const r = checkVersions({
         docker: '1.63.0',
         locked: ['1.63.0'],
         manifests: [{ file: 'pnpm-workspace.yaml', field: 'overrides.playwright', version: '1.62.0' }],
       });
       expect(r.ok).toBe(false);
       expect(r.message).toContain('pnpm-workspace.yaml');
       expect(r.message).toContain('1.62.0');
     });
   });
   ```

## Tests
```
pnpm exec vitest run packages/runner/tests/playwright-version-check.test.ts
node scripts/check-playwright-version.mjs
pnpm lint
pnpm format:check
```
The second command must print `Playwright 1.63.0 matches the Docker image tag, lockfile, and package manifests.`
and exit 0.

## Done when
- [x] `parseWorkspaceOverrides` is exported and used by `parseManifestVersions`.
- [x] The test file passes, including the 3 new tests.
- [x] `node scripts/check-playwright-version.mjs` exits 0 on this repository.

## Notes
- `path`, `existsSync` and `readFileSync` are already imported at the top of the script.
- Do not change any Playwright version anywhere. This ticket only widens what the check reads.
- No YAML library: the script is "pure string parsing" by design (its line 2).
