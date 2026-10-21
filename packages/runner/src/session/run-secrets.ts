import type { StorageStateData } from '@qa/types';
import fs from 'fs/promises';
import path from 'path';

export interface RunSecrets {
  readonly headers?: Record<string, string>;
  readonly tunnelAuth?: string;
  readonly headerHosts?: string[];
  readonly userAgent?: string;
  set(values: {
    headers?: Record<string, string>;
    tunnelAuth?: string;
    headerHosts?: string[];
    userAgent?: string;
  }): void;
  clear(): void;
  /** Saved sign-in states per role (today's `savedSessions`). */
  readonly savedSessions: Map<string, Record<string, StorageStateData>>;
  /** The per-run auth folder, outside the report folder (today's `runAuthDir`). */
  authDirFor(runId: string): string;
  /** Delete it when the run ends (today's `cleanAuthDir`). */
  clean(runId: string): Promise<void>;
  /** Delete the auth folders an earlier process left behind. Called once at startup, before any run. */
  sweepLeftovers(): Promise<void>;
}

export class DefaultRunSecrets implements RunSecrets {
  private _headers?: Record<string, string>;
  private _tunnelAuth?: string;
  private _headerHosts?: string[];
  private _userAgent?: string;
  readonly savedSessions = new Map<string, Record<string, StorageStateData>>();
  private readonly baseAuthDir: string;

  constructor(authDir: string) {
    this.baseAuthDir = authDir;
  }

  get headers(): Record<string, string> | undefined {
    return this._headers;
  }

  get tunnelAuth(): string | undefined {
    return this._tunnelAuth;
  }

  get headerHosts(): string[] | undefined {
    return this._headerHosts;
  }

  get userAgent(): string | undefined {
    return this._userAgent;
  }

  set(values: {
    headers?: Record<string, string>;
    tunnelAuth?: string;
    headerHosts?: string[];
    userAgent?: string;
  }): void {
    this._headers = values.headers;
    this._tunnelAuth = values.tunnelAuth;
    this._headerHosts = values.headerHosts;
    this._userAgent = values.userAgent;
  }

  clear(): void {
    this._headers = undefined;
    this._tunnelAuth = undefined;
    this._headerHosts = undefined;
    this._userAgent = undefined;
  }

  authDirFor(runId: string): string {
    return path.join(this.baseAuthDir, runId);
  }

  async clean(runId: string): Promise<void> {
    await fs.rm(this.authDirFor(runId), { recursive: true, force: true }).catch(() => {});
  }

  async sweepLeftovers(): Promise<void> {
    // A new process has no run or waiting plan in memory, so nothing kept there is still usable.
    const names = await fs.readdir(this.baseAuthDir).catch(() => [] as string[]);
    await Promise.all(
      names.map((name) => fs.rm(path.join(this.baseAuthDir, name), { recursive: true, force: true }).catch(() => {}))
    );
  }

  /**
   * Never serialize secret values to JSON (ADR 0021).
   */
  toJSON(): Record<string, unknown> {
    return {};
  }
}
