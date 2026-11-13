import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { BrowserContext, Route } from 'playwright';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import { PreFlightChecker, roleRequestHeaders, routeRoleHeaders, type PreFlightResult } from '../src/preflight.js';

type Handler = (route: Route) => Promise<void>;

function fakeRoute(url: string) {
  const fallback = vi.fn();
  const route = {
    request: () => ({ url: () => url, headers: () => ({ accept: '*/*' }) }),
    fallback,
  } as unknown as Route;
  return { route, fallback };
}

describe('roleRequestHeaders', () => {
  it('merges headers and a bearer token; no Role gives nothing', () => {
    expect(roleRequestHeaders({ role: 'api', username: '', token: 'tok-123', headers: { 'X-Team': 'red' } })).toEqual({
      'X-Team': 'red',
      Authorization: 'Bearer tok-123',
    });
    expect(roleRequestHeaders(undefined)).toEqual({});
  });
});

describe('routeRoleHeaders', () => {
  it('adds the headers on the site and its twin, never on a third party', async () => {
    let handler: Handler | undefined;
    const ctx = {
      route: vi.fn(async (_p: string, h: Handler) => {
        handler = h;
      }),
    } as unknown as BrowserContext;
    await routeRoleHeaders(ctx, 'https://app.example.com', { Authorization: 'Bearer tok-123' });
    expect(handler).toBeDefined();

    for (const url of ['https://app.example.com/x', 'https://www.app.example.com/x']) {
      const { route, fallback } = fakeRoute(url);
      await handler!(route);
      expect(fallback).toHaveBeenCalledWith({ headers: { accept: '*/*', Authorization: 'Bearer tok-123' } });
    }
    const third = fakeRoute('https://cdn.other.net/a.js');
    await handler!(third.route);
    expect(third.fallback).toHaveBeenCalledWith();
  });

  it('registers no route without headers', async () => {
    const ctx = { route: vi.fn(async () => {}) } as unknown as BrowserContext;
    await routeRoleHeaders(ctx, 'https://app.example.com', {});
    expect(ctx.route).not.toHaveBeenCalled();
  });
});

describe('the saved-session check', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  });

  it("sends the Role's token", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-headers-'));
    let handler: Handler | undefined;
    const fakeContext = {
      route: vi.fn(async (_p: string, h: Handler) => {
        handler = h;
      }),
      newPage: vi.fn(async () => {
        throw new Error('stop');
      }),
      close: vi.fn(async () => {}),
    } as unknown as BrowserContext;
    vi.spyOn(BrowserManager.prototype, 'createContext').mockResolvedValue(fakeContext);
    vi.spyOn(PreFlightChecker.prototype, 'runPreFlight').mockResolvedValue({
      ok: false,
      error: 'stop',
      roleAuthResults: { api: false },
      roleStorageStates: {},
      roleLandingPaths: {},
      roleFailures: {},
      roleDiagnostics: {},
    } as unknown as PreFlightResult);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      new FlowTestOrchestrator().run({
        targetUrl: 'https://app.example.com',
        productId: 'p',
        specTestCases: [],
        outputDir: tmpDir,
        profile: { name: 'p', productId: 'p', roles: [{ role: 'api', username: '', token: 'tok-123' }] },
        preflight: {
          ok: true,
          url: 'https://app.example.com',
          roleAuthResults: { api: true },
          roleStorageStates: { api: { cookies: [], origins: [] } },
        },
      } as never)
    ).rejects.toThrow(/Pre-flight check failed/);

    expect(handler).toBeDefined();
    const { route, fallback } = fakeRoute('https://app.example.com/dash');
    await handler!(route);
    expect(fallback).toHaveBeenCalledWith({ headers: { accept: '*/*', Authorization: 'Bearer tok-123' } });
  });
});
