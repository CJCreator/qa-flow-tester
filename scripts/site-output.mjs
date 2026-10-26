#!/usr/bin/env node
/**
 * Copies the built wizard into ./public. The deploy job puts that folder into the static site image
 * (site/Dockerfile), which nginx serves on Cloud Run.
 */
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
