import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { server } from '../../../fixtures/test-app/server.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { TestCase, ProductProfile } from '@qa/types';

describe('FlowTestOrchestrator E2E', () => {
  const PORT = 3085;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-e2e-qa-report');

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

  it('should execute test cases, capture evidence, detect bugs, and produce report with traceability', async () => {
    const testCases: TestCase[] = [
      {
        id: 'TC-E2E-001',
        requirementId: 'REQ-INVOICE-01',
        flowId: 'invoice-creation',
        name: 'Create Invoice Flow',
        role: 'manager',
        startPage: '/invoices/new',
        steps: [
          { action: 'fill', selector: '[data-testid="customer-field"]', value: 'Globex Corp', name: 'Customer' },
          { action: 'fill', selector: '[data-testid="amount-field"]', value: '4500', name: 'Amount' },
          { action: 'click', selector: '[data-testid="save-btn"]', name: 'Submit' },
          { action: 'wait', name: 'Wait for navigation' },
        ],
        expectations: {
          url: { pattern: '/invoices/*' },
          text: { contains: 'Invoice created successfully' },
        },
      },
      {
        id: 'TC-E2E-002',
        requirementId: 'REQ-TELEMETRY-01',
        flowId: 'dashboard-telemetry',
        name: 'Dashboard Telemetry and Error Checking',
        role: 'manager',
        startPage: '/dashboard',
        steps: [
          { action: 'click', selector: '[data-testid="trigger-error-btn"]', name: 'Trigger console error' },
          { action: 'click', selector: '[data-testid="trigger-failed-api-btn"]', name: 'Trigger 500 error' },
        ],
        expectations: {
          text: { contains: 'Welcome back, Manager!' },
        },
      },
    ];

    const profile: ProductProfile = {
      name: 'Fixture App',
      productId: 'fixture-app',
      roles: [
        {
          role: 'manager',
          username: 'admin@example.com',
          password: 'secret',
          loginPath: '/login',
        },
      ],
    };

    const orchestrator = new FlowTestOrchestrator();
    const report = await orchestrator.run({
      targetUrl: baseUrl,
      productId: 'fixture-test',
      specTestCases: testCases,
      profile,
      headless: true,
      outputDir,
      breakpoints: ['1440px'],
      repoRoot: process.cwd(),
      enableA11y: false,
    });

    expect(report).toBeDefined();
    expect(report.results).toHaveLength(2);

    // TC-E2E-001 should pass cleanly
    const invoiceResult = report.results.find((r) => r.testCaseId === 'TC-E2E-001');
    expect(invoiceResult).toBeDefined();
    expect(invoiceResult?.status).toBe('Passed');

    // TC-E2E-002 should have detected the console error and 500 API call
    const telemetryResult = report.results.find((r) => r.testCaseId === 'TC-E2E-002');
    expect(telemetryResult).toBeDefined();
    expect(telemetryResult?.status).toBe('Failed');

    const consoleFinding = report.findings.find(
      (f) => f.title.toLowerCase().includes('console error') && f.testCaseId === 'TC-E2E-002'
    );
    expect(consoleFinding).toBeDefined();

    const apiFinding = report.findings.find((f) => f.title.includes('HTTP 500') && f.testCaseId === 'TC-E2E-002');
    expect(apiFinding).toBeDefined();

    // Video is retained only for the failed test point, and linked from its findings
    expect(invoiceResult?.videoPath).toBeUndefined();
    expect(telemetryResult?.videoPath).toMatch(/\.webm$/);
    // Report paths are relative to the report folder, so the report still works when moved.
    expect(path.isAbsolute(telemetryResult!.videoPath!)).toBe(false);
    expect((await fs.stat(path.join(outputDir, telemetryResult!.videoPath!))).size).toBeGreaterThan(0);
    expect(apiFinding?.evidence.videoPath).toBe(telemetryResult?.videoPath);
    // Each problem shows the screen it was found on: here, its test's latest screenshot.
    const lastScreen = [...telemetryResult!.stepEvidence].reverse().find((s) => s.screenshotPath)?.screenshotPath;
    expect(lastScreen).toBeTruthy();
    expect(apiFinding?.evidence.screenshotPath).toBe(lastScreen);
    expect(path.isAbsolute(apiFinding!.evidence.screenshotPath!)).toBe(false);
    const passedPointFiles = await fs.readdir(path.join(outputDir, 'evidence', 'TC-E2E-001-1440px'));
    expect(passedPointFiles.some((f) => f.endsWith('.webm'))).toBe(false);

    // Verify Traceability Matrix
    expect(report.traceability).toBeDefined();
    expect(report.traceability?.length).toBeGreaterThanOrEqual(2);
    const invoiceReq = report.traceability?.find((t) => t.requirementId === 'REQ-INVOICE-01');
    expect(invoiceReq?.status).toBe('Passed');

    // Verify files written to outputDir
    const reportMdPath = path.join(outputDir, 'report.md');
    const findingsJsonPath = path.join(outputDir, 'findings.json');

    const mdExists = await fs
      .stat(reportMdPath)
      .then(() => true)
      .catch(() => false);
    const jsonExists = await fs
      .stat(findingsJsonPath)
      .then(() => true)
      .catch(() => false);

    expect(mdExists).toBe(true);
    expect(jsonExists).toBe(true);

    const mdContent = await fs.readFile(reportMdPath, 'utf8');
    expect(mdContent).toContain('Requirement Traceability Matrix');
    expect(mdContent).toContain('REQ-INVOICE-01');
  }, 45000);

  it('records visual baselines, then flags a visual regression against them', async () => {
    const baselineDir = path.join(outputDir, 'baselines');
    const testCase: TestCase = {
      id: 'TC-VISUAL-001',
      flowId: 'login-page',
      name: 'Login page renders',
      role: 'anonymous',
      startPage: '/login',
      steps: [{ action: 'wait', name: 'Wait for page load' }],
      expectations: { url: { pattern: '/login*' } },
    };
    const profile: ProductProfile = {
      name: 'Fixture App',
      productId: 'fixture-app',
      roles: [],
      visualBaselineDir: baselineDir,
    };
    const run = (updateBaselines: boolean) =>
      new FlowTestOrchestrator().run({
        targetUrl: baseUrl,
        productId: 'fixture-test',
        specTestCases: [testCase],
        profile,
        outputDir: path.join(outputDir, 'visual-run'),
        enableA11y: false,
        recordVideo: false,
        updateBaselines,
      });
    const visualFindings = (r: Awaited<ReturnType<typeof run>>) =>
      r.findings.filter((f) => f.id.startsWith('F-VISUAL-'));

    await run(true);
    const baselinePath = path.join(baselineDir, 'TC-VISUAL-001-1440px.png');
    const baseline = await fs.readFile(baselinePath);

    // Unchanged page matches its own baseline
    expect(visualFindings(await run(false))).toHaveLength(0);

    // Paint a block over the baseline: the live page no longer matches it
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(baseline);
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 400; x++) {
        const i = (y * png.width + x) * 4;
        png.data[i] = 255;
        png.data[i + 1] = 0;
        png.data[i + 2] = 255;
      }
    }
    await fs.writeFile(baselinePath, PNG.sync.write(png));

    const [regression] = visualFindings(await run(false));
    expect(regression).toBeDefined();
    expect(regression.checker).toBe('design-standards');
    expect(regression.evidence.screenshotPath).toMatch(/visual-diff\.png$/);
  }, 60000);
});
