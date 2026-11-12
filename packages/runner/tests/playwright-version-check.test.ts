import { describe, expect, it } from 'vitest';
import {
  checkVersions,
  main,
  nodeMajorWarning,
  parseDockerfileVersion,
  parseLockfileVersions,
  parseWorkspaceOverrides,
  // @ts-expect-error plain .mjs script without type declarations
} from '../../../scripts/check-playwright-version.mjs';

const exitCodeAtImport = process.exitCode;

const DOCKERFILE = 'FROM mcr.microsoft.com/playwright:v1.65.0-noble\nWORKDIR /app\n';
const lock = (v: string) =>
  [
    'packages:',
    '',
    `  playwright-core@${v}:`,
    '    resolution: {integrity: x}',
    '',
    `  playwright@${v}:`,
    '    resolution: {integrity: x}',
    '',
    'snapshots:',
    '',
    `  playwright@${v}:`,
    '    dependencies:',
    `      playwright-core: ${v}`,
    '',
  ].join('\n');

describe('playwright version check', () => {
  it('does not set an exit code on import', () => {
    expect(process.exitCode).toBe(exitCodeAtImport);
  });

  it('passes when the lockfile playwright version equals the Dockerfile tag', () => {
    const r = checkVersions({
      docker: parseDockerfileVersion(DOCKERFILE),
      locked: parseLockfileVersions(lock('1.65.0')),
    });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('1.65.0');
  });

  it('parses the version out of a tag with a -noble suffix', () => {
    expect(parseDockerfileVersion('FROM mcr.microsoft.com/playwright:v1.65.0-noble')).toBe('1.65.0');
  });

  it('ignores playwright-core and @playwright/test keys', () => {
    const text = "packages:\n  playwright-core@1.49.1:\n    x: 1\n  '@playwright/test@1.49.1':\n    x: 1\n";
    const locked = parseLockfileVersions(text);
    expect(locked).toEqual([]);
    expect(checkVersions({ docker: '1.65.0', locked }).ok).toBe(false);
  });

  it('fails and names both versions when they differ', () => {
    const r = checkVersions({
      docker: '1.65.0',
      locked: parseLockfileVersions(lock('1.62.0')),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('1.65.0');
    expect(r.message).toContain('1.62.0');
    expect(r.message).toContain('pnpm-lock.yaml');
  });

  it('fails when core and checkers resolve a second playwright version', () => {
    const r = checkVersions({ docker: '1.65.0', locked: ['1.49.1', '1.65.0'] });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('1.49.1');
    expect(r.message).toContain('1.65.0');
  });

  it('fails clearly when the Dockerfile has no playwright tag', () => {
    for (const text of ['FROM node:22\n', 'ARG V=1.65.0\nFROM mcr.microsoft.com/playwright:v${V}-noble\n']) {
      const r = checkVersions({ docker: parseDockerfileVersion(text), locked: ['1.65.0'] });
      expect(r.ok).toBe(false);
      expect(r.message).toContain('Dockerfile');
    }
  });

  it('fails clearly when the lockfile has no playwright entry', () => {
    const r = checkVersions({ docker: '1.65.0', locked: parseLockfileVersions('packages:\n') });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('pnpm-lock.yaml');
  });

  it('handles quoted keys, peer suffixes and CRLF line endings', () => {
    const text =
      "packages:\r\n  'playwright@1.65.0':\r\n    x: 1\r\nsnapshots:\r\n  playwright@1.65.0(foo@1.0.0):\r\n    x: 1\r\n";
    expect(parseLockfileVersions(text)).toEqual(['1.65.0']);
  });
});

describe('pnpm-workspace.yaml overrides', () => {
  const workspace = [
    'packages:',
    "  - 'packages/*'",
    'allowBuilds:',
    '  esbuild: true',
    'overrides:',
    "  playwright: '1.65.0'",
    "  playwright-core: '1.65.0'",
    "  '@grpc/grpc-js': '>=1.13.6'",
    '',
  ].join('\n');

  it('reads playwright and playwright-core from the overrides block', () => {
    expect(parseWorkspaceOverrides(workspace)).toEqual([
      { name: 'playwright', version: '1.65.0' },
      { name: 'playwright-core', version: '1.65.0' },
    ]);
  });

  it('ignores the same names outside the overrides block', () => {
    expect(parseWorkspaceOverrides('allowBuilds:\n  playwright: false\npackages:\n  - x\n')).toEqual([]);
  });

  it('fails the check when an override differs from the Docker image tag', () => {
    const r = checkVersions({
      docker: '1.65.0',
      locked: ['1.65.0'],
      manifests: [{ file: 'pnpm-workspace.yaml', field: 'overrides.playwright', version: '1.62.0' }],
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('pnpm-workspace.yaml');
    expect(r.message).toContain('1.62.0');
  });
});

describe('Node major check', () => {
  it('returns null when the running major matches .nvmrc', () => {
    expect(nodeMajorWarning('22.9.0', '22\n')).toBeNull();
    expect(nodeMajorWarning('22.9.0', 'v22.11.0')).toBeNull();
  });

  it('warns, naming both majors, when the running major differs', () => {
    const w = nodeMajorWarning('24.1.0', '22\n');
    expect(typeof w).toBe('string');
    expect(w).toContain('24');
    expect(w).toContain('22');
  });

  it('never warns when .nvmrc is unreadable or not a version', () => {
    expect(nodeMajorWarning('22.9.0', '')).toBeNull();
    expect(nodeMajorWarning('22.9.0', 'lts/*')).toBeNull();
  });

  it('main() still returns 0 for matching Playwright versions when the Node major differs', () => {
    expect(main()).toBe(0);
  });
});
