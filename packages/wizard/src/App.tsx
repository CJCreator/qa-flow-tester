import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReleaseReport, ReviewPlan, RoleCredential, RunSummary } from '@qa/types';
import {
  abortRun,
  approvePlan,
  checkReachable,
  getAiSetup,
  getPlan,
  getStatus,
  listRuns,
  listWaitingPlans,
  readRunText,
  plainError,
  resumeWaitingPlan,
  RunnerError,
  startRun,
  STREAM_URL,
  type AiSetup,
  type RunnerStatus,
  type SiteFacts,
  type StartRunRequest,
  type WaitingPlan,
} from './api';
import { useConfirm } from './components/ConfirmDialog';
import { NothingInProgress } from './components/RunStates';
import { addressForPhase } from './lib/phase-address';
import { StepBar, type Step } from './components/StepBar';
import { Notice, Spinner } from './components/text';
import { TopBar } from './components/TopBar';
import { hasFinishedCheckup } from './lib/onboarding';
import { CommandPalette } from './components/CommandPalette';
import { useRunnerConnection } from './hooks/useRunnerConnection';
import { useRunnerStream } from './hooks/useRunnerStream';
import {
  DEFAULT_MAX_PAGES,
  EMPTY_FORM,
  addressFromSearch,
  capOf,
  testCapOf,
  afterStart,
  consentRequestOf,
  contextDocumentsOf,
  contextUrlOf,
  productContextOf,
  rolesOf,
  SIGN_IN_AGAIN_TEXT,
  savedSessionsOf,
  parseCustomHeaders,
  type CheckupForm,
} from './lib/form';
import { isCheckRoute, matchRoute, navigate, PATHS, readsAddressParam, usePathname, type Route } from './lib/router';
import { COUNTER_EVENTS, sendCounterEvent } from './lib/counter';
import { useDocumentTitle } from './lib/title';
import { initialFeed, plainFailure, reduceFeed, type FeedState, type RunnerEvent } from './lib/translate';
import { count } from './lib/format';
import { displayHost, hostOf } from './lib/url';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { NewCheckupScreen, type StartFacts } from './screens/NewCheckupScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { LandingScreen } from './screens/LandingScreen';
import { PastCheckupsScreen } from './screens/PastCheckupsScreen';
import type { PlanNotice, PlanUpdateState } from './screens/PlanReviewScreen';
import { VisibilityScreen } from './screens/VisibilityScreen';
import { ScanningScreen, isScanProgress, type ScanProgress } from './screens/ScanningScreen';
import { headersNotice } from './lib/coverage-text';
import { SettingsScreen } from './screens/SettingsScreen';
import { TestingScreen } from './screens/TestingScreen';
import { VisualBaselinesScreen } from './screens/VisualBaselinesScreen';
import { splitStoredContext } from './lib/context';

// Report, Plan Review and Benchmark load on first visit, so the first screen does not ship them.
const PlanReviewScreen = lazy(() =>
  import('./screens/PlanReviewScreen').then((m) => ({ default: m.PlanReviewScreen }))
);
const ReportScreen = lazy(() => import('./screens/ReportScreen').then((m) => ({ default: m.ReportScreen })));
const BenchmarkScreen = lazy(() =>
  import('./screens/BenchmarkScreen').then((m) => ({ default: m.BenchmarkScreen }))
);

/** How often the runner's state is read while a check-up is in progress, besides its events. */
const POLL_MS = 5000;
/** How often it is read on a check-up address while nothing is in progress. */
const IDLE_POLL_MS = 30000;

const IN_PROGRESS = new Set(['scanning', 'awaiting-review', 'testing']);

/** The step bar's position for a screen, when it has one. Scanning is when the plan is made. */
function stepOf(route: Route): Step | null {
  switch (route.name) {
    case 'new':
      return 'address';
    case 'scan':
    case 'plan':
      return 'plan';
    case 'testing':
      return 'testing';
    case 'report':
      return 'report';
    default:
      return null;
  }
}

function Loading({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-prose px-4 py-16 text-ink-soft sm:px-6">
      <Spinner label={label} />
    </div>
  );
}

/** What the runner remembered about a site: who owns it, and whether it was marked as a test copy. */
async function rememberedFor(targetUrl: string): Promise<SiteFacts['remembered']> {
  try {
    return (await checkReachable(targetUrl)).remembered;
  } catch {
    return undefined;
  }
}

export default function App() {
  const pathname = usePathname();
  const route = matchRoute(pathname);
  // The public landing page needs no runner, so it neither waits for one nor polls for one.
  const { reachable, checks } = useRunnerConnection(route.name !== 'landing');
  const { confirm, choose, dialog } = useConfirm();

  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [ai, setAi] = useState<AiSetup | null>(null);
  // The new check-up form lives here, so changing screens or adding the key never loses it.
  const [form, setForm] = useState<CheckupForm>(() => ({
    ...EMPTY_FORM,
    address: readsAddressParam(matchRoute(window.location.pathname)) ? addressFromSearch(window.location.search) : '',
  }));
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(null);
  const [planUpdate, setPlanUpdate] = useState<PlanUpdateState>({ running: false });
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveNeedsSignIn, setApproveNeedsSignIn] = useState<boolean | string[]>(false);
  const [approving, setApproving] = useState(false);
  const lastHeaders = useRef<string>('');
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [feed, setFeed] = useState<FeedState>(() => initialFeed('product'));
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RunSummary[] | null>(null);
  const [waitingPlans, setWaitingPlans] = useState<WaitingPlan[]>([]);
  // The plan couldn't be fetched (Retry asks again), the runner missed a poll, a stop didn't work.
  const [planError, setPlanError] = useState(false);
  const [planTry, setPlanTry] = useState(0);
  const [missedPoll, setMissedPoll] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  /** Set by Back and Forward: the next status read must not snap the person forward. */
  const popped = useRef(false);

  /** Goes up with every start, stop and approval: a status read begun before one is out of date. */
  const epoch = useRef(0);
  const planningStartedAt = useRef<number | null>(null);

  const refreshRecent = useCallback(() => {
    listRuns()
      .then(setRecent)
      .catch(() => {});
    void listWaitingPlans().then(setWaitingPlans);
  }, []);

  /**
   * Reads the runner's state. On the check-up's own addresses the runner's phase wins: when the
   * check-up has moved on, the address is replaced with the right one. Anywhere else the phase never
   * moves the person; the new check-up screen offers a Resume card instead.
   */
  const reconcile = useCallback(async () => {
    const asked = epoch.current;
    const next = await getStatus();
    if (asked !== epoch.current) return;
    setMissedPoll(!next);
    if (!next) return;
    setStatus(next);
    const wasPopped = popped.current;
    popped.current = false;
    const target = addressForPhase(next.phase, window.location.pathname, wasPopped);
    if (target && target !== window.location.pathname) navigate(target, { replace: true });
  }, []);

  const loadAi = useCallback(() => {
    setStartError(null);
    getAiSetup()
      .then(setAi)
      .catch(() => setStartError('Release check-up didn’t answer about its AI setup. Try again.'));
  }, []);

  // Once the runner answers: the AI setup, where any check-up is, and the recent check-ups.
  useEffect(() => {
    if (!reachable) return;
    loadAi();
    void reconcile();
    refreshRecent();
  }, [reachable, loadAi, reconcile, refreshRecent]);

  const inProgress = !!status?.phase && IN_PROGRESS.has(status.phase);

  useEffect(() => {
    const onPop = () => {
      popped.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Back onto a finished check-up's address would only bounce to the report: go to the new check-up instead.
  const phase = status?.phase;
  useEffect(() => {
    if (phase !== 'done') return;
    const onPop = () => {
      const target = addressForPhase('done', window.location.pathname, true);
      if (target) navigate(target, { replace: true });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [phase]);

  // The runner's state is read again on each check-up address, and every few seconds while a
  // check-up is in progress (the events do most of the work; this catches anything missed).
  const checkAddress = isCheckRoute(route);
  useEffect(() => {
    if (!reachable) return;
    if (checkAddress) void reconcile();
    if (!checkAddress && !inProgress) return;
    const timer = window.setInterval(() => void reconcile(), inProgress ? POLL_MS : IDLE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [reachable, pathname, checkAddress, inProgress, reconcile]);

  // The plan waiting for review (or being tested), fetched whenever the runner has one this page doesn't.
  useEffect(() => {
    if (status?.phase !== 'awaiting-review' && status?.phase !== 'testing') return;
    if (plan && plan.runId === status.runId) return;
    let cancelled = false;
    getPlan()
      .then((p) => {
        if (cancelled) return;
        setPlanError(false);
        setPlan(p);
      })
      .catch(() => !cancelled && setPlanError(true));
    return () => {
      cancelled = true;
    };
  }, [status?.phase, status?.runId, plan, planTry]);

  // A message from starting belongs to the screen it was started from.
  useEffect(() => setStartError(null), [pathname]);
  useEffect(() => {
    if (reachable && route.name === 'new') refreshRecent();
  }, [reachable, route.name, refreshRecent]);

  const onEvent = useCallback(
    (event: RunnerEvent) => {
      // A page that opens or reconnects mid-run is sent the run's events so far, marked `replayed`:
      // they rebuild the screens, but only live events move the person.
      const live = event.replayed !== true;
      const onCheckAddress = () => isCheckRoute(matchRoute(window.location.pathname));
      const at = typeof event.timestamp === 'number' ? event.timestamp : Date.now();

      switch (event.type) {
        case 'connected':
          setFeed(initialFeed('product'));
          setScan(null);
          planningStartedAt.current = null;
          void reconcile();
          return;

        case 'DISCOVERY_PROGRESS': {
          if (!isScanProgress(event)) return;
          const p = event;
          if (p.stage === 'planning') planningStartedAt.current ??= at;
          // Time left, from how long the AI requests so far took.
          const elapsed = planningStartedAt.current ? (at - planningStartedAt.current) / 1000 : 0;
          const secondsLeft =
            p.stage === 'planning' && p.done && p.total
              ? (elapsed / p.done) * Math.max(0, p.total - p.done)
              : undefined;
          // The same request asked about again keeps its start time; a new one starts its own.
          const askingSince = p.asking
            ? (before: ScanProgress | null) => (before?.asking && before.what === p.what ? before.askingSince : at)
            : () => undefined;
          setScan((before) => ({
            ...before,
            ...p,
            pagesFound: p.pagesFound ?? before?.pagesFound,
            secondsLeft: p.asking ? before?.secondsLeft : secondsLeft,
            askingSince: askingSince(before),
            asking: p.asking || undefined,
          }));
          return;
        }

        case 'PLAN_UPDATE_STARTED':
          setPlanUpdate((u) => ({ running: true, what: String(event.what ?? ''), seq: (u.seq ?? 0) + 1 }));
          return;
        case 'PLAN_UPDATE_PROGRESS':
          setPlanUpdate((u) => ({ ...u, running: true, step: String(event.what ?? ''), seq: (u.seq ?? 0) + 1 }));
          return;
        case 'PLAN_UPDATED':
          getPlan()
            .then(setPlan)
            .catch(() =>
              setPlanNotice({
                tone: 'warn',
                title: 'The updated plan couldn’t be loaded',
                body: 'The plan on screen may be out of date. Reload the page to see the latest.',
              })
            )
            .finally(() => setPlanUpdate((u) => ({ running: false, seq: (u.seq ?? 0) + 1 })));
          return;
        case 'PLAN_UPDATE_FAILED':
          setPlanUpdate((u) => ({
            running: false,
            seq: (u.seq ?? 0) + 1,
            error: 'The plan couldn’t be updated. Try again. If it keeps failing, look at your AI key in Settings.',
          }));
          return;

        case 'PLAN_READY':
          getPlan()
            .then((p) => {
              setPlanError(false);
              setPlan(p);
            })
            .catch(() => setPlanError(true));
          if (event.changedSinceApproval) {
            setPlanNotice({
              tone: 'warn',
              title: 'The site has changed since you approved its plan',
              body: 'What’s new is marked New. Look it over, then approve the plan to test it.',
            });
          }
          if (live) {
            setStatus((s) => (s ? { ...s, phase: 'awaiting-review', hasPlan: true } : s));
            if (onCheckAddress()) navigate(PATHS.plan, { replace: true });
          }
          return;

        case 'TESTING_STARTED':
          // The feed starts again with testing; the time left counts from here.
          setFeed({ ...initialFeed('product'), testingStartedAt: at });
          if (live) {
            setStatus((s) => (s ? { ...s, phase: 'testing' } : s));
            if (onCheckAddress()) navigate(PATHS.testing, { replace: true });
          }
          return;

        case 'RUN_COMPLETED': {
          setFeed((f) => reduceFeed(f, event, 'product'));
          if (!live) return;
          sendCounterEvent(COUNTER_EVENTS.completedCheckup);
          const runId = typeof event.runId === 'string' ? event.runId : null;
          setStatus((s) => (s ? { ...s, phase: 'done', isRunning: false, reportRunId: runId } : s));
          refreshRecent();
          if (runId && onCheckAddress()) navigate(PATHS.report(runId), { replace: true });
          return;
        }

        case 'RUN_FAILED':
          setFeed((f) => reduceFeed(f, event, 'product'));
          if (live) epoch.current++;
          if (event.planKept) {
            // Testing failed part-way: the approved plan waits again, with what happened above it.
            setPlanNotice({
              tone: 'fail',
              title: 'Testing stopped before it finished',
              body: `${plainFailure(event.error, 'product')} Your plan is kept: approve it again when the site is working.`,
            });
            if (live) {
              setStatus((s) => (s ? { ...s, phase: 'awaiting-review' } : s));
              if (onCheckAddress()) navigate(PATHS.plan, { replace: true });
            }
          } else if (live) {
            setStatus((s) => (s ? { ...s, phase: 'failed', isRunning: false } : s));
          }
          return;

        case 'RUN_ABORTED':
          setFeed((f) => reduceFeed(f, event, 'product'));
          // Stopped from another tab: catch up.
          if (live) void reconcile();
          return;

        default:
          setFeed((f) => reduceFeed(f, event, 'product'));
      }
    },
    [reconcile, refreshRecent]
  );

  const connection = useRunnerStream(STREAM_URL, reachable, onEvent, () => void reconcile());
  const lostContact = reachable && route.name !== 'landing' && (missedPoll || connection === 'reconnecting');

  /** Clears everything of the check-up before, for a new one. */
  const resetRun = () => {
    setPlan(null);
    setPlanNotice(null);
    setPlanUpdate({ running: false });
    setApproveError(null);
    setPlanError(false);
    setStopError(null);
    setScan(null);
    planningStartedAt.current = null;
    setFeed(initialFeed('product'));
  };

  /** A stop that did not stop anything says so, beside the thing that was stopped. */
  const stopFailed = (result: { aborted: boolean; error?: string }): boolean => {
    if (result.aborted) {
      setStopError(null);
      return false;
    }
    setStopError(result.error ?? 'Nothing was stopped. The check-up may have already finished.');
    void reconcile();
    return true;
  };

  /**
   * Starts a check-up: from the new check-up screen, Test again or Go deeper, all the same way. A
   * plan waiting for review is only thrown away once the person says so.
   */
  const start = async (request: StartRunRequest): Promise<boolean> => {
    setStarting(true);
    setStartError(null);
    try {
      let runId: string;
      try {
        runId = await startRun({ aiProvider: ai?.provider, ...request });
      } catch (err) {
        if (!(err instanceof RunnerError) || err.code !== 'ERR_PLAN_WAITING') throw err;
        const waiting = (await getStatus())?.targetUrl;
        const ok = await confirm({
          title: 'Start a new check-up?',
          body: (
            <p>
              The plan for {waiting ? hostOf(waiting) : 'this site'} that’s waiting for your review will be thrown away.
              (Plans for other sites are kept.)
            </p>
          ),
          confirmLabel: 'Start a new check-up',
          cancelLabel: 'Keep the plan',
          danger: true,
        });
        if (!ok) return false;
        runId = await startRun({ aiProvider: ai?.provider, ...request, replacePlan: true });
      }
      epoch.current++;
      resetRun();
      setStatus((s) => ({
        isRunning: true,
        hasReport: s?.hasReport ?? false,
        lastRunError: null,
        reportRunId: s?.reportRunId,
        phase: 'scanning',
        hasPlan: false,
        runId,
        targetUrl: request.targetUrl,
      }));
      navigate(PATHS.scan);
      return true;
    } catch (err) {
      if (err instanceof RunnerError && err.code === 'ERR_NO_AI_KEY') {
        setAi((a) => ({ model: a?.model ?? null, configured: false }));
        setStartError(
          matchRoute(window.location.pathname).name === 'new'
            ? 'The AI isn’t connected. Connect it on this page, or start again without it: fixed rules will write the plan.'
            : 'An AI key is needed first. Add it in Settings, then try again.'
        );
      } else {
        setStartError(plainError(err, 'The check-up couldn’t be started. Try again.'));
      }
      return false;
    } finally {
      setStarting(false);
    }
  };

  const startFromForm = (facts: StartFacts) => {
    lastHeaders.current = form.customHeaders || '';
    const roles = rolesOf(form);
    void start({
      targetUrl: facts.url,
      ...consentRequestOf(form, facts.stagingHost),
      searchChecks: facts.searchChecks,
      visibility: facts.visibility,
      productContext: productContextOf(form),
      designNotes: form.designNotes.trim() || undefined,
      maxPages: form.maxPages !== DEFAULT_MAX_PAGES ? form.maxPages : undefined,
      roles: roles.length > 0 ? roles : undefined,
      useSavedSignIns: roles.length === 0 && form.useSavedSignIns,
      planWithoutAI: form.planWithoutAI || undefined,
      useAI: facts.noAI ? false : undefined,
      contextDocuments: contextDocumentsOf(form),
      contextUrl: contextUrlOf(form),
      savedSessions: savedSessionsOf(form),
      aiCap: capOf(form),
      testCap: testCapOf(form),
      crawlConcurrency: form.crawlConcurrency !== 2 ? form.crawlConcurrency : undefined,
      crawlDelayMs: form.crawlDelayMs !== 100 ? form.crawlDelayMs : undefined,
      customHeaders: parseCustomHeaders(form.customHeaders),
    }).then((started) => {
      // Saved sessions are sent once and dropped from the screen once the check-up has started; they are never kept.
      // If the start failed they stay, so the person does not have to choose the file again.
      // Consent is not kept either: the next check-up asks again.
      if (started) setForm(afterStart);
    });
  };

  /** The address as the person typed it for a finished check-up (a report holds the one connected to). */
  const typedAddressOf = async (runId: string, fallback: string): Promise<string> => {
    const runs = await listRuns().catch(() => recent ?? []);
    return runs.find((r) => r.runId === runId)?.targetUrl ?? fallback;
  };

  /** Scans again and reuses the approved plan: testing starts at once if nothing changed. */
  const testAgain = async (runId: string, fallbackUrl: string) => {
    lastHeaders.current = form.customHeaders || '';
    const targetUrl = await typedAddressOf(runId, fallbackUrl);
    const remembered = await rememberedFor(targetUrl);
    setForm((f) => ({
      ...f,
      address: f.address && hostOf(f.address) === hostOf(targetUrl) ? f.address : displayHost(targetUrl),
      owner: remembered?.owner ?? f.owner,
      markedTestCopy: remembered?.markedTestCopy ?? f.markedTestCopy,
      choicesFor: hostOf(targetUrl),
    }));
    // The specs go along, so anything new is planned with them and the next Go deeper has them too.
    const productContext = await readRunText(runId, 'product-context.md').catch(() => undefined);
    const stored = splitStoredContext(productContext);
    await start({
      targetUrl,
      owner: remembered?.owner ?? false,
      stagingHost: remembered?.markedTestCopy,
      testAgain: true,
      productContext: stored.productContext,
      contextDocuments: stored.documents,
      useSavedSignIns: true,
    });
  };

  /** A new check-up of the same site, signed in, with the first one's specs and page limit. */
  const goDeeper = async (report: ReleaseReport, signIn: { username: string; password: string }) => {
    const targetUrl = await typedAddressOf(report.runId, report.targetUrl);
    const sameSite = form.choicesFor === hostOf(targetUrl);
    const productContext =
      (sameSite && productContextOf(form)) ||
      (await readRunText(report.runId, 'product-context.md').catch(() => undefined));
    const remembered = await rememberedFor(targetUrl);
    setForm((f) => {
      let specs = f.specs;
      if (!sameSite && productContext && !specs) {
        const match = productContext.match(/# Specs\n\n([\s\S]*?)(?:\n\n---\n\n|$)/);
        specs = match ? match[1].trim() : productContext.trim();
      }
      return {
        ...f,
        address: f.address && hostOf(f.address) === hostOf(targetUrl) ? f.address : displayHost(targetUrl),
        owner: remembered?.owner ?? f.owner,
        markedTestCopy: remembered?.markedTestCopy ?? f.markedTestCopy,
        choicesFor: hostOf(targetUrl),
        specs,
      };
    });
    const stored = splitStoredContext(productContext || undefined);
    await start({
      targetUrl,
      owner: remembered?.owner ?? false,
      stagingHost: remembered?.markedTestCopy,
      roles: [{ role: 'member', username: signIn.username, password: signIn.password }],
      productContext: stored.productContext,
      contextDocuments: stored.documents,
      designNotes: sameSite ? form.designNotes.trim() || undefined : undefined,
      maxPages: sameSite && form.maxPages !== DEFAULT_MAX_PAGES ? form.maxPages : undefined,
    });
  };

  /** Brings back a plan kept aside for its site; the plan waiting now, if any, is kept aside instead. */
  const resumePlan = async (planHost: string) => {
    setStartError(null);
    try {
      const resumed = await resumeWaitingPlan(planHost, lastHeaders.current || undefined);
      epoch.current++;
      resetRun();
      setStatus((s) =>
        s
          ? {
              ...s,
              phase: 'awaiting-review',
              isRunning: true,
              hasPlan: true,
              runId: resumed.runId,
              targetUrl: resumed.targetUrl,
            }
          : s
      );
      refreshRecent();
      navigate(PATHS.plan);
    } catch (err) {
      if (
        err instanceof RunnerError &&
        err.code === 'ERR_HEADERS_NOT_SAVED' &&
        err.needsHeaders &&
        err.needsHeaders.length > 0
      ) {
        setStartError(headersNotice(err.needsHeaders));
        return;
      }
      setStartError(plainError(err, 'That plan couldn’t be opened. Try again.'));
    }
  };

  const stopScan = async () => {
    const choice = await choose({
      title: 'Stop exploring?',
      body: (
        <p>
          Plan the {scan?.pagesFound ? count(scan.pagesFound, 'page', 'pages') : 'pages'} found so far, and review them,
          or throw the exploration away. AI requests already used stay used.
        </p>
      ),
      confirmLabel: 'Stop and plan what’s found',
      altLabel: 'Throw it away',
      altDanger: true,
      cancelLabel: 'Keep exploring',
    });
    if (choice === 'cancel') return;
    if (choice === 'confirm') {
      // The scan ends early and plans what it has: the plan arrives as usual.
      stopFailed(await abortRun(true));
      return;
    }
    epoch.current++;
    const result = await abortRun();
    if (stopFailed(result)) return;
    resetRun();
    setStatus((s) => (s ? { ...s, phase: 'idle', isRunning: false, runId: null, targetUrl: null } : s));
    // Back to the new check-up, with everything still filled in.
    navigate(PATHS.new, { replace: true });
  };

  const stopTesting = async () => {
    const choice = await choose({
      title: 'Stop testing?',
      body: (
        <p>
          Make a report from the tests done so far (marked as a partial check-up), or go back to the plan. Going back
          throws away the results so far.
        </p>
      ),
      confirmLabel: 'Make a report from what’s done',
      altLabel: 'Throw away the results and go back to the plan',
      altDanger: true,
      cancelLabel: 'Keep testing',
    });
    if (choice === 'cancel') return;
    if (choice === 'confirm') {
      // No more tests start; the report arrives as usual.
      stopFailed(await abortRun(true));
      return;
    }
    epoch.current++;
    const result = await abortRun();
    if (stopFailed(result)) return;
    setFeed(initialFeed('product'));
    if (result.planKept) {
      setStatus((s) => (s ? { ...s, phase: 'awaiting-review' } : s));
      setPlanNotice({
        tone: 'stamp',
        title: 'Testing stopped. Your plan is kept.',
        body: 'Change it if you like, then approve it again.',
      });
      await getPlan()
        .then(setPlan)
        .catch(() => {});
      navigate(PATHS.plan, { replace: true });
    } else {
      setStatus((s) => (s ? { ...s, phase: 'idle', isRunning: false } : s));
      navigate(PATHS.new);
    }
  };

  const approve = async (roles?: RoleCredential[]) => {
    setApproveError(null);
    setApproveNeedsSignIn(false);
    setApproving(true);
    const asked = epoch.current;
    try {
      await approvePlan({
        roles: roles && roles.length > 0 ? roles : undefined,
        customHeaders: lastHeaders.current || undefined,
      });
      // Testing can fail before this answer arrives (the site is down): then the plan is back already.
      if (asked !== epoch.current) return;
      epoch.current++;
      setPlanNotice(null);
      setFeed(initialFeed('product'));
      setStatus((s) => (s ? { ...s, phase: 'testing' } : s));
      navigate(PATHS.testing);
    } catch (err) {
      if (err instanceof RunnerError && err.code === 'ERR_SIGN_IN_REQUIRED') {
        setApproveNeedsSignIn(err.needsSignIn && err.needsSignIn.length > 0 ? err.needsSignIn : true);
        setApproveError(SIGN_IN_AGAIN_TEXT);
        return;
      }
      if (
        err instanceof RunnerError &&
        err.code === 'ERR_HEADERS_NOT_SAVED' &&
        err.needsHeaders &&
        err.needsHeaders.length > 0
      ) {
        setApproveError(headersNotice(err.needsHeaders));
        return;
      }
      setApproveError(plainError(err, 'The plan couldn’t be approved. Try again.'));
    } finally {
      setApproving(false);
    }
  };

  const host = status?.targetUrl ? hostOf(status.targetUrl) : plan ? hostOf(plan.targetUrl) : 'your site';

  // Screens that know their own subject name the tab themselves.
  useDocumentTitle(
    !reachable
      ? null
      : route.name === 'new'
        ? 'New check-up'
        : route.name === 'scan'
          ? `Exploring ${host}`
          : route.name === 'testing'
            ? `Testing ${host}`
            : route.name === 'plan' && !(plan && status?.phase === 'awaiting-review')
              ? 'Plan'
              : route.name === 'baselines'
                ? 'Visual Baselines'
                : route.name === 'benchmark'
                  ? 'Compare with another site'
                  : null
  );

  const scanFailure =
    feed.failure ?? (status?.phase === 'failed' ? plainFailure(status.lastRunError, 'product') : null);

  const nothingInProgress = (what: string) => <NothingInProgress what={what} reportRunId={status?.reportRunId} />;
  let body: ReactNode;
  if (route.name === 'landing') {
    body = <LandingScreen />;
  } else if (!reachable) {
    body = checks > 0 ? <ConnectionScreen checks={checks} /> : <Loading label="Connecting…" />;
  } else {
    switch (route.name) {
      case 'new':
        body = (
          <NewCheckupScreen
            ai={ai}
            onKeySaved={(model) => setAi({ configured: true, model })}
            form={form}
            onFormChange={setForm}
            onStart={startFromForm}
            starting={starting}
            startError={startError}
            onRetryAi={loadAi}
            inProgress={inProgress ? status : null}
            recent={recent}
            waitingPlans={waitingPlans}
            onResumePlan={(h) => void resumePlan(h)}
            shared={!!status?.beta}
            busy={!!status?.busy}
          />
        );
        break;
      case 'scan':
        body = !status ? (
          <Loading label="Opening the site…" />
        ) : status.phase === 'scanning' || (status.phase === 'failed' && scanFailure) ? (
          <ScanningScreen
            host={host}
            progress={scan}
            failure={status.phase === 'failed' ? scanFailure : null}
            hasMaterials={!!productContextOf(form)}
            onStop={() => void stopScan()}
          />
        ) : (
          nothingInProgress('Nothing is being explored')
        );
        break;
      case 'plan':
        body =
          status?.phase === 'awaiting-review' && plan ? (
            <PlanReviewScreen
              plan={plan}
              onApprove={(roles) => void approve(roles)}
              needsSignIn={approveNeedsSignIn}
              onPlanUpdated={setPlan}
              update={planUpdate}
              approveError={approveError}
              approving={approving}
              notice={planNotice}
              confirm={confirm}
            />
          ) : status?.phase === 'awaiting-review' && planError ? (
            <div className="mx-auto max-w-prose px-4 py-16 sm:px-6">
              <Notice
                title="The plan couldn’t be opened"
                actions={
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setPlanError(false);
                      setPlanTry((n) => n + 1);
                    }}
                  >
                    Retry
                  </button>
                }
              >
                Release check-up has the plan but couldn’t send it to this page. Try again.
              </Notice>
            </div>
          ) : !status || status.phase === 'awaiting-review' ? (
            <Loading label="Opening the plan…" />
          ) : (
            nothingInProgress('No plan is waiting for review')
          );
        break;
      case 'testing':
        body = !status ? (
          <Loading label="Opening the testing…" />
        ) : status.phase === 'testing' || feed.status === 'failed' ? (
          <TestingScreen
            host={host}
            pages={plan?.pages}
            flows={plan?.flows}
            feed={feed}
            onStop={() => void stopTesting()}
            onBackToPlan={() => navigate(PATHS.plan)}
          />
        ) : (
          nothingInProgress('Nothing is being tested')
        );
        break;
      case 'reports':
        body = (
          <PastCheckupsScreen
            confirm={confirm}
            onTestAgain={(run) => void testAgain(run.runId, run.targetUrl)}
            starting={starting || inProgress}
            actionError={startError}
          />
        );
        break;
      case 'report':
        body = (
          <ReportScreen
            runId={route.runId}
            actions={{
              onTestAgain: (report) => void testAgain(report.runId, report.targetUrl),
              onGoDeeper: (report, signIn) => void goDeeper(report, signIn),
              starting: starting || inProgress,
              actionError: startError,
            }}
          />
        );
        break;
      case 'visibility':
        body = <VisibilityScreen runId={route.runId} />;
        break;
      case 'baselines':
        body = <VisualBaselinesScreen />;
        break;
      case 'benchmark':
        body = <BenchmarkScreen initialTargetUrl={status?.targetUrl || undefined} />;
        break;
      case 'settings':
        body = <SettingsScreen onKeySaved={(model) => setAi({ configured: true, model })} />;
        break;
      default:
        body = <NotFoundScreen />;
    }
  }

  const step = reachable ? stepOf(route) : null;
  const landing = route.name === 'landing';

  return (
    <div className="min-h-screen bg-paper text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-[60] focus:inline-flex focus:min-h-[44px] focus:items-center rounded bg-stamp px-4 py-2 font-bold text-surface"
      >
        Skip to the content
      </a>
      {!landing && (
        <TopBar route={route} checkupInProgress={inProgress} showDeveloperShortcuts={hasFinishedCheckup(recent)} />
      )}
      {step && <StepBar current={step} links={{ address: PATHS.new }} />}
      <main id="main">
        {lostContact && (
          <div className="mx-auto max-w-prose px-4 pt-4 sm:px-6">
            <Notice tone="warn" title="Lost contact with Release check-up. Retrying…">
              Make sure it’s still running in its terminal (start it with pnpm start). This page keeps trying.
            </Notice>
          </div>
        )}
        {stopError && (
          <div className="mx-auto max-w-prose px-4 pt-4 sm:px-6">
            <Notice
              title="The check-up wasn’t stopped"
              actions={
                <button type="button" className="btn-quiet" onClick={() => setStopError(null)}>
                  Dismiss
                </button>
              }
            >
              {stopError}
            </Notice>
          </div>
        )}
        <Suspense fallback={<Loading label="Loading…" />}>{body}</Suspense>
      </main>
      {!landing && <CommandPalette route={route} />}
      {dialog}
    </div>
  );
}
