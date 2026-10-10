import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRun } from '../src/api';

function stubRunner() {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ runId: 'run-1' }), { status: 202 });
    })
  );
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

describe('starting a check-up', () => {
  it('uses the AI unless told there is no key', async () => {
    const bodies = stubRunner();
    await startRun({ targetUrl: 'https://example.com/' });
    expect(bodies[0].useAI).toBe(true);
  });

  it('plans with fixed rules and no AI when there is no key, so a first scan needs no setup', async () => {
    const bodies = stubRunner();
    await startRun({ targetUrl: 'https://example.com/', useAI: false });
    expect(bodies[0].useAI).toBe(false);
    expect(bodies[0].planWithoutAI).toBeUndefined();
  });
});

describe('starting with sign-in consent', () => {
  it('sends consent and skipReview only when consent is given', async () => {
    const bodies = stubRunner();
    await startRun({ targetUrl: 'https://example.com/', owner: true, signInConsent: true, skipReview: true });
    expect(bodies[0]).toMatchObject({ owner: true, signInConsent: true, skipReview: true });
  });

  it('keeps the plan review when the person asked to see the plan first', async () => {
    const bodies = stubRunner();
    await startRun({ targetUrl: 'https://example.com/', owner: true, signInConsent: true, skipReview: false });
    expect(bodies[0]).toMatchObject({ signInConsent: true, skipReview: false });
  });

  it('sends no consent and never skips the review without it', async () => {
    const bodies = stubRunner();
    await startRun({ targetUrl: 'https://example.com/', owner: false, skipReview: true });
    expect(bodies[0].signInConsent).toBeUndefined();
    expect(bodies[0].skipReview).toBe(false);
    expect(bodies[0].owner).toBe(false);
  });
});
