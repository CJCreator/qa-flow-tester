import { afterEach, describe, it, expect, vi } from 'vitest';
import { DEFAULT_WAKE_LIMIT_MS, startAddress, wakeAddress, wakeLimitMs } from '../src/lib/online';

describe('where "Start a free check-up" leads', () => {
  it('stays on this site when no online copy is published', () => {
    expect(startAddress(null, 'https://app.example.com')).toBe('/check');
  });
  it('stays on this site when this page is the online copy', () => {
    expect(startAddress('https://qa.run.app', 'https://qa.run.app')).toBe('/check');
  });
  it('goes to the online copy from the static site', () => {
    expect(startAddress('https://qa.run.app', 'https://site.run.app')).toBe('https://qa.run.app/check');
    expect(startAddress('https://qa.run.app/', 'https://site.run.app')).toBe('https://qa.run.app/check');
  });
  it('falls back to this site when the published address cannot be read', () => {
    expect(startAddress('not a url', 'https://site.run.app')).toBe('/check');
  });
});

describe('waking the online copy', () => {
  it('pings its root from the static site, so the container wakes', () => {
    expect(wakeAddress('https://qa.run.app', 'https://site.run.app')).toBe('https://qa.run.app/');
  });
  it('has nothing to wake on its own origin, or with no online copy', () => {
    expect(wakeAddress('https://qa.run.app', 'https://qa.run.app')).toBeNull();
    expect(wakeAddress(null, 'https://site.run.app')).toBeNull();
    expect(wakeAddress('nope', 'https://site.run.app')).toBeNull();
  });
});

describe('how long to wait for the online copy to wake', () => {
  it('wake limit defaults to 90 s', () => {
    expect(DEFAULT_WAKE_LIMIT_MS).toBe(90_000);
    expect(wakeLimitMs(undefined)).toBe(90_000);
  });
  it('reads seconds from config', () => {
    expect(wakeLimitMs('45')).toBe(45_000);
    expect(wakeLimitMs(' 120 ')).toBe(120_000);
  });
  it('falls back to 90 s for empty, zero, negative, NaN, text', () => {
    for (const raw of ['', '  ', '0', '-5', 'NaN', 'soon', 'Infinity']) {
      expect(wakeLimitMs(raw)).toBe(90_000);
    }
  });
  it('clamps to 5 s..600 s', () => {
    expect(wakeLimitMs('1')).toBe(5_000);
    expect(wakeLimitMs('9999')).toBe(600_000);
  });
});

describe('what the wizard says when the runner answers badly', () => {
  const reply = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }));
  afterEach(() => vi.unstubAllGlobals());

  it('says access was refused only for 401 and 403', async () => {
    const { checkReachable } = await import('../src/api');
    for (const status of [401, 403]) {
      reply(status, { reachable: false, error: 'Nope' });
      expect(await checkReachable('http://x.test')).toMatchObject({ ok: false, code: 'ERR_RUNNER_REFUSED' });
    }
  });

  it('reports a 500 as what failed, never as a refusal', async () => {
    const { checkReachable } = await import('../src/api');
    reply(500, { error: 'Preflight crashed' });
    const result = await checkReachable('http://x.test');
    expect(result).toMatchObject({ ok: false, reason: 'Preflight crashed', statusCode: 500 });
    expect(result.ok === false && result.code).not.toBe('ERR_RUNNER_REFUSED');
    reply(500, {});
    const bare = await checkReachable('http://x.test');
    expect(bare.ok === false && bare.reason).not.toMatch(/refused/i);
  });

  it('a failed stop says so', async () => {
    const { abortRun } = await import('../src/api');
    reply(500, {});
    expect(await abortRun()).toMatchObject({ aborted: false, error: expect.stringContaining('couldn’t stop') });
    vi.stubGlobal('fetch', async () => {
      throw new Error('down');
    });
    expect(await abortRun(true)).toMatchObject({ aborted: false, error: expect.any(String) });
  });
});
