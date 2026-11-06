import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createCheckupSession, type CheckupSession } from '../src/session/checkup-session.js';
import type { StoredPlanRecord } from '../src/session/plan-store.js';
import type { ReviewPlan, DiscoveryDraft, TestCase, PlanPage, PageInventoryItem } from '@qa/types';
import { getPlan, patchPlan, approvePlan, planMarkdown, waitingPlans } from '../src/routes/plan.js';
import { CREDENTIAL_PLACEHOLDERS } from '@qa/core';

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
  method = 'POST'
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

function makeStoredPlan(runId = 'run-test-1', targetUrl = 'http://example.com'): StoredPlanRecord {
  const pages: PageInventoryItem[] = [
    {
      urlPath: '/',
      title: 'Home',
      elements: [
        { selector: '#email', role: 'textbox', name: 'Email', tagName: 'input', visible: true, enabled: true },
        { selector: '#password', role: 'textbox', name: 'Password', tagName: 'input', visible: true, enabled: true },
        { selector: '#submit', role: 'button', name: 'Submit', tagName: 'button', visible: true, enabled: true },
      ],
      interactiveElementsCount: 3,
      formsCount: 1,
    },
  ];

  const planPages: PlanPage[] = [
    {
      id: 'page-home',
      urlPath: '/',
      title: 'Home',
      coverage: 'tested',
      reachedBy: ['visitor'],
      source: 'fallback',
      tests: [
        {
          id: 'test-item-1',
          name: 'Home test',
          role: 'visitor',
          source: 'fallback',
          steps: [{ action: 'wait', name: 'Wait for load' }],
        },
      ],
    },
  ];

  const draft: DiscoveryDraft = {
    version: '1.0',
    productId: 'test-product',
    targetUrl,
    timestamp: new Date().toISOString(),
    plan: {
      pages: planPages,
      navigation: [],
      layoutGroups: [],
      otherHosts: [],
      budget: { needed: 0, used: 0, left: 10 },
    },
    pages,
    forms: [],
    flows: [],
    sensitiveActions: [],
    ambiguityQuestions: [],
    exploration: { signedInAs: [], signInFailed: [], signInPages: [], notReached: [], notes: [] },
  };

  const plan: ReviewPlan = {
    runId,
    targetUrl,
    discoveredAt: new Date().toISOString(),
    pages,
    flows: [],
    questions: [],
    testCases: [],
    planPages,
    navigation: [],
    screenSizes: ['1440px'],
  };

  return {
    plan,
    status: 'awaiting-review',
    context: {
      runId,
      targetUrl,
      productId: 'test-product',
      siteHost: new URL(targetUrl).host,
      draft,
      profile: {
        name: 'test-product',
        productId: 'test-product',
        roles: [{ role: 'admin', username: 'admin@example.com', password: 'secretPassword123!' }],
      },
    },
  };
}

describe('Plan handlers as functions over CheckupSession (T-207)', () => {
  let tmpDir: string;
  let session: CheckupSession;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-plan-routes-'));
    const outputDir = path.join(tmpDir, 'output');
    const dataDir = path.join(tmpDir, 'data');
    const authDir = path.join(tmpDir, 'auth');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(authDir, { recursive: true });
    session = createCheckupSession({ outputDir, dataDir, authDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('1. items switched off: patchPlan switches item to skipped in stored record', async () => {
    const record = makeStoredPlan();
    await session.plan.save(record);

    const req = createMockRequest({
      items: [{ id: 'test-item-1', skipped: true }],
    });
    const res = new MockResponse();

    await patchPlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan'),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.delta).toBe(true);

    const savedRecord = session.plan.currentRecord;
    expect(savedRecord).not.toBeNull();
    const testItem = savedRecord?.context.draft.plan?.pages[0].tests.find((t) => t.id === 'test-item-1');
    expect(testItem?.skipped).toBe(true);
    const planPageTest = savedRecord?.plan.planPages?.[0].tests.find((t) => t.id === 'test-item-1');
    expect(planPageTest?.skipped).toBe(true);
  });

  it('2. intentsOff with an invalid value refused (400 ERR_INVALID_INTENTS)', async () => {
    const record = makeStoredPlan();
    await session.plan.save(record);

    const req = createMockRequest({
      intentsOff: ['invalid-intent-name' as any],
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
    expect(body.code).toBe('ERR_INVALID_INTENTS');
    expect(body.error).toContain('An Intent must be');
  });

  it('3. step aimed at something not on the page refused (422) with nothing applied', async () => {
    const record = makeStoredPlan();
    await session.plan.save(record);

    const badTestCase: TestCase = {
      id: 'TC-BAD-1',
      flowId: 'flow-bad',
      name: 'Aim at missing element',
      role: 'visitor',
      startPage: '/',
      steps: [{ action: 'click', name: 'Click non-existent button', selector: '#non-existent-button' }],
      expectations: {},
    };

    const req = createMockRequest({
      testCases: [badTestCase],
    });
    const res = new MockResponse();

    await patchPlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan'),
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toBe('Some steps are aimed at things that aren’t on the page.');
    expect(body.issues.length).toBeGreaterThan(0);

    // Assert nothing applied
    const savedRecord = session.plan.currentRecord;
    expect(savedRecord?.context.customTestCases).toBeUndefined();
    expect(savedRecord?.plan.testCases).toEqual([]);
  });

  it('4. approvePlan with no Plan (404)', async () => {
    // Session is fresh and has no saved plan
    const req = createMockRequest({});
    const res = new MockResponse();

    await approvePlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan/approve'),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'No plan awaiting review' });
  });

  it('5. credential placeholder replacement on stored steps', async () => {
    const record = makeStoredPlan();
    await session.plan.save(record);

    const loginTestCase: TestCase = {
      id: 'TC-LOGIN',
      flowId: 'flow-login',
      name: 'Admin sign in',
      role: 'admin',
      startPage: '/',
      steps: [{ action: 'fill', name: 'Fill password', selector: '#password', value: 'secretPassword123!' }],
      expectations: {},
    };

    const req = createMockRequest({
      testCases: [loginTestCase],
    });
    const res = new MockResponse();

    await patchPlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan'),
    });

    expect(res.statusCode).toBe(200);
    const savedRecord = session.plan.currentRecord;
    expect(savedRecord).not.toBeNull();
    const savedStep = savedRecord?.plan.testCases?.[0]?.steps?.[0];
    expect(savedStep?.value).toBe(CREDENTIAL_PLACEHOLDERS.password);
    expect(savedStep?.value).toBe('{{password}}');
  });

  it('getPlan returns 200 and client plan for loaded plan', async () => {
    const record = makeStoredPlan();
    await session.plan.save(record);

    const req = createMockRequest(undefined, {}, 'GET');
    const res = new MockResponse();

    await getPlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan'),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runId).toBe('run-test-1');
    expect(body.targetUrl).toBe('http://example.com');
  });

  it('planMarkdown returns 200 text/markdown for loaded plan', async () => {
    const record = makeStoredPlan();
    await session.plan.save(record);

    const req = createMockRequest(undefined, {}, 'GET');
    const res = new MockResponse();

    await planMarkdown({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan/markdown'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/markdown');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('waitingPlans lists parked plans and unparks a plan', async () => {
    const record = makeStoredPlan('run-parked-1', 'http://parked.example.com');
    await session.plan.park(record);

    // List waiting plans (GET)
    const listReq = createMockRequest(undefined, {}, 'GET');
    const listRes = new MockResponse();
    await waitingPlans({
      session,
      req: listReq,
      res: listRes as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/waiting-plans'),
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.plans).toHaveLength(1);
    expect(listBody.plans[0].host).toBe('parked.example.com');

    // Unpark the waiting plan (POST)
    const unparkReq = createMockRequest({ host: 'parked.example.com' }, {}, 'POST');
    const unparkRes = new MockResponse();
    await waitingPlans({
      session,
      req: unparkReq,
      res: unparkRes as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/waiting-plans'),
    });

    expect(unparkRes.statusCode).toBe(200);
    const unparkBody = unparkRes.json();
    expect(unparkBody.resumed).toBe(true);
    expect(unparkBody.runId).toBe('run-parked-1');
  });
});

describe('Plan generation: stale writes refused, approval bumps it (R9, R10)', () => {
  let tmpDir: string;
  let session: CheckupSession;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-plan-generation-'));
    const outputDir = path.join(tmpDir, 'output');
    const dataDir = path.join(tmpDir, 'data');
    const authDir = path.join(tmpDir, 'auth');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(authDir, { recursive: true });
    session = createCheckupSession({ outputDir, dataDir, authDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('refuses a patch built on an older planGeneration with 409 ERR_PLAN_STALE and applies nothing', async () => {
    const record = { ...makeStoredPlan(), planGeneration: 2 };
    await session.plan.save(record);

    const req = createMockRequest({ generation: 1, items: [{ id: 'test-item-1', skipped: true }] });
    const res = new MockResponse();
    await patchPlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan'),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ERR_PLAN_STALE');
    const testItem = session.plan.currentRecord?.context.draft.plan?.pages[0].tests.find(
      (t) => t.id === 'test-item-1'
    );
    expect(testItem?.skipped).not.toBe(true);
  });

  it('applies a patch built on the current planGeneration', async () => {
    const record = { ...makeStoredPlan(), planGeneration: 2 };
    await session.plan.save(record);

    const req = createMockRequest({ generation: 2, items: [{ id: 'test-item-1', skipped: true }] });
    const res = new MockResponse();
    await patchPlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan'),
    });

    expect(res.statusCode).toBe(200);
  });

  it('a patch without a generation is not refused (existing clients)', async () => {
    await session.plan.save({ ...makeStoredPlan(), planGeneration: 5 });

    const req = createMockRequest({ items: [{ id: 'test-item-1', skipped: true }] });
    const res = new MockResponse();
    await patchPlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan'),
    });

    expect(res.statusCode).toBe(200);
  });

  it('GET returns the stored planGeneration so the client can send it back on PATCH', async () => {
    await session.plan.save({ ...makeStoredPlan(), planGeneration: 4 });

    const req = createMockRequest(undefined, {}, 'GET');
    const res = new MockResponse();
    await getPlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().planGeneration).toBe(4);
    expect(res.json().runId).toBe('run-test-1');
  });

  it('approving bumps planGeneration before the approved plan is saved to disk', async () => {
    await session.plan.save({ ...makeStoredPlan(), planGeneration: 3 });

    const req = createMockRequest({});
    const res = new MockResponse();
    await approvePlan({
      session,
      req,
      res: res as unknown as http.ServerResponse,
      url: new URL('http://localhost/api/runner/plan/approve'),
    });

    expect(res.statusCode).toBe(200);
    expect(session.plan.currentRecord?.planGeneration).toBe(4);
    const onDisk = JSON.parse(await fs.readFile(session.plan.file, 'utf8'));
    expect(onDisk.planGeneration).toBe(4);
    expect(onDisk.status).toBe('approved');
  });
});
