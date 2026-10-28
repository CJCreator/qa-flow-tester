import { promises as fs } from 'fs';
import path from 'path';
import type { AIProviderType } from '@qa/types';

export interface ResolvedKeyInfo {
  provider: AIProviderType;
  apiKey: string;
  source: 'cli' | 'keychain' | 'byok_file' | 'env';
}

/** Where saved secrets live. The default is the OS keychain. */
export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
}

const KEYCHAIN_SERVICE = 'qa-flow-tester';

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
}

export class KeyResolver {
  private configFilePath: string;
  private store: SecretStore;

  constructor(repoRoot: string = process.cwd(), store: SecretStore = new OsKeychainStore()) {
    this.configFilePath = path.join(repoRoot, '.qa-keys.json');
    this.store = store;
  }

  /** Legacy plaintext key file. Read for backwards compatibility; written only when the keychain is unavailable. */
  async loadByokConfig(): Promise<Partial<Record<AIProviderType, string>>> {
    try {
      const content = await fs.readFile(this.configFilePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /** Saves a key to the OS keychain; falls back to `.qa-keys.json` only when no keychain exists. */
  async saveByokKey(provider: AIProviderType, apiKey: string): Promise<'keychain' | 'byok_file'> {
    try {
      await this.store.set(provider, apiKey);
      return 'keychain';
    } catch (err) {
      console.warn(
        `[KeyResolver] OS keychain unavailable (${err instanceof Error ? err.message : err}); storing key in ${this.configFilePath}. Keep this file out of version control.`
      );
      const existing = await this.loadByokConfig();
      existing[provider] = apiKey;
      await fs.writeFile(this.configFilePath, JSON.stringify(existing, null, 2), { encoding: 'utf8', mode: 0o600 });
      return 'byok_file';
    }
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

    // 2. Preferred provider: keychain, then legacy file, then environment
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
}
