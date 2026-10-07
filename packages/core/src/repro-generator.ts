import { promises as fs } from 'fs';
import path from 'path';
import type { Finding, TestCase } from '@qa/types';

export class ReproScriptGenerator {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  async generate(finding: Finding, testCase?: TestCase, baseUrl = 'http://localhost:3000'): Promise<string> {
    await fs.mkdir(this.outputDir, { recursive: true });
    const filename = `repro-${finding.id}.ts`;
    const filePath = path.join(this.outputDir, filename);

    const stepsCode =
      testCase?.steps
        .map((s) => {
          if (s.action === 'click') {
            return `  // Step: ${s.name}\n  await page.locator('${s.selector}').click();`;
          }
          if (s.action === 'fill') {
            return `  // Step: ${s.name}\n  await page.locator('${s.selector}').fill('${s.value || ''}');`;
          }
          if (s.action === 'navigate') {
            return `  // Step: ${s.name}\n  await page.goto('${s.value}');`;
          }
          return `  // Step: ${s.name}\n  await page.waitForTimeout(500);`;
        })
        .join('\n\n') || `  // Finding reproduced on page\n  await page.goto('${finding.where.urlPath}');`;

    const script = `/**
 * Standalone Playwright Reproduction Script for Finding ${finding.id}
 * Title: ${finding.title}
 * Severity: ${finding.severity}
 * Checker: ${finding.checker}
 *
 * To run:
 * npx tsx ${path.relative(process.cwd(), filePath).replace(/\\/g, '/')}
 */

import { chromium } from 'playwright';

async function reproduce() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    baseURL: '${baseUrl}',
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log('Navigating to initial page: ${testCase?.startPage || finding.where.urlPath}');
  await page.goto('${testCase?.startPage || finding.where.urlPath}');

${stepsCode}

  console.log('Expected: ${finding.expectedVsActual.expected.replace(/'/g, "\\'")}');
  console.log('Actual:   ${finding.expectedVsActual.actual.replace(/'/g, "\\'")}');
  console.log('Reproduction complete. Keeping browser open for 5 seconds...');
  await page.waitForTimeout(5000);
  await browser.close();
}

reproduce().catch((err) => {
  console.error('Error running reproduction script:', err);
  process.exit(1);
});
`;

    await fs.writeFile(filePath, script, 'utf8');
    return filePath;
  }
}
