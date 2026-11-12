// Fails when the Playwright version in pnpm-lock.yaml, a package manifest or the pnpm-workspace.yaml overrides differs from the tag of the runner Docker image.
// Pure string parsing: no network, no pnpm. Usage: node scripts/check-playwright-version.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A warning when the running Node major differs from the one in .nvmrc, else null. `running` is process.versions.node. */
export function nodeMajorWarning(running, nvmrcText) {
  const want = /^v?(\d+)/.exec(String(nvmrcText).trim());
  const have = /^(\d+)/.exec(String(running));
  if (!want || !have || want[1] === have[1]) return null;
  return `Node ${have[1]} is running; this repository is built and tested on Node ${want[1]} (.nvmrc). Use Node ${want[1]} to match CI.`;
}

/** Version from `FROM mcr.microsoft.com/playwright:vX.Y.Z-noble`, or null. */
export function parseDockerfileVersion(text) {
  const m = /^FROM\s+\S*playwright:v(\d+\.\d+\.\d+)/im.exec(text);
  return m ? m[1] : null;
}

/** Sorted distinct versions of every `playwright@X.Y.Z` package key in the lockfile. */
export function parseLockfileVersions(text) {
  const re = /^ {2}'?playwright@(\d+\.\d+\.\d+(?:-[\w.]+)?)(?:\([^)]*\))*'?:\s*$/gm;
  const found = new Set();
  for (const m of text.matchAll(re)) found.add(m[1]);
  return [...found].sort();
}

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

/** Finds Playwright versions or overrides in root and workspace package.json files. */
export function parseManifestVersions(root) {
  const manifests = [];
  const rootPkgPath = path.join(root, 'package.json');
  if (existsSync(rootPkgPath)) {
    manifests.push({ relPath: 'package.json', path: rootPkgPath });
  }

  const packagesDir = path.join(root, 'packages');
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir)) {
      const pkgJsonPath = path.join(packagesDir, name, 'package.json');
      if (existsSync(pkgJsonPath)) {
        manifests.push({ relPath: `packages/${name}/package.json`, path: pkgJsonPath });
      }
    }
  }

  const results = [];
  for (const m of manifests) {
    try {
      const data = JSON.parse(readFileSync(m.path, 'utf8'));
      const deps = data.dependencies?.playwright;
      const devDeps = data.devDependencies?.playwright;
      if (deps) results.push({ file: m.relPath, field: 'dependencies.playwright', version: deps });
      if (devDeps) results.push({ file: m.relPath, field: 'devDependencies.playwright', version: devDeps });
    } catch {
      // ignore parse error if any
    }
  }

  const workspacePath = path.join(root, 'pnpm-workspace.yaml');
  if (existsSync(workspacePath)) {
    for (const o of parseWorkspaceOverrides(readFileSync(workspacePath, 'utf8'))) {
      results.push({ file: 'pnpm-workspace.yaml', field: `overrides.${o.name}`, version: o.version });
    }
  }
  return results;
}

export function checkVersions({ docker, locked, manifests = [] }) {
  if (!docker) {
    return {
      ok: false,
      message:
        'Could not find a Playwright version in packages/runner/Dockerfile (expected `FROM mcr.microsoft.com/playwright:vX.Y.Z-...`).',
    };
  }
  if (locked.length === 0) {
    return { ok: false, message: 'Could not find a playwright version in pnpm-lock.yaml.' };
  }
  if (locked.some((v) => v !== docker)) {
    return {
      ok: false,
      message: `Playwright version mismatch: packages/runner/Dockerfile is ${docker}, pnpm-lock.yaml resolves ${locked.join(', ')}. Bump them together (docs/DEPLOYMENT.md#docker).`,
    };
  }
  const mismatchedManifests = manifests.filter((m) => m.version !== docker);
  if (mismatchedManifests.length > 0) {
    const details = mismatchedManifests.map((m) => `${m.file} (${m.field}=${m.version})`).join(', ');
    return {
      ok: false,
      message: `Playwright version mismatch: packages/runner/Dockerfile is ${docker}, but manifests declare: ${details}.`,
    };
  }
  return { ok: true, message: `Playwright ${docker} matches the Docker image tag, lockfile, and package manifests.` };
}

export function main(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  let dockerfile;
  let lockfile;
  try {
    dockerfile = readFileSync(path.join(root, 'packages/runner/Dockerfile'), 'utf8');
    lockfile = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  } catch (err) {
    console.error(`Could not read a file needed for the Playwright version check: ${err.message}`);
    return 1;
  }
  // A different Node major is a warning only; it never changes the exit code.
  if (existsSync(path.join(root, '.nvmrc'))) {
    const warning = nodeMajorWarning(process.versions.node, readFileSync(path.join(root, '.nvmrc'), 'utf8'));
    if (warning) console.warn(warning);
  }
  const manifests = parseManifestVersions(root);
  const result = checkVersions({
    docker: parseDockerfileVersion(dockerfile),
    locked: parseLockfileVersions(lockfile),
    manifests,
  });
  (result.ok ? console.log : console.error)(result.message);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
