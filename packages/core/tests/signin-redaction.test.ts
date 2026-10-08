import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { ReviewPlan } from '@qa/types';
import { BrowserManager } from '../src/browser.js';
import { PreFlightChecker } from '../src/preflight.js';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import { planToMarkdown } from '../src/plan/markdown.js';
import { FlowTestOrchestrator, type OrchestratorEvent } from '../src/orchestrator.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

const PASSWORD = 'two-step-password';
const USERNAME = 'two-step@example.com';

describe('Sign-in keeps the seeded username and password out of logs, reports and the Plan', () => {
  const PORT = 3615;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-signin-redaction');
  const browser = new BrowserManager();

  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(PORT, () => resolve()));
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  async function allFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? allFiles(path.join(dir, e.name)) : Promise.resolve([path.join(dir, e.name)])
      )
    );
    return nested.flat();
  }

  const leaks = (text: string) => [PASSWORD, USERNAME].filter((secret) => text.includes(secret));

  it('keeps seeded username and password out of logs, report files and the Plan', async () => {
    const logged: string[] = [];
    const spies = (['log', 'warn', 'error', 'info'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      })
    );
    const returned: unknown[] = [];
    const events: OrchestratorEvent[] = [];
    try {
      const checker = new PreFlightChecker();
      const attempts: Array<[string, string, string]> = [
        ['/login-two-step', USERNAME, PASSWORD],
        ['/login-modal', USERNAME, PASSWORD],
        ['/login-two-step', USERNAME, 'wrong-password-xyz'],
        ['/login-two-step', 'wrong-user@example.com', PASSWORD],
        ['/signin', USERNAME, 'wrong-password-xyz'],
      ];
      for (const [loginPath, username, password] of attempts) {
        const context = await browser.createContext({ baseUrl });
        try {
          returned.push(await checker.signIn(context, baseUrl, { role: 'manager', username, password, loginPath }));
        } finally {
          await context.close();
        }
      }

      // Discovery signed in with the seeded account: draft file and Plan text.
      const discoveryDir = path.join(outputDir, 'discovery');
      const draft = await new DiscoveryAgent().discover({
        targetUrl: baseUrl,
        productId: 'fixture',
        outputDir: discoveryDir,
        aiProvider: new MockAIProvider(),
        profile: {
          name: 'Fixture',
          productId: 'fixture',
          roles: [{ role: 'manager', username: USERNAME, password: PASSWORD, loginPath: '/signin' }],
        },
      });
      const plan: ReviewPlan = {
        runId: 'signin-redaction',
        targetUrl: baseUrl,
        discoveredAt: new Date().toISOString(),
        pages: draft.pages,
        flows: draft.flows,
        questions: draft.ambiguityQuestions,
        signedInAs: draft.exploration?.signedInAs,
      };
      returned.push(draft, planToMarkdown(plan));

      // A check-up with a sign-in step: every file it writes, and every event.
      const runDir = path.join(outputDir, 'run');
      await new FlowTestOrchestrator().run({
        targetUrl: baseUrl,
        productId: 'fixture',
        outputDir: runDir,
        breakpoints: ['1440px'],
        enableA11y: false,
        recordVideo: false,
        onEvent: (e) => events.push(e),
        profile: {
          name: 'Fixture',
          productId: 'fixture',
          roles: [{ role: 'manager', username: USERNAME, password: PASSWORD, loginPath: '/signin' }],
        },
        specTestCases: [
          {
            id: 'TC-SIGN-IN',
            flowId: 'FLOW-SIGN-IN',
            role: 'manager',
            startPage: '/signin',
            steps: [
              { action: 'fill', selector: '#signin-email', value: '{{username}}', name: 'Enter email' },
              { action: 'fill', selector: '#signin-password', value: '{{password}}', name: 'Enter password' },
              { action: 'click', selector: '[data-testid="signin-btn"]', name: 'Sign in' },
            ],
            expectations: { url: { pattern: '/account' } },
          },
        ],
      });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }

    expect(leaks(JSON.stringify(returned))).toEqual([]);
    expect(leaks(logged.join('\n'))).toEqual([]);
    expect(leaks(JSON.stringify(events))).toEqual([]);

    const leakyFiles: string[] = [];
    for (const file of await allFiles(outputDir)) {
      // Saved browser sign-in state lives under auth/ on purpose; images and videos are not text.
      if (/\.(png|webm)$/.test(file) || file.includes(`${path.sep}auth${path.sep}`)) continue;
      const text = await fs.readFile(file, 'utf8');
      if (leaks(text).length > 0) leakyFiles.push(path.relative(outputDir, file));
    }
    expect(leakyFiles).toEqual([]);
  }, 180000);
});
