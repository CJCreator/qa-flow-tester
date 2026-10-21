import type http from 'http';
import dns from 'dns';
import net from 'net';
import { randomBytes } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import fs from 'fs/promises';
import path from 'path';
import type { AIProviderType } from '@qa/types';
import { KeyResolver, classifyAddress, isPrivateHost, type ResolvedKeyInfo, type SecretStore } from '@qa/core';

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
  /** Check-ups and comparisons this visitor started on `day` (UTC, YYYY-MM-DD). In memory only. */
  usage?: { day: string; count: number };
  /** When each address last had its Verified Domain proof fetched (ms). In memory only. */
  proofChecks?: Map<string, number>;
  /** Owns a run or a plan: kept when the session cap is reached. */
  pinned?: boolean;
}
const sessions = new Map<string, Session>();

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** A session that owns a run, a plan or a sign-in is never pushed out to make room. */
function ownsSomething(s: Session): boolean {
  return !!s.pinned || s.secrets.size > 0;
}

/** Marks the session as owning a run or plan, so the cap never evicts it. */
export function pinSession(sessionId: string | undefined): void {
  const s = sessionId ? sessions.get(sessionId) : undefined;
  if (s) s.pinned = true;
}

/** Beta: the folder that holds each visitor's remembered sites (`<dataDir>/sessions`); unset outside beta. */
let sessionFolderRoot: string | null = null;

/** Beta: keeps each visitor's folder under `<dataDir>/sessions`, removed when the session ends. */
export function keepSessionFoldersIn(dataDir: string): void {
  sessionFolderRoot = path.join(dataDir, 'sessions');
}

/** The folder name for a session. Session ids are base64url, so the name is the id itself. */
export function sessionFolderName(sessionId: string): string {
  return sessionId.replace(/[^\w-]/g, '_');
}

/** Removes a visitor's folder, in the background. Nothing is removed outside beta. */
function removeSessionFolder(sessionId: string): void {
  if (!sessionFolderRoot) return;
  fs.rm(path.join(sessionFolderRoot, sessionFolderName(sessionId)), { recursive: true, force: true }).catch(() => {});
}

function forgetSession(id: string): void {
  sessions.delete(id);
  removeSessionFolder(id);
}

/**
 * Beta: removes visitor folders that were not written for a session's lifetime and have no session in memory
 * (a restart forgets every session). Called once when the server starts.
 */
export async function sweepSessionFolders(now: number = Date.now()): Promise<void> {
  if (!sessionFolderRoot) return;
  const names = await fs.readdir(sessionFolderRoot).catch(() => [] as string[]);
  for (const name of names) {
    const dir = path.join(sessionFolderRoot, name);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || sessions.has(name) || now - stat.mtimeMs < SESSION_HOURS * 3_600_000) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function forgetOldSessions(): void {
  const cutoff = Date.now() - SESSION_HOURS * 3_600_000;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff) forgetSession(id);
  // Over the cap, the least recently seen go first, but never one that owns a run, plan or sign-in.
  const extra = sessions.size - MAX_SESSIONS;
  if (extra > 0) {
    const oldest = [...sessions.entries()]
      .filter(([, s]) => !ownsSomething(s))
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
      .slice(0, extra);
    for (const [id] of oldest) forgetSession(id);
  }
}

/** Thrown by sessionFor when one client address is making sessions faster than the limit. */
export class SessionRateLimited extends Error {
  constructor() {
    super('Too many new sessions from this address. Try again in a few minutes.');
  }
}

const NEW_SESSIONS_PER_WINDOW = 20;
const NEW_SESSION_WINDOW_MS = 10 * 60_000;
const newSessionTimes = new Map<string, number[]>();

/** The client address: the last X-Forwarded-For entry (added by the nearest proxy) or the socket's. */
function clientAddress(req: http.IncomingMessage): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').pop()?.trim();
  return last || req.socket?.remoteAddress || 'unknown';
}

/** Counts one new session for the address; false when it is over the limit. */
function claimNewSession(address: string, now: number): boolean {
  for (const [key, times] of newSessionTimes) {
    const recent = times.filter((t) => now - t < NEW_SESSION_WINDOW_MS);
    if (recent.length === 0) newSessionTimes.delete(key);
    else newSessionTimes.set(key, recent);
  }
  const times = newSessionTimes.get(address) ?? [];
  if (times.length >= NEW_SESSIONS_PER_WINDOW) return false;
  times.push(now);
  newSessionTimes.set(address, times);
  return true;
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
    if (!claimNewSession(clientAddress(req), Date.now())) throw new SessionRateLimited();
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

export interface BetaLimits {
  /** Most check-ups and comparisons one visitor session may start per UTC day. */
  perVisitor: number;
  /** Most the whole shared copy may start per UTC day. */
  perDay: number;
}

export const DEFAULT_RUNS_PER_VISITOR = 5;
export const DEFAULT_RUNS_PER_DAY = 40;

/** A limit that was reached: what to tell the tester, and when it resets. */
export interface BetaLimitHit {
  scope: 'visitor' | 'day';
  limit: number;
  resetsAt: string;
  error: string;
  suggestion: string;
}

function positiveWhole(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : fallback;
}

/** Limits from RUNNER_BETA_RUNS_PER_VISITOR and RUNNER_BETA_RUNS_PER_DAY; unset or invalid values use the defaults. */
export function betaLimitsFromEnv(env: Record<string, string | undefined> = process.env): BetaLimits {
  return {
    perVisitor: positiveWhole(env.RUNNER_BETA_RUNS_PER_VISITOR, DEFAULT_RUNS_PER_VISITOR),
    perDay: positiveWhole(env.RUNNER_BETA_RUNS_PER_DAY, DEFAULT_RUNS_PER_DAY),
  };
}

// The whole shared copy's count for one UTC day. Memory only: a restart starts it again.
let dayUsage: { day: string; count: number } = { day: '', count: 0 };

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);
const nextMidnight = (now: number): number => Date.parse(`${utcDay(now)}T00:00:00.000Z`) + 86_400_000;

function hitFor(scope: 'visitor' | 'day', limit: number, now: number): BetaLimitHit {
  const reset = nextMidnight(now);
  const hours = Math.max(1, Math.ceil((reset - now) / 3_600_000));
  const inAbout = `in about ${hours} hour${hours === 1 ? '' : 's'}`;
  return {
    scope,
    limit,
    resetsAt: new Date(reset).toISOString(),
    error:
      scope === 'visitor'
        ? `You have used your ${limit} check-ups for today on this shared copy (a comparison counts as one). The limit resets at 00:00 UTC, ${inAbout}.`
        : `This shared copy has reached its limit of ${limit} check-ups for today. It resets at 00:00 UTC, ${inAbout}.`,
    suggestion:
      'Come back after the reset, or run the QA Tool on your own computer or in your own GitHub Actions, which have no such limit.',
  };
}

/**
 * Beta: checks and records one check-up or comparison start in a single step. Returns null when it is
 * allowed (and now counted), or the limit that was reached (nothing is counted then). The day's cap is
 * checked first, then the visitor's. With no session (or one that was forgotten) only the day's cap applies.
 * The counts are in memory and are never keyed on an address.
 */
export function claimBetaRun(
  sessionId: string | undefined,
  opts: { limits?: BetaLimits; now?: number } = {}
): BetaLimitHit | null {
  const limits = opts.limits ?? betaLimitsFromEnv();
  const now = opts.now ?? Date.now();
  const day = utcDay(now);
  if (dayUsage.day !== day) dayUsage = { day, count: 0 };
  if (dayUsage.count >= limits.perDay) return hitFor('day', limits.perDay, now);
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (session) {
    if (!session.usage || session.usage.day !== day) session.usage = { day, count: 0 };
    if (session.usage.count >= limits.perVisitor) return hitFor('visitor', limits.perVisitor, now);
    session.usage.count++;
  }
  dayUsage.count++;
  return null;
}

/** Test helper: forgets the day's count and every session's count. */
export function resetBetaUsage(): void {
  dayUsage = { day: '', count: 0 };
  newSessionTimes.clear();
  for (const s of sessions.values()) s.usage = undefined;
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
  return classifyAddress(address) !== null;
}

/**
 * Why a tester may not point the runner at this address, or null when it's fine. The name is resolved,
 * so a public-looking name that leads to a private address is refused too. A site that redirects to a
 * private address afterwards is not caught here.
 */
export async function refusedTarget(
  address: string,
  lookup?: (host: string) => Promise<string[]>
): Promise<string | null> {
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
    const found = lookup
      ? await lookup(host)
      : (await dns.promises.lookup(host, { all: true, verbatim: true })).map((f) => f.address);
    if (found.length === 0) return 'That address could not be found.';
    if (found.some((f) => isPrivateAddress(f))) return why;
  } catch {
    return 'That address could not be found.';
  }
  return null;
}

const PROOF_PREFIX = 'qa-verify:';
const PROOF_THROTTLE_MS = 10_000;

/**
 * The Verified Domain token for an exact origin in the current session: made on first use, kept in
 * this session's memory only (never on disk), never logged. Throws outside a session.
 */
export function proofTokenFor(origin: string): string {
  const id = current.getStore();
  const session = id ? sessions.get(id) : undefined;
  if (!session) throw new Error('No session');
  const key = PROOF_PREFIX + origin.toLowerCase();
  let token = session.secrets.get(key);
  if (!token) {
    token = randomBytes(24).toString('base64url');
    session.secrets.set(key, token);
  }
  return token;
}

/** The current session's token for an origin, or undefined when none was made (nothing is created). */
export function peekProofToken(origin: string): string | undefined {
  const id = current.getStore();
  return (id ? sessions.get(id) : undefined)?.secrets.get(PROOF_PREFIX + origin.toLowerCase());
}

/** True when this session may fetch the proof for the origin now (one fetch per origin per 10 seconds); counts it. */
export function claimProofCheck(origin: string, now: number = Date.now()): boolean {
  const id = current.getStore();
  const session = id ? sessions.get(id) : undefined;
  if (!session) return false;
  const checks = (session.proofChecks ??= new Map());
  const key = origin.toLowerCase();
  const last = checks.get(key);
  if (last !== undefined && now - last < PROOF_THROTTLE_MS) return false;
  checks.set(key, now);
  return true;
}
