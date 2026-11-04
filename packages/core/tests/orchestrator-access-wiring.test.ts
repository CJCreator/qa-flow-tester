import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { defaultNetDeps } from '../src/safe-net.js';
import path from 'path';
import { promises as fs } from 'fs';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import type { PreFlightResult } from '../src/preflight.js';
import type { ProductProfile } from '@qa/types';

// Browser-free: the browser manager and sign-in checker are stubbed; only plain GETs are answered.
describe('orchestrator runs the access checks (ADR 0030)', () => {
  const outputDir = path.join(process.cwd(), '.tmp-orchestrator-access-wiring');
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  const profile: ProductProfile = {
    name: 'Stub',
    productId: 'stub',
    roles: [
      { role: 'alice', username: 'alice-user', password: 'pw-a', loginPath: '/signin', postLoginUrl: '/account' },
      { role: 'bob', username: 'bob-user', password: 'pw-b', loginPath: '/signin', postLoginUrl: '/account' },
    ],
  };

  const preflight = {
    ok: true,
    roleAuthResults: { alice: true, bob: true },
    roleStorageStates: { alice: 'state-alice', bob: 'state-bob' },
    roleLandingPaths: { alice: '/account', bob: '/account' },
    roleFailures: {},
    roleDiagnostics: {},
  } as unknown as PreFlightResult;

  it('finds a page that opens signed out and one that leaks another role name', async () => {
    const requests: Array<{ state: string; url: string }> = [];
    const makeContext = (state: string) => ({
      newPage: async () => {
        throw new Error('no browser in this test');
      },
      close: async () => {},
      // The access fetcher sends the context's cookies through the pinned outbound path; the cookie
      // value tells the fake network which state asked.
      cookies: async () => (state === 'signed-out' ? [] : [{ name: 'state', value: state }]),
    });

    // Every state is served the same page, which names alice: signed out sees it (open page),
    // and bob sees alice's name (isolation).
    vi.spyOn(defaultNetDeps, 'lookup').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(defaultNetDeps, 'connect').mockImplementation(async (req) => {
      const cookie = req.headers['Cookie'] ?? req.headers['cookie'] ?? '';
      const m = /state=([^;]+)/.exec(cookie);
      requests.push({ state: m ? m[1] : 'signed-out', url: req.url.toString() });
      return { status: 200, headers: {}, body: '<main>Account for alice-user</main>' };
    });

    const orchestrator = new FlowTestOrchestrator();
    (orchestrator as any).browserManager = {
      createContext: async (o: { storageState?: string }) => makeContext(o.storageState ?? 'signed-out'),
      close: async () => {},
    };
    (orchestrator as any).preflightChecker = { runPreFlight: async () => preflight };

    const report = await orchestrator.run({
      targetUrl: 'http://stub.test',
      productId: 'stub',
      specTestCases: [],
      profile,
      preflight,
      outputDir,
      authDir: path.join(outputDir, 'auth'),
      breakpoints: ['1440px'],
      enableA11y: false,
      recordVideo: false,
      siteMap: { pages: [{ urlPath: '/account', reachedBy: ['alice'] }] } as any,
    });

    expect(requests.some((r) => r.state === 'signed-out' && r.url.endsWith('/account'))).toBe(true);
    const ids = report.findings.map((f) => f.id);
    expect(ids.some((i) => i.startsWith('F-ACCESS-OPEN-'))).toBe(true);
    expect(ids.some((i) => i.startsWith('F-ACCESS-ISOLATION-alice-bob-'))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('pw-a');
  });
});
