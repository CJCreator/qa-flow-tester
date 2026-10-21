import { promises as fs } from 'fs';
import path from 'path';

// Tests write into generated `.tmp-<name>` folders under the working directory (ignored by git). Each test
// file names its folder as a quoted literal, so this scans the test sources and creates every folder before
// any test runs. A new test folder needs no entry here.
const TMP_LITERAL = /'\.tmp-([\w-]+)'/g;

async function testFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true }).catch(() => [] as string[]);
  return entries.filter((f) => /\.(ts|tsx|js|mjs)$/.test(f)).map((f) => path.join(dir, f));
}

export default async function setup(): Promise<void> {
  const packagesDir = path.join(process.cwd(), 'packages');
  const packages = await fs.readdir(packagesDir).catch(() => [] as string[]);
  const names = new Set<string>();

  for (const pkg of packages) {
    for (const file of await testFiles(path.join(packagesDir, pkg, 'tests'))) {
      const text = await fs.readFile(file, 'utf8');
      for (const m of text.matchAll(TMP_LITERAL)) names.add(m[1]);
    }
  }

  await Promise.all(
    [...names].map((name) => fs.mkdir(path.join(process.cwd(), `.tmp-${name}`), { recursive: true })),
  );
}
