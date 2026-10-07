import { describe, expect, it } from 'vitest';
import {
  checkVersions,
  parseDockerfileVersion,
  parseLockfileVersions,
  // @ts-expect-error plain .mjs script without type declarations
} from '../../../scripts/check-playwright-version.mjs';

const exitCodeAtImport = process.exitCode;

const DOCKERFILE = 'FROM mcr.microsoft.com/playwright:v1.63.0-noble\nWORKDIR /app\n';
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
      locked: parseLockfileVersions(lock('1.63.0')),
    });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('1.63.0');
  });

  it('parses the version out of a tag with a -noble suffix', () => {
    expect(parseDockerfileVersion('FROM mcr.microsoft.com/playwright:v1.63.0-noble')).toBe('1.63.0');
  });

  it('ignores playwright-core and @playwright/test keys', () => {
    const text = "packages:\n  playwright-core@1.49.1:\n    x: 1\n  '@playwright/test@1.49.1':\n    x: 1\n";
    const locked = parseLockfileVersions(text);
    expect(locked).toEqual([]);
    expect(checkVersions({ docker: '1.63.0', locked }).ok).toBe(false);
  });

  it('fails and names both versions when they differ', () => {
    const r = checkVersions({
      docker: '1.63.0',
      locked: parseLockfileVersions(lock('1.62.0')),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('1.63.0');
    expect(r.message).toContain('1.62.0');
    expect(r.message).toContain('pnpm-lock.yaml');
  });

  it('fails when core and checkers resolve a second playwright version', () => {
    const r = checkVersions({ docker: '1.63.0', locked: ['1.49.1', '1.63.0'] });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('1.49.1');
    expect(r.message).toContain('1.63.0');
  });

  it('fails clearly when the Dockerfile has no playwright tag', () => {
    for (const text of ['FROM node:22\n', 'ARG V=1.63.0\nFROM mcr.microsoft.com/playwright:v${V}-noble\n']) {
      const r = checkVersions({ docker: parseDockerfileVersion(text), locked: ['1.63.0'] });
      expect(r.ok).toBe(false);
      expect(r.message).toContain('Dockerfile');
    }
  });

  it('fails clearly when the lockfile has no playwright entry', () => {
    const r = checkVersions({ docker: '1.63.0', locked: parseLockfileVersions('packages:\n') });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('pnpm-lock.yaml');
  });

  it('handles quoted keys, peer suffixes and CRLF line endings', () => {
    const text =
      "packages:\r\n  'playwright@1.63.0':\r\n    x: 1\r\nsnapshots:\r\n  playwright@1.63.0(foo@1.0.0):\r\n    x: 1\r\n";
    expect(parseLockfileVersions(text)).toEqual(['1.63.0']);
  });
});
