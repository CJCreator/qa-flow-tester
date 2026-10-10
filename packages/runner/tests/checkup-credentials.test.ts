import { describe, it, expect } from 'vitest';
import type { ReleaseReport } from '@qa/types';
import { parseArgs, buildRunBody, scrub, summaryMarkdown } from '../src/checkup.js';

const base = { QA_TARGET_URL: 'https://x.test' } as NodeJS.ProcessEnv;
const PW = 'S3cret-pw-9';
const USER = 'tester@x.test';

describe('checkup test sign-in via env', () => {
  it('parseArgs reads QA_USERNAME, QA_PASSWORD, QA_LOGIN_PATH', () => {
    const a = parseArgs([], { ...base, QA_USERNAME: USER, QA_PASSWORD: PW, QA_LOGIN_PATH: '/login' });
    expect(a.signIn).toEqual({ username: USER, password: PW, loginPath: '/login' });
  });

  it('needs both variables', () => {
    expect(parseArgs([], { ...base, QA_USERNAME: USER }).signIn).toBeUndefined();
    expect(parseArgs([], { ...base, QA_PASSWORD: PW }).signIn).toBeUndefined();
  });

  it('has no command-line flag for the password', () => {
    const a = parseArgs(['--password', PW, '--username', USER], base);
    expect(a.signIn).toBeUndefined();
  });

  it('body carries roles, consent, owner, skipReview only with both variables', () => {
    const on = buildRunBody(parseArgs([], { ...base, QA_USERNAME: USER, QA_PASSWORD: PW }));
    expect(on.roles).toEqual([expect.objectContaining({ username: USER, password: PW })]);
    expect(on).toMatchObject({ signInConsent: true, owner: true, skipReview: true });
    expect(on).not.toHaveProperty('saveStorageStatePath');
    const off = buildRunBody(parseArgs([], base));
    expect(off).not.toHaveProperty('roles');
    expect(off).not.toHaveProperty('signInConsent');
    expect(off.owner).toBe(false);
  });

  it('scrub hides the password and username; summary never holds them', () => {
    const args = parseArgs([], { ...base, QA_USERNAME: USER, QA_PASSWORD: PW });
    expect(scrub(`failed for ${USER} with ${PW}`, args.signIn)).not.toMatch(/S3cret|tester@/);
    const report = {
      findings: [],
      targetUrl: 'https://x.test',
      coverage: { totalTestPoints: 1, passed: 1, failed: 0 },
    } as unknown as ReleaseReport;
    const md = summaryMarkdown(report, args);
    expect(md).not.toContain(PW);
    expect(md).not.toContain(USER);
  });
});
