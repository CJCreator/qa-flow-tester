/**
 * M4: a waiting Plan kept aside for more than 7 days is dropped (file and memory) when the waiting list is read
 * or the plan is taken back. A recent one stays.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { DiscoveryDraft, ReviewPlan } from '@qa/types';
import { createCheckupSession, type CheckupSession, type StoredPlanRecord } from '../src/session/checkup-session.js';
import { WAITING_PLAN_TTL_MS } from '../src/session/plan-store.js';

const scratch = path.join(process.cwd(), '.tmp-plan-expiry');
const DAY = 24 * 3_600_000;

function record(targetUrl: string, runId: string): StoredPlanRecord {
  return {
    plan: { targetUrl, runId, pages: [] } as unknown as ReviewPlan,
    context: { targetUrl, productId: 'p', runId, draft: {} as DiscoveryDraft },
  };
}

describe('waiting Plans expire after 7 days (M4)', () => {
  let session: CheckupSession;

  beforeEach(async () => {
    await fs.mkdir(scratch, { recursive: true });
    session = createCheckupSession({
      outputDir: path.join(scratch, 'out'),
      dataDir: path.join(scratch, 'data'),
      authDir: path.join(scratch, 'auth'),
    });
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('the TTL is seven days', () => {
    expect(WAITING_PLAN_TTL_MS).toBe(7 * DAY);
  });

  it('a plan kept aside for over 7 days is dropped from the list and its file is deleted', async () => {
    await session.plan.park(record('http://old.example.com', 'run-old'));
    const file = session.plan.parkedFileFor('old.example.com');
    const when = new Date(Date.now() - 8 * DAY);
    await fs.utimes(file, when, when);

    expect(await session.plan.waiting()).toEqual([]);
    await expect(fs.stat(file)).rejects.toThrow();
    expect(session.plan.parked.has('old.example.com')).toBe(false);
  });

  it('a recent waiting plan stays listed', async () => {
    await session.plan.park(record('http://new.example.com', 'run-new'));
    const waiting = await session.plan.waiting();
    expect(waiting.map((w) => w.host)).toEqual(['new.example.com']);
  });

  it('an expired plan is not taken back by unpark', async () => {
    await session.plan.park(record('http://old.example.com', 'run-old'));
    const file = session.plan.parkedFileFor('old.example.com');
    const when = new Date(Date.now() - 8 * DAY);
    await fs.utimes(file, when, when);

    expect(await session.plan.unpark('old.example.com')).toBeNull();
    await expect(fs.stat(file)).rejects.toThrow();
  });
});
