import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { ReleaseReport, RunStartBody, TestCase } from '@qa/types';
import { FlowTestOrchestrator, type OrchestratorEvent } from '@qa/core';
import { createCheckupRun, type RunAuthorization } from '../src/session/checkup-run.js';
import { createCheckupSession } from '../src/session/checkup-session.js';

const scratch = path.join(process.cwd(), '.tmp-checkup-run-on-event');
const runId = 'run-on-event-test';

const body = {
  targetUrl: 'https://a.example/',
  useAI: false,
  specTestCases: [
    {
      id: 'tc-1',
      title: 'Smoke test',
      steps: [],
    } as unknown as TestCase,
  ],
} as unknown as RunStartBody;

const authorization: RunAuthorization = {
  readOnly: true,
  readOnlyReason: '',
  testCopy: false,
  owner: false,
  signInConsent: false,
};

const fakeReport: ReleaseReport = {
  runId,
  timestamp: new Date().toISOString(),
  durationMs: 120,
  targetUrl: 'https://a.example/',
  findings: [],
  results: [],
  summary: { total: 1, passed: 1, failed: 0, warnings: 0 },
} as unknown as ReleaseReport;

const stepEvent: OrchestratorEvent = {
  type: 'STEP_STARTED',
  stepIndex: 0,
  stepName: 'Open page',
  action: 'navigate',
  testCaseId: 'tc-1',
};

describe('createCheckupRun onEvent', () => {
  beforeEach(async () => {
    await fs.mkdir(scratch, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  async function driveRunToCompletion() {
    const session = createCheckupSession({ outputDir: scratch, dataDir: scratch });
    const publishSpy = vi.spyOn(session.events, 'publish');
    const onEventEvents: Array<Record<string, unknown>> = [];

    const run = createCheckupRun(session, {
      siteDir: () => scratch,
      prepareAI: async () => ({}),
      onEvent: (event) => {
        onEventEvents.push(event as Record<string, unknown>);
      },
    });

    vi.spyOn(FlowTestOrchestrator.prototype, 'run').mockImplementation(async (options) => {
      options.onEvent?.(stepEvent);
      options.onEvent?.({
        type: 'RUN_COMPLETED',
        runId: options.runId ?? runId,
        report: fakeReport,
      } as unknown as OrchestratorEvent);
      return fakeReport;
    });

    await run.start({ body, authorization });
    await run.waitFor(5000);

    return { session, publishSpy, onEventEvents };
  }

  it('RUN_COMPLETED reaches onEvent as the object that was published', async () => {
    const { publishSpy, onEventEvents } = await driveRunToCompletion();

    const onEventCompleted = onEventEvents.find((e) => e.type === 'RUN_COMPLETED');
    const publishedCompleted = publishSpy.mock.calls.map((call) => call[0]).find((e) => e.type === 'RUN_COMPLETED');

    expect(onEventCompleted).toBeDefined();
    expect(publishedCompleted).toBeDefined();
    expect(onEventCompleted).toBe(publishedCompleted);
  });

  it('RUN_COMPLETED is sent without its report', async () => {
    const { session, onEventEvents } = await driveRunToCompletion();

    const onEventCompleted = onEventEvents.find((e) => e.type === 'RUN_COMPLETED');
    expect(onEventCompleted).toBeDefined();
    expect(onEventCompleted).toHaveProperty('type', 'RUN_COMPLETED');
    expect(onEventCompleted).toHaveProperty('runId');
    expect(onEventCompleted).not.toHaveProperty('report');
    expect(session.report.last).toEqual(fakeReport);
  });

  it('other events pass through unchanged', async () => {
    const { publishSpy, onEventEvents } = await driveRunToCompletion();

    const onEventOther = onEventEvents.find((e) => e.type === 'STEP_STARTED');
    const publishedOther = publishSpy.mock.calls.map((call) => call[0]).find((e) => e.type === 'STEP_STARTED');

    expect(onEventOther).toBeDefined();
    expect(publishedOther).toBeDefined();
    expect(onEventOther).toBe(publishedOther);
    expect(onEventOther).toBe(stepEvent);
  });
});
