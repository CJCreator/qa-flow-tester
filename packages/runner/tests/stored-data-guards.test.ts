import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';
import { Readable } from 'stream';
import { DefaultPlanStore, type StoredPlanRecord } from '../src/session/plan-store.js';
import { DefaultReportStore } from '../src/session/report-store.js';
import { BenchmarkStore } from '../src/benchmarks.js';
import { createCheckupSession, type CheckupSession } from '../src/session/checkup-session.js';
import { patchPlan } from '../src/routes/plan.js';
import { DefaultRunSecrets } from '../src/session/run-secrets.js';
import type { ReviewPlan, DiscoveryDraft } from '@qa/types';

class MockResponse {
  statusCode = 200;
  headers: Record<string, string | number | readonly string[]> = {};
  body = '';
  ended = false;

  writeHead(status: number, headers?: Record<string, string | number | readonly string[]>) {
    this.statusCode = status;
    if (headers) {
      Object.assign(this.headers, headers);
    }
    return this;
  }

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  end(chunk?: unknown) {
    if (chunk) {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    }
    this.ended = true;
    return this;
  }

  json<T = any>(): T {
    return JSON.parse(this.body) as T;
  }
}

function createMockRequest(
  body?: unknown,
  headers: Record<string, string> = {},
  method = 'PATCH'
): http.IncomingMessage {
  const payload = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
  const stream = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []);
  const req = stream as unknown as http.IncomingMessage;
  req.method = method;
  req.headers = {
    'content-type': 'application/json',
    ...headers,
  };
  return req;
}

function makeGoodPlan(runId = 'run-1', targetUrl = 'https://example.com'): StoredPlanRecord {
  const plan = {
    runId,
    targetUrl,
    discoveredAt: new Date().toISOString(),
    pages: [{ urlPath: '/', title: 'Home', interactiveElementsCount: 0, formsCount: 0 }],
    flows: [],
    questions: [],
    planPages: [
      {
        id: 'page-1',
        urlPath: '/',
        title: 'Home',
        tests: [{ id: 'test-1', name: 'Test 1', steps: [] }],
      },
    ],
  } as unknown as ReviewPlan;
  const draft = {
    version: '1.0',
    productId: 'product-1',
    targetUrl,
    timestamp: new Date().toISOString(),
    pages: [],
    flows: [],
    sensitiveActions: [],
    ambiguityQuestions: [],
    plan: {
      pages: [
        {
          id: 'draft-page-1',
          urlPath: '/',
          title: 'Home',
          tests: [{ id: 'draft-test-1', steps: [] }],
        },
      ],
      navigation: [],
      layoutGroups: [],
      otherHosts: [],
    },
  } as unknown as DiscoveryDraft;
  return {
    schemaVersion: 1,
    status: 'awaiting-review',
    plan,
    context: {
      targetUrl,
      productId: 'product-1',
      runId,
      draft,
    },
  };
}

describe('stored data runtime guards', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-stored-guards-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('PlanStore', () => {
    it('returns null and does not throw when .qa-plan.json has a saved page with no tests', async () => {
      const dataDir = path.join(tmpDir, 'data');
      await fs.mkdir(dataDir, { recursive: true });

      // Malformed record: planPages has a page without tests
      const malformed = {
        schemaVersion: 1,
        status: 'awaiting-review',
        plan: {
          runId: 'run-1',
          targetUrl: 'https://example.com',
          pages: [],
          flows: [],
          questions: [],
          planPages: [{ id: 'page-1', urlPath: '/' }], // tests missing!
        },
        context: {
          targetUrl: 'https://example.com',
          runId: 'run-1',
        },
      };
      await fs.writeFile(path.join(dataDir, '.qa-plan.json'), JSON.stringify(malformed), 'utf8');

      const store = new DefaultPlanStore(dataDir, new DefaultRunSecrets(path.join(tmpDir, 'auth')));
      const loaded = await store.current();
      expect(loaded).toBeNull();
    });

    it('returns null and does not throw when draft.plan.pages has a page with no tests', async () => {
      const dataDir = path.join(tmpDir, 'data');
      await fs.mkdir(dataDir, { recursive: true });

      const malformed = {
        schemaVersion: 1,
        status: 'awaiting-review',
        plan: {
          runId: 'run-1',
          targetUrl: 'https://example.com',
          pages: [],
          flows: [],
          questions: [],
        },
        context: {
          targetUrl: 'https://example.com',
          runId: 'run-1',
          draft: {
            plan: {
              pages: [{ id: 'page-1' }], // tests missing!
            },
          },
        },
      };
      await fs.writeFile(path.join(dataDir, '.qa-plan.json'), JSON.stringify(malformed), 'utf8');

      const store = new DefaultPlanStore(dataDir, new DefaultRunSecrets(path.join(tmpDir, 'auth')));
      const loaded = await store.current();
      expect(loaded).toBeNull();
    });

    it('loads a good plan file properly', async () => {
      const dataDir = path.join(tmpDir, 'data');
      await fs.mkdir(dataDir, { recursive: true });

      const goodPlan = makeGoodPlan();
      await fs.writeFile(path.join(dataDir, '.qa-plan.json'), JSON.stringify(goodPlan), 'utf8');

      const store = new DefaultPlanStore(dataDir, new DefaultRunSecrets(path.join(tmpDir, 'auth')));
      const loaded = await store.current();
      expect(loaded).not.toBeNull();
      expect(loaded?.plan.runId).toBe('run-1');
    });

    it('skips unreadable waiting plan files in waiting() and unpark()', async () => {
      const dataDir = path.join(tmpDir, 'data');
      const waitingDir = path.join(dataDir, 'waiting-plans');
      await fs.mkdir(waitingDir, { recursive: true });

      // Malformed waiting plan
      await fs.writeFile(path.join(waitingDir, 'bad-host.json'), JSON.stringify({ plan: { runId: 'bad' } }), 'utf8');

      const store = new DefaultPlanStore(dataDir, new DefaultRunSecrets(path.join(tmpDir, 'auth')));
      const waiting = await store.waiting();
      expect(waiting).toHaveLength(0);

      const unparked = await store.unpark('bad-host');
      expect(unparked).toBeNull();
    });
  });

  describe('ReportStore', () => {
    it('lists only runs whose summary.json is complete and skips one with {}', async () => {
      const outputDir = path.join(tmpDir, 'output');
      const runsDir = path.join(outputDir, 'runs');
      await fs.mkdir(runsDir, { recursive: true });

      // Run 1: good summary
      const run1Dir = path.join(runsDir, 'run-good');
      await fs.mkdir(run1Dir, { recursive: true });
      const goodSummary = {
        runId: 'run-good',
        targetUrl: 'https://example.com',
        host: 'example.com',
        timestamp: '2026-11-12T00:00:00Z',
        stamp: 'Ready to release',
        durationMs: 5000,
        ready: true,
        counts: {
          Blocker: 0,
          Major: 0,
          Minor: 0,
          Suggestion: 0,
        },
      };
      await fs.writeFile(path.join(run1Dir, 'summary.json'), JSON.stringify(goodSummary), 'utf8');

      // Run 2: empty/broken summary
      const run2Dir = path.join(runsDir, 'run-broken');
      await fs.mkdir(run2Dir, { recursive: true });
      await fs.writeFile(path.join(run2Dir, 'summary.json'), JSON.stringify({}), 'utf8');

      const store = new DefaultReportStore({
        outputDir,
        dataDir: path.join(tmpDir, 'data'),
        authDir: path.join(tmpDir, 'auth'),
      });

      const list = await store.list();
      expect(list).toHaveLength(1);
      expect(list[0].runId).toBe('run-good');
    });

    it('read() of a run whose report.json is [] returns null', async () => {
      const outputDir = path.join(tmpDir, 'output');
      const runDir = path.join(outputDir, 'runs', 'run-array');
      await fs.mkdir(runDir, { recursive: true });
      await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify([]), 'utf8');

      const store = new DefaultReportStore({
        outputDir,
        dataDir: path.join(tmpDir, 'data'),
        authDir: path.join(tmpDir, 'auth'),
      });

      const report = await store.read('run-array');
      expect(report).toBeNull();
    });

    it('read() of a run whose report.json is valid returns the report', async () => {
      const outputDir = path.join(tmpDir, 'output');
      const runDir = path.join(outputDir, 'runs', 'run-valid');
      await fs.mkdir(runDir, { recursive: true });
      const goodReport = {
        runId: 'run-valid',
        findings: [],
        timestamp: '2026-11-12T00:00:00Z',
      };
      await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(goodReport), 'utf8');

      const store = new DefaultReportStore({
        outputDir,
        dataDir: path.join(tmpDir, 'data'),
        authDir: path.join(tmpDir, 'auth'),
      });

      const report = await store.read('run-valid');
      expect(report).not.toBeNull();
      expect(report?.runId).toBe('run-valid');
    });
  });

  describe('BenchmarkStore', () => {
    it('get() of a file holding {} returns null', async () => {
      const benchDir = path.join(tmpDir, 'benchmarks');
      await fs.mkdir(benchDir, { recursive: true });
      await fs.writeFile(path.join(benchDir, 'job-empty.json'), JSON.stringify({}), 'utf8');

      const store = new BenchmarkStore(benchDir);
      const job = await store.get('job-empty');
      expect(job).toBeNull();
    });

    it('get() of a valid benchmark job returns the job', async () => {
      const benchDir = path.join(tmpDir, 'benchmarks');
      await fs.mkdir(benchDir, { recursive: true });
      const goodJob = {
        id: 'job-1',
        status: 'done',
        stage: 'Finished',
        startedAt: '2026-11-12T00:00:00Z',
        flowType: 'checkout',
        ourUrl: 'https://a.com',
        refUrl: 'https://b.com',
      };
      await fs.writeFile(path.join(benchDir, 'job-1.json'), JSON.stringify(goodJob), 'utf8');

      const store = new BenchmarkStore(benchDir);
      const job = await store.get('job-1');
      expect(job).not.toBeNull();
      expect(job?.id).toBe('job-1');
    });
  });

  describe('routes/plan patchPlan', () => {
    it('PATCH with { testCases: [{}] } answers 400 with error', async () => {
      const session = createCheckupSession({
        outputDir: path.join(tmpDir, 'output'),
        dataDir: path.join(tmpDir, 'data'),
        authDir: path.join(tmpDir, 'auth'),
      });
      const goodPlan = makeGoodPlan();
      await session.plan.save(goodPlan);

      const req = createMockRequest({
        testCases: [{}],
      });
      const res = new MockResponse();

      await patchPlan({
        session,
        req,
        res: res as unknown as http.ServerResponse,
        url: new URL('http://localhost/api/runner/plan'),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(typeof body.error).toBe('string');
      expect(body.error).toContain('test case');
    });
  });
});
