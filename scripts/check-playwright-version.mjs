// Fails when the Playwright version in pnpm-lock.yaml differs from the tag of the runner Docker image.
// Pure string parsing: no network, no pnpm. Usage: node scripts/check-playwright-version.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

export function checkVersions({ docker, locked }) {
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
  return { ok: true, message: `Playwright ${docker} matches the Docker image tag.` };
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
  const result = checkVersions({
    docker: parseDockerfileVersion(dockerfile),
    locked: parseLockfileVersions(lockfile),
  });
  (result.ok ? console.log : console.error)(result.message);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
