import type { RunStartBody, TimingEntry } from '@qa/types';
import { isAbortError, SignInFailedError, type OrchestratorEvent } from '@qa/core';
import { signInReasonText } from '@qa/types';
import { checkCustomHeaders, checkSavedSessions } from '../run-inputs.js';
import type { CheckupSession } from './checkup-session.js';
import { hostOfAddress } from './plan-store.js';
import { PLAN_SAVE_FAILED, redactedMessage } from './checkup-run-helpers.js';
import type { CheckupRun, RunAuthorization, RunContext, RunDeps } from './checkup-run-types.js';
import { createExecuteTesting } from './checkup-run-testing.js';
import { createExecuteRun } from './checkup-run-execute.js';

// Public surface of the run modules, kept importable from this path.
export type { CheckupRun, RunAuthorization, RunDeps } from './checkup-run-types.js';
export { LOOPBACK_HOSTS, ALL_SCREEN_SIZES, nothingNew, resolveTargetUrl, formatDay, redactedMessage, screensForReview } from './checkup-run-helpers.js';
export {
  hasCompleteSignIn,
  resolveReadOnly,
  readOnlyReason,
  resolveAuthorization,
  signInAccount,
} from './checkup-run-authorization.js';

export function createCheckupRun(session: CheckupSession, deps: RunDeps = {}): CheckupRun {
  let currentRunPromise: Promise<void> | null = null;
  /** False from the moment a run starts until its executeRun has returned, stopped runs included. */
  let runEnded = true;
  /** True from the moment start() is called until it has claimed the slot (or failed). Set before any await. */
  let starting = false;
  let startDone: Promise<void> | null = null;
  const runBusy = () =>
    Object.assign(
      new Error(
        deps.beta
          ? 'Someone else is running a check-up on this shared copy. Try again in a few minutes.'
          : 'Another check-up is running. Wait for it to finish, or stop it first.'
      ),
      { code: 'ERR_RUN_IN_PROGRESS', status: 409 }
    );

  const broadcast = (event: OrchestratorEvent | Record<string, unknown>): void => {
    // The server's onEvent records the event for replay and streams it; record here only without one.
    if (deps.onEvent) {
      deps.onEvent(event);
      return;
    }
    session.events.publish(event.type === 'RUN_COMPLETED' ? { type: event.type, runId: (event as any).runId } : event);
  };

  const forwardRunEvent = (event: OrchestratorEvent): void => {
    if (event.type === 'RUN_COMPLETED') session.report.set(event.report);
    broadcast(event);
  };

  const getSiteDir = (): string => {
    return deps.siteDir ? deps.siteDir() : session.paths.dataDir;
  };

  /** Discovery's crawl and planning times, kept per run until testing starts (a plan can wait for review). */
  const discoveryTimings = new Map<string, TimingEntry[]>();

  const ctx: RunContext = { session, deps, broadcast, forwardRunEvent, getSiteDir, discoveryTimings };
  const executeTesting = createExecuteTesting(ctx);
  const executeRun = createExecuteRun(ctx, executeTesting);

  return {
    async start(input: {
      body: RunStartBody;
      authorization: RunAuthorization;
    }): Promise<{ runId: string; awaitingReview: boolean }> {
      const { body, authorization } = input;
      // Checked and set before the first await: a second start while this one is still starting is refused.
      // A stopped run still tearing down (its browsers closing) holds the slot until it has ended.
      if (starting || !runEnded || (session.run.isRunning && session.run.phase !== 'awaiting-review')) throw runBusy();
      starting = true;
      let finishStarting!: () => void;
      startDone = new Promise<void>((resolve) => (finishStarting = resolve));
      try {
        return await startRun(body, authorization);
      } finally {
        starting = false;
        startDone = null;
        finishStarting();
      }
    },

    async stop(input?: {
      finish?: boolean;
      discard?: boolean;
    }): Promise<{ aborted: boolean; planKept?: boolean; finishing?: boolean }> {
      // A stop that arrives while a run is still starting waits for the start, then stops that run.
      if (starting && startDone) await startDone;
      return stopRun(input);
    },

    async waitFor(deadlineMs: number): Promise<void> {
      if (!currentRunPromise && !session.run.isRunning) return;
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadlineMs));
      });
      try {
        await Promise.race([currentRunPromise ?? Promise.resolve(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    executeTesting,
  };

  async function startRun(
    body: RunStartBody,
    authorization: RunAuthorization
  ): Promise<{ runId: string; awaitingReview: boolean }> {
    {
      await session.plan.current();
      const waiting = session.run.phase === 'awaiting-review' ? session.plan.currentRecord : null;
      const othersPlan = !!deps.beta && !!waiting && (deps.isMine ? !deps.isMine(waiting.plan.runId) : false);
      // On the shared copy another tester's waiting plan is never moved: the start is refused instead.
      if (othersPlan) throw runBusy();
      const parkWaiting = !!waiting && session.plan.hostOf(waiting) !== hostOfAddress(body.targetUrl);
      if (waiting && !parkWaiting && !body.replacePlan) {
        let waitingFor = waiting.plan.targetUrl;
        try {
          waitingFor = new URL(waitingFor).host;
        } catch {}
        const err = Object.assign(
          new Error(
            `The plan for ${waitingFor} is waiting for your review. Starting a new check-up of it throws that plan away.`
          ),
          {
            code: 'ERR_PLAN_WAITING',
            status: 409,
            suggestion: 'Open the plan to finish reviewing it, or start again to replace it.',
            targetUrl: waiting.plan.targetUrl,
          }
        );
        throw err;
      }

      if (parkWaiting && waiting) await session.plan.park(waiting);
      await session.plan.unpark(hostOfAddress(body.targetUrl));
      await session.plan.clear();

      const productId = body.productId || 'default-product';
      const runId = `run-${Date.now()}`;
      if (deps.claimOwner) deps.claimOwner(runId);

      // begin() refuses when a run holds the slot; the start never goes on without it.
      if (!session.run.begin(runId, body.targetUrl)) throw runBusy();
      session.run.setPhase('scanning');
      session.report.setError(null, null);

      const abortController = new AbortController();
      const finishController = new AbortController();
      session.run.setAbortController(abortController);
      session.run.setFinishController(finishController);

      session.events.clear();
      const generation = session.run.generation;

      let typedHostname = '';
      try {
        typedHostname = new URL(body.targetUrl).hostname;
      } catch {}
      const customHeadersChecked = checkCustomHeaders(body.customHeaders);
      const sessions = checkSavedSessions(body.savedSessions, typedHostname);
      if (sessions.ok && sessions.value) session.secrets.savedSessions.set(runId, sessions.value);
      delete body.savedSessions;

      session.secrets.set({
        headers: customHeadersChecked.ok ? customHeadersChecked.value : undefined,
        tunnelAuth: body.tunnelAuth,
        headerHosts: body.headerHosts,
        userAgent: body.userAgent,
      });

      runEnded = false;
      const runPromise = executeRun(
        body,
        productId,
        runId,
        generation,
        authorization,
        abortController.signal,
        finishController.signal
      ).finally(() => {
        runEnded = true;
      }).catch((err: unknown) => {
        if (generation !== session.run.generation || isAbortError(err)) return;
        session.secrets.savedSessions.delete(runId);
        const msg = redactedMessage(err, {
          roles: body.roles,
          customHeaders: session.secrets.headers,
          tunnelAuth: session.secrets.tunnelAuth,
          targetUrl: session.run.targetUrl || undefined,
        });
        const code = (err as { code?: string } | undefined)?.code || 'ERR_DISCOVERY_FAILED';
        session.report.setError(msg, code);
        session.run.setPhase('failed');
        session.run.setIsRunning(false);
        const signInReason = err instanceof SignInFailedError ? err.reason : undefined;
        broadcast({
          type: 'RUN_FAILED',
          runId,
          error: msg,
          code,
          ...(signInReason ? { signInReason } : {}),
          timestamp: Date.now(),
        });
      });

      currentRunPromise = runPromise;

      return { runId, awaitingReview: false };
    }
  }

  async function ctxWaitEnd(promise: Promise<void>, ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function stopRun(input?: {
    finish?: boolean;
    discard?: boolean;
  }): Promise<{ aborted: boolean; planKept?: boolean; finishing?: boolean }> {
    {
      const runId = session.run.runId;
      const finishCtrl = session.run.finishController();
      if (input?.finish && (session.run.phase === 'scanning' || session.run.phase === 'testing') && finishCtrl) {
        finishCtrl.abort();
        broadcast({
          type: 'RUN_FINISHING',
          runId: runId ?? undefined,
          phase: session.run.phase,
          timestamp: Date.now(),
        });
        return { aborted: false, finishing: true };
      }
      if (!session.run.isRunning && session.run.phase === 'idle') {
        return { aborted: false };
      }
      // Nothing is running while a plan waits for review. Stop keeps that plan; only an explicit discard clears it.
      if (session.run.phase === 'awaiting-review' && !input?.discard) {
        return { aborted: false, planKept: true };
      }

      session.run.setGeneration(session.run.generation + 1);
      const activeCtrl = session.run.abortController();
      if (activeCtrl) {
        try {
          activeCtrl.abort();
        } catch {}
        session.run.setAbortController(null);
      }

      const record = session.plan.currentRecord;
      const planKept = session.run.phase === 'testing' && !!record && record.plan.runId === runId;
      // Stop during testing ends execution: the run's sign-in goes now. The plan is kept for review without it.
      if (planKept && runId) {
        session.secrets.savedSessions.delete(runId);
        await session.secrets.clean(runId);
      }
      let planSaved = true;
      if (planKept) {
        session.run.setPhase('awaiting-review');
        session.run.setIsRunning(true);
        planSaved = await session.plan.save(record!).then(() => true, () => false);
      } else {
        session.run.setIsRunning(false);
        session.run.setPhase('idle');
        session.run.setTargetUrl(null);
        await session.plan.clear(runId ?? undefined);
      }
      session.report.setError(
        planSaved ? 'Run was manually stopped by user.' : `Run was manually stopped by user. ${PLAN_SAVE_FAILED}`,
        'ERR_RUN_ABORTED'
      );

      broadcast({
        type: 'RUN_ABORTED',
        runId: runId ?? undefined,
        planKept,
        code: 'ERR_RUN_ABORTED',
        message: 'Run was stopped by the user.',
        timestamp: Date.now(),
      });

      // Give the aborted run a moment to close its browsers, so a start right after the stop finds the slot free.
      if (!runEnded && currentRunPromise) await ctxWaitEnd(currentRunPromise, 15000);

      return { aborted: true, planKept, finishing: false };
    }
  }
}
