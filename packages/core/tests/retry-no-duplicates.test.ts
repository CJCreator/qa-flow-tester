import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { FlowTestOrchestrator, type RunOptions } from '../src/orchestrator.js';
import type { TestCase, TestCaseStep } from '@qa/types';

const PORT = 3534;
const PASSWORD = 'Zx9-secret-pw';

describe('namespacing: retried flow cannot create duplicates', () => {
  const outputDir = path.join(process.cwd(), '.tmp-retry-no-dupes-report');
  let posts = 0;
  let formLoads = 0;
  let hideSubmitFirstLoad = false;
  let seen: string[] = [];

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/submit') && req.method === 'POST') {
      posts++;
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    if (url.startsWith('/seen')) {
      seen.push(decodeURIComponent(url.split('?v=')[1] ?? ''));
      res.end('ok');
      return;
    }
    res.setHeader('content-type', 'text/html');
    if (url.startsWith('/form')) {
      formLoads++;
      const hide = hideSubmitFirstLoad && formLoads === 1 ? 'style="display:none"' : '';
      res.end(
        `<html lang="en"><head><title>Form</title></head><body><header><a href="/">Home</a></header><main><h1>Form</h1>
<label>Name <input data-testid="name" type="text"></label>
<label>Email <input data-testid="email" type="text"></label>
<label>Secret <input data-testid="secret" type="text"></label>
<button data-testid="submit" ${hide}>Send</button>
<script>
for (const el of document.querySelectorAll('input')) {
  el.addEventListener('input', () => fetch('/seen?v=' + encodeURIComponent(el.value)));
}
document.querySelector('[data-testid="submit"]').addEventListener('click', () => fetch('/submit', { method: 'POST' }));
</script></main></body></html>`
      );
      return;
    }
    res.end('<html lang="en"><head><title>x</title></head><body><main>ok</main></body></html>');
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });
  beforeEach(() => {
    posts = 0;
    formLoads = 0;
    hideSubmitFirstLoad = false;
    seen = [];
  });

  const fillSteps: TestCaseStep[] = [
    { action: 'fill', selector: '[data-testid="name"]', name: 'Type name', value: 'Jane Doe' },
    { action: 'fill', selector: '[data-testid="email"]', name: 'Type email', value: 'jo@example.com' },
  ];
  const submit: TestCaseStep = { action: 'click', selector: '[data-testid="submit"]', name: 'Press Send' };

  const makeCase = (id: string, steps: TestCaseStep[]): TestCase => ({
    id,
    flowId: `${id}-flow`,
    name: id,
    role: 'anonymous',
    startPage: '/form',
    steps,
    expectations: {},
  });

  const run = (testCase: TestCase, extra: Partial<RunOptions> = {}) =>
    new FlowTestOrchestrator().run({
      targetUrl: `http://localhost:${PORT}`,
      productId: 'retry-no-dupes',
      specTestCases: [testCase],
      outputDir,
      enableA11y: false,
      enableSecurity: false,
      enablePerformance: false,
      enableSeo: false,
      recordVideo: false,
      ...extra,
    });

  it('namespacing: Test Copy fill values reach the page with the per-run token', async () => {
    await run(makeCase('TC-NS-1', [...fillSteps, submit]));
    const name = seen.find((v) => v.startsWith('Jane Doe'));
    expect(name).toMatch(/^Jane Doe [a-z]{6}$/);
    expect(seen.find((v) => v.startsWith('jo+'))).toMatch(/^jo\+[a-z]{6}@example\.com$/);
    expect(posts).toBe(1);
  }, 90000);

  it('namespacing: flow that fails after submit is not retried, POST /submit count is 1', async () => {
    const report = await run(
      makeCase('TC-NS-2', [
        ...fillSteps,
        submit,
        { action: 'click', selector: '[data-testid="nope"]', name: 'Press missing' },
      ])
    );
    const point = report.results.find((r) => r.testCaseId === 'TC-NS-2')!;
    expect(posts).toBe(1);
    expect(point.status).toBe('Failed');
    expect(point.retry?.retryCount ?? 0).toBe(0);
    expect(point.error).toContain('Not tried again');
    expect(formLoads).toBe(1);
  }, 90000);

  it('namespacing: failure before any send still retries whole flow once and is FLAKY_PASSED, POST count 1', async () => {
    hideSubmitFirstLoad = true;
    const report = await run(makeCase('TC-NS-3', [...fillSteps, submit]));
    const point = report.results.find((r) => r.testCaseId === 'TC-NS-3')!;
    expect(point.retry?.status).toBe('FLAKY_PASSED');
    expect(point.retry?.retryCount).toBe(1);
    expect(posts).toBe(1);
    expect(formLoads).toBe(2);
    const names = new Set(seen.filter((v) => v.startsWith('Jane Doe')));
    expect(names.size).toBe(1);
    expect([...names][0]).toMatch(/^Jane Doe [a-z]{6}$/);
  }, 90000);

  it('namespacing: readOnly true sends no POST and types values unchanged', async () => {
    const report = await run(makeCase('TC-NS-4', [...fillSteps, submit]), { readOnly: true });
    expect(posts).toBe(0);
    expect(seen).toContain('Jane Doe');
    expect(seen).toContain('jo@example.com');
    expect(report.scanMode).toBe('read-only');
  }, 90000);

  it('namespacing: {{password}} fill types the real password, not namespaced, on a Test Copy', async () => {
    const report = await run(
      makeCase('TC-NS-5', [
        { action: 'fill', selector: '[data-testid="secret"]', name: 'Type secret', value: '{{password}}' },
        submit,
      ]),
      {
        profile: {
          name: 'p',
          productId: 'retry-no-dupes',
          roles: [{ role: 'anonymous', username: 'u', password: PASSWORD }],
        },
      }
    );
    expect(seen).toContain(PASSWORD);
    expect(seen.some((v) => v.startsWith(PASSWORD) && v !== PASSWORD)).toBe(false);
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
  }, 90000);
});
