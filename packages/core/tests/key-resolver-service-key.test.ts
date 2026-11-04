import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { KeyResolver, KEY_FILE_SECRET_ENV, type SecretStore } from '../src/ai/key-resolver.js';

// REQ-011 / ADR 0034: a saved service key (the PageSpeed key) can be removed again.
const ENV_NAMES = [KEY_FILE_SECRET_ENV, 'PAGESPEED_API_KEY'];
const SAVED = 'pagespeed-saved-key-0123456789';
const OTHER = 'openai-saved-key-abcdefghijkl';

/** No keychain: every save throws, as on headless Linux without D-Bus. */
const noKeychain: SecretStore = {
  get: async () => null,
  set: async () => {
    throw new Error('no secret service');
  },
};

class MemoryStore implements SecretStore {
  secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
  async delete(account: string) {
    this.secrets.delete(account);
  }
}

describe('KeyResolver.removeServiceKey', () => {
  let root: string;
  let dataDir: string;
  let keyDir: string;
  let savedEnv: Record<string, string | undefined>;

  const resolver = (store: SecretStore) => new KeyResolver(dataDir, store, { keyDir });
  const keyFilePath = () => path.join(dataDir, '.qa-keys.json');

  beforeEach(async () => {
    savedEnv = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
    for (const n of ENV_NAMES) delete process.env[n];
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-service-key-'));
    dataDir = path.join(root, 'data');
    keyDir = path.join(root, 'config');
    await fs.mkdir(dataDir, { recursive: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const n of ENV_NAMES) {
      if (savedEnv[n] === undefined) delete process.env[n];
      else process.env[n] = savedEnv[n];
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  it('removes a keychain entry, so the key resolves from the environment or not at all', async () => {
    const store = new MemoryStore();
    const keys = resolver(store);
    expect(await keys.saveServiceKey('pagespeed', SAVED)).toBe('keychain');

    await keys.removeServiceKey('pagespeed');
    expect(store.secrets.has('service:pagespeed')).toBe(false);
    expect(await keys.resolveServiceKey('pagespeed')).toBeNull();

    process.env.PAGESPEED_API_KEY = 'pagespeed-from-env';
    expect(await keys.resolveServiceKey('pagespeed')).toEqual({
      service: 'pagespeed',
      apiKey: 'pagespeed-from-env',
      source: 'env',
    });
  });

  it('clears the keychain with set(account, "") when the store has no delete', async () => {
    const secrets = new Map<string, string>();
    const store: SecretStore = {
      get: async (a) => secrets.get(a) || null,
      set: async (a, s) => void secrets.set(a, s),
    };
    const keys = resolver(store);
    await keys.saveServiceKey('pagespeed', SAVED);
    await keys.removeServiceKey('pagespeed');
    expect(await keys.resolveServiceKey('pagespeed')).toBeNull();
  });

  it('removes the encrypted-file entry, keeps the other entries and never writes plain text', async () => {
    const keys = resolver(noKeychain);
    expect(await keys.saveByokKey('openai', OTHER)).toBe('byok_file');
    expect(await keys.saveServiceKey('pagespeed', SAVED)).toBe('byok_file');
    expect((await keys.resolveServiceKey('pagespeed'))?.source).toBe('byok_file');

    await keys.removeServiceKey('pagespeed');

    expect(await keys.resolveServiceKey('pagespeed')).toBeNull();
    // A fresh resolver reads the same file: the other entry survived.
    expect(await resolver(noKeychain).loadByokConfig()).toEqual({ openai: OTHER });

    const raw = await fs.readFile(keyFilePath(), 'utf8');
    const envelope = JSON.parse(raw);
    expect(envelope.format).toBe('qa-keys/encrypted');
    for (const secret of [SAVED, OTHER]) {
      expect(raw).not.toContain(secret);
      expect(Buffer.from(envelope.data, 'base64').includes(Buffer.from(secret, 'utf8'))).toBe(false);
    }

    process.env.PAGESPEED_API_KEY = 'pagespeed-from-env';
    expect((await keys.resolveServiceKey('pagespeed'))?.source).toBe('env');
  });

  it('writes no key file when there is nothing to remove', async () => {
    await resolver(noKeychain).removeServiceKey('pagespeed');
    await expect(fs.access(keyFilePath())).rejects.toThrow();
  });

  it('refuses an unknown service name', async () => {
    await expect(resolver(new MemoryStore()).removeServiceKey('nope' as never)).rejects.toThrow(
      /Unknown service key name/
    );
  });
});
