import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DefaultPlanStore, waitingPlanMaxAgeMs, DEFAULT_WAITING_PLAN_DAYS } from '../src/session/plan-store.js';
import type { RunSecrets } from '../src/session/run-secrets.js';

const DAY = 86_400_000;

describe('T-50 waiting plans expire', () => {
  let dir: string;
  let store: DefaultPlanStore;
  const secrets = { savedSessions: new Map(), headers: undefined, tunnelAuth: undefined, clean: async () => {} };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-waiting-'));
    store = new DefaultPlanStore(dir, secrets as unknown as RunSecrets);
    await fs.mkdir(path.join(dir, 'waiting-plans'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function parkedFile(name: string, ageDays: number): Promise<string> {
    const file = path.join(dir, 'waiting-plans', name);
    await fs.writeFile(file, '{"schemaVersion":1,"plan":{},"context":{}}');
    const when = new Date(Date.now() - ageDays * DAY);
    await fs.utimes(file, when, when);
    return file;
  }

  it('removes waiting plans older than the limit and lists them as expired', async () => {
    const old = await parkedFile('old.example.com.json', 31);
    const fresh = await parkedFile('new.example.com.json', 2);

    const expired = await store.expireWaiting(30 * DAY);

    expect(expired).toEqual(['old.example.com.json']);
    await expect(fs.access(old)).rejects.toThrow();
    await expect(fs.access(fresh)).resolves.toBeUndefined();
  });

  it('keeps a waiting plan written just now', async () => {
    const file = path.join(dir, 'waiting-plans', 'now.example.com.json');
    await fs.writeFile(file, '{"schemaVersion":1,"plan":{},"context":{}}');
    expect(await store.expireWaiting(DAY)).toEqual([]);
    await expect(fs.access(file)).resolves.toBeUndefined();
  });

  it('a missing waiting-plans folder expires nothing', async () => {
    await fs.rm(path.join(dir, 'waiting-plans'), { recursive: true, force: true });
    expect(await store.expireWaiting(DAY)).toEqual([]);
  });

  it('the default limit is 30 days and RUNNER_WAITING_PLAN_DAYS overrides it', () => {
    expect(DEFAULT_WAITING_PLAN_DAYS).toBe(30);
    expect(waitingPlanMaxAgeMs({})).toBe(30 * DAY);
    expect(waitingPlanMaxAgeMs({ RUNNER_WAITING_PLAN_DAYS: '7' })).toBe(7 * DAY);
    expect(waitingPlanMaxAgeMs({ RUNNER_WAITING_PLAN_DAYS: '0' })).toBe(30 * DAY);
    expect(waitingPlanMaxAgeMs({ RUNNER_WAITING_PLAN_DAYS: 'soon' })).toBe(30 * DAY);
  });
});
