/**
 * T-201: the check-up API's shapes are pinned here. Every field of each interface is written out and
 * checked with `satisfies`, so a field that is removed, renamed or retyped fails this test instead of
 * failing at run time, on the wire, between the runner and the wizard.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { PlanPatchBody, RunnerStatusReply, RunStartBody } from '../src/checkup-api.js';

describe('check-up API contracts (T-201)', () => {
  it('RunStartBody carries every field POST /api/runner/run accepts', () => {
    const body = {
      targetUrl: 'http://localhost:3000',
      productId: 'localhost',
      useAI: true,
      aiProvider: 'openrouter',
      apiKey: 'key',
      aiModel: 'model',
      releaseTarget: 'staging',
      breakpoints: ['1440px'],
      headless: true,
      roles: [{ role: 'manager', username: 'manager@example.com', password: 'secret', loginPath: '/signin' }],
      rememberSignIns: true,
      useSavedSignIns: true,
      specTestCases: [],
      productContext: 'context',
      mode: 'product',
      skipReview: true,
      owner: true,
      signInConsent: true,
      stagingHost: true,
      designNotes: 'notes',
      replanAll: true,
      maxPages: 50,
      searchChecks: true,
      visibility: { search: true, answers: true, aiSearch: true, marketing: false },
      planWithoutAI: true,
      replacePlan: true,
      testAgain: true,
      contextDocuments: [{ name: 'prd.md', text: 'text' }],
      contextUrl: 'http://localhost:3000/docs',
      savedSessions: { manager: { cookies: [], origins: [] } },
      aiCap: { requests: 100, dollars: 1 },
      testCap: 50,
      crawlConcurrency: 2,
      crawlDelayMs: 100,
      customHeaders: { 'x-qa-bypass-token': 'token' },
      userAgent: 'QA Flow Tester',
      tunnelAuth: 'user:pass',
      headerHosts: ['localhost'],
    } satisfies RunStartBody;

    expectTypeOf(body).toMatchTypeOf<RunStartBody>();
    // The runner accepts headers as an object or as a header string; both must stay allowed.
    expectTypeOf<RunStartBody['customHeaders']>().toEqualTypeOf<Record<string, string> | string | undefined>();
    expectTypeOf<RunStartBody['targetUrl']>().toEqualTypeOf<string>();
    expectTypeOf<RunStartBody['mode']>().toEqualTypeOf<'product' | 'safe-public' | undefined>();
  });

  it('PlanPatchBody carries every field PATCH /api/runner/plan accepts', () => {
    const patch = {
      flows: [
        {
          id: 'flow-1',
          name: 'Buy a thing',
          role: 'manager',
          description: 'A journey',
          startPage: '/',
          steps: [],
        },
      ],
      questions: [{ id: 'Q-001', selectedAnswer: 'Yes' }],
      answers: { 'Q-001': 'Yes' },
      testCases: [{ id: 'TC-1', flowId: 'flow-1', role: 'manager', startPage: '/', steps: [], expectations: {} }],
      productContext: 'context',
      designNotes: 'notes',
      items: [{ id: 'page:/about', skipped: true }],
      screenSizes: ['375px', '1440px'],
      expectations: [{ id: 'TC-1', text: 'It lands on the dashboard' }],
      preset: 'quick',
      sourceEdits: [{ itemId: 'TC-1', roles: ['manager'], severity: 'Major', stale: true, confirm: true }],
      notFoundEdits: [{ id: 'TC-2', remove: true }],
      intentsOff: ['rejects', 'denied'],
    } satisfies PlanPatchBody;

    expectTypeOf(patch).toMatchTypeOf<PlanPatchBody>();
    expectTypeOf<PlanPatchBody['screenSizes']>().toEqualTypeOf<Array<'375px' | '768px' | '1440px'> | undefined>();
    expectTypeOf<PlanPatchBody['preset']>().toEqualTypeOf<'quick' | undefined>();
  });

  it('RunnerStatusReply is exactly what GET /api/runner/status writes', () => {
    const status = {
      isRunning: false,
      hasReport: true,
      lastRunError: null,
      lastErrorCode: null,
      phase: 'done',
      hasPlan: true,
      runId: 'run-1',
      targetUrl: 'http://localhost:3000',
      reportRunId: 'run-1',
      beta: false,
    } satisfies RunnerStatusReply;

    expectTypeOf(status).toMatchTypeOf<RunnerStatusReply>();
    // The phase is the runner's own union: the two ends must not declare a second one.
    expectTypeOf<RunnerStatusReply['phase']>().toEqualTypeOf<
      'idle' | 'scanning' | 'awaiting-review' | 'testing' | 'done' | 'failed'
    >();
  });
});
