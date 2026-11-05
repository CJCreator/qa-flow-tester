/**
 * PERF-2: a plan link is requested once per run; later checks reuse the first outcome (failure included).
 * Unit tier: fake FetchFn; no network.
 */
import { describe, it, expect, vi } from 'vitest';
import type { FetchFn } from '@qa/checkers';
import { createRunLinkChecker } from '../src/checker-fetch.js';

function statusFetch(status: number) {
  return vi.fn<FetchFn>(async () => ({ status }) as unknown as Awaited<ReturnType<FetchFn>>);
}

describe('createRunLinkChecker (PERF-2)', () => {
  it('requests each address once per run and reuses a pass', async () => {
    const fetchFn = statusFetch(200);
    const check = createRunLinkChecker(fetchFn);
    await check('https://site.test/a');
    await check('https://site.test/a');
    await check('https://site.test/b');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reuses a broken outcome without a second request', async () => {
    const fetchFn = statusFetch(404);
    const check = createRunLinkChecker(fetchFn);
    await expect(check('https://site.test/gone')).rejects.toThrow('answered 404');
    await expect(check('https://site.test/gone')).rejects.toThrow('answered 404');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a new run (new checker) requests again', async () => {
    const fetchFn = statusFetch(200);
    await createRunLinkChecker(fetchFn)('https://site.test/a');
    await createRunLinkChecker(fetchFn)('https://site.test/a');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
