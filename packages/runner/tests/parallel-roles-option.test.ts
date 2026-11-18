import { describe, expect, it } from 'vitest';
import { parseArgs, parseParallelRoles } from '../src/checkup.js';

describe('parallelRoles option', () => {
  it('clamps to 1..10', () => {
    expect(parseParallelRoles('0')).toBe(1);
    expect(parseParallelRoles('-3')).toBe(1);
    expect(parseParallelRoles('4')).toBe(4);
    expect(parseParallelRoles('99')).toBe(10);
  });
  it('is absent when unset or empty', () => {
    expect(parseParallelRoles(undefined)).toBeUndefined();
    expect(parseParallelRoles('')).toBeUndefined();
  });
  it('rejects non-integers with a clear message', () => {
    expect(() => parseParallelRoles('2.5')).toThrow(/--parallel-roles must be a whole number/);
    expect(() => parseParallelRoles('abc')).toThrow(/whole number/);
  });
  it('flag wins over QA_PARALLEL_ROLES', () => {
    const env = { QA_PARALLEL_ROLES: '3' } as NodeJS.ProcessEnv;
    expect(parseArgs(['https://x.test', '--parallel-roles', '5'], env).parallelRoles).toBe(5);
    expect(parseArgs(['https://x.test'], env).parallelRoles).toBe(3);
    expect(parseArgs(['https://x.test'], {} as NodeJS.ProcessEnv).parallelRoles).toBeUndefined();
  });
  it('names the env var when it is invalid', () => {
    expect(() => parseArgs(['https://x.test'], { QA_PARALLEL_ROLES: 'x' } as NodeJS.ProcessEnv)).toThrow(
      /QA_PARALLEL_ROLES/
    );
  });
});
