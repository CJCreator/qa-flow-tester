/**
 * issues.md and issues.html download like the other report files, and accepting a "Needs your
 * judgement" item makes it count and writes the issues files again.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';

const PORT = 3729;
const outputDir = path.join(process.cwd(), '.tmp-issues-download');
const dataDir = `${outputDir}-data`;
const runId = 'run-1700000000000';
const base = `http://localhost:${PORT}/api/runs/${runId}`;

const finding = {
  id: 'F-1',
  severity: 'Major',
  checker: 'bug-detection',
  title: 'Totals look off on the invoice',
  where: { urlPath: '/invoices', role: 'member', breakpoint: '1440px' },
  expectedVsActual: { expected: 'a total', actual: 'a different total' },
  stepsToReproduce: ['Open /invoices'],
  evidence: {},
  resolution: 'Check the total',
  needsConfirmation: true,
  needsJudgement: true,
};

describe('Issues files', () => {
  let runner: RunnerServer;
  beforeAll(async () => {
    const dir = path.join(outputDir, 'runs', runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'report.json'),
      JSON.stringify({
        runId,
        targetUrl: 'http://localhost:1/',
        timestamp: new Date().toISOString(),
        findings: [finding],
        results: [],
        grades: [],
        recommendations: [],
      })
    );
    await fs.writeFile(path.join(dir, 'issues.md'), '# Issues\n');
    await fs.writeFile(path.join(dir, 'issues.html'), '<h1>Issues</h1>');
    runner = new RunnerServer({ port: PORT, outputDir, dataDir });
    await runner.start();
  });
  afterAll(async () => {
    await runner.stop();
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('serves issues.md and issues.html as downloads', async () => {
    const md = await fetch(`${base}/download/issues.md`);
    expect(md.status).toBe(200);
    expect(md.headers.get('content-type')).toContain('text/markdown');
    expect(md.headers.get('content-disposition')).toContain('attachment');
    const html = await fetch(`${base}/download/issues.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    expect((await fetch(`${base}/download/secret.json`)).status).toBe(404);
  });

  it('accepting a judgement item counts it and rewrites the issues files', async () => {
    const res = await fetch(`${base}/accept-judgement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titles: [finding.title] }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const report = (await res.json()) as { findings: Array<{ needsConfirmation?: boolean; judgementAccepted?: boolean }> };
    expect(report.findings[0].judgementAccepted).toBe(true);
    expect(report.findings[0].needsConfirmation).toBeUndefined();
    const md = await fs.readFile(path.join(outputDir, 'runs', runId, 'issues.md'), 'utf8');
    expect(md).toContain('Totals look off on the invoice');
    expect(md).not.toMatch(/\bbug\b/i);
  });
});
