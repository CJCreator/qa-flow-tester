#!/usr/bin/env node
/**
 * Finishes the static site: copies the built wizard into ./public (or, with `--in-place`, finishes the build where it
 * is, which is how Vercel's build uses it), fills `%ORIGIN%` and writes version.json.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Files whose `%ORIGIN%` placeholder is filled in (kept in step with packages/runner/src/ui-static.ts). */
export const TEMPLATED = new Set(['.html', '.txt', '.xml', '.webmanifest']);

/**
 * Trims and validates a site origin. Drops trailing slashes, accepts only http(s) origins
 * with optional port, else returns null.
 */
export function siteOrigin(raw) {
  if (typeof raw !== 'string') return null;
  const configured = raw.trim().replace(/\/+$/, '');
  if (configured && /^https?:\/\/[\w.-]+(:\d+)?$/.test(configured)) {
    return configured;
  }
  return null;
}

/**
 * Recursively walks dir, finding files with an extension in TEMPLATED that contain
 * the %ORIGIN% placeholder, replaces with origin, and writes back.
 * Returns the count of files modified.
 */
export function fillOrigin(dir, origin) {
  let count = 0;
  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (TEMPLATED.has(ext)) {
          const content = readFileSync(fullPath, 'utf8');
          if (content.includes('%ORIGIN%')) {
            const replaced = content.replaceAll('%ORIGIN%', origin);
            writeFileSync(fullPath, replaced, 'utf8');
            count++;
          }
        }
      }
    }
  }
  walk(dir);
  return count;
}

/**
 * The site's own origin for `%ORIGIN%`: SITE_ORIGIN, else the older SITE_URL, else Vercel's production host
 * (VERCEL_PROJECT_PRODUCTION_URL has no scheme). Null when none is a valid origin.
 */
export function resolveOrigin(env = process.env) {
  const vercelHost =
    typeof env.VERCEL_PROJECT_PRODUCTION_URL === 'string' ? env.VERCEL_PROJECT_PRODUCTION_URL.trim() : '';
  return (
    siteOrigin(env.SITE_ORIGIN) ??
    siteOrigin(env.SITE_URL) ??
    (vercelHost ? siteOrigin(/^https?:\/\//.test(vercelHost) ? vercelHost : `https://${vercelHost}`) : null)
  );
}

/**
 * `--in-place [dir]` finishes a build that is already in dir (default packages/wizard/dist; Vercel serves that
 * folder itself). Without it the wizard build is copied to ./public. Null when the flag is absent.
 */
export function inPlaceDir(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--in-place');
  if (i === -1) return null;
  const dir = argv[i + 1];
  return dir && !dir.startsWith('--') ? dir : path.join('packages', 'wizard', 'dist');
}

export function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const from = path.join(root, 'packages', 'wizard', 'dist');
  const inPlace = inPlaceDir();
  const to = inPlace ? path.resolve(root, inPlace) : path.join(root, 'public');

  if (!existsSync(path.join(inPlace ? to : from, 'index.html'))) {
    console.error(`The wizard was not built: ${inPlace ? to : from} has no index.html.`);
    process.exit(1);
  }
  if (!inPlace) {
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
    console.log(`Copied the wizard build to ${to}`);
  }
  // The deploy's verify step reads this to confirm the site serves the commit it was built from.
  const commit = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
  writeFileSync(path.join(to, 'version.json'), JSON.stringify({ commit }) + '\n');

  const origin = resolveOrigin();
  if (origin) {
    const count = fillOrigin(to, origin);
    console.log(`Replaced %ORIGIN% in ${count} templated file(s) with ${origin}`);
  } else {
    console.warn(
      'SITE_ORIGIN (or VERCEL_PROJECT_PRODUCTION_URL) is not an http(s) origin: %ORIGIN% is left in the output. Set it for a deploy.'
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
