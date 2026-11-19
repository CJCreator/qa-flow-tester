import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeStatus } from '../src/api';
import { looksLikeWaking, wakeStateFor } from '../src/lib/wake';

describe('what looks like a runner that is waking up', () => {
  it('a 5xx always does', () => {
    expect(looksLikeWaking('server', 'localhost')).toBe(true);
    expect(looksLikeWaking('server', 'site.vercel.app')).toBe(true);
  });
  it('no answer in time does on the hosted copy, not on this computer', () => {
    expect(looksLikeWaking('slow', 'site.vercel.app')).toBe(true);
    expect(looksLikeWaking('slow', 'localhost')).toBe(false);
    expect(looksLikeWaking('slow', '127.0.0.1')).toBe(false);
  });
  it('a refusal or other answer does not', () => {
    expect(looksLikeWaking('other', 'site.vercel.app')).toBe(false);
    expect(looksLikeWaking('none', 'site.vercel.app')).toBe(false);
  });
});

describe('the wake state over time', () => {
  it('is none before any failure, waking until the limit, then failed', () => {
    expect(wakeStateFor(null, 1000, 90_000)).toBe('none');
    expect(wakeStateFor(1000, 1000 + 89_999, 90_000)).toBe('waking');
    expect(wakeStateFor(1000, 1000 + 90_000, 90_000)).toBe('failed');
  });
});

describe('probeStatus says why there was no answer', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown = {}) =>
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }));

  it('502, 503 and 504 are server failures', async () => {
    for (const status of [502, 503, 504]) {
      reply(status);
      expect(await probeStatus()).toEqual({ status: null, failure: 'server' });
    }
  });
  it('a request that fails is slow', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('timeout');
    });
    expect(await probeStatus()).toEqual({ status: null, failure: 'slow' });
  });
  it('401 is not waking', async () => {
    reply(401);
    expect(await probeStatus()).toEqual({ status: null, failure: 'other' });
  });
  it('an answer is returned as it is', async () => {
    reply(200, { phase: 'idle' });
    expect(await probeStatus()).toMatchObject({ status: { phase: 'idle' }, failure: 'none' });
  });
});
