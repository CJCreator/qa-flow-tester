import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { RunStartBody } from '@qa/types';
import { createCheckupRun, type RunAuthorization } from '../src/session/checkup-run.js';
import { createCheckupSession } from '../src/session/checkup-session.js';

const scratch = path.join(process.cwd(), '.tmp-checkup-run-invalid-inputs');

const body = { targetUrl: 'https://a.example/', useAI: true } as unknown as RunStartBody;
const authorization: RunAuthorization = {
  readOnly: true,
  readOnlyReason: '',
  testCopy: false,
  owner: false,
  signInConsent: false,
};

describe('T-360: Invalid run inputs are refused for every caller, not dropped', () => {
  let releasePrep: () => void;
  let prepGate: Promise<void>;

  beforeEach(async () => {
    await fs.mkdir(scratch, { recursive: true });
    prepGate = new Promise<void>((resolve) => (releasePrep = resolve));
  });

  afterEach(async () => {
    releasePrep();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  function makeRun() {
    const session = createCheckupSession({ outputDir: scratch, dataDir: scratch });
    const run = createCheckupRun(session, {
      siteDir: () => scratch,
      prepareAI: async () => {
        await prepGate;
        return {};
      },
    });
    return { session, run };
  }

  it('aiCap: { dollars: -1 } makes start() reject with status 400 and code; session is not running and no run folder was made', async () => {
    const { session, run } = makeRun();
    const badCapBody = { ...body, aiCap: { dollars: -1 } as unknown } as RunStartBody;

    await expect(run.start({ body: badCapBody, authorization })).rejects.toMatchObject({
      status: 400,
      code: 'ERR_INVALID_CAP',
    });

    expect(session.run.isRunning).toBe(false);
    const files = await fs.readdir(scratch);
    expect(files.filter((f) => f.startsWith('run-'))).toHaveLength(0);
  });

  it('a bad customHeaders rejects with status 400, and refusal text does not repeat the header value', async () => {
    const { session, run } = makeRun();
    const secretValue = 'secret-bypass-token-12345';
    const badHeadersBody = {
      ...body,
      customHeaders: { 'Bad Header': secretValue },
    } as unknown as RunStartBody;

    let caughtError: unknown;
    try {
      await run.start({ body: badHeadersBody, authorization });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).toMatchObject({
      status: 400,
      code: 'ERR_INVALID_HEADERS',
    });
    const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
    expect(message).not.toContain(secretValue);
    expect(session.run.isRunning).toBe(false);
    const files = await fs.readdir(scratch);
    expect(files.filter((f) => f.startsWith('run-'))).toHaveLength(0);
  });

  it('a bad savedSessions value rejects with status 400 and code ERR_INVALID_SESSION', async () => {
    const { session, run } = makeRun();
    const badSessionsBody = {
      ...body,
      savedSessions: { user: { cookies: 'invalid-not-array', origins: [] } } as unknown,
    } as RunStartBody;

    await expect(run.start({ body: badSessionsBody, authorization })).rejects.toMatchObject({
      status: 400,
      code: 'ERR_INVALID_SESSION',
    });

    expect(session.run.isRunning).toBe(false);
    const files = await fs.readdir(scratch);
    expect(files.filter((f) => f.startsWith('run-'))).toHaveLength(0);
  });

  it('a bad contextDocuments or contextUrl rejects with status 400', async () => {
    const { session, run } = makeRun();
    const badDocsBody = {
      ...body,
      contextDocuments: [{ name: '', text: 'text' }] as unknown,
    } as RunStartBody;

    await expect(run.start({ body: badDocsBody, authorization })).rejects.toMatchObject({
      status: 400,
      code: 'ERR_INVALID_CONTEXT',
    });

    const badUrlBody = {
      ...body,
      contextUrl: 'ftp://invalid-scheme.example.com',
    } as RunStartBody;

    await expect(run.start({ body: badUrlBody, authorization })).rejects.toMatchObject({
      status: 400,
      code: 'ERR_INVALID_CONTEXT_URL',
    });

    expect(session.run.isRunning).toBe(false);
  });

  it('a valid body still starts and sets isRunning to true', async () => {
    const { session, run } = makeRun();
    const result = await run.start({ body, authorization });

    expect(result.runId).toMatch(/^run-/);
    expect(session.run.isRunning).toBe(true);

    releasePrep();
    await run.stop();
  });

  it('a refused start does not leave starting set: a second, valid start() right after succeeds', async () => {
    const { session, run } = makeRun();
    const badCapBody = { ...body, aiCap: { dollars: -1 } as unknown } as RunStartBody;

    await expect(run.start({ body: badCapBody, authorization })).rejects.toMatchObject({
      status: 400,
      code: 'ERR_INVALID_CAP',
    });
    expect(session.run.isRunning).toBe(false);

    const started = await run.start({ body, authorization });
    expect(started.runId).toMatch(/^run-/);
    expect(session.run.isRunning).toBe(true);

    releasePrep();
    await run.stop();
  });
});
