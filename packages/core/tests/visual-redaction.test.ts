import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Finding, ReleaseReport } from '@qa/types';
import { Redactor } from '../src/redact.js';
import { withPortablePaths } from '../src/reporter.js';
import { generateSingleFileHtmlReport } from '../src/html-report.js';

describe('visual evidence redaction', () => {
  const redactor = new Redactor([{ role: 'u', username: 'u@example.com', password: 'hunter2secret' }]);

  it('visual evidence: Redactor.files leaves PNG bytes untouched (file containing the password bytes)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-visual-red-'));
    try {
      const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('hunter2secret')]);
      const file = path.join(dir, 'visual-current.png');
      await fs.writeFile(file, bytes);
      await redactor.files(dir);
      expect((await fs.readFile(file)).equals(bytes)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('visual evidence: deep hides ?password= in finding text before the report is written; new evidence paths survive deep', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-visual-red-'));
    try {
      await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
      const finding: Finding = {
        id: 'F-VISUAL-1',
        title: 'Visual regression against baseline at 1440px',
        severity: 'Minor',
        checker: 'design-standards',
        where: { urlPath: '/login?password=hunter2secret', role: 'u', breakpoint: '1440px' },
        expectedVsActual: { expected: 'Matches /login?password=hunter2secret', actual: '5% differ' },
        stepsToReproduce: [],
        evidence: {
          baselineScreenshotPath: path.join(dir, 'evidence', 'visual-baseline.png'),
          currentScreenshotPath: path.join(dir, 'evidence', 'visual-current.png'),
        },
        resolution: 'Approve or fix',
      };
      const report = {
        runId: 'r',
        productId: 'p',
        targetUrl: 'http://localhost:1',
        timestamp: new Date().toISOString(),
        durationMs: 1,
        coverage: {
          totalTestPoints: 1,
          passed: 1,
          failed: 0,
          blocked: 0,
          skipped: 0,
          couldNotVerify: 0,
          completionRate: 100,
        },
        results: [],
        findings: [finding],
      } as unknown as ReleaseReport;
      const portable = withPortablePaths(redactor.deep(report), dir);
      expect(portable.findings[0].evidence.baselineScreenshotPath).toBe('evidence/visual-baseline.png');
      expect(portable.findings[0].evidence.currentScreenshotPath).toBe('evidence/visual-current.png');
      const html = await fs.readFile(await generateSingleFileHtmlReport(portable, { outputDir: dir }), 'utf8');
      expect(html).not.toContain('hunter2secret');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
