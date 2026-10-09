/**
 * The AI estimate answers with pacing, the cap and a price: dollars only when the model has one,
 * and a free key shows requests only.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { KeyResolver, type OpenRouterClient, type SecretStore } from '@qa/core';
import { RunnerServer } from '../src/server.js';

class MemoryStore implements SecretStore {
  secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
}

const scratch = path.join(process.cwd(), '.tmp-ai-estimate-cap');

async function estimate(port: number, price: { prompt: number; completion: number } | null, body: unknown) {
  const store = new MemoryStore();
  store.secrets.set('openrouter', 'sk-or-test');
  const runner = new RunnerServer({
    port,
    outputDir: path.join(scratch, String(port)),
    dataDir: path.join(scratch, `${port}-data`),
    keyResolver: new KeyResolver(path.join(scratch, `${port}-data`), store),
    openRouter: {
      freeRequestsToday: async () => ({ remaining: 40, limit: 50 }),
      keyLimits: async () => ({ remainingRequests: 40, requestsPerInterval: 20, intervalMs: 60000 }),
      modelPrice: async () => price,
      validateKey: async () => ({ valid: true }),
      listFreeModels: async () => [],
    } as unknown as OpenRouterClient,
  });
  await runner.start();
  try {
    await fs.mkdir(path.join(scratch, `${port}-data`), { recursive: true });
    await fs.writeFile(
      path.join(scratch, `${port}-data`, '.qa-ai-models.json'),
      JSON.stringify({ provider: 'openrouter', text: 'some/model' })
    );
    const res = await fetch(`http://localhost:${port}/api/runner/ai-estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Record<string, unknown>;
  } finally {
    await runner.stop();
  }
}

describe('AI estimate with a cap', () => {
  afterAll(async () => {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  });

  it('a free model shows requests only, with the cap echoed', async () => {
    const r = await estimate(3727, { prompt: 0, completion: 0 }, { maxPages: 30, aiCap: { requests: 50 } });
    expect(r.cap).toEqual({ requests: 50 });
    expect(r.price).toBeNull();
    expect(r.estimatedUsd).toBeNull();
    expect(typeof r.low).toBe('number');
    expect(r.concurrency).toBeGreaterThanOrEqual(1);
  });

  it('a priced model adds a dollar estimate', async () => {
    const r = await estimate(3728, { prompt: 1, completion: 4 }, { maxPages: 30, aiCap: { dollars: 2 } });
    expect(r.price).toEqual({ prompt: 1, completion: 4 });
    expect(r.estimatedUsd as number).toBeGreaterThan(0);
  });
});
