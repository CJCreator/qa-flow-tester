#!/usr/bin/env node
/**
 * scripts/clean.mjs
 * Safely removes temporary test files, runner reports, scratch directories,
 * and optional build caches from the repository.
 *
 * Usage:
 *   pnpm clean        # Cleans temporary files, runner reports, benchmarks, and scratch
 *   pnpm clean:dist   # Also removes packages/[package]/dist and public/
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanDist = process.argv.includes('--dist') || process.argv.includes('--all');

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

let removedCount = 0;
let bytesReclaimed = 0;

function calculateSize(itemPath) {
  try {
    const stat = statSync(itemPath);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    const entries = readdirSync(itemPath, { withFileTypes: true });
    for (const entry of entries) {
      total += calculateSize(path.join(itemPath, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}

function removeSafe(relPath) {
  if (PROTECTED.has(relPath)) return;
  const absPath = path.resolve(root, relPath);
  if (!existsSync(absPath)) return;

  const size = calculateSize(absPath);
  try {
    rmSync(absPath, { recursive: true, force: true, maxRetries: 3 });
    removedCount++;
    bytesReclaimed += size;
    console.log(`[clean] Removed: ${relPath}`);
  } catch (err) {
    console.warn(`[clean] Warning: Failed to remove ${relPath}: ${err.message}`);
  }
}

// 1. Clean root items matching .tmp-*
try {
  const rootEntries = readdirSync(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.name.startsWith('.tmp-')) {
      removeSafe(entry.name);
    }
  }
} catch (err) {
  console.warn(`[clean] Error reading root directory: ${err.message}`);
}

// 2. Clean standard ephemeral directories
for (const dir of EPHEMERAL_DIRS) {
  removeSafe(dir);
}

// 3. Clean localhost_* histories in .qa-data/sites if present
const qaDataSites = path.join(root, '.qa-data', 'sites');
if (existsSync(qaDataSites)) {
  try {
    const siteEntries = readdirSync(qaDataSites);
    for (const file of siteEntries) {
      if (file.startsWith('localhost_')) {
        removeSafe(path.join('.qa-data', 'sites', file));
      }
    }
  } catch (err) {
    console.warn(`[clean] Could not clean .qa-data/sites: ${err.message}`);
  }
}

// 4. Clean optional build outputs
if (cleanDist) {
  removeSafe('public');
  const packagesDir = path.join(root, 'packages');
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      removeSafe(path.join('packages', pkg, 'dist'));
    }
  }
}

const mb = (bytesReclaimed / (1024 * 1024)).toFixed(2);
console.log(`\n[clean] Done. Removed ${removedCount} items (${mb} MB reclaimed).`);
