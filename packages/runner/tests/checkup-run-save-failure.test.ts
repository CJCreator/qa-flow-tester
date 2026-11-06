/**
 * R7: a failed plan save is logged, not swallowed. Reached through the public stop() path that keeps the Plan
 * (stopRun saves the kept record). The logger is console.warn.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createCheckupRun } from '../src/session/checkup-run.js';
import { createCheckupSession } from '../src/session/checkup-session.js';
import type { StoredPlanRecord } from '../src/session/plan-store.js';

const scratch = path.join(process.cwd(), '.tmp-checkup-run-save-failure');
const runId = 'run-save-failure';

describe('R7: a plan save failure is logged', () => {
  beforeEach(async () => {
    await fs.mkdir(scratch, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('logs the failed save of a kept Plan on stop, and still resolves with planKept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = createCheckupSession({ outputDir: scratch, dataDir: scratch });
    const run = createCheckupRun(session);

    const record = {
      plan: { runId, targetUrl: 'https://a.example/' },
      context: {},
      status: 'awaiting-review',
    } as unknown as StoredPlanRecord;
    session.run.begin(runId, 'https://a.example/');
    session.run.setPhase('testing');
    session.run.setIsRunning(true);
    session.plan.set(record);

    const save = vi.spyOn(session.plan, 'save').mockRejectedValue(new Error('disk full at /secret/path'));

    const result = await run.stop();

    expect(save).toHaveBeenCalledWith(record);
    expect(result).toMatchObject({ aborted: true, planKept: true });
    expect(warn).toHaveBeenCalledWith('[Release check-up] Couldn’t save the plan:', expect.any(String));
    expect(session.run.phase).toBe('awaiting-review');
  });
});
