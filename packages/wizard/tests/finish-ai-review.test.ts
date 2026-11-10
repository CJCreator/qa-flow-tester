import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishAiReview } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('finishAiReview', () => {
  it('sends the id of the Check-up on screen', async () => {
    const fetchMock = stubFetch(200, { completed: true, reviewedCount: 2, remainingCount: 0, addedFindingsCount: 0 });
    await finishAiReview('run-abc');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({ runId: 'run-abc' });
  });

  it('shows the runner’s reason on a refusal', async () => {
    stubFetch(409, { error: 'Every screen was already looked over.' });
    await expect(finishAiReview('run-abc')).rejects.toThrow('Every screen was already looked over.');
  });

  it('falls back to the fixed message', async () => {
    stubFetch(500, {});
    await expect(finishAiReview('run-abc')).rejects.toThrow('Couldn’t finish the AI review. Try again.');
  });
});
