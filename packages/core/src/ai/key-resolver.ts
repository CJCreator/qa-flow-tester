import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { AIProviderType } from '@qa/types';

export interface ResolvedKeyInfo {
  provider: AIProviderType;
  apiKey: string;
  source: 'cli' | 'keychain' | 'byok_file' | 'env';
}

/** Keys for services other than AI Providers, kept the same way as AI keys (ADR 0034). */
export const SERVICE_KEY_NAMES = ['pagespeed'] as const;
export type ServiceKeyName = (typeof SERVICE_KEY_NAMES)[number];

export interface ResolvedServiceKey {
  service: ServiceKeyName;
  apiKey: string;
  source: 'keychain' | 'byok_file' | 'env';
}

const SERVICE_KEY_ENV: Record<ServiceKeyName, string> = { pagespeed: 'PAGESPEED_API_KEY' };

/** Where saved secrets live. The default is the OS keychain. */
export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  /** Removes the entry. Stores without it are cleared with `set(account, '')`. */
  delete?(account: string): Promise<void>;
}

export interface KeyResolverOptions {
  /** Folder for the generated file key. Defaults to the user's config folder, never the data folder. */
  keyDir?: string;
}

/**
 * Optional secret the key file is encrypted with instead of the generated file key. Set it when the data folder
 * outlives the machine's config folder, such as a Docker volume.
 */
export const KEY_FILE_SECRET_ENV = 'QA_KEYS_ENCRYPTION_KEY';

const KEYCHAIN_SERVICE = 'qa-flow-tester';
const FILE_FORMAT = 'qa-keys/encrypted';
const FILE_VERSION = 1;
const CIPHER = 'aes-256-gcm';
const LOCAL_KEY_FILE = 'key-file.key';
const MIN_SECRET_LENGTH = 16;

/** The encrypted `.qa-keys.json`. Only the cipher text holds keys; the rest is authenticated as additional data. */
interface EncryptedKeyFile {
  format: typeof FILE_FORMAT;
  version: number;
  cipher: typeof CIPHER;
  keySource: 'env' | 'local';
  salt?: string;
  iv: string;
  tag: string;
  data: string;
}

/**
 * OS keychain (Windows Credential Manager, macOS Keychain, libsecret on Linux).
 * Throws from `set` when no keychain backend is available (e.g. headless Linux without D-Bus).
 */
export class OsKeychainStore implements SecretStore {
  private async entry(account: string) {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(KEYCHAIN_SERVICE, account);
  }

  async get(account: string): Promise<string | null> {
    try {
      return (await this.entry(account)).getPassword() ?? null;
    } catch {
      return null;
    }
  }

  async set(account: string, secret: string): Promise<void> {
    (await this.entry(account)).setPassword(secret);
  }

  async delete(account: string): Promise<void> {
    const entry = (await this.entry(account)) as unknown as {
      deleteCredential?: () => unknown;
      deletePassword?: () => unknown;
      setPassword(secret: string): void;
    };
    if (entry.deleteCredential) entry.deleteCredential();
    else if (entry.deletePassword) entry.deletePassword();
    else entry.setPassword('');
  }
}

export class KeyResolver {
  private configFilePath: string;
  private store: SecretStore;
  private keyDir: string;
  private fileWrites: Promise<unknown> = Promise.resolve();

  constructor(
    repoRoot: string = process.cwd(),
    store: SecretStore = new OsKeychainStore(),
    options: KeyResolverOptions = {}
  ) {
    this.configFilePath = path.join(repoRoot, '.qa-keys.json');
    this.store = store;
    this.keyDir = options.keyDir ?? defaultKeyDir();
  }

  /** AI keys from the encrypted fallback file (written only when the keychain is unavailable). */
  async loadByokConfig(): Promise<Partial<Record<AIProviderType, string>>> {
    const keys = await this.readFallbackFile();
    return Object.fromEntries(Object.entries(keys).filter(([account]) => !account.startsWith('service:')));
  }

  /** Saves a key to the OS keychain; falls back to the encrypted `.qa-keys.json` only when no keychain exists. */
  async saveByokKey(provider: AIProviderType, apiKey: string): Promise<'keychain' | 'byok_file'> {
    return this.saveKey(provider, apiKey);
  }

  /** Saves a named service key (such as the PageSpeed key) like an AI key: keychain first, else the encrypted file. */
  async saveServiceKey(service: ServiceKeyName, apiKey: string): Promise<'keychain' | 'byok_file'> {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) throw new Error('A service key must not be empty');
    return this.saveKey(serviceAccount(service), key);
  }

  /**
   * Forgets a saved service key: its keychain entry and its entry in the encrypted file (the file's other
   * entries are kept, and it is rewritten encrypted). Afterwards the key resolves from its environment variable or not at all.
   */
  async removeServiceKey(service: ServiceKeyName): Promise<void> {
    const account = serviceAccount(service);
    // No keychain (or no entry in it) is fine: there is nothing to remove there.
    await (this.store.delete ? this.store.delete(account) : this.store.set(account, '')).catch(() => {});
    const { keys } = await this.decodeFallbackFile();
    if (!(account in keys)) return;
    await this.updateFallbackFile((current) => {
      delete current[account];
    });
  }

  /** A named service key: OS keychain, then the encrypted file, then its environment variable. */
  async resolveServiceKey(service: ServiceKeyName): Promise<ResolvedServiceKey | null> {
    const account = serviceAccount(service);
    const fromKeychain = await this.store.get(account).catch(() => null);
    if (fromKeychain) return { service, apiKey: fromKeychain, source: 'keychain' };
    const fromFile = (await this.readFallbackFile())[account];
    if (fromFile) return { service, apiKey: fromFile, source: 'byok_file' };
    const fromEnv = process.env[SERVICE_KEY_ENV[service]];
    if (fromEnv) return { service, apiKey: fromEnv, source: 'env' };
    return null;
  }

  /**
   * Keeps another secret, such as a site's sign-in password, in the OS keychain only. Returns
   * false when there's no keychain: such secrets are never written to a plain file.
   */
  async saveSecret(account: string, secret: string): Promise<boolean> {
    try {
      await this.store.set(account, secret);
      return true;
    } catch {
      return false;
    }
  }

  async readSecret(account: string): Promise<string | null> {
    const secret = await this.store.get(account).catch(() => null);
    return secret || null;
  }

  /** Forgets a secret kept with saveSecret. */
  async forgetSecret(account: string): Promise<void> {
    await this.store.set(account, '').catch(() => {});
  }

  async resolveKey(preferredProvider?: AIProviderType, explicitKey?: string): Promise<ResolvedKeyInfo | null> {
    // 1. Explicit CLI / Param
    if (explicitKey) {
      return {
        provider: preferredProvider || 'anthropic',
        apiKey: explicitKey,
        source: 'cli',
      };
    }

    const byok = await this.loadByokConfig();
    const lookup = async (p: AIProviderType): Promise<ResolvedKeyInfo | null> => {
      const fromKeychain = await this.store.get(p);
      if (fromKeychain) return { provider: p, apiKey: fromKeychain, source: 'keychain' };
      if (byok[p]) return { provider: p, apiKey: byok[p]!, source: 'byok_file' };
      const envKey = this.getEnvKey(p);
      if (envKey) return { provider: p, apiKey: envKey, source: 'env' };
      return null;
    };

    // 2. Preferred provider: keychain, then encrypted file, then environment
    if (preferredProvider) {
      const found = await lookup(preferredProvider);
      if (found) return found;
    }

    // 3. Fallback search order across providers
    const providers: AIProviderType[] = ['anthropic', 'openai', 'gemini', 'openrouter'];
    for (const p of providers) {
      const found = await lookup(p);
      if (found) return found;
    }

    return null;
  }

  private getEnvKey(provider: AIProviderType): string | undefined {
    switch (provider) {
      case 'anthropic':
        return process.env.ANTHROPIC_API_KEY;
      case 'openai':
        return process.env.OPENAI_API_KEY;
      case 'gemini':
        return process.env.GEMINI_API_KEY;
      case 'openrouter':
        return process.env.OPENROUTER_API_KEY;
      default:
        return undefined;
    }
  }

  private async saveKey(account: string, apiKey: string): Promise<'keychain' | 'byok_file'> {
    try {
      await this.store.set(account, apiKey);
      return 'keychain';
    } catch (err) {
      console.warn(
        `[KeyResolver] OS keychain unavailable (${err instanceof Error ? err.message : err}); storing the key encrypted in ${this.configFilePath}.`
      );
      await this.updateFallbackFile((keys) => {
        keys[account] = apiKey;
      });
      return 'byok_file';
    }
  }

  /** Account name to key, from the fallback file. A legacy plaintext file is rewritten encrypted on first read. */
  private async readFallbackFile(): Promise<Record<string, string>> {
    const { keys, legacy } = await this.decodeFallbackFile();
    if (legacy) {
      await this.updateFallbackFile(() => {}).catch((err) =>
        console.warn(
          `[KeyResolver] Could not encrypt the plaintext ${this.configFilePath} (${err instanceof Error ? err.message : err}).`
        )
      );
    }
    return keys;
  }

  private async decodeFallbackFile(): Promise<{ keys: Record<string, string>; legacy: boolean }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.configFilePath, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[KeyResolver] ${this.configFilePath} could not be read; its keys are ignored.`);
      }
      return { keys: {}, legacy: false };
    }
    if (!isRecord(parsed)) return { keys: {}, legacy: false };
    if (parsed.format !== FILE_FORMAT) return { keys: onlyStrings(parsed), legacy: true };
    try {
      return { keys: await this.decrypt(parsed), legacy: false };
    } catch (err) {
      console.warn(
        `[KeyResolver] Saved keys in ${this.configFilePath} cannot be decrypted (${err instanceof Error ? err.message : err}); save them again.`
      );
      return { keys: {}, legacy: false };
    }
  }

  /** Read, change and rewrite the file encrypted, one change at a time so none is lost. */
  private updateFallbackFile(change: (keys: Record<string, string>) => void): Promise<void> {
    const run = this.fileWrites.then(async () => {
      const { keys } = await this.decodeFallbackFile();
      change(keys);
      const body = JSON.stringify(await this.encrypt(keys), null, 2);
      const temp = `${this.configFilePath}.${randomBytes(6).toString('hex')}.tmp`;
      await fs.writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
      try {
        await fs.rename(temp, this.configFilePath);
      } catch (err) {
        await fs.rm(temp, { force: true });
        throw err;
      }
    });
    this.fileWrites = run.catch(() => {});
    return run;
  }

  private async encrypt(keys: Record<string, string>): Promise<EncryptedKeyFile> {
    const secret = envSecret();
    const salt = secret ? randomBytes(16).toString('base64') : undefined;
    const fileKey = secret ? await deriveKey(secret, salt!) : await this.localFileKey(true);
    const header = {
      format: FILE_FORMAT,
      version: FILE_VERSION,
      cipher: CIPHER,
      keySource: secret ? 'env' : 'local',
      salt,
    } as const;
    const iv = randomBytes(12);
    const cipher = createCipheriv(CIPHER, fileKey, iv, { authTagLength: 16 });
    cipher.setAAD(additionalData(header));
    const data = Buffer.concat([cipher.update(JSON.stringify(keys), 'utf8'), cipher.final()]);
    return {
      ...header,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }

  private async decrypt(file: Record<string, unknown>): Promise<Record<string, string>> {
    if (
      file.version !== FILE_VERSION ||
      file.cipher !== CIPHER ||
      (file.keySource !== 'env' && file.keySource !== 'local') ||
      typeof file.iv !== 'string' ||
      typeof file.tag !== 'string' ||
      typeof file.data !== 'string' ||
      (file.keySource === 'env' && typeof file.salt !== 'string')
    ) {
      throw new Error('unknown file layout');
    }
    const header = file as unknown as EncryptedKeyFile;
    let fileKey: Buffer;
    if (header.keySource === 'env') {
      const secret = envSecret();
      if (!secret) throw new Error(`they were encrypted with ${KEY_FILE_SECRET_ENV}, which is not set`);
      fileKey = await deriveKey(secret, header.salt!);
    } else {
      fileKey = await this.localFileKey(false);
    }
    const decipher = createDecipheriv(CIPHER, fileKey, Buffer.from(header.iv, 'base64'), { authTagLength: 16 });
    decipher.setAAD(additionalData(header));
    decipher.setAuthTag(Buffer.from(header.tag, 'base64'));
    const json = Buffer.concat([decipher.update(Buffer.from(header.data, 'base64')), decipher.final()]);
    const keys: unknown = JSON.parse(json.toString('utf8'));
    return isRecord(keys) ? onlyStrings(keys) : {};
  }

  /** The generated 256-bit file key, kept in the user's config folder (mode 600), not beside the key file. */
  private async localFileKey(create: boolean): Promise<Buffer> {
    const keyPath = path.join(this.keyDir, LOCAL_KEY_FILE);
    try {
      const key = Buffer.from((await fs.readFile(keyPath, 'utf8')).trim(), 'base64');
      if (key.length !== 32) throw new Error(`${keyPath} does not hold a 256-bit key`);
      return key;
    } catch (err) {
      if (!create || (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.mkdir(this.keyDir, { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    try {
      await fs.writeFile(keyPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return key;
    } catch (err) {
      // Another process made it first: use theirs.
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return this.localFileKey(false);
      throw err;
    }
  }
}

function defaultKeyDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === 'win32' ? process.env.APPDATA : undefined) ||
    path.join(os.homedir(), '.config');
  return path.join(base, KEYCHAIN_SERVICE);
}

/** The account name a service key is kept under, in the keychain, the encrypted file or a beta session. */
export function serviceAccount(service: ServiceKeyName): string {
  if (!SERVICE_KEY_NAMES.includes(service)) throw new Error('Unknown service key name');
  return `service:${service}`;
}

function envSecret(): string | undefined {
  const secret = process.env[KEY_FILE_SECRET_ENV];
  if (!secret) return undefined;
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${KEY_FILE_SECRET_ENV} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

function deriveKey(secret: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(secret, Buffer.from(salt, 'base64'), 32, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

function additionalData(header: Pick<EncryptedKeyFile, 'version' | 'cipher' | 'keySource' | 'salt'>): Buffer {
  return Buffer.from(`${FILE_FORMAT}|${header.version}|${header.cipher}|${header.keySource}|${header.salt ?? ''}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyStrings(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1])
  );
}
