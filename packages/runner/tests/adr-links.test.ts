import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Every ADR that the docs, the code and the scripts cite has a file in docs/adr (T-63).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// "ADR 0021", "ADRs 0014" and links such as "adr/0021-...". Only the first number of a list is read.
const CITATION = /\bADRs?\s+(\d{4})\b|\badr\/(\d{4})-/g;

async function walk(dir: string, pattern: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, pattern)));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

async function citingFiles(): Promise<string[]> {
  const rootDocs = (await fs.readdir(root)).filter((f) => f.endsWith('.md')).map((f) => path.join(root, f));
  const docs = await walk(path.join(root, 'docs'), /\.md$/);
  const code = await walk(path.join(root, 'packages'), /\.(md|ts|tsx|mjs)$/);
  const scripts = await walk(path.join(root, 'scripts'), /\.(ts|mjs)$/);
  return [...rootDocs, ...docs, ...code, ...scripts];
}

describe('every ADR cited in the docs and code exists', () => {
  it('each cited ADR number has a file in docs/adr', async () => {
    const adrNumbers = new Set(
      (await fs.readdir(path.join(root, 'docs', 'adr'))).map((f) => /^(\d{4})-.+\.md$/.exec(f)?.[1]).filter(Boolean)
    );
    const missing: string[] = [];
    for (const file of await citingFiles()) {
      const text = await fs.readFile(file, 'utf8');
      for (const m of text.matchAll(CITATION)) {
        const number = m[1] ?? m[2];
        if (!adrNumbers.has(number)) missing.push(`${path.relative(root, file)}: ADR ${number}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
