/**
 * R2: a stop waits for the aborted run to tear down before it frees the slot. A second start is refused until then,
 * and stop() resolves only after teardown (or after the 6 second cap, which then frees the slot).
 * The run is held inside an injected prepareAI, so no browser is launched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { RunStartBody } from '@qa/types';
import { createCheckupRun, type RunAuthorization } from '../src/session/checkup-run.js';
import { createCheckupSession } from '../src/session/checkup-session.js';

const scratch = path.join(process.cwd(), '.tmp-checkup-run-teardown');

const body = { targetUrl: 'https://a.example/', useAI: true } as unknown as RunStartBody;
const authorization: RunAuthorization = {
  readOnly: true,
  readOnlyReason: '',
  testCopy: false,
  owner: false,
  signInConsent: false,
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('R2: stop waits for teardown before the slot is freed', () => {
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

  function makeRun(forceClose?: () => Promise<void>) {
    const session = createCheckupSession({ outputDir: scratch, dataDir: scratch });
    const run = createCheckupRun(session, {
      registerForceClose: (set) => {
        if (forceClose) set(forceClose);
      },
      siteDir: () => scratch,
      // The run parks here until the test releases it: it stands in for the run still tearing down.
      prepareAI: async () => {
        await prepGate;
        return {};
      },
    });
    return { session, run };
  }

  it('refuses a second start while the stopped run is tearing down, and stop() resolves only after teardown', async () => {
    const { session, run } = makeRun();
    await run.start({ body, authorization });
    expect(session.run.isRunning).toBe(true);

    let stopped = false;
    const stopping = run.stop().then((result) => {
      stopped = true;
      return result;
    });
    await tick();

    expect(stopped).toBe(false);
    expect(session.run.isRunning).toBe(true);
    await expect(run.start({ body, authorization })).rejects.toMatchObject({
      code: 'ERR_RUN_IN_PROGRESS',
      status: 409,
    });

    releasePrep();
    const result = await stopping;
    expect(stopped).toBe(true);
    expect(result).toEqual({ aborted: true, planKept: false, finishing: false });
    expect(session.run.isRunning).toBe(false);
    expect(session.run.phase).toBe('idle');
  });

  it('frees the slot after the 6 second cap when the run never finishes tearing down', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forceClose = vi.fn(async () => {});
    const { session, run } = makeRun(forceClose);
    await run.start({ body, authorization });

    let stopped = false;
    const stopping = run.stop().then((result) => {
      stopped = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(stopped).toBe(false);
    expect(forceClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(forceClose).toHaveBeenCalledTimes(1);

    await expect(stopping).resolves.toMatchObject({ aborted: true });
    expect(session.run.isRunning).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not finish tearing down in time'));
  });

  it('saves the waiting Plan before teardown wait ends when stopping a run in the testing phase', async () => {
    const { session, run } = makeRun();
    await run.start({ body, authorization });
    const runId = session.run.runId!;

    session.run.setPhase('testing');
    const fakeRecord = {
      plan: { runId, targetUrl: 'https://a.example/', items: [] },
      context: { runId, targetUrl: 'https://a.example/', productId: 'test', draft: {} as any },
    } as any;
    session.plan.set(fakeRecord);

    const saveSpy = vi.spyOn(session.plan, 'save');

    let stopped = false;
    const stopping = run.stop().then((result) => {
      stopped = true;
      return result;
    });
    await tick();

    // The run is still held (tearing down), but the waiting Plan was already saved.
    expect(stopped).toBe(false);
    expect(session.run.isRunning).toBe(true);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(fakeRecord);

    releasePrep();
    const result = await stopping;
    expect(stopped).toBe(true);
    expect(result).toEqual({ aborted: true, planKept: true, finishing: false });
    expect(session.run.phase).toBe('awaiting-review');
  });

  it('a stop after a Check-up ended is not an abort', async () => {
    const { session, run } = makeRun();
    session.run.setPhase('failed');
    session.report.setError('Site unreachable', 'ERR_UNREACHABLE');

    const result = await run.stop();
    expect(result).toEqual({ aborted: false });
    expect(session.report.error()).toEqual({ message: 'Site unreachable', code: 'ERR_UNREACHABLE' });
  });
});
