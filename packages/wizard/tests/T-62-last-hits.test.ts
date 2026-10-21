import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// T-62: last avoid-list hits in wizard UI copy ("check" as a verb is on the CONTEXT.md avoid list).
const CASES: Array<{ file: string; old: string; replacement: string }> = [
  {
    file: '../src/screens/BenchmarkScreen.tsx',
    old: 'Check both addresses',
    replacement: 'Make sure both addresses are right',
  },
  {
    file: '../src/components/KeyField.tsx',
    old: 'Checking the key…',
    replacement: 'Confirming the key…',
  },
  {
    file: '../src/screens/ConnectionScreen.tsx',
    old: 'Checking again every 3 seconds.',
    replacement: 'Trying again every 3 seconds.',
  },
];

describe('T-62 last avoid-list hits in wizard UI copy', () => {
  for (const { file, old, replacement } of CASES) {
    it(`${file} drops "${old}" and carries its replacement`, () => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source.includes(old), file).toBe(false);
      expect(source.includes(replacement), file).toBe(true);
    });
  }
});
