#!/usr/bin/env node
/**
 * Copies the built wizard into ./public. The deploy job puts that folder into the static site image
 * (site/Dockerfile), which nginx serves on Cloud Run.
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

export function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const from = path.join(root, 'packages', 'wizard', 'dist');
  const to = path.join(root, 'public');

  if (!existsSync(path.join(from, 'index.html'))) {
    console.error(`The wizard was not built: ${from} has no index.html.`);
    process.exit(1);
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  // The deploy's verify step reads this to confirm the site serves the commit it was built from.
  writeFileSync(path.join(to, 'version.json'), JSON.stringify({ commit: process.env.GITHUB_SHA || 'unknown' }) + '\n');
  console.log(`Copied the wizard build to ${to}`);

  const origin = siteOrigin(process.env.SITE_URL);
  if (origin) {
    const count = fillOrigin(to, origin);
    console.log(`Replaced %ORIGIN% in ${count} templated file(s) with ${origin}`);
  } else {
    console.warn('SITE_URL is not set or not an http(s) origin: %ORIGIN% is left in ./public. Set it for a deploy.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
