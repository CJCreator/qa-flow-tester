import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDomainProof, RunnerError } from '../src/api';

function stub(status: number, body: unknown) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(body), { status });
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('the Verified Domain check', () => {
  it('sends the address and returns the line to publish', async () => {
    const calls = stub(200, {
      required: true,
      verified: false,
      origin: 'https://preview.example.com',
      proofUrl: 'https://preview.example.com/.well-known/qa-verify.txt',
      line: 'qa-verify=abc',
      reason: 'not-found',
    });
    const status = await checkDomainProof('https://preview.example.com/');
    expect(calls[0].url).toBe('/api/runner/domain-proof');
    expect(calls[0].body).toEqual({ targetUrl: 'https://preview.example.com/' });
    expect(status).toEqual({
      required: true,
      verified: false,
      origin: 'https://preview.example.com',
      proofUrl: 'https://preview.example.com/.well-known/qa-verify.txt',
      line: 'qa-verify=abc',
      reason: 'not-found',
    });
  });

  it('says nothing is needed on your own computer', async () => {
    stub(200, { required: false, verified: true, origin: 'http://localhost:3050', proofUrl: '', line: '' });
    const status = await checkDomainProof('http://localhost:3050');
    expect(status.required).toBe(false);
    expect(status.verified).toBe(true);
  });

  it('turns a too-soon answer into an error that says to wait', async () => {
    stub(429, { code: 'ERR_RATE', error: 'Checked a moment ago.' });
    await expect(checkDomainProof('https://preview.example.com')).rejects.toMatchObject({
      name: 'RunnerError',
      code: 'ERR_RATE',
      suggestion: expect.stringContaining('10 seconds'),
    });
  });

  it('turns a refused address into an error', async () => {
    stub(400, { code: 'ERR_PRIVATE_TARGET', error: 'Only public sites.' });
    const err = await checkDomainProof('http://127.0.0.1').catch((e) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect(err.code).toBe('ERR_PRIVATE_TARGET');
  });
});
