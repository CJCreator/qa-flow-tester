import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n');

describe('.gitignore', () => {
  const entries = read('.gitignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  it('ignores the generated qa-report/ output', () => {
    expect(entries).toContain('qa-report/');
  });

  it('lists each entry once', () => {
    const dupes = entries.filter((line, i) => entries.indexOf(line) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('runner Dockerfile', () => {
  it('names no fixture workspace (there are no fixture sites)', () => {
    const dockerfile = read('packages/runner/Dockerfile');
    expect(dockerfile).not.toContain('fixtures/');
    expect(dockerfile).toContain('RUN pnpm install --frozen-lockfile');
  });
});
