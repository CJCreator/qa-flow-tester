import { describe, it, expect, afterAll } from 'vitest';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { promises as fs } from 'fs';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import type { PreFlightResult } from '../src/preflight.js';
import type { ProductProfile } from '@qa/types';

// Browser-free: the browser manager and sign-in checker are stubbed; only plain GETs are answered.
describe('orchestrator runs the access checks (ADR 0030)', () => {
  const outputDir = path.join(process.cwd(), '.tmp-orchestrator-access-wiring');
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

  // T-43: the access checks use the pinned, guarded GET (ADR 0031), not the browser, so the test serves
  // the page from a local server and gives each role a cookie state for that host.
  const cookieState = (value: string) => ({
    cookies: [{ name: 'sid', value, domain: '127.0.0.1', path: '/' }],
    origins: [],
  });
  const preflight = {
    ok: true,
    roleAuthResults: { alice: true, bob: true },
    roleStorageStates: { alice: cookieState('a'), bob: cookieState('b') },
    roleLandingPaths: { alice: '/account', bob: '/account' },
    roleFailures: {},
    roleDiagnostics: {},
  } as unknown as PreFlightResult;

  it('finds a page that opens signed out and one that leaks another role name', async () => {
    const requests: Array<{ url: string; cookie?: string }> = [];
    // Every visitor is served the same page, which names alice: signed out sees it (open page),
    // and bob sees alice's name (isolation).
    const server = http.createServer((req, res) => {
      requests.push({ url: req.url ?? '', cookie: req.headers.cookie });
      res.setHeader('content-type', 'text/html');
      res.end('<main>Account for alice-user</main>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const orchestrator = new FlowTestOrchestrator();
    (orchestrator as any).browserManager = {
      close: async () => {},
    };
    (orchestrator as any).preflightChecker = { runPreFlight: async () => preflight };

    let report: Awaited<ReturnType<typeof orchestrator.run>>;
    try {
      report = await orchestrator.run({
        targetUrl: base,
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
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(requests.some((r) => !r.cookie && r.url.endsWith('/account'))).toBe(true);
    const ids = report.findings.map((f) => f.id);
    expect(ids.some((i) => i.startsWith('F-ACCESS-OPEN-'))).toBe(true);
    expect(ids.some((i) => i.startsWith('F-ACCESS-ISOLATION-alice-bob-'))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('pw-a');
  });
});
