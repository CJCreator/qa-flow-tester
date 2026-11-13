import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunnerStatus } from '../src/api';
import { RunnerError } from '../src/api';
import { approveFailure, runEventStep, testingStoppedStep, type RunStep } from '../src/lib/run-events';
import { SIGN_IN_AGAIN_TEXT } from '../src/lib/form';
import { headersNotice } from '../src/lib/coverage-text';
import { initialFeed, type FeedState, type RunnerEvent } from '../src/lib/translate';
import type { ScanProgress } from '../src/lib/scan-progress';

const CHECKUP = { onCheckAddress: true, planningStartedAt: null, now: 1_000 };
const NOT_CHECKUP = { ...CHECKUP, onCheckAddress: false };

const scanning = {
  phase: 'scanning',
  isRunning: true,
  hasPlan: false,
  hasReport: false,
  lastRunError: null,
  runId: 'run-0',
  targetUrl: 'https://site.test',
} as unknown as RunnerStatus;

function step(event: RunnerEvent, where = CHECKUP): RunStep {
  return runEventStep(event, where);
}

function navigates(s: RunStep): string[] {
  return s.effects.flatMap((e) => (e.kind === 'navigate' || e.kind === 'go' ? [e.to] : []));
}

function kinds(s: RunStep): string[] {
  return s.effects.map((e) => e.kind);
}

describe('runEventStep', () => {
  it('connected: a fresh connection resets the feed and scan and asks for reconcile', () => {
    const feedBefore: FeedState = { ...initialFeed('product'), current: 'Old line' };
    const s = step({ type: 'connected' });
    expect(kinds(s)).toEqual(['reconcile']);
    expect(s.feed?.(feedBefore).current).toBe(initialFeed('product').current);
    expect(s.scan?.({ stage: 'crawling', pagesFound: 3 })).toBeNull();
    expect(s.planningStartedAt).toBeNull();
  });

  it('connected: a resumed reconnect keeps the feed and scan, and still asks for reconcile', () => {
    const s = step({ type: 'connected', resumed: true });
    expect(kinds(s)).toEqual(['reconcile']);
    expect(s.feed).toBeUndefined();
    expect(s.scan).toBeUndefined();
    expect(s.planningStartedAt).toBeUndefined();
  });

  it('DISCOVERY_PROGRESS in planning: the first event sets the start time; later ones give time left', () => {
    const first = step({
      type: 'DISCOVERY_PROGRESS',
      stage: 'planning',
      done: 0,
      total: 4,
      timestamp: 5_000,
    });
    expect(first.planningStartedAt).toBe(5_000);

    const later = step(
      { type: 'DISCOVERY_PROGRESS', stage: 'planning', done: 2, total: 4, timestamp: 15_000 },
      { ...CHECKUP, planningStartedAt: 5_000 }
    );
    expect(later.planningStartedAt).toBeUndefined();
    const scan = later.scan?.(null) as ScanProgress;
    expect(scan.secondsLeft).toBe(10);
  });

  it('DISCOVERY_PROGRESS asking again about the same request keeps its start time', () => {
    const before: ScanProgress = { stage: 'planning', asking: true, what: 'plan the home page', askingSince: 2_000 };
    const s = step({
      type: 'DISCOVERY_PROGRESS',
      stage: 'planning',
      asking: true,
      what: 'plan the home page',
      timestamp: 9_000,
    });
    expect(s.scan?.(before)?.askingSince).toBe(2_000);
    const fresh = s.scan?.({ stage: 'planning' });
    expect(fresh?.askingSince).toBe(9_000);
  });

  it('DISCOVERY_PROGRESS that is not scan progress gives no change and no effects', () => {
    const s = step({ type: 'DISCOVERY_PROGRESS', stage: 'something-else' });
    expect(s.scan).toBeUndefined();
    expect(s.feed).toBeUndefined();
    expect(s.planningStartedAt).toBeUndefined();
    expect(s.effects).toEqual([]);
  });

  it('PLAN_READY live on a Check-up address: awaiting-review, load the plan, move to the plan', () => {
    const s = step({ type: 'PLAN_READY' });
    expect(s.status?.(scanning)).toMatchObject({ phase: 'awaiting-review', hasPlan: true });
    expect(s.effects).toEqual([
      { kind: 'load-plan', after: 'ready' },
      { kind: 'navigate', to: '/check/plan' },
    ]);
  });

  it('PLAN_READY replayed: only the plan is loaded', () => {
    const s = step({ type: 'PLAN_READY', replayed: true });
    expect(s.status).toBeUndefined();
    expect(s.effects).toEqual([{ kind: 'load-plan', after: 'ready' }]);
  });

  it('PLAN_READY with changedSinceApproval: shows the site-changed notice', () => {
    const s = step({ type: 'PLAN_READY', changedSinceApproval: true });
    expect(s.planNotice?.title).toBe('The site has changed since you approved its plan');
  });

  it('PLAN_READY live but not on a Check-up address: no navigate', () => {
    const s = step({ type: 'PLAN_READY' }, NOT_CHECKUP);
    expect(navigates(s)).toEqual([]);
    expect(s.status?.(scanning)).toMatchObject({ phase: 'awaiting-review' });
  });

  it('TESTING_STARTED: the feed starts at the event time; live moves to testing', () => {
    const s = step({ type: 'TESTING_STARTED', timestamp: 7_000 });
    expect(s.feed?.(initialFeed('product')).testingStartedAt).toBe(7_000);
    expect(s.status?.(scanning)).toMatchObject({ phase: 'testing' });
    expect(navigates(s)).toEqual(['/check/testing']);
  });

  it('RUN_COMPLETED live with a run id: done, counted, recent list refreshed, report opened', () => {
    const s = step({ type: 'RUN_COMPLETED', runId: 'run-1' });
    expect(s.status?.(scanning)).toMatchObject({ phase: 'done', isRunning: false, reportRunId: 'run-1' });
    expect(kinds(s)).toEqual(['count-completed', 'refresh-recent', 'navigate']);
    expect(navigates(s)).toEqual(['/reports/run-1']);
  });

  it('RUN_COMPLETED replayed: the feed changes, nothing else', () => {
    const s = step({ type: 'RUN_COMPLETED', runId: 'run-1', replayed: true });
    expect(s.feed).toBeDefined();
    expect(s.status).toBeUndefined();
    expect(s.effects).toEqual([]);
  });

  it('RUN_FAILED live with planKept: epoch bump, notice, awaiting-review, back to the plan', () => {
    const s = step({ type: 'RUN_FAILED', planKept: true, error: 'The site stopped answering.' });
    expect(kinds(s)).toEqual(['bump-epoch', 'navigate']);
    expect(s.planNotice?.title).toBe('Testing stopped before it finished');
    expect(s.status?.(scanning)).toMatchObject({ phase: 'awaiting-review' });
    expect(navigates(s)).toEqual(['/check/plan']);
  });

  it('RUN_FAILED live without planKept: failed, not running', () => {
    const s = step({ type: 'RUN_FAILED', error: 'Boom' });
    expect(s.status?.(scanning)).toMatchObject({ phase: 'failed', isRunning: false });
    expect(s.planNotice).toBeUndefined();
    expect(s.effects).toEqual([{ kind: 'bump-epoch' }]);
  });

  it('RUN_ABORTED live: asks for reconcile', () => {
    const s = step({ type: 'RUN_ABORTED' });
    expect(kinds(s)).toEqual(['reconcile']);
    expect(s.feed).toBeDefined();
  });

  it('PLAN_UPDATE_STARTED then PLAN_UPDATE_FAILED: running goes on then off, seq counts up, the failure is set', () => {
    const started = step({ type: 'PLAN_UPDATE_STARTED', what: 'Adding a page' });
    const running = started.planUpdate?.({ running: false });
    expect(running).toMatchObject({ running: true, what: 'Adding a page', seq: 1 });

    const failed = step({ type: 'PLAN_UPDATE_FAILED' });
    const after = failed.planUpdate?.(running ?? { running: false });
    expect(after?.running).toBe(false);
    expect(after?.seq).toBe(2);
    expect(after?.error).toContain('The plan couldn’t be updated.');
  });

  it('PLAN_UPDATED: the plan is loaded as an update; no state change in the step', () => {
    const s = step({ type: 'PLAN_UPDATED' });
    expect(s.effects).toEqual([{ kind: 'load-plan', after: 'update' }]);
    expect(s.planUpdate).toBeUndefined();
  });
});

describe('approveFailure', () => {
  it('sign-in required with names: asks again for those roles', () => {
    const err = new RunnerError('x', 'ERR_SIGN_IN_REQUIRED', undefined, ['member']);
    expect(approveFailure(err)).toEqual({ error: SIGN_IN_AGAIN_TEXT, needsSignIn: ['member'] });
  });

  it('sign-in required without names: asks again, as true', () => {
    const err = new RunnerError('x', 'ERR_SIGN_IN_REQUIRED');
    expect(approveFailure(err)).toEqual({ error: SIGN_IN_AGAIN_TEXT, needsSignIn: true });
  });

  it('headers not saved with names: the headers notice', () => {
    const err = new RunnerError('x', 'ERR_HEADERS_NOT_SAVED', undefined, undefined, ['X-Test']);
    expect(approveFailure(err)).toEqual({ error: headersNotice(['X-Test']), needsSignIn: false });
  });

  it('any other runner error: its message', () => {
    expect(approveFailure(new RunnerError('The runner is busy.'))).toEqual({
      error: 'The runner is busy.',
      needsSignIn: false,
    });
  });

  it('anything else: the generic text', () => {
    expect(approveFailure(new Error('network'))).toEqual({
      error: 'The plan couldn’t be approved. Try again.',
      needsSignIn: false,
    });
  });
});

describe('testingStoppedStep', () => {
  it('with planKept: the plan is kept, loaded, and shown', () => {
    const s = testingStoppedStep({ aborted: true, planKept: true });
    expect(s.status?.(scanning)).toMatchObject({ phase: 'awaiting-review' });
    expect(s.planNotice).toMatchObject({ tone: 'stamp', title: 'Testing stopped. Your plan is kept.' });
    expect(s.effects).toEqual([
      { kind: 'load-plan', after: 'kept' },
      { kind: 'navigate', to: '/check/plan' },
    ]);
    expect(s.feed?.(scanningFeed())).toEqual(initialFeed('product'));
  });

  it('without planKept: idle, not running, and a plain move to the new check-up', () => {
    const s = testingStoppedStep({ aborted: true });
    expect(s.status?.(scanning)).toMatchObject({ phase: 'idle', isRunning: false });
    expect(s.planNotice).toBeUndefined();
    expect(s.effects).toEqual([{ kind: 'go', to: '/check' }]);
  });
});

describe('App wiring', () => {
  it('App.tsx hands each event to runEventStep and no longer switches on runner event names', () => {
    const app = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
    expect(app).toContain('runEventStep(');
    expect(app).not.toContain("case 'PLAN_READY':");
  });
});

function scanningFeed(): FeedState {
  return { ...initialFeed('product'), status: 'running', current: 'Testing', history: ['a'] };
}
