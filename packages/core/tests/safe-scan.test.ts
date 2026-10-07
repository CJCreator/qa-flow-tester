import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { SafePublicCrawler } from '../src/competitive/safe-crawler.js';
import { runSafeWebsiteScan } from '../src/safe-scan.js';
import type { OrchestratorEvent } from '../src/orchestrator.js';

/**
 * A page built to tempt a crawler: an unlabeled button (accessibility issue), a console error,
 * a background POST, a POST form whose button text matches the crawler's toggle heuristic,
 * a GET form, and a script that tries to submit a form programmatically.
 */
const PAGE = `<!doctype html>
<html lang="en"><head><title>Tempting page</title></head>
<body>
  <nav><a href="/">Home</a></nav>
  <main>
    <h1>Plans</h1>
    <button id="icon-only"><svg width="16" height="16"></svg></button>
    <form method="post" action="/signup"><input name="email" aria-label="Email"><button>Features</button></form>
    <form method="get" action="/search"><input name="q" aria-label="Search"><button>Annual</button></form>
    <details><summary>More details</summary><p>Hidden text</p></details>
  </main>
  <script>
    console.error('Widget failed to initialise');
    fetch('/api/track', { method: 'POST', body: '{}' }).catch(() => {});
    setTimeout(() => document.forms[0].submit(), 50);
  </script>
</body></html>`;

describe('Safe website scan', () => {
  const PORT = 3393;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-safe-scan');
  const requests: string[] = [];
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(PAGE);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('reports accessibility and console-error findings without submitting anything', async () => {
    requests.length = 0;
    const result = await new SafePublicCrawler().scan({
      entryUrl: baseUrl,
      outputDir,
      respectRobots: false,
      actionDelayMs: 200,
    });

    // Accessibility: the icon-only button has no accessible name
    const a11y = result.findings.find((f) => f.checker === 'ux-quality' && f.title.includes('button-name'));
    expect(a11y).toBeDefined();
    expect(a11y?.stepsToReproduce.length).toBeGreaterThan(0);
    expect(a11y?.where.urlPath).toBe('/');

    // Bug detection: the console error
    const consoleFinding = result.findings.find(
      (f) => f.checker === 'bug-detection' && f.title.includes('Console Error')
    );
    expect(consoleFinding?.expectedVsActual.actual).toContain('Widget failed to initialise');

    // Safety: the server saw no mutating request and no form submission of either kind
    expect(requests.filter((r) => !r.startsWith('GET'))).toEqual([]);
    expect(requests.some((r) => r.includes('/search') || r.includes('/signup'))).toBe(false);
    // The background POST was stopped by the interceptor, and is not reported as a site defect
    expect(result.blockedRequests.some((r) => r.startsWith('POST') && r.includes('/api/track'))).toBe(true);
    expect(result.findings.some((f) => f.title.includes('/api/track'))).toBe(false);

    // It still explored safely: the accordion was expanded
    expect(result.flow.steps.map((s) => s.action)).toContain('Expanded “More details”');
  }, 60000);

  it('writes the same report.md / findings.json a product run produces, marked as read-only', async () => {
    const events: OrchestratorEvent[] = [];
    const report = await runSafeWebsiteScan({
      targetUrl: baseUrl,
      outputDir,
      runId: 'run-safe-test',
      respectRobots: false,
      onEvent: (e) => events.push(e),
    });

    expect(report.scanMode).toBe('safe-public');
    expect(report.findings.length).toBeGreaterThan(0);
    const findingsJson = JSON.parse(await fs.readFile(path.join(outputDir, 'findings.json'), 'utf8'));
    expect(findingsJson.runId).toBe('run-safe-test');
    expect(findingsJson.findings).toHaveLength(report.findings.length);
    const md = await fs.readFile(path.join(outputDir, 'report.md'), 'utf8');
    expect(md).toContain('Read-only website scan');

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('RUN_STARTED');
    expect(events[0]).toMatchObject({ mode: 'safe-public' });
    expect(types).toContain('STEP_STARTED');
    expect(types).toContain('FINDINGS_UPDATED');
    expect(types[types.length - 1]).toBe('RUN_COMPLETED');
  }, 60000);
});
