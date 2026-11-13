import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'path';
import { promises as fs } from 'fs';
import { LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import { UsageLedger, USAGE_KEY, type StoredUsage } from '../src/usage-ledger.js';
import { AuditDailyLimiter, ownerKey } from '../src/helpers/audit-limit.js';
import { claimBetaRun, resetBetaUsage, restoreBetaDayUsage } from '../src/beta.js';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** A fake backend: a Map behind getJson/putJson. */
function fakeBackend() {
  const data = new Map<string, unknown>();
  return {
    data,
    getJson: vi.fn(async (key: string) => (data.has(key) ? data.get(key) : null)),
    putJson: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
  };
}

const sample = (day: string): StoredUsage => ({ day, copyStarts: 3, auditStarts: { [ownerKey('a@x.com')]: 1 } });

afterEach(() => {
  vi.restoreAllMocks();
  resetBetaUsage();
});

describe('UsageLedger', () => {
  it('save then load gives the same object; another day loads as null', async () => {
    const backend = fakeBackend();
    const ledger = new UsageLedger(backend as unknown as ConstructorParameters<typeof UsageLedger>[0]);
    await ledger.save(sample(today));
    await ledger.flush();
    expect(await ledger.load(today)).toEqual(sample(today));
    expect(await ledger.load(yesterday)).toBeNull();
    expect(backend.data.get(USAGE_KEY)).toEqual(sample(today));
  });

  it('a stored value with a negative or non-number count loads as null', async () => {
    const backend = fakeBackend();
    const ledger = new UsageLedger(backend as unknown as ConstructorParameters<typeof UsageLedger>[0]);
    backend.data.set(USAGE_KEY, { day: today, copyStarts: -1, auditStarts: {} });
    expect(await ledger.load(today)).toBeNull();
    backend.data.set(USAGE_KEY, { day: today, copyStarts: 'x', auditStarts: {} });
    expect(await ledger.load(today)).toBeNull();
  });

  it('a read that throws gives null and logs a line without the thrown message', async () => {
    const backend = fakeBackend();
    backend.getJson.mockRejectedValue(new Error('bucket secret-name-xyz denied'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ledger = new UsageLedger(backend as unknown as ConstructorParameters<typeof UsageLedger>[0]);
    expect(await ledger.load(today)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain('secret-name-xyz');
  });

  it('a write that rejects resolves: save and flush do not throw', async () => {
    const backend = fakeBackend();
    backend.putJson.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ledger = new UsageLedger(backend as unknown as ConstructorParameters<typeof UsageLedger>[0]);
    await expect(ledger.save(sample(today))).resolves.toBeUndefined();
    await expect(ledger.flush()).resolves.toBeUndefined();
  });
});

describe('AuditDailyLimiter counts survive a restore', () => {
  it('a restored count refuses the owner, under any casing of the email', () => {
    const now = Date.parse(`${today}T12:00:00.000Z`);
    const limiter = new AuditDailyLimiter({ limit: 2, now: () => now });
    limiter.restore(today, { [ownerKey('a@x.com')]: 2 });
    expect(limiter.claim(' A@X.com ').allowed).toBe(false);
    expect(limiter.snapshot(today)).toEqual({ [ownerKey('a@x.com')]: 2 });
  });

  it('a restore with a lower count does not lower a higher count in memory', () => {
    const now = Date.parse(`${today}T12:00:00.000Z`);
    const limiter = new AuditDailyLimiter({ limit: 5, now: () => now });
    limiter.claim('a@x.com');
    limiter.claim('a@x.com');
    limiter.restore(today, { [ownerKey('a@x.com')]: 1 });
    expect(limiter.snapshot(today)).toEqual({ [ownerKey('a@x.com')]: 2 });
  });
});

describe('the copy-wide day count survives a restore', () => {
  const limits = { perVisitor: 5, perDay: 40 };

  it('a restored count of 40 refuses the next start with scope day', () => {
    restoreBetaDayUsage({ day: today, count: 40 });
    const hit = claimBetaRun(undefined, { limits });
    expect(hit?.scope).toBe('day');
  });

  it('a stored count for yesterday changes nothing', () => {
    restoreBetaDayUsage({ day: yesterday, count: 40 });
    expect(claimBetaRun(undefined, { limits })).toBeNull();
  });
});

describe('the runner loads and saves the counts through the audit store', () => {
  const scratch = path.join(process.cwd(), '.tmp-usage-ledger');
  const servers: RunnerServer[] = [];

  afterEach(async () => {
    for (const s of servers.splice(0)) await s.stop();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function startWithStored(perDay: number, copyStarts: number) {
    const dataDir = path.join(scratch, `data-${perDay}-${copyStarts}`);
    await new LocalAuditStoreBackend(dataDir).putJson(USAGE_KEY, { day: today, copyStarts, auditStarts: {} });
    resetBetaUsage();
    const port = await freePort();
    const server = new RunnerServer({
      port,
      outputDir: path.join(scratch, 'report'),
      dataDir,
      beta: true,
      betaLimits: { perVisitor: 5, perDay },
    });
    servers.push(server);
    await server.start();
    return { server, dataDir };
  }

  const betaLimitHit = (server: RunnerServer, res: unknown): boolean =>
    (server as unknown as { betaLimitHit(res: unknown): boolean }).betaLimitHit(res);

  it('a stored day count at the cap answers 429 after a restart', async () => {
    const { server } = await startWithStored(3, 3);
    const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn(), getHeader: vi.fn(), hasHeader: vi.fn() };
    expect(betaLimitHit(server, res)).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(429, expect.anything());
  });

  it('a counted start is written: the stored copyStarts becomes 4', async () => {
    const { server, dataDir } = await startWithStored(4, 3);
    const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn(), getHeader: vi.fn(), hasHeader: vi.fn() };
    expect(betaLimitHit(server, res)).toBe(false);
    await (server as unknown as { usageLedger: UsageLedger }).usageLedger.flush();
    const stored = (await new LocalAuditStoreBackend(dataDir).getJson(USAGE_KEY)) as StoredUsage;
    expect(stored.copyStarts).toBe(4);
  });
});
