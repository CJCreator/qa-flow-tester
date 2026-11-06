import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlan, patchPlan, PLAN_STALE_TEXT, RunnerError } from '../src/api';

/** Answers GET /api/runner/plan with a plan, and PATCH with `patchStatus`; records the PATCH bodies. */
function stubPlan(planGeneration: number | undefined, patchStatus = 200, patchReply: unknown = { answers: {} }) {
  const patches: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ planPages: [], flows: [], planGeneration }), { status: 200 });
      }
      patches.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(patchReply), { status: patchStatus });
    })
  );
  return patches;
}

afterEach(() => vi.unstubAllGlobals());

describe('plan generation on save', () => {
  it('sends the planGeneration it loaded on each plan PATCH', async () => {
    const patches = stubPlan(4);
    await getPlan();
    await patchPlan({ answers: { q1: 'yes' } });
    expect(patches[0]).toEqual({ answers: { q1: 'yes' }, generation: 4 });
  });

  it('sends no generation when the runner did not return one', async () => {
    const patches = stubPlan(undefined);
    await getPlan();
    await patchPlan({ answers: { q1: 'yes' } });
    expect(patches[0]).not.toHaveProperty('generation');
  });

  it('keeps a generation the caller set', async () => {
    const patches = stubPlan(4);
    await getPlan();
    await patchPlan({ answers: {}, generation: 2 });
    expect(patches[0]).toMatchObject({ generation: 2 });
  });

  it('on 409 ERR_PLAN_STALE shows the friendly text and does not return a plan', async () => {
    stubPlan(5, 409, { error: 'The plan changed after you loaded it. Reload it and try again.', code: 'ERR_PLAN_STALE' });
    await getPlan();
    const failed = await patchPlan({ answers: {} }).then(
      () => null,
      (err: unknown) => err
    );
    expect(failed).toBeInstanceOf(RunnerError);
    expect((failed as RunnerError).code).toBe('ERR_PLAN_STALE');
    expect((failed as RunnerError).message).toBe(PLAN_STALE_TEXT);
    expect(PLAN_STALE_TEXT).not.toMatch(/ERR_|409|generation/);
  });
});
