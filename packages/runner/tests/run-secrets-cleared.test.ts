/**
 * T-296: a run that ended (failed or stopped) leaves no custom headers or tunnel sign-in in the session.
 * The run is held inside an injected prepareAI, so no browser is launched. Only obvious fake secrets here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { RunStartBody } from '@qa/types';
import { createCheckupRun, type RunAuthorization } from '../src/session/checkup-run.js';
import { createCheckupSession } from '../src/session/checkup-session.js';

const scratch = path.join(process.cwd(), '.tmp-run-secrets-cleared');

const makeBody = () =>
  ({
    targetUrl: 'https://a.example/',
    useAI: true,
    customHeaders: { 'X-Bypass': 'secret-value' },
    tunnelAuth: 'user:pass',
  }) as unknown as RunStartBody;
const authorization: RunAuthorization = {
  readOnly: true,
  readOnlyReason: '',
  testCopy: false,
  owner: false,
  signInConsent: false,
};

describe('T-296: run secrets are cleared when a run ends', () => {
  let releasePrep: () => void;
  let prepGate: Promise<void>;

  beforeEach(async () => {
    await fs.mkdir(scratch, { recursive: true });
    prepGate = new Promise<void>((resolve) => (releasePrep = resolve));
  });

  afterEach(async () => {
    releasePrep();
    vi.restoreAllMocks();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  function makeRun(prepareAI: () => Promise<Record<string, never>>) {
    const session = createCheckupSession({ outputDir: scratch, dataDir: scratch });
    const run = createCheckupRun(session, { siteDir: () => scratch, prepareAI });
    return { session, run };
  }

  it('keeps the values while the run needs them', async () => {
    const { session, run } = makeRun(async () => {
      await prepGate;
      return {};
    });
    await run.start({ body: makeBody(), authorization });
    expect(session.secrets.headers).toEqual({ 'X-Bypass': 'secret-value' });
    expect(session.secrets.tunnelAuth).toBe('user:pass');
    releasePrep();
    await run.stop();
  });

  it('clears them when the run fails', async () => {
    const { session, run } = makeRun(async () => {
      throw new Error('boom');
    });
    await run.start({ body: makeBody(), authorization });
    await run.waitFor(5000);
    expect(session.run.phase).toBe('failed');
    expect(session.secrets.headers).toBeUndefined();
    expect(session.secrets.tunnelAuth).toBeUndefined();
  });

  it('clears them when the run is stopped', async () => {
    const { session, run } = makeRun(async () => {
      await prepGate;
      return {};
    });
    await run.start({ body: makeBody(), authorization });
    const stopping = run.stop();
    releasePrep();
    await stopping;
    expect(session.secrets.headers).toBeUndefined();
    expect(session.secrets.tunnelAuth).toBeUndefined();
  });
});
