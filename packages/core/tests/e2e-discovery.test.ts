import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { TestPlanner } from '../src/discovery/test-planner.js';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import { server } from '../../../fixtures/test-app/server.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('DiscoveryAgent E2E Pipeline', () => {
  const PORT = 3095;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-e2e-discovery');

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(PORT, () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should discover routes, synthesize flows, plan test cases, and execute them end-to-end', async () => {
    const aiProvider = new MockAIProvider();
    const agent = new DiscoveryAgent();

    // 1. Run Discovery
    const draft = await agent.discover({
      targetUrl: baseUrl,
      productId: 'fixture-product',
      profile: {
        name: 'Fixture Product',
        productId: 'fixture-product',
        roles: [{ role: 'manager', username: 'admin@example.com', password: 'secret', loginPath: '/login' }],
        forbiddenActions: ['delete', 'pay'],
      },
      outputDir,
      aiProvider,
    });

    expect(draft).toBeDefined();
    expect(draft.pages.length).toBeGreaterThanOrEqual(4);
    expect(draft.flows.length).toBeGreaterThanOrEqual(1);

    // Verify draft file was written
    const draftFilePath = path.join(outputDir, 'discovery-draft.json');
    const draftFileExists = await fs
      .stat(draftFilePath)
      .then(() => true)
      .catch(() => false);
    expect(draftFileExists).toBe(true);

    // 2. Plan Spec
    const planner = new TestPlanner();
    const spec = planner.plan(draft);

    expect(spec.testCases.length).toBeGreaterThanOrEqual(1);
    const invoiceCase = spec.testCases.find((tc) => tc.flowId.includes('001') || tc.name?.includes('Invoice'));
    expect(invoiceCase).toBeDefined();

    // 3. Execute planned test case through Orchestrator
    const orchestrator = new FlowTestOrchestrator();
    const report = await orchestrator.run({
      targetUrl: baseUrl,
      productId: 'fixture-product',
      specTestCases: spec.testCases,
      outputDir: path.join(outputDir, 'run-results'),
      breakpoints: ['1440px'],
      repoRoot: process.cwd(),
      enableA11y: false,
    });

    expect(report).toBeDefined();
    expect(report.results.length).toBeGreaterThanOrEqual(1);

    const invoiceRun = report.results.find((r) => r.testCaseId === invoiceCase?.id);
    expect(invoiceRun).toBeDefined();
    expect(invoiceRun?.status).toBe('Passed');
  }, 45000);
});
