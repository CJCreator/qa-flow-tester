/**
 * T-435 (ADR 0050): the per-account daily limit and the saved Verified Domain proof live in the audit store.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AuditStoreBackend, NetDeps, RawResponse } from '@qa/core';
import { AccountUsage, accountHash, accountUsageKey } from '../src/account-usage.js';
import { AccountProofs, PROOF_VALID_DAYS, proofKey } from '../src/account-proofs.js';
import { testCopyFor } from '../src/host-policy.js';
import { claimBetaRun, resetBetaUsage, visitorHit } from '../src/beta.js';

function fakeBackend() {
  const data = new Map<string, unknown>();
  // getJson is generic on the real backend; the mock returns unknown, so it is typed to the backend's shape.
  const getJson = vi.fn(async (key: string) => (data.has(key) ? data.get(key) : null));
  const putJson = vi.fn(async (key: string, value: unknown) => {
    data.set(key, value);
  });
  return {
    data,
    getJson: getJson as typeof getJson & AuditStoreBackend['getJson'],
    putJson,
  };
}

const DAY = '2026-11-19';

describe('AccountUsage', () => {
  it('keys the count by day and the hashed email, never the email', () => {
    const key = accountUsageKey(DAY, ' Tester@Example.com ');
    expect(key).toBe(`usage/accounts/${DAY}/${accountHash('tester@example.com')}.json`);
    expect(key).not.toContain('tester');
    expect(key).toMatch(/^[A-Za-z0-9._\-/]+$/);
  });

  it('counts, saves each change and survives a restart', async () => {
    const backend = fakeBackend();
    const first = new AccountUsage(backend);
    await first.load(DAY, 'a@x.com');
    expect(first.count(DAY, 'a@x.com')).toBe(0);
    first.increment(DAY, 'a@x.com');
    first.increment(DAY, 'A@x.com');
    await first.flush();
    expect(backend.data.get(accountUsageKey(DAY, 'a@x.com'))).toEqual({ day: DAY, count: 2 });
    const restarted = new AccountUsage(backend);
    await restarted.load(DAY, 'a@x.com');
    expect(restarted.count(DAY, 'a@x.com')).toBe(2);
    await restarted.load(DAY, 'b@x.com');
    expect(restarted.count(DAY, 'b@x.com')).toBe(0);
  });

  it('starts from zero when the stored value is malformed or another day’s, or the store fails', async () => {
    const backend = fakeBackend();
    backend.data.set(accountUsageKey(DAY, 'a@x.com'), { day: '2026-01-01', count: 9 });
    backend.data.set(accountUsageKey(DAY, 'b@x.com'), { day: DAY, count: -1 });
    const usage = new AccountUsage(backend);
    await usage.load(DAY, 'a@x.com');
    await usage.load(DAY, 'b@x.com');
    expect(usage.count(DAY, 'a@x.com')).toBe(0);
    expect(usage.count(DAY, 'b@x.com')).toBe(0);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    backend.getJson.mockRejectedValueOnce(new Error('down'));
    await usage.load(DAY, 'c@x.com');
    expect(usage.count(DAY, 'c@x.com')).toBe(0);
  });

  it('drops cached counts of other days', async () => {
    const backend = fakeBackend();
    const usage = new AccountUsage(backend);
    await usage.load('2026-11-18', 'a@x.com');
    usage.increment('2026-11-18', 'a@x.com');
    usage.dropOtherDays(DAY);
    expect(usage.count('2026-11-18', 'a@x.com')).toBe(0);
  });
});

describe('claimBetaRun with an account', () => {
  it('ignoreVisitor still counts the day’s cap and never the session', () => {
    resetBetaUsage();
    const limits = { perVisitor: 1, perDay: 2 };
    expect(claimBetaRun('s1', { limits, ignoreVisitor: true })).toBeNull();
    expect(claimBetaRun('s1', { limits, ignoreVisitor: true })).toBeNull();
    expect(claimBetaRun('s1', { limits, ignoreVisitor: true })).toMatchObject({ scope: 'day' });
    resetBetaUsage();
  });

  it('visitorHit words the limit like the session one', () => {
    expect(visitorHit(5)).toMatchObject({ scope: 'visitor', limit: 5 });
  });
});

describe('AccountProofs', () => {
  it('saves {account, host, verifiedAt} under proofs/<hash>/<host>.json and reads it back', async () => {
    const backend = fakeBackend();
    const proofs = new AccountProofs(backend, () => Date.parse('2026-11-19T00:00:00Z'));
    expect(await proofs.valid('a@x.com', 'site.example.com')).toBe(false);
    await proofs.save('a@x.com', 'site.example.com');
    const key = proofKey('a@x.com', 'site.example.com');
    expect(key).toBe(`proofs/${accountHash('a@x.com')}/site.example.com.json`);
    expect(backend.data.get(key)).toEqual({
      account: accountHash('a@x.com'),
      host: 'site.example.com',
      verifiedAt: '2026-11-19T00:00:00.000Z',
    });
    expect(await proofs.valid('a@x.com', 'site.example.com')).toBe(true);
    // Another account, or another host, has no proof.
    expect(await proofs.valid('b@x.com', 'site.example.com')).toBe(false);
    expect(await proofs.valid('a@x.com', 'other.example.com')).toBe(false);
  });

  it('is valid for 30 days and then must be checked again', async () => {
    const backend = fakeBackend();
    let now = Date.parse('2026-11-19T00:00:00Z');
    const proofs = new AccountProofs(backend, () => now);
    await proofs.save('a@x.com', 'site.example.com');
    now += (PROOF_VALID_DAYS * 86_400 - 60) * 1000;
    expect(await proofs.valid('a@x.com', 'site.example.com')).toBe(true);
    now += 120 * 1000;
    expect(await proofs.valid('a@x.com', 'site.example.com')).toBe(false);
  });

  it('a store that fails means no proof, and a failed save does not throw', async () => {
    const backend = fakeBackend();
    backend.getJson.mockRejectedValue(new Error('down'));
    backend.putJson.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const proofs = new AccountProofs(backend);
    expect(await proofs.valid('a@x.com', 'h.example.com')).toBe(false);
    await expect(proofs.save('a@x.com', 'h.example.com')).resolves.toBeUndefined();
  });
});

describe('testCopyFor with a saved proof', () => {
  const file = (body: string): RawResponse => ({ status: 200, headers: {}, body });
  function deps(connects: string[], files: Record<string, RawResponse> = {}): NetDeps {
    return {
      lookup: async () => ['93.184.216.34'],
      connect: async (req) => {
        connects.push(req.url.toString());
        const r = files[req.url.toString()];
        if (!r) throw new Error('refused');
        return r;
      },
    };
  }
  const base = {
    beta: true,
    hostname: 'preview.example.com',
    origin: 'https://preview.example.com',
    marked: true,
    token: () => 'tok',
  };

  it('a valid saved proof stands in for the fetch', async () => {
    const connects: string[] = [];
    const ok = await testCopyFor({
      ...base,
      deps: deps(connects),
      saved: { valid: async () => true, save: async () => {} },
    });
    expect(ok).toBe(true);
    expect(connects).toEqual([]);
  });

  it('still needs the address to be public and marked', async () => {
    const privateDeps: NetDeps = { lookup: async () => ['10.0.0.5'], connect: async () => file('x') };
    expect(
      await testCopyFor({ ...base, deps: privateDeps, saved: { valid: async () => true, save: async () => {} } })
    ).toBe(false);
    expect(
      await testCopyFor({
        ...base,
        marked: false,
        deps: deps([]),
        saved: { valid: async () => true, save: async () => {} },
      })
    ).toBe(false);
  });

  it('a live proof that passes is saved; one that fails is not', async () => {
    const save = vi.fn(async () => {});
    const files = { 'https://preview.example.com/.well-known/qa-verify.txt': file('qa-verify=tok') };
    const passes = await testCopyFor({ ...base, deps: deps([], files), saved: { valid: async () => false, save } });
    expect(passes).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    const fails = await testCopyFor({ ...base, deps: deps([]), saved: { valid: async () => false, save } });
    expect(fails).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
