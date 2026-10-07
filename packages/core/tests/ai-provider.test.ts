import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyResolver, MockAIProvider, createAIProvider } from '../src/ai/ai-provider.js';
import type { SecretStore } from '../src/ai/key-resolver.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('AIProvider and KeyResolver', () => {
  const tmpDir = path.join(process.cwd(), '.tmp-ai-keys-test');

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should resolve key from explicit parameter first', async () => {
    const resolver = new KeyResolver(tmpDir);
    const resolved = await resolver.resolveKey('openai', 'sk-explicit-test-key');

    expect(resolved).not.toBeNull();
    expect(resolved?.provider).toBe('openai');
    expect(resolved?.apiKey).toBe('sk-explicit-test-key');
    expect(resolved?.source).toBe('cli');
  });

  class MemoryStore implements SecretStore {
    secrets = new Map<string, string>();
    async get(account: string) {
      return this.secrets.get(account) ?? null;
    }
    async set(account: string, secret: string) {
      this.secrets.set(account, secret);
    }
  }

  it('should save a BYOK key to the keychain, not to disk', async () => {
    const store = new MemoryStore();
    const resolver = new KeyResolver(tmpDir, store);
    expect(await resolver.saveByokKey('anthropic', 'sk-ant-test-1234')).toBe('keychain');

    const resolved = await resolver.resolveKey('anthropic');
    expect(resolved).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-test-1234', source: 'keychain' });
    await expect(fs.access(path.join(tmpDir, '.qa-keys.json'))).rejects.toThrow();
  });

  it('should fall back to the local key file when no keychain is available', async () => {
    const brokenStore: SecretStore = {
      get: async () => null,
      set: async () => {
        throw new Error('no secret service');
      },
    };
    const resolver = new KeyResolver(tmpDir, brokenStore);
    expect(await resolver.saveByokKey('openai', 'sk-file-key')).toBe('byok_file');

    const resolved = await resolver.resolveKey('openai');
    expect(resolved).toMatchObject({ apiKey: 'sk-file-key', source: 'byok_file' });
  });

  it('MockAIProvider should produce synthesized flow responses', async () => {
    const provider = new MockAIProvider();
    const result = await provider.generateText([
      { role: 'user', content: 'Please discover_flows for the application' },
    ]);

    expect(result).toContain('FLOW-001');
    const parsed = JSON.parse(result);
    expect(parsed.flows).toHaveLength(1);
    expect(parsed.flows[0].name).toBe('Create Invoice');
  });

  it('createAIProvider should instantiate corresponding providers', () => {
    const mock = createAIProvider('mock', 'none');
    expect(mock.providerType).toBe('mock');

    const claude = createAIProvider('anthropic', 'test-key');
    expect(claude.providerType).toBe('anthropic');

    const oai = createAIProvider('openai', 'test-key');
    expect(oai.providerType).toBe('openai');
  });

  it('asks OpenRouter models to answer without thinking first, and says when an answer was cut off', async () => {
    const realFetch = globalThis.fetch;
    const bodies: any[] = [];
    let finish = 'stop';
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: finish, message: { content: '{"flows":[' } }] }),
        {
          status: 200,
        }
      );
    }) as typeof fetch;
    try {
      const openRouter = createAIProvider('openrouter', 'test-key', undefined, 'some/model:free');
      await openRouter.generateText([{ role: 'user', content: 'plan' }], { responseFormat: 'json' });
      // Thinking counts against the answer's length limit and can use all of it on a free model.
      expect(bodies[0].reasoning).toEqual({ enabled: false });

      finish = 'length';
      await expect(openRouter.generateText([{ role: 'user', content: 'plan' }])).rejects.toThrow(/cut off/);

      await createAIProvider('openai', 'test-key')
        .generateText([{ role: 'user', content: 'plan' }])
        .catch(() => {});
      expect(bodies[2].reasoning).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
