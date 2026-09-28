import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { chromium, type Browser } from 'playwright';
import { UXQualityChecker } from '@qa/checkers';
import { FlowTestOrchestrator } from '../src/orchestrator.js';

const ONE_SCREEN_APP = `<!doctype html><html lang="en"><head><title>Todos</title></head><body><main>
  <h1>todos</h1><label for="new">New todo</label><input id="new"><button>Add</button><button>Clear done</button>
</main></body></html>`;

const TINY_NEIGHBOURS = `<!doctype html><html lang="en"><head><title>Tiny</title></head><body><nav><a href="/">Home</a></nav><main>
  <h1>Tiny</h1>
  <button style="width:10px;height:10px;padding:0;margin:0" aria-label="One"></button><button style="width:10px;height:10px;padding:0;margin:0" aria-label="Two"></button>
</main></body></html>`;

describe('Dead-end rule and WCAG 2.2', () => {
  let browser: Browser;
  const checker = new UXQualityChecker();

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('does not call the start page of a one-screen app a dead end, but still flags other pages', async () => {
    const page = await browser.newPage();
    await page.setContent(ONE_SCREEN_APP);
    const context = { role: 'visitor', breakpoint: '1440px' as const, urlPath: '/todomvc/', enableAxe: false };

    const asStart = await checker.check(page, { ...context, entryPath: '/todomvc/' });
    expect(asStart.some((f) => f.title.startsWith('Dead End Page'))).toBe(false);

    const elsewhere = await checker.check(page, { ...context, entryPath: '/' });
    expect(elsewhere.some((f) => f.title.startsWith('Dead End Page'))).toBe(true);

    // Nothing to do and no way out is a dead end even where the review started.
    await page.setContent('<!doctype html><html lang="en"><body><main><h1>Lost in Space</h1><p>No way back.</p></main></body></html>');
    const empty = await checker.check(page, { ...context, urlPath: '/deadend', entryPath: '/deadend' });
    expect(empty.some((f) => f.title.startsWith('Dead End Page'))).toBe(true);
    await page.close();
  });

  it('checks WCAG 2.2 rules, such as minimum target size', async () => {
    // axe only runs in pages opened from a browser context.
    const page = await (await browser.newContext()).newPage();
    await page.setContent(TINY_NEIGHBOURS);
    const findings = await checker.check(page, { role: 'visitor', breakpoint: '1440px', urlPath: '/tiny' });
    expect(findings.map((f) => f.title)).toContainEqual(expect.stringContaining('(target-size)'));
    await page.close();
  });
});

describe('Reports explain every failure and travel well', () => {
  const PORT = 3508;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-small-fixes');
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html lang="en"><head><title>Home</title></head><body><nav><a href="/">Home</a></nav><main><h1>Home</h1></main></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('gives a test that could not run a finding saying why, and writes paths relative to the report folder', async () => {
    const report = await new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'small-fixes',
      outputDir,
      breakpoints: ['1440px'],
      enableA11y: false,
      recordVideo: false,
      specTestCases: [
        { id: 'TC-OK', flowId: 'home', role: 'visitor', startPage: '/', steps: [{ action: 'wait', name: 'Look' }], expectations: {} },
        {
          id: 'TC-DOWN',
          flowId: 'elsewhere',
          name: 'Open the help centre',
          role: 'visitor',
          startPage: 'http://localhost:1/help',
          steps: [{ action: 'wait', name: 'Look' }],
          expectations: {},
        },
      ],
    });

    const down = report.results.find((r) => r.testCaseId === 'TC-DOWN');
    expect(down?.status).toBe('Failed');
    expect(down?.findings.map((f) => f.title)).toEqual(['Couldn’t run “Open the help centre”']);
    expect(report.findings.some((f) => f.title === 'Couldn’t run “Open the help centre”')).toBe(true);

    const ok = report.results.find((r) => r.testCaseId === 'TC-OK');
    expect(ok?.stepEvidence[0].screenshotPath).toBe('evidence/TC-OK-1440px/step-1-Look.png');

    for (const file of ['findings.json', 'report.md']) {
      const content = await fs.readFile(path.join(outputDir, file), 'utf8');
      expect(content, file).not.toContain(path.resolve(outputDir));
      expect(content, file).not.toContain(path.resolve(outputDir).replace(/\\/g, '\\\\'));
    }
  }, 60000);
});
