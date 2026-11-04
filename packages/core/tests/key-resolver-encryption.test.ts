import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { KeyResolver, KEY_FILE_SECRET_ENV, type SecretStore } from '../src/ai/key-resolver.js';

// ADR 0034: the fallback key file is encrypted; named service keys use the same resolver.
const ENV_NAMES = [
  KEY_FILE_SECRET_ENV,
  'PAGESPEED_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
];

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
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else files.push(full);
  }
  return files;
}

describe('KeyResolver encrypted fallback file and service keys', () => {
  let root: string;
  let dataDir: string;
  let keyDir: string;
  let savedEnv: Record<string, string | undefined>;
  let warn: ReturnType<typeof vi.spyOn>;

  const resolver = (store: SecretStore = noKeychain, dir = keyDir) => new KeyResolver(dataDir, store, { keyDir: dir });
  const keyFilePath = () => path.join(dataDir, '.qa-keys.json');
  const readKeyFile = async () => JSON.parse(await fs.readFile(keyFilePath(), 'utf8'));

  /** Every stored file under the test root, read the way someone outside the tool would. */
  async function expectNowhereInPlainText(secret: string) {
    const files = await listFiles(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = await fs.readFile(file);
      expect(raw.includes(Buffer.from(secret, 'utf8')), `${path.basename(file)} holds the key`).toBe(false);
      expect(raw.toString('utf8')).not.toContain(Buffer.from(secret).toString('base64'));
    }
    const envelope = await readKeyFile();
    expect(Buffer.from(envelope.data, 'base64').includes(Buffer.from(secret, 'utf8'))).toBe(false);
    for (const call of warn.mock.calls) expect(String(call.join(' '))).not.toContain(secret);
  }

  beforeEach(async () => {
    savedEnv = {};
    for (const name of ENV_NAMES) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-key-encryption-'));
    dataDir = path.join(root, 'data');
    keyDir = path.join(root, 'config');
    await fs.mkdir(dataDir, { recursive: true });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    for (const name of ENV_NAMES) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('REQ-040 AC-1: without a keychain the saved key is in no stored file in plain text', async () => {
    const apiKey = 'sk-openai-PLAINTEXT-MARKER-0001';
    expect(await resolver().saveByokKey('openai', apiKey)).toBe('byok_file');

    const envelope = await readKeyFile();
    expect(envelope).toMatchObject({
      format: 'qa-keys/encrypted',
      version: 1,
      cipher: 'aes-256-gcm',
      keySource: 'local',
    });
    expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(envelope.tag, 'base64')).toHaveLength(16);
    await expectNowhereInPlainText(apiKey);

    // The file key is not beside the key file: the data folder holds only the encrypted file.
    expect(await fs.readdir(dataDir)).toEqual(['.qa-keys.json']);
    expect(await fs.readdir(keyDir)).toEqual(['key-file.key']);
  });

  it('REQ-040 AC-2: after a restart the saved key still resolves for AI steps', async () => {
    await resolver().saveByokKey('openai', 'sk-openai-restart-0002');

    const afterRestart = resolver();
    expect(await afterRestart.resolveKey('openai')).toEqual({
      provider: 'openai',
      apiKey: 'sk-openai-restart-0002',
      source: 'byok_file',
    });
    expect(await afterRestart.resolveKey()).toMatchObject({ provider: 'openai', apiKey: 'sk-openai-restart-0002' });
  });

  it('uses a fresh random IV for every write', async () => {
    const r = resolver();
    await r.saveByokKey('openai', 'sk-openai-iv-0003');
    const first = await readKeyFile();
    await r.saveByokKey('openai', 'sk-openai-iv-0003');
    const second = await readKeyFile();

    expect(second.iv).not.toBe(first.iv);
    expect(second.data).not.toBe(first.data);
    expect(await resolver().resolveKey('openai')).toMatchObject({ apiKey: 'sk-openai-iv-0003' });
  });

  it('a copy of the data folder alone does not give the key back', async () => {
    await resolver().saveByokKey('anthropic', 'sk-ant-copied-0004');

    const otherMachine = resolver(noKeychain, path.join(root, 'other-config'));
    expect(await otherMachine.resolveKey('anthropic')).toBeNull();
    expect(warn.mock.calls.some((call) => String(call[0]).includes('cannot be decrypted'))).toBe(true);
  });

  it('rejects a tampered file instead of returning altered keys', async () => {
    await resolver().saveByokKey('gemini', 'sk-gemini-tamper-0005');
    const envelope = await readKeyFile();
    const data = Buffer.from(envelope.data, 'base64');
    data[0] ^= 0xff;
    await fs.writeFile(keyFilePath(), JSON.stringify({ ...envelope, data: data.toString('base64') }));

    expect(await resolver().resolveKey('gemini')).toBeNull();

    // A changed header is refused too.
    await resolver().saveByokKey('gemini', 'sk-gemini-tamper-0005');
    const valid = await readKeyFile();
    await fs.writeFile(keyFilePath(), JSON.stringify({ ...valid, keySource: 'env', salt: 'AAAA' }));
    process.env[KEY_FILE_SECRET_ENV] = 'a-secret-that-is-long-enough';
    expect(await resolver().resolveKey('gemini')).toBeNull();
  });

  it('migrates a legacy plaintext file to the encrypted form on first read', async () => {
    const legacyKey = 'sk-ant-legacy-plain-0006';
    await fs.writeFile(keyFilePath(), JSON.stringify({ anthropic: legacyKey }, null, 2));

    expect(await resolver().resolveKey('anthropic')).toEqual({
      provider: 'anthropic',
      apiKey: legacyKey,
      source: 'byok_file',
    });
    expect(await readKeyFile()).toMatchObject({ format: 'qa-keys/encrypted', keySource: 'local' });
    await expectNowhereInPlainText(legacyKey);
    expect(await resolver().resolveKey('anthropic')).toMatchObject({ apiKey: legacyKey, source: 'byok_file' });
  });

  it('keeps legacy keys when a new key is saved over a plaintext file', async () => {
    await fs.writeFile(keyFilePath(), JSON.stringify({ anthropic: 'sk-ant-legacy-0007' }));

    await resolver().saveByokKey('openai', 'sk-openai-new-0007');

    const r = resolver();
    expect(await r.resolveKey('anthropic')).toMatchObject({ apiKey: 'sk-ant-legacy-0007' });
    expect(await r.resolveKey('openai')).toMatchObject({ apiKey: 'sk-openai-new-0007' });
    await expectNowhereInPlainText('sk-ant-legacy-0007');
    await expectNowhereInPlainText('sk-openai-new-0007');
  });

  it('REQ-011 AC-1: each provider uses its own saved key, in the file and in the keychain', async () => {
    const fileResolver = resolver();
    await Promise.all([
      fileResolver.saveByokKey('openai', 'sk-openai-own-0008'),
      fileResolver.saveByokKey('anthropic', 'sk-ant-own-0008'),
      fileResolver.saveServiceKey('pagespeed', 'psi-own-0008'),
    ]);
    const restarted = resolver();
    expect(await restarted.resolveKey('openai')).toMatchObject({ provider: 'openai', apiKey: 'sk-openai-own-0008' });
    expect(await restarted.resolveKey('anthropic')).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-own-0008' });
    expect(await restarted.resolveServiceKey('pagespeed')).toMatchObject({ apiKey: 'psi-own-0008' });

    const store = new MemoryStore();
    const keychainResolver = resolver(store);
    expect(await keychainResolver.saveByokKey('openai', 'sk-openai-keychain-0008')).toBe('keychain');
    expect(await keychainResolver.saveByokKey('gemini', 'sk-gemini-keychain-0008')).toBe('keychain');
    expect(await keychainResolver.resolveKey('openai')).toEqual({
      provider: 'openai',
      apiKey: 'sk-openai-keychain-0008',
      source: 'keychain',
    });
    expect(await keychainResolver.resolveKey('gemini')).toMatchObject({
      apiKey: 'sk-gemini-keychain-0008',
      source: 'keychain',
    });
  });

  it('keychain path unchanged: a key saved to the keychain writes no file and no file key', async () => {
    const store = new MemoryStore();
    expect(await resolver(store).saveByokKey('openrouter', 'sk-or-keychain-0009')).toBe('keychain');

    expect(store.secrets.get('openrouter')).toBe('sk-or-keychain-0009');
    expect(await listFiles(root)).toEqual([]);
  });

  it('saves and resolves the named pagespeed key through the keychain', async () => {
    const store = new MemoryStore();
    const r = resolver(store);
    expect(await r.saveServiceKey('pagespeed', '  psi-keychain-0010  ')).toBe('keychain');

    expect(store.secrets.get('service:pagespeed')).toBe('psi-keychain-0010');
    expect(await r.resolveServiceKey('pagespeed')).toEqual({
      service: 'pagespeed',
      apiKey: 'psi-keychain-0010',
      source: 'keychain',
    });
    expect(await listFiles(root)).toEqual([]);
  });

  it('without a keychain the pagespeed key is encrypted, survives a restart and is never an AI key', async () => {
    const apiKey = 'psi-PLAINTEXT-MARKER-0011';
    expect(await resolver().saveServiceKey('pagespeed', apiKey)).toBe('byok_file');
    await expectNowhereInPlainText(apiKey);

    const restarted = resolver();
    expect(await restarted.resolveServiceKey('pagespeed')).toEqual({
      service: 'pagespeed',
      apiKey,
      source: 'byok_file',
    });
    expect(await restarted.loadByokConfig()).toEqual({});
    expect(await restarted.resolveKey()).toBeNull();
  });

  it('falls back to PAGESPEED_API_KEY, and returns null when no pagespeed key exists', async () => {
    expect(await resolver().resolveServiceKey('pagespeed')).toBeNull();

    process.env.PAGESPEED_API_KEY = 'psi-env-0012';
    expect(await resolver().resolveServiceKey('pagespeed')).toEqual({
      service: 'pagespeed',
      apiKey: 'psi-env-0012',
      source: 'env',
    });
  });

  it('rejects an empty service key or an unknown service name and writes nothing', async () => {
    const r = resolver();
    await expect(r.saveServiceKey('pagespeed', '   ')).rejects.toThrow(/must not be empty/);
    await expect(r.saveServiceKey('unknown' as never, 'value-0013')).rejects.toThrow(/Unknown service key/);
    await expect(r.resolveServiceKey('__proto__' as never)).rejects.toThrow(/Unknown service key/);
    expect(await listFiles(root)).toEqual([]);
  });

  it(`with ${KEY_FILE_SECRET_ENV} set, encrypts with that secret and needs it to read`, async () => {
    process.env[KEY_FILE_SECRET_ENV] = 'docker-volume-secret-0014-long';
    const apiKey = 'sk-openai-envsecret-0014';
    expect(await resolver().saveByokKey('openai', apiKey)).toBe('byok_file');

    const envelope = await readKeyFile();
    expect(envelope).toMatchObject({ format: 'qa-keys/encrypted', keySource: 'env' });
    expect(typeof envelope.salt).toBe('string');
    await expectNowhereInPlainText(apiKey);
    await expect(fs.access(path.join(keyDir, 'key-file.key'))).rejects.toThrow();

    // A container recreated with the same secret reads it back.
    expect(await resolver(noKeychain, path.join(root, 'fresh-config')).resolveKey('openai')).toMatchObject({ apiKey });

    process.env[KEY_FILE_SECRET_ENV] = 'a-different-secret-0014-long';
    expect(await resolver().resolveKey('openai')).toBeNull();
    delete process.env[KEY_FILE_SECRET_ENV];
    expect(await resolver().resolveKey('openai')).toBeNull();
  });

  it(`refuses to save with a too short ${KEY_FILE_SECRET_ENV} rather than write plain text`, async () => {
    process.env[KEY_FILE_SECRET_ENV] = 'short';
    await expect(resolver().saveByokKey('openai', 'sk-openai-short-0015')).rejects.toThrow(/at least 16 characters/);
    expect(await listFiles(root)).toEqual([]);
  });

  it('ignores a malformed key file without throwing', async () => {
    await fs.writeFile(keyFilePath(), '{ not json');
    expect(await resolver().resolveKey('openai')).toBeNull();

    await fs.writeFile(keyFilePath(), JSON.stringify({ format: 'qa-keys/encrypted', version: 99 }));
    expect(await resolver().resolveKey('openai')).toBeNull();
  });
});
