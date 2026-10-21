import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { server } from '../../../fixtures/test-app/server.js';
import type { TestCase, ProductProfile } from '@qa/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const orchestratorSource = readFileSync(path.join(here, '..', 'src', 'orchestrator.ts'), 'utf8');

describe('once-per-page wiring (T-55)', () => {
  it('checks links once per page per run, with the run-wide cache', () => {
    expect(orchestratorSource).toContain('const linkChecked = new Set<string>();');
    expect(orchestratorSource).toContain('const linkCache = new Map<string, Promise<number | null>>();');
    expect(orchestratorSource).toContain('const seoLinks = searchHere && !linkChecked.has(seoPath);');
    expect(orchestratorSource).toContain('checkLinks: seoLinks,');
    expect(orchestratorSource).toContain('linkCache,');
  });

  it('runs headers and site-file security checks once per page per run', () => {
    expect(orchestratorSource).toContain('const securityChecked = new Set<string>();');
    expect(orchestratorSource).toContain('!securityChecked.has(securityPath)');
    expect(orchestratorSource).toContain('...(securityHere');
  });

  it('keeps the keyboard and reflow once-per-page pattern', () => {
    expect(orchestratorSource).toContain('if (!keyboardChecked.has(urlPath)) {');
    expect(orchestratorSource).toContain('if (!reflowChecked.has(urlPath)) {');
  });

  it('defaults to three screen sizes (decision 5)', () => {
    expect(orchestratorSource).toContain("options.breakpoints || ['375px', '768px', '1440px']");
  });

  it('keeps the timing and retry wiring from earlier tickets', () => {
    expect(orchestratorSource).toContain("timedAs('seo')");
    expect(orchestratorSource).toContain("timedAs('security-depth')");
    expect(orchestratorSource).toContain('...(timer.enabled ? { timing: timer.entries } : {}),');
    expect(orchestratorSource).toContain("testCase.kind === 'link' ? 0 :");
  });
});

describe('FlowTestOrchestrator at three sizes on the fixture (T-55)', () => {
  const PORT = 3098;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-t55-once-per-page');

  const testCases: TestCase[] = [
    {
      id: 'TC-T55-001',
      requirementId: 'REQ-TELEMETRY-01',
      flowId: 'dashboard-telemetry',
      name: 'Dashboard loads',
      role: 'manager',
      startPage: '/dashboard',
      steps: [{ action: 'wait', name: 'Wait' }],
      expectations: { text: { contains: 'Welcome back, Manager!' } },
    },
  ];

  const profile: ProductProfile = {
    name: 'Fixture App',
    productId: 'fixture-app',
    roles: [{ role: 'manager', username: 'manager@example.com', password: 'manager-password', loginPath: '/signin' }],
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('runs one test point per size and finishes with the same findings shape', async () => {
    const report = await new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'fixture-test',
      specTestCases: testCases,
      profile,
      outputDir,
      breakpoints: ['375px', '768px', '1440px'],
      recordVideo: false,
      flakyReruns: 0,
    });
    const points = report.results.filter((r) => r.testCaseId === 'TC-T55-001');
    expect(points.map((p) => p.breakpoint).sort()).toEqual(['1440px', '375px', '768px']);
    expect(Array.isArray(report.findings)).toBe(true);
  }, 180000);
});
