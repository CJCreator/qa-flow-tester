/**
 * What one runner event does to the wizard, as data. App applies the result (setters, navigation, requests);
 * the decisions live here so they can be tested without rendering App.
 */

import type { RunnerStatus } from '../api';
import { RunnerError } from '../api';
import { shouldResetFeed } from '../hooks/useRunnerStream';
import { headersNotice } from './coverage-text';
import { SIGN_IN_AGAIN_TEXT } from './form';
import { PATHS } from './router';
import { isScanProgress, type ScanProgress } from './scan-progress';
import type { StopReply } from './stop-result';
import { initialFeed, plainFailure, reduceFeed, type FeedState, type RunnerEvent } from './translate';

/** A background change to the plan (re-planning, adding pages), as Release check-up reports it. */
export interface PlanUpdateState {
  running: boolean;
  what?: string;
  step?: string;
  error?: string | null;
  /** Goes up with every PLAN_UPDATE_* event, so a waiting screen can tell that something was heard. */
  seq?: number;
}

/** A banner over the plan: testing stopped or failed, or the site changed since the plan was approved. */
export interface PlanNotice {
  tone: 'fail' | 'warn' | 'stamp';
  title: string;
  body?: string;
}

/** Something App must do after an event: requests and moves stay in App, the decision is made here. */
export type RunEffect =
  | { kind: 'reconcile' }
  | { kind: 'load-plan'; after: 'ready' | 'update' | 'kept' }
  | { kind: 'navigate'; to: string } // with { replace: true }: a move the person did not make
  | { kind: 'go'; to: string } // a plain navigate(to): a move the person asked for (after Stop)
  | { kind: 'refresh-recent' }
  | { kind: 'count-completed' }
  | { kind: 'bump-epoch' };

/** The state changes and effects of one runner event. Each updater is applied with React's functional setState. */
export interface RunStep {
  feed?: (feed: FeedState) => FeedState;
  scan?: (scan: ScanProgress | null) => ScanProgress | null;
  status?: (status: RunnerStatus | null) => RunnerStatus | null;
  planUpdate?: (update: PlanUpdateState) => PlanUpdateState;
  /** undefined leaves the notice as it is; null clears it. */
  planNotice?: PlanNotice | null;
  /** The new value of the planning start time, when it changes. */
  planningStartedAt?: number | null;
  effects: RunEffect[];
}

/** What the page knows that the event does not carry. */
export interface RunWhere {
  onCheckAddress: boolean;
  planningStartedAt: number | null;
  now: number;
}

const feedOf = (event: RunnerEvent) => (f: FeedState) => reduceFeed(f, event, 'product');

export function runEventStep(event: RunnerEvent, where: RunWhere): RunStep {
  // A page that opens or reconnects mid-run is sent the run's events so far, marked `replayed`:
  // they rebuild the screens, but only live events move the person.
  const live = event.replayed !== true;
  const at = typeof event.timestamp === 'number' ? event.timestamp : where.now;

  switch (event.type) {
    case 'connected': {
      // A resumed reconnect keeps the feed and scan already held; only the gap comes after it.
      const step: RunStep = { effects: [{ kind: 'reconcile' }] };
      if (shouldResetFeed(event)) {
        step.feed = () => initialFeed('product');
        step.scan = () => null;
        step.planningStartedAt = null;
      }
      return step;
    }

    case 'DISCOVERY_PROGRESS': {
      if (!isScanProgress(event)) return { effects: [] };
      const p = event;
      const start = p.stage === 'planning' && where.planningStartedAt === null ? at : where.planningStartedAt;
      // Time left, from how long the AI requests so far took.
      const elapsed = start ? (at - start) / 1000 : 0;
      const secondsLeft =
        p.stage === 'planning' && p.done && p.total ? (elapsed / p.done) * Math.max(0, p.total - p.done) : undefined;
      // The same request asked about again keeps its start time; a new one starts its own.
      const askingSince = p.asking
        ? (before: ScanProgress | null) => (before?.asking && before.what === p.what ? before.askingSince : at)
        : () => undefined;
      return {
        scan: (before) => ({
          ...before,
          ...p,
          pagesFound: p.pagesFound ?? before?.pagesFound,
          secondsLeft: p.asking ? before?.secondsLeft : secondsLeft,
          askingSince: askingSince(before),
          asking: p.asking || undefined,
        }),
        planningStartedAt: start !== where.planningStartedAt ? start : undefined,
        effects: [],
      };
    }

    case 'PLAN_UPDATE_STARTED':
      return {
        planUpdate: (u) => ({ running: true, what: String(event.what ?? ''), seq: (u.seq ?? 0) + 1 }),
        effects: [],
      };

    case 'PLAN_UPDATE_PROGRESS':
      return {
        planUpdate: (u) => ({ ...u, running: true, step: String(event.what ?? ''), seq: (u.seq ?? 0) + 1 }),
        effects: [],
      };

    case 'PLAN_UPDATED':
      // The plan is loaded first; the update is over only once it is (App's 'update' load).
      return { effects: [{ kind: 'load-plan', after: 'update' }] };

    case 'PLAN_UPDATE_FAILED':
      return {
        planUpdate: (u) => ({
          running: false,
          seq: (u.seq ?? 0) + 1,
          error: 'The plan couldn’t be updated. Try again. If it keeps failing, check your AI key in Settings.',
        }),
        effects: [],
      };

    case 'PLAN_READY': {
      const effects: RunEffect[] = [{ kind: 'load-plan', after: 'ready' }];
      const step: RunStep = { effects };
      if (event.changedSinceApproval) {
        step.planNotice = {
          tone: 'warn',
          title: 'The site has changed since you approved its plan',
          body: 'What’s new is marked New. Look it over, then approve the plan to test it.',
        };
      }
      if (live) {
        step.status = (s) => (s ? { ...s, phase: 'awaiting-review', hasPlan: true } : s);
        if (where.onCheckAddress) effects.push({ kind: 'navigate', to: PATHS.plan });
      }
      return step;
    }

    case 'TESTING_STARTED': {
      // The feed starts again with testing; the time left counts from here.
      const step: RunStep = {
        feed: () => ({ ...initialFeed('product'), testingStartedAt: at }),
        effects: [],
      };
      if (live) {
        step.status = (s) => (s ? { ...s, phase: 'testing' } : s);
        if (where.onCheckAddress) step.effects.push({ kind: 'navigate', to: PATHS.testing });
      }
      return step;
    }

    case 'RUN_COMPLETED': {
      const step: RunStep = { feed: feedOf(event), effects: [] };
      if (!live) return step;
      const runId = typeof event.runId === 'string' ? event.runId : null;
      step.effects.push({ kind: 'count-completed' });
      step.status = (s) => (s ? { ...s, phase: 'done', isRunning: false, reportRunId: runId } : s);
      step.effects.push({ kind: 'refresh-recent' });
      if (runId && where.onCheckAddress) step.effects.push({ kind: 'navigate', to: PATHS.report(runId) });
      return step;
    }

    case 'RUN_FAILED': {
      const step: RunStep = { feed: feedOf(event), effects: [] };
      if (live) step.effects.push({ kind: 'bump-epoch' });
      if (event.planKept) {
        // Testing failed part-way: the approved plan waits again, with what happened above it.
        step.planNotice = {
          tone: 'fail',
          title: 'Testing stopped before it finished',
          body: `${plainFailure(event.error, 'product')} Your plan is kept: approve it again when the site is working.`,
        };
        if (live) {
          step.status = (s) => (s ? { ...s, phase: 'awaiting-review' } : s);
          if (where.onCheckAddress) step.effects.push({ kind: 'navigate', to: PATHS.plan });
        }
      } else if (live) {
        step.status = (s) => (s ? { ...s, phase: 'failed', isRunning: false } : s);
      }
      return step;
    }

    case 'RUN_ABORTED': {
      // Stopped from another tab: catch up.
      const step: RunStep = { feed: feedOf(event), effects: [] };
      if (live) step.effects.push({ kind: 'reconcile' });
      return step;
    }

    default:
      return { feed: feedOf(event), effects: [] };
  }
}

/** The message and the sign-in state for a failed approval, as the plan screen shows them. */
export function approveFailure(err: unknown): { error: string; needsSignIn: boolean | string[] } {
  if (err instanceof RunnerError && err.code === 'ERR_SIGN_IN_REQUIRED') {
    return {
      error: SIGN_IN_AGAIN_TEXT,
      needsSignIn: err.needsSignIn && err.needsSignIn.length > 0 ? err.needsSignIn : true,
    };
  }
  if (
    err instanceof RunnerError &&
    err.code === 'ERR_HEADERS_NOT_SAVED' &&
    err.needsHeaders &&
    err.needsHeaders.length > 0
  ) {
    return { error: headersNotice(err.needsHeaders), needsSignIn: false };
  }
  return {
    error: err instanceof RunnerError ? err.message : 'The plan couldn’t be approved. Try again.',
    needsSignIn: false,
  };
}

/** What happens after "throw the results away" on Stop testing, once the stop has worked (App checks stopProblem first). */
export function testingStoppedStep(reply: StopReply): RunStep {
  const feed = () => initialFeed('product');
  if (reply.planKept) {
    return {
      feed,
      status: (s) => (s ? { ...s, phase: 'awaiting-review' } : s),
      planNotice: {
        tone: 'stamp',
        title: 'Testing stopped. Your plan is kept.',
        body: 'Change it if you like, then approve it again.',
      },
      effects: [
        { kind: 'load-plan', after: 'kept' },
        { kind: 'navigate', to: PATHS.plan },
      ],
    };
  }
  return {
    feed,
    status: (s) => (s ? { ...s, phase: 'idle', isRunning: false } : s),
    effects: [{ kind: 'go', to: PATHS.new }],
  };
}
