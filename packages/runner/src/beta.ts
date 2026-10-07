import type http from 'http';
import dns from 'dns';
import net from 'net';
import { randomBytes } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import type { AIProviderType } from '@qa/types';
import { KeyResolver, isPrivateHost, type ResolvedKeyInfo, type SecretStore } from '@qa/core';

/**
 * Beta mode (RUNNER_BETA=1): a runner shared with a few outside testers over a tunnel. Each tester
 * gets a session, and the AI key and site sign-ins they enter are kept in this process's memory for
 * that session only: never in the keychain, never in a file, never used by anyone else, and gone when
 * the runner stops. The owner's saved key and environment keys are not used either.
 */

const SESSION_COOKIE = 'qa_session';
const SESSION_HOURS = 24;
const MAX_SESSIONS = 50;

const current = new AsyncLocalStorage<string>();

interface Session {
  secrets: Map<string, string>;
  lastSeen: number;
}
const sessions = new Map<string, Session>();

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

function forgetOldSessions(): void {
  const cutoff = Date.now() - SESSION_HOURS * 3_600_000;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff) sessions.delete(id);
  // Over the cap, the least recently seen go first.
  const extra = sessions.size - MAX_SESSIONS;
  if (extra > 0) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, extra);
    for (const [id] of oldest) sessions.delete(id);
  }
}

/**
 * The tester's session id, from their cookie; a new one is set when they have none (or an unknown
 * one, such as after a restart). `secure` should be true when the visit was https.
 */
export function sessionFor(req: http.IncomingMessage, res: http.ServerResponse, secure: boolean): string {
  forgetOldSessions();
  const sent = cookieValue(req.headers.cookie, SESSION_COOKIE);
  let id = sent && sessions.has(sent) ? sent : undefined;
  if (!id) {
    id = randomBytes(18).toString('base64url');
    sessions.set(id, { secrets: new Map(), lastSeen: Date.now() });
    const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
    const existing = res.getHeader('Set-Cookie');
    const cookie = `${SESSION_COOKIE}=${id}; ${flags}`;
    res.setHeader(
      'Set-Cookie',
      existing ? [...(Array.isArray(existing) ? existing : [String(existing)]), cookie] : cookie
    );
  }
  sessions.get(id)!.lastSeen = Date.now();
  return id;
}

/** The session the current request (or a run it started) belongs to; undefined outside beta mode. */
export function currentSessionId(): string | undefined {
  return current.getStore();
}

/** Makes the rest of this request (and everything it starts) belong to that session. */
export function enterSession(sessionId: string): void {
  current.enterWith(sessionId);
}

/** Secrets of the session the current request belongs to. Without one, nothing is kept or found. */
class SessionSecretStore implements SecretStore {
  private secrets(): Map<string, string> | undefined {
    const id = current.getStore();
    return id ? sessions.get(id)?.secrets : undefined;
  }
  async get(account: string): Promise<string | null> {
    return this.secrets()?.get(account) || null;
  }
  async set(account: string, secret: string): Promise<void> {
    const secrets = this.secrets();
    if (!secrets) throw new Error('No session');
    if (secret) secrets.set(account, secret);
    else secrets.delete(account);
  }
}

/** Keys and passwords from the current session only: no keychain, no file, no environment. */
export class SessionKeyResolver extends KeyResolver {
  private sessionStore = new SessionSecretStore();

  constructor() {
    super(process.cwd(), new SessionSecretStore());
  }

  async loadByokConfig(): Promise<Partial<Record<AIProviderType, string>>> {
    return {};
  }

  async saveByokKey(provider: AIProviderType, apiKey: string): Promise<'keychain' | 'byok_file'> {
    await this.sessionStore.set(provider, apiKey);
    return 'keychain';
  }

  async resolveKey(preferredProvider?: AIProviderType, explicitKey?: string): Promise<ResolvedKeyInfo | null> {
    if (explicitKey) return { provider: preferredProvider || 'anthropic', apiKey: explicitKey, source: 'cli' };
    const providers: AIProviderType[] = preferredProvider
      ? [preferredProvider]
      : ['openrouter', 'anthropic', 'openai', 'gemini'];
    for (const provider of providers) {
      const apiKey = await this.sessionStore.get(provider);
      if (apiKey) return { provider, apiKey, source: 'keychain' };
    }
    return null;
  }
}

function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase();
  if (net.isIPv4(a)) {
    return (
      isPrivateHost(a) ||
      a.startsWith('0.') ||
      a.startsWith('169.254.') ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a) || // carrier-grade NAT
      /^22[4-9]\.|^2[3-5]\d\./.test(a) // multicast and reserved
    );
  }
  if (net.isIPv6(a)) {
    if (a === '::' || a === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)) return true;
    // An IPv4 address written inside IPv6: dotted (::ffff:127.0.0.1), or as the URL parser rewrites it (::ffff:7f00:1).
    const dotted = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return false;
}

/**
 * Why a tester may not point the runner at this address, or null when it's fine. The name is resolved,
 * so a public-looking name that leads to a private address is refused too. A site that redirects to a
 * private address afterwards is not caught here.
 */
export async function refusedTarget(address: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return 'That is not a valid address.';
  }
  if (!/^https?:$/.test(url.protocol)) return 'Only http and https addresses can be checked.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const why =
    'This shared copy can only check sites on the public internet, not addresses on the computer running it. Run the QA Tool on your own computer to check a local site.';
  if (isPrivateHost(host) || isPrivateAddress(host)) return why;
  if (net.isIP(host)) return null;
  try {
    const found = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (found.length === 0) return 'That address could not be found.';
    if (found.some((f) => isPrivateAddress(f.address))) return why;
  } catch {
    return 'That address could not be found.';
  }
  return null;
}
