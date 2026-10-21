import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { RunTimer } from '../src/discovery/discovery-agent.js';
import { server } from '../../../fixtures/test-app/server.js';
import type { TestCase, ProductProfile, TimingEntry } from '@qa/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const orchestratorSource = readFileSync(path.join(here, '..', 'src', 'orchestrator.ts'), 'utf8');

describe('RunTimer (T-53)', () => {
  const origDebug = process.env.QA_DEBUG;
  beforeEach(() => {
    delete process.env.QA_DEBUG;
  });
  afterEach(() => {
    if (origDebug === undefined) delete process.env.QA_DEBUG;
    else process.env.QA_DEBUG = origDebug;
  });

  it('is off by default: nothing is kept', () => {
    const timer = new RunTimer();
    expect(timer.enabled).toBe(false);
    timer.add({ phase: 'crawl', name: 'visitor' }, Date.now());
    expect(timer.entries).toEqual([]);
  });

  it('is on when the run asks for timing', () => {
    const timer = new RunTimer(true);
    expect(timer.enabled).toBe(true);
  });

  it('is on when QA_DEBUG is set to any value', () => {
    process.env.QA_DEBUG = 'crawl';
    expect(new RunTimer().enabled).toBe(true);
  });

  it('treats a blank QA_DEBUG as off', () => {
    process.env.QA_DEBUG = '   ';
    expect(new RunTimer().enabled).toBe(false);
  });

  it('records a span with its name, breakpoint and duration, and passes the result through', async () => {
    const timer = new RunTimer(true);
    const result = await timer.span({ phase: 'checker', name: 'seo', breakpoint: '1440px' }, async () => 42);
    expect(result).toBe(42);
    expect(timer.entries).toHaveLength(1);
    expect(timer.entries[0]).toMatchObject({ phase: 'checker', name: 'seo', breakpoint: '1440px' });
    expect(timer.entries[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a span that throws, and rethrows the same error', async () => {
    const timer = new RunTimer(true);
    const boom = new Error('checker failed');
    await expect(timer.span({ phase: 'checker', name: 'security' }, async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(timer.entries.map((e) => e.name)).toEqual(['security']);
  });

  it('times a synchronous step and rethrows its error', () => {
    const timer = new RunTimer(true);
    expect(timer.sync({ phase: 'checker', name: 'bug-detection' }, () => 'ok')).toBe('ok');
    expect(() =>
      timer.sync({ phase: 'checker', name: 'permission-matrix' }, () => {
        throw new Error('no matrix');
      })
    ).toThrow('no matrix');
    expect(timer.entries.map((e) => e.name)).toEqual(['bug-detection', 'permission-matrix']);
  });

  it('keeps no timing while off, even for a span that runs', async () => {
    const timer = new RunTimer(false);
    await timer.span({ phase: 'test-point', name: 'page-sweep' }, async () => 'done');
    expect(timer.entries).toEqual([]);
  });
});

describe('timing wiring (T-53)', () => {
  it('times every phase the ticket names: crawl, plan, navigation, test point and each checker', () => {
    expect(orchestratorSource).toContain("phase: 'navigation'");
    expect(orchestratorSource).toContain("phase: 'test-point'");
    expect(orchestratorSource).toContain("timedAs('bug-detection')");
    expect(orchestratorSource).toContain("timedAs('spec-conformance')");
    expect(orchestratorSource).toContain("timedAs('ux-quality')");
    expect(orchestratorSource).toContain("timedAs('security')");
    expect(orchestratorSource).toContain("timedAs('security-depth')");
    expect(orchestratorSource).toContain("timedAs('performance')");
    expect(orchestratorSource).toContain("timedAs('seo')");
    expect(orchestratorSource).toContain("timedAs('design-standards')");
    expect(orchestratorSource).toContain("timedAs('keyboard-a11y')");
    expect(orchestratorSource).toContain("timedAs('reflow')");
  });

  it('adds the timing field only when the timer is on', () => {
    expect(orchestratorSource).toContain('...(timer.enabled ? { timing: timer.entries } : {}),');
  });

  it('writes the timing into the report before redaction, so it is covered by the redaction table', () => {
    const timingAt = orchestratorSource.indexOf('...(timer.enabled ? { timing: timer.entries } : {}),');
    const redactAt = orchestratorSource.indexOf('const report = withPortablePaths(redactor.deep(fullReport), outputDir);');
    expect(timingAt).toBeGreaterThan(-1);
    expect(redactAt).toBeGreaterThan(timingAt);
  });
});

describe('FlowTestOrchestrator timing on the fixture (T-53)', () => {
  const PORT = 3087;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-t53-timing');
  const origDebug = process.env.QA_DEBUG;

  const testCases: TestCase[] = [
    {
      id: 'TC-T53-001',
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
    if (origDebug === undefined) delete process.env.QA_DEBUG;
    else process.env.QA_DEBUG = origDebug;
  });

  const runOnce = (timing?: boolean) =>
    new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'fixture-test',
      specTestCases: testCases,
      profile,
      outputDir,
      breakpoints: ['1440px'],
      timing,
      recordVideo: false,
      flakyReruns: 0,
    });

  it('writes a timing section with a test point, a navigation and checker entries', async () => {
    delete process.env.QA_DEBUG;
    const report = await runOnce(true);
    const entries: TimingEntry[] = report.timing ?? [];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.phase === 'test-point' && e.testCaseId === 'TC-T53-001')).toBe(true);
    expect(entries.some((e) => e.phase === 'navigation' && e.name === '/dashboard')).toBe(true);
    expect(entries.some((e) => e.phase === 'checker' && e.name === 'bug-detection')).toBe(true);
    expect(entries.some((e) => e.phase === 'checker' && e.name === 'ux-quality')).toBe(true);
    for (const e of entries) {
      expect(e.durationMs).toBeGreaterThanOrEqual(0);
      expect(e.name).not.toMatch(/:\/\/|@/);
    }
  }, 120000);

  it('has no timing section when timing is off and QA_DEBUG is unset', async () => {
    delete process.env.QA_DEBUG;
    const report = await runOnce(false);
    expect('timing' in report).toBe(false);
  }, 120000);
});
