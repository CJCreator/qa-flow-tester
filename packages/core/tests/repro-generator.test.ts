import { describe, it, expect, afterEach } from 'vitest';
import { ReproScriptGenerator } from '../src/repro-generator.js';
import type { Finding, TestCase } from '@qa/types';
import { promises as fs } from 'fs';
import path from 'path';

describe('ReproScriptGenerator', () => {
  const tempDir = path.resolve(__dirname, './temp-repro-test');

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('generates a valid standalone Playwright script file', async () => {
    const generator = new ReproScriptGenerator(tempDir);

    const mockFinding: Finding = {
      id: 'F-TEST-001',
      severity: 'Blocker',
      checker: 'spec-conformance',
      title: 'Save button failed to persist invoice',
      where: {
        urlPath: '/invoices/new',
        role: 'manager',
        breakpoint: '1440px',
      },
      expectedVsActual: {
        expected: 'Invoice saved with 200 OK',
        actual: 'Server returned 500 error',
      },
      stepsToReproduce: ['Navigate to /invoices/new', 'Click Save button'],
      evidence: {},
      resolution: 'Check API endpoint handler',
    };

    const mockTestCase: TestCase = {
      id: 'TC-001',
      flowId: 'invoice-creation',
      role: 'manager',
      startPage: '/invoices/new',
      steps: [
        { action: 'fill', selector: '#amount', value: '500', name: 'Enter amount' },
        { action: 'click', selector: '#save-btn', name: 'Click save' },
      ],
      expectations: {},
    };

    const scriptPath = await generator.generate(mockFinding, mockTestCase, 'http://localhost:3050');
    expect(scriptPath).toBeDefined();

    const fileContent = await fs.readFile(scriptPath, 'utf8');
    expect(fileContent).toContain('Standalone Playwright Reproduction Script for Finding F-TEST-001');
    expect(fileContent).toContain("await page.locator('#amount').fill('500');");
    expect(fileContent).toContain("await page.locator('#save-btn').click();");
    expect(fileContent).toContain('http://localhost:3050');
  });

  it('escapes quotes, backslashes, newlines and comment ends', async () => {
    const generator = new ReproScriptGenerator(tempDir);

    const mockFinding: Finding = {
      id: 'F-TEST-002',
      severity: 'Major',
      checker: 'spec-conformance',
      title: 'Ends a comment */ here',
      where: {
        urlPath: '/test',
        role: 'manager',
        breakpoint: '1440px',
      },
      expectedVsActual: {
        expected: "it's fine\nsecond line",
        actual: 'a\\b',
      },
      stepsToReproduce: [],
      evidence: {},
      resolution: '',
    };

    const mockTestCase: TestCase = {
      id: 'TC-002',
      flowId: 'flow-2',
      role: 'manager',
      startPage: '/test',
      steps: [
        { action: 'click', selector: "[aria-label='Close']", name: 'Close\nthe dialog' },
      ],
      expectations: {},
    };

    const scriptPath = await generator.generate(mockFinding, mockTestCase, 'http://localhost:3050');
    const fileContent = await fs.readFile(scriptPath, 'utf8');

    expect(fileContent).toContain("await page.locator('[aria-label=\\'Close\\']').click();");
    expect(fileContent).toContain("'Expected: it\\'s fine\\nsecond line'");
    expect(fileContent).toContain("'Actual:   a\\\\b'");
    expect(fileContent).not.toContain('*/ here');
    expect(fileContent).toContain('// Step: Close the dialog');

    expect(() => new Function(fileContent.replace(/^import .*$/m, '').replace(/await /g, ''))).not.toThrow();
  });
});
