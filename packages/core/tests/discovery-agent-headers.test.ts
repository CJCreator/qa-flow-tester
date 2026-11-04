import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fs, mkdtempSync } from 'fs';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { DiscoveryAgent, type DiscoveryOptions } from '../src/discovery/discovery-agent.js';
import { SignInFailedError } from '../src/preflight.js';
import type { AIMessage, AICompletionOptions, AIProviderType, ProductProfile } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';

class EmptyPlanAI implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  private planner = new MockAIProvider();
  async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    if (!prompt.includes('synthesizing application flows')) return this.planner.generateText(messages, options);
    return JSON.stringify({ flows: [] });
  }
}

describe('Discovery Agent headers, handoff, and session awareness (T-113)', () => {
  let port: number;
  let fixtureUrl: string;
  // A new folder per run, outside the repository: inside OneDrive the sync client picks up every file a run
  // writes, competes with Chromium for the CPU and holds files open so the clean-up fails.
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'qa-test-discovery-headers-'));

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      fixtureServer.listen(0, () => {
        const addr = fixtureServer.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
          fixtureUrl = `http://localhost:${port}`;
        }
        resolve();
      });
    });
    await fs.mkdir(outputDir, { recursive: true });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });

  const testProfile: ProductProfile = {
    name: 'Fixture App',
    productId: 'fixture-app',
    roles: [
      {
        role: 'manager',
        username: 'manager@example.com',
        password: 'manager-password',
        loginPath: '/signin',
        postLoginUrl: '/account',
      },
    ],
  };

  it('customHeaders reach sign-in, visitor crawl, role crawl, and narrow screens pass', async () => {
    await fetch(`${fixtureUrl}/lab/stats/reset`, { method: 'POST' });

    const outcome = await new DiscoveryAgent().discoverWithSession({
      targetUrl: `${fixtureUrl}/lab/headers`,
      productId: 'fixture-app',
      outputDir: path.join(outputDir, 'headers-echo'),
      aiProvider: new EmptyPlanAI(),
      customHeaders: {
        'x-qa-bypass-token': 'bypass-test-token',
      },
      userAgent: 'QA-Custom-Bot/1.0',
      profile: testProfile,
    });

    const res = await fetch(`${fixtureUrl}/lab/stats`);
    const stats = (await res.json()) as { headerHits: Record<string, number> };

    // Header reached signin during preflight
    expect(stats.headerHits['/signin']).toBeGreaterThanOrEqual(1);
    // Header reached visitor or role crawl
    expect(stats.headerHits['/lab/headers']).toBeGreaterThanOrEqual(1);

    // discoverWithSession returns preflight
    expect(outcome.preflight).toBeDefined();
    expect(outcome.preflight?.roleStorageStates?.manager).toBeDefined();

    // Draft JSON contains no storage-state path or cookies
    const draftJson = JSON.stringify(outcome.draft);
    expect(draftJson).not.toContain(outcome.preflight?.roleStorageStates?.manager);
    expect(draftJson).not.toContain('manager-password');
  }, 180000); // a sign-in, a visitor crawl, a role crawl and narrow screens in Chromium: over 60 s alone on a busy 4-core laptop

  it('/lab/expiring as a signed-in role reports session-expired and fixed note', async () => {
    await fetch(`${fixtureUrl}/lab/stats/reset`, { method: 'POST' });
    await fetch(`${fixtureUrl}/lab/expiring/start?n=1`, { method: 'POST' });

    const outcome = await new DiscoveryAgent().discoverWithSession({
      targetUrl: `${fixtureUrl}/lab/expiring`,
      productId: 'fixture-app',
      outputDir: path.join(outputDir, 'expiring-discovery'),
      aiProvider: new EmptyPlanAI(),
      profile: {
        name: 'Fixture App',
        productId: 'fixture-app',
        roles: [
          {
            role: 'manager',
            username: 'manager@example.com',
            password: 'manager-password',
            loginPath: '/signin',
            postLoginUrl: '/account',
          },
        ],
      },
      remembered: {
        pages: {
          '/lab/expiring/1': { added: true, tests: [], source: 'fallback' },
          '/lab/expiring/2': { added: true, tests: [], source: 'fallback' },
          '/lab/expiring/3': { added: true, tests: [], source: 'fallback' },
          '/lab/expiring/4': { added: true, tests: [], source: 'fallback' },
        },
        navigation: {},
        flows: [],
      },
    });

    expect(outcome.draft.exploration?.signInFailures?.manager).toBe('session-expired');
    expect(outcome.draft.exploration?.notes).toContain(
      "manager's sign-in stopped working part-way; pages after that were not explored"
    );
  }, 60000);

  it('/lab/expiring with requireSignIn throws SignInFailedError with reason session-expired', async () => {
    await fetch(`${fixtureUrl}/lab/stats/reset`, { method: 'POST' });
    await fetch(`${fixtureUrl}/lab/expiring/start?n=1`, { method: 'POST' });

    await expect(
      new DiscoveryAgent().discoverWithSession({
        targetUrl: `${fixtureUrl}/lab/expiring`,
        productId: 'fixture-app',
        outputDir: path.join(outputDir, 'expiring-req-signin'),
        aiProvider: new EmptyPlanAI(),
        profile: {
          name: 'Fixture App',
          productId: 'fixture-app',
          roles: [
            {
              role: 'manager',
              username: 'manager@example.com',
              password: 'manager-password',
              loginPath: '/signin',
              postLoginUrl: '/account',
            },
          ],
        },
        remembered: {
          pages: {
            '/lab/expiring/1': { added: true, tests: [], source: 'fallback' },
            '/lab/expiring/2': { added: true, tests: [], source: 'fallback' },
            '/lab/expiring/3': { added: true, tests: [], source: 'fallback' },
            '/lab/expiring/4': { added: true, tests: [], source: 'fallback' },
          },
          navigation: {},
          flows: [],
        },
        requireSignIn: true,
      })
    ).rejects.toThrow(SignInFailedError);
  }, 60000);

  it('with deadlineAt in the past, crawls end immediately with time-limit entries and call resolves', async () => {
    const outcome = await new DiscoveryAgent().discoverWithSession({
      targetUrl: `${fixtureUrl}/lab`,
      productId: 'fixture-app',
      outputDir: path.join(outputDir, 'past-deadline'),
      aiProvider: new EmptyPlanAI(),
      deadlineAt: Date.now() - 5000,
      profile: testProfile,
    });

    expect(outcome).toBeDefined();
    const skipped = outcome.draft.exploration?.pageCoverage?.skipped || [];
    expect(skipped.some((s) => s.why === 'time-limit')).toBe(true);
  }, 60000);

  it('pageCoverage.skipped contains http-error with a status for /lab/always-500', async () => {
    const outcome = await new DiscoveryAgent().discoverWithSession({
      targetUrl: `${fixtureUrl}/lab/always-500`,
      productId: 'fixture-app',
      outputDir: path.join(outputDir, 'always-500'),
      aiProvider: new EmptyPlanAI(),
    });

    const skipped = outcome.draft.exploration?.pageCoverage?.skipped || [];
    const item = skipped.find((s) => s.urlPath === '/lab/always-500');
    expect(item).toBeDefined();
    expect(item?.why).toBe('http-error');
    expect(item?.status).toBe(500);
  }, 60000);

  it('pageCoverage routes are present and capped at 500 with redirectChain <= 5', async () => {
    const outcome = await new DiscoveryAgent().discoverWithSession({
      targetUrl: `${fixtureUrl}/lab`,
      productId: 'fixture-app',
      outputDir: path.join(outputDir, 'coverage-routes'),
      aiProvider: new EmptyPlanAI(),
    });

    const routes = outcome.draft.exploration?.pageCoverage?.routes;
    expect(routes).toBeDefined();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes!.length).toBeLessThanOrEqual(500);
    for (const r of routes!) {
      if (r.redirectChain) {
        expect(r.redirectChain.length).toBeLessThanOrEqual(5);
      }
    }
    // Crawls up to 500 routes: about a minute alone, more on a shared runner.
  }, 180000);
});
