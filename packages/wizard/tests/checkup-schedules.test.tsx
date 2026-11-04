import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunnerError, SCHEDULES_OWNER_ONLY, listSchedules } from '../src/api';

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

  it('keeps returning [] on other failures', async () => {
    stubFetch(500, {});
    expect(await listSchedules()).toEqual([]);
  });
});
