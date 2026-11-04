import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createCheckupSession, MAX_RUN_EVENTS, type StoredPlanRecord } from '../src/session/checkup-session.js';
import type { DraftPlan, ReviewPlan } from '@qa/types';

describe('CheckupSession state and operations (T-204)', () => {
  let tmpDir: string;
  let outputDir: string;
  let dataDir: string;
  let authDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-session-test-'));
    outputDir = path.join(tmpDir, 'output');
    dataDir = path.join(tmpDir, 'data');
    authDir = path.join(tmpDir, 'auth');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(authDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('begin() refuses while a run is active and release() frees it', () => {
    const session = createCheckupSession({ outputDir, dataDir, authDir });

    expect(session.run.isRunning).toBe(false);
    expect(session.run.begin('run-1', 'http://localhost:3000')).toBe(true);
    expect(session.run.isRunning).toBe(true);
    expect(session.run.runId).toBe('run-1');
    expect(session.run.targetUrl).toBe('http://localhost:3000');

    // Second begin refused
    expect(session.run.begin('run-2', 'http://localhost:3000')).toBe(false);
    expect(session.run.runId).toBe('run-1');

    session.run.release();
    expect(session.run.isRunning).toBe(false);
    expect(session.run.runId).toBeNull();
    expect(session.run.targetUrl).toBeNull();

    // Now can begin again
    expect(session.run.begin('run-2', 'http://localhost:3000')).toBe(true);
    expect(session.run.runId).toBe('run-2');
    session.run.release();
  });

  it('the generation changes between runs', () => {
    const session = createCheckupSession({ outputDir, dataDir, authDir });
    const gen0 = session.run.generation;

    session.run.begin('run-1', 'http://localhost:3000');
    const gen1 = session.run.generation;
    expect(gen1).toBeGreaterThan(gen0);

    session.run.release();

    session.run.begin('run-2', 'http://localhost:3000');
    const gen2 = session.run.generation;
    expect(gen2).toBeGreaterThan(gen1);
    session.run.release();
  });

  it('publish() appends, caps at MAX_RUN_EVENTS and reaches a subscriber, and unsubscribing stops it', () => {
    const session = createCheckupSession({ outputDir, dataDir, authDir });
    const received: Array<Record<string, unknown>> = [];

    const unsubscribe = session.events.subscribe((event) => {
      received.push(event);
    });

    session.events.publish({ type: 'EVENT_1', index: 1 });
    expect(received.length).toBe(1);
    expect(session.events.log.length).toBe(1);
    expect(session.events.log[0]).toEqual({ type: 'EVENT_1', index: 1 });

    unsubscribe();

    session.events.publish({ type: 'EVENT_2', index: 2 });
    expect(received.length).toBe(1); // Not notified after unsubscribe
    expect(session.events.log.length).toBe(2);

    // Test capping at MAX_RUN_EVENTS
    session.events.clear();
    expect(session.events.log.length).toBe(0);

    for (let i = 0; i < MAX_RUN_EVENTS + 50; i++) {
      session.events.publish({ type: 'EVENT', seq: i });
    }
    expect(session.events.log.length).toBe(MAX_RUN_EVENTS);
    expect(session.events.log[0]).toEqual({ type: 'EVENT', seq: 50 });
    expect(session.events.log[MAX_RUN_EVENTS - 1]).toEqual({ type: 'EVENT', seq: MAX_RUN_EVENTS + 49 });
  });

  it('plan.park() / unpark() round-trips a record to disk and back', async () => {
    const session = createCheckupSession({ outputDir, dataDir, authDir });
    const mockPlan: ReviewPlan = {
      runId: 'run-park-test',
      targetUrl: 'http://example.com',
      discoveredAt: new Date().toISOString(),
      summary: { tests: 0, pages: 0, pagesListed: 0, screenSizes: [], lines: [] },
      pages: [],
      flows: [],
      screenSizes: [],
      questions: [],
    };
    const draftPlan: DraftPlan = { pages: [], navigation: [], layoutGroups: [], otherHosts: [] };
    const record: StoredPlanRecord = {
      plan: mockPlan,
      status: 'awaiting-review',
      context: {
        runId: 'run-park-test',
        targetUrl: 'http://example.com',
        productId: 'park-test',
        siteHost: 'example.com',
        draft: {
          version: '1.0',
          productId: 'park-test',
          targetUrl: 'http://example.com',
          timestamp: new Date().toISOString(),
          plan: draftPlan,
          pages: [],
          flows: [],
          forms: [],
          sensitiveActions: [],
          ambiguityQuestions: [],
        },
      },
    };

    await session.plan.park(record);
    const parkedFile = session.plan.parkedFileFor('example.com');
    const fileStat = await fs.stat(parkedFile).catch(() => null);
    expect(fileStat).not.toBeNull();

    const waiting = await session.plan.waiting();
    expect(waiting.some((w) => w.host === 'example.com')).toBe(true);

    const unparked = await session.plan.unpark('example.com');
    expect(unparked).not.toBeNull();
    expect(unparked?.plan.runId).toBe('run-park-test');

    const fileAfter = await fs.stat(parkedFile).catch(() => null);
    expect(fileAfter).toBeNull();
  });

  it('plan.save() then plan.clear() removes the file', async () => {
    const session = createCheckupSession({ outputDir, dataDir, authDir });
    const mockPlan: ReviewPlan = {
      runId: 'run-save-clear',
      targetUrl: 'http://example.com',
      discoveredAt: new Date().toISOString(),
      summary: { tests: 0, pages: 0, pagesListed: 0, screenSizes: [], lines: [] },
      pages: [],
      flows: [],
      screenSizes: [],
      questions: [],
    };
    const draftPlan: DraftPlan = { pages: [], navigation: [], layoutGroups: [], otherHosts: [] };
    const record: StoredPlanRecord = {
      plan: mockPlan,
      status: 'awaiting-review',
      context: {
        runId: 'run-save-clear',
        targetUrl: 'http://example.com',
        productId: 'save-clear-test',
        siteHost: 'example.com',
        draft: {
          version: '1.0',
          productId: 'save-clear-test',
          targetUrl: 'http://example.com',
          timestamp: new Date().toISOString(),
          plan: draftPlan,
          pages: [],
          flows: [],
          forms: [],
          sensitiveActions: [],
          ambiguityQuestions: [],
        },
      },
    };

    await session.plan.save(record);
    expect(await session.plan.current()).not.toBeNull();
    const statBefore = await fs.stat(session.plan.file).catch(() => null);
    expect(statBefore).not.toBeNull();

    await session.plan.clear('run-save-clear');
    expect(await session.plan.current()).toBeNull();
    const statAfter = await fs.stat(session.plan.file).catch(() => null);
    expect(statAfter).toBeNull();
  });

  it('secrets.set() / clear() leaves JSON.stringify of the session free of header values', () => {
    const session = createCheckupSession({ outputDir, dataDir, authDir });
    const superSecretHeaderVal = 'x-secret-auth-bearer-token-xyz-12345';
    const superSecretTunnelVal = 'tunnel-secret-999-auth';

    session.secrets.set({
      headers: { Authorization: superSecretHeaderVal },
      tunnelAuth: superSecretTunnelVal,
      userAgent: 'QA-Bot',
    });

    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(superSecretHeaderVal);
    expect(serialized).not.toContain(superSecretTunnelVal);

    const secretsSerialized = JSON.stringify(session.secrets);
    expect(secretsSerialized).not.toContain(superSecretHeaderVal);
    expect(secretsSerialized).not.toContain(superSecretTunnelVal);

    session.secrets.clear();
    expect(session.secrets.headers).toBeUndefined();
    expect(session.secrets.tunnelAuth).toBeUndefined();
  });
});
