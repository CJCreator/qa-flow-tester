import { describe, it, expect } from 'vitest';
import { parseArgs, buildRunBody } from '../src/checkup.js';

describe('T-54 checkup QA_RECORD_VIDEO option', () => {
  const base = {} as NodeJS.ProcessEnv;

  it('is absent by default outside CI, so the run keeps its own default', () => {
    expect(parseArgs(['https://app.test'], base).recordVideo).toBeUndefined();
    expect(buildRunBody(parseArgs(['https://app.test'], base)).recordVideo).toBeUndefined();
  });

  it('is off on GitHub Actions unless QA_RECORD_VIDEO says otherwise', () => {
    const ci = { GITHUB_ACTIONS: 'true' } as NodeJS.ProcessEnv;
    expect(parseArgs(['https://app.test'], ci).recordVideo).toBe(false);
    expect(parseArgs(['https://app.test'], { CI: 'true' } as NodeJS.ProcessEnv).recordVideo).toBe(false);
    expect(parseArgs(['https://app.test'], { ...ci, QA_RECORD_VIDEO: 'true' }).recordVideo).toBe(true);
  });

  it('reads QA_RECORD_VIDEO true or false, case-insensitively', () => {
    expect(parseArgs(['https://app.test'], { QA_RECORD_VIDEO: 'TRUE' } as NodeJS.ProcessEnv).recordVideo).toBe(true);
    expect(parseArgs(['https://app.test'], { QA_RECORD_VIDEO: 'false' } as NodeJS.ProcessEnv).recordVideo).toBe(false);
    expect(parseArgs(['https://app.test'], { QA_RECORD_VIDEO: 'maybe' } as NodeJS.ProcessEnv).recordVideo).toBeUndefined();
  });

  it('carries the choice into the run body only when it is set', () => {
    const off = buildRunBody(parseArgs(['https://app.test'], { QA_RECORD_VIDEO: 'false' } as NodeJS.ProcessEnv));
    expect(off.recordVideo).toBe(false);
    const on = buildRunBody(parseArgs(['https://app.test'], { QA_RECORD_VIDEO: 'true' } as NodeJS.ProcessEnv));
    expect(on.recordVideo).toBe(true);
    expect('recordVideo' in buildRunBody(parseArgs(['https://app.test'], base))).toBe(false);
  });
});
