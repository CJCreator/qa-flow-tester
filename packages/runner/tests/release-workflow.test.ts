import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const version = (JSON.parse(read('package.json')) as { version: string }).version;

describe('release workflow', () => {
  const yml = read('.github/workflows/release.yml');

  it('triggers only on v* tag push', () => {
    expect(yml).toMatch(/tags:\s*\n\s*-\s*'v\*'/);
    for (const word of ['branches', 'pull_request', 'workflow_dispatch', 'schedule']) {
      expect(yml).not.toContain(word);
    }
  });

  it('builds and does not publish', () => {
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('pnpm build');
    expect(yml).toContain('contents: read');
    for (const word of [
      'npm publish',
      'docker push',
      'gh release',
      'softprops',
      'upload-artifact',
      'secrets.',
      'contents: write',
    ]) {
      expect(yml).not.toContain(word);
    }
  });

  it('all package versions agree with the root version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const dir of [
      'packages/types',
      'packages/checkers',
      'packages/core',
      'packages/runner',
      'packages/wizard',
      'fixtures/test-app',
    ]) {
      expect((JSON.parse(read(`${dir}/package.json`)) as { version: string }).version, dir).toBe(version);
    }
  });

  it('CHANGELOG has a section for the version', () => {
    const escaped = version.replace(/\./g, '\\.');
    expect(read('CHANGELOG.md')).toMatch(new RegExp(`^## \\[${escaped}\\]`, 'm'));
  });

  it('deploy workflow does not trigger on tags', () => {
    expect(read('.github/workflows/deploy.yml')).not.toContain('tags:');
  });
});
