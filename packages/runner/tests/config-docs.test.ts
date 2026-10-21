import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Keeps .env.example, docs/CONFIGURATION.md, the start script and the setup docs in step with the code (T-38).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string) => fs.readFile(path.join(root, rel), 'utf8');

// Vite's built-in import.meta.env keys are not settings a person configures.
const VITE_BUILTINS = new Set(['MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL']);

// Settings that were removed from the code. They must not come back in code, scripts or the example.
const RETIRED = ['QA_CHECKUP_PORT', 'HUB_API_URL'];

// Commands pnpm provides itself, so they need no script in package.json.
const PNPM_BUILTINS = new Set(['install', 'exec', 'setup', 'add', 'run', 'dlx', 'update', 'filter']);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// The package sources and the scripts (start, smoke, build helpers). The scripts read settings too (T-63).
async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const pkg of await fs.readdir(path.join(root, 'packages'))) {
    const src = path.join(root, 'packages', pkg, 'src');
    const isDir = await fs.stat(src).then(
      (s) => s.isDirectory(),
      () => false
    );
    if (isDir) files.push(...(await walk(src)));
  }
  files.push(...(await walk(path.join(root, 'scripts'))));
  return files;
}

// Every name the code reads from the environment: process.env.NAME, a parameter named env (env.NAME,
// env['NAME']) and import.meta.env.NAME. Dynamic reads (process.env[name]) are generated code, not settings.
async function codeReads(): Promise<Map<string, string[]>> {
  const patterns = [/\benv\.([A-Z][A-Z0-9_]*)\b/g, /\benv\[['"]([A-Z][A-Z0-9_]*)['"]\]/g];
  const reads = new Map<string, string[]>();
  for (const file of await sourceFiles()) {
    const text = await fs.readFile(file, 'utf8');
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        if (VITE_BUILTINS.has(m[1])) continue;
        reads.set(m[1], [...(reads.get(m[1]) ?? []), path.relative(root, file)]);
      }
    }
  }
  return reads;
}

// Lines of .env.example that set a name, commented out or not: "# NAME=value" or "NAME=value".
function exampleEntries(text: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const line of text.split('\n')) {
    const m = /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out.push({ name: m[1], value: m[2].trim() });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('.env.example lists every variable the code reads', () => {
  it('each name the code reads appears in .env.example exactly once', async () => {
    const entries = exampleEntries(await read('.env.example'));
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);

    const reads = await codeReads();
    expect(reads.size).toBeGreaterThan(30);
    const missing = [...reads.keys()].filter((name) => !counts.has(name));
    expect(missing, 'read in code but not in .env.example').toEqual([]);

    const repeated = [...counts].filter(([, n]) => n !== 1).map(([name]) => name);
    expect(repeated, 'listed more than once in .env.example').toEqual([]);
  });

  it('retired settings are not read or listed anywhere', async () => {
    const files = [
      '.env.example',
      'package.json',
      'scripts/start.mjs',
      'scripts/smoke.mjs',
      ...(await sourceFiles()).map((f) => path.relative(root, f)),
    ];
    for (const rel of files) {
      const text = await read(rel);
      for (const name of RETIRED) expect(text, `${name} in ${rel}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe('pnpm start loads .env', () => {
  it('the start script passes --env-file-if-exists=.env to node', async () => {
    const pkg = JSON.parse(await read('package.json'));
    expect(pkg.scripts.start).toContain('--env-file-if-exists=.env');
  });
});

describe('.env.example agrees with docs/CONFIGURATION.md', () => {
  it('every variable in the example is documented', async () => {
    const config = await read('docs/CONFIGURATION.md');
    const undocumented = exampleEntries(await read('.env.example'))
      .map((e) => e.name)
      .filter((name) => !new RegExp(`\\b${name}\\b`).test(config));
    expect(undocumented).toEqual([]);
  });

  it('a non-empty default in the example matches the documented default', async () => {
    const rows = (await read('docs/CONFIGURATION.md')).split('\n').filter((l) => l.startsWith('|'));
    const mismatches: string[] = [];
    for (const { name, value } of exampleEntries(await read('.env.example'))) {
      if (!value) continue;
      const row = rows.find((l) => l.includes(`\`${name}\``));
      if (!row || !new RegExp(`\\b${escapeRe(value)}\\b`).test(row)) mismatches.push(`${name}=${value}`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('the setup docs name commands and files that exist', () => {
  const docs = ['README.md', 'docs/PRODUCT_GUIDE.md', 'CONTRIBUTING.md', 'docs/CONFIGURATION.md'];

  it('every pnpm command in a code span or at a line start is a package script or a pnpm built-in', async () => {
    const pkg = JSON.parse(await read('package.json'));
    const scripts = new Set(Object.keys(pkg.scripts));
    const unknown: string[] = [];
    for (const doc of docs) {
      const text = await read(doc);
      for (const m of text.matchAll(/(?:^|`)pnpm (?:-r |--filter \S+ )?([a-z][a-z:-]*)/gm)) {
        if (!scripts.has(m[1]) && !PNPM_BUILTINS.has(m[1])) unknown.push(`${doc}: pnpm ${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('every relative link in the setup docs and the E2E plan points at a file that exists', async () => {
    const files = [...docs, 'docs/README.md', 'docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md'];
    const missing: string[] = [];
    for (const doc of files) {
      const abs = path.join(root, doc);
      for (const m of (await fs.readFile(abs, 'utf8')).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1];
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const file = target.split('#')[0];
        if (!file) continue;
        const exists = await fs.access(path.resolve(path.dirname(abs), file)).then(
          () => true,
          () => false
        );
        if (!exists) missing.push(`${doc}: ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
