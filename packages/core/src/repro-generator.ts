import { promises as fs } from 'fs';
import path from 'path';
import type { Finding, TestCase } from '@qa/types';

/** A value as a single-quoted JavaScript string literal, quotes included. */
function js(value: unknown): string {
  const text = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return "'" + text + "'";
}

/** Text that is safe inside a comment: one line, and it cannot close a block comment. */
function comment(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\*\//g, '* /');
}

export class ReproScriptGenerator {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  async generate(finding: Finding, testCase?: TestCase, baseUrl = 'http://localhost:3000'): Promise<string> {
    await fs.mkdir(this.outputDir, { recursive: true });
    const filename = `repro-${finding.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.ts`;
    const filePath = path.join(this.outputDir, filename);

    const stepsCode =
      testCase?.steps
        .map((s) => {
          const label = `  // Step: ${comment(s.name)}\n`;
          if (s.action === 'click') return `${label}  await page.locator(${js(s.selector)}).click();`;
          if (s.action === 'fill') return `${label}  await page.locator(${js(s.selector)}).fill(${js(s.value || '')});`;
          if (s.action === 'navigate') return `${label}  await page.goto(${js(s.value)});`;
          return `${label}  await page.waitForTimeout(500);`;
        })
        .join('\n\n') || `  // Finding reproduced on page\n  await page.goto(${js(finding.where.urlPath)});`;

    const startPage = testCase?.startPage || finding.where.urlPath;

    const script = `/**
 * Standalone Playwright Reproduction Script for Finding ${comment(finding.id)}
 * Title: ${comment(finding.title)}
 * Severity: ${comment(finding.severity)}
 * Checker: ${comment(finding.checker)}
 *
 * To run:
 * npx tsx ${path.relative(process.cwd(), filePath).replace(/\\/g, '/')}
 */

import { chromium } from 'playwright';

async function reproduce() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    baseURL: ${js(baseUrl)},
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log(${js(`Navigating to initial page: ${startPage}`)});
  await page.goto(${js(startPage)});

${stepsCode}

  console.log(${js(`Expected: ${finding.expectedVsActual.expected}`)});
  console.log(${js(`Actual:   ${finding.expectedVsActual.actual}`)});
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
