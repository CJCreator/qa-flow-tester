import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunnerError, SCHEDULES_OWNER_ONLY, listBenchmarks, listSchedules } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }));
}

describe('listSchedules', () => {
  it('returns the owner list', async () => {
    stubFetch(200, [{ id: 's1' }]);
    expect(await listSchedules()).toEqual([{ id: 's1' }]);
  });

  it.each([401, 403])('throws the owner-only error on %i', async (status) => {
    stubFetch(status, { error: 'no' });
    const err = await listSchedules().catch((e) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect(err.code).toBe('ERR_FORBIDDEN');
    expect(err.message).toBe(SCHEDULES_OWNER_ONLY);
  });

  it('throws a plain error on other failures, so the screen can show it', async () => {
    stubFetch(500, {});
    const err = await listSchedules().catch((e) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect(err.message).toBe('The scheduled check-ups couldn’t be read. Try again.');
    expect(err.code).not.toBe('ERR_FORBIDDEN');
  });
});

describe('listBenchmarks', () => {
  it('returns the list', async () => {
    stubFetch(200, []);
    expect(await listBenchmarks()).toEqual([]);
  });

  it('throws when the runner refuses', async () => {
    stubFetch(500, {});
    await expect(listBenchmarks()).rejects.toThrow('The comparisons couldn’t be read. Try again.');
  });
});
