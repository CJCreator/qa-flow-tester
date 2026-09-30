import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReleaseReport, ReviewPlan, RoleCredential, RunSummary } from '@qa/types';
import {
  abortRun,
  approvePlan,
  checkReachable,
  getAiSetup,
  getPlan,
  getStatus,
  listRuns,
  readRunText,
  RunnerError,
  startRun,
  STREAM_URL,
  type AiSetup,
  type RunnerStatus,
  type StartRunRequest,
} from './api';
import { useRunnerConnection } from './hooks/useRunnerConnection';
import { useRunnerStream } from './hooks/useRunnerStream';
import { isCheckRoute, matchRoute, navigate, PATHS, usePathname, type Route } from './lib/router';
import { initialFeed, plainFailure, reduceFeed, type FeedState, type RunnerEvent } from './lib/translate';
import { canMarkTestCopy, DEFAULT_MAX_PAGES, emptyForm, materialsOf, productContextOf, type CheckupForm } from './lib/checkup';
import { hostOf } from './lib/url';
import { useConfirm } from './components/ConfirmDialog';
import { TopBar } from './components/TopBar';
import { StepBar, type Step } from './components/StepBar';
import { Spinner } from './components/text';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { NewCheckupScreen } from './screens/NewCheckupScreen';
import { ScanningScreen, type ScanProgress } from './screens/ScanningScreen';
import { PlanReviewScreen, type PlanNotice, type PlanUpdateState } from './screens/PlanReviewScreen';
import { TestingScreen } from './screens/TestingScreen';
import { ReportScreen } from './screens/ReportScreen';
import { PastCheckupsScreen } from './screens/PastCheckupsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';

/** How often the runner's phase is checked while a scan or test run is going, in case an event was missed. */
const RUN_SAFETY_POLL_MS = 5000;

const IN_PROGRESS = new Set(['scanning', 'awaiting-review', 'testing']);

/** Where the new check-up form is kept in this tab, so a reload doesn't lose what was typed. */
const FORM_KEY = 'release-check-up:form';

function savedForm(): CheckupForm {
  try {
    const saved = window.sessionStorage.getItem(FORM_KEY);
    return saved ? { ...emptyForm, ...(JSON.parse(saved) as Partial<CheckupForm>) } : emptyForm;
  } catch {
    return emptyForm;
  }
}

const STOPPED_NOTICE: PlanNotice = {
  tone: 'stamp',
  title: 'Testing was stopped',
  body: 'Your plan is kept, so you can change it and approve it again.',
};

/**
 * The one app. It picks the screen from the address, and keeps what the screens share: the QA
 * Tool's status, the new check-up form (so nothing typed is lost), the plan under review, and the
 * live progress of a scan or test run from the QA Tool's event stream.
 *
 * On the check-up's own addresses (/check/*) the QA Tool's phase decides the screen: when the plan is
 * ready or testing starts, the address is replaced. Anywhere else, the phase never moves anyone.
 */
export default function App() {
  const route = matchRoute(usePathname());
  const routeRef = useRef<Route>(route);
  routeRef.current = route;

  const { reachable, checks } = useRunnerConnection();
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [ai, setAi] = useState<AiSetup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<CheckupForm>(savedForm);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(FORM_KEY, JSON.stringify(form));
    } catch {
      // Not kept across a reload, then; nothing else depends on it.
    }
  }, [form]);
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const planRef = useRef<ReviewPlan | null>(null);
  planRef.current = plan;
  const [planUpdate, setPlanUpdate] = useState<PlanUpdateState>({ running: false });
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [feed, setFeed] = useState<FeedState>(() => initialFeed('product'));
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  /** The run the live screens show. Events from another run start them afresh. */
  const runIdRef = useRef<string | null>(null);
  /** A start is on its way: the old phase mustn't move anyone meanwhile. */
  const startingRef = useRef(false);
  const planningStartedAt = useRef<number | null>(null);
  /** Counts failed test runs, so an approval can tell that its testing already failed. */
  const failures = useRef(0);

  const resetLive = useCallback(() => {
    setFeed(initialFeed('product'));
    setScan(null);
    planningStartedAt.current = null;
  }, []);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await listRuns());
      setRunsError(null);
    } catch (err) {
      setRunsError(err instanceof RunnerError ? err.message : 'Couldn’t list your past check-ups. Try again.');
    }
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      setPlan(await getPlan());
    } catch {
      // Not waiting any more; the next status check says where the check-up went.
    }
  }, []);

  /** Asks the QA Tool where the check-up is, and on /check/* moves to the screen for it. */
  const reconcile = useCallback(async () => {
    if (startingRef.current) return;
    const s = await getStatus();
    if (!s || startingRef.current) return;
    setStatus(s);
    const phase = s.phase ?? 'idle';
    if (phase === 'awaiting-review' && planRef.current?.runId !== s.runId) void loadPlan();
    const here = routeRef.current;
    if (!isCheckRoute(here)) return;
    if (phase === 'scanning' && here.name !== 'scan') navigate(PATHS.scan, { replace: true });
    else if (phase === 'awaiting-review' && here.name !== 'plan') navigate(PATHS.plan, { replace: true });
    else if (phase === 'testing' && here.name !== 'testing') navigate(PATHS.testing, { replace: true });
    else if (phase === 'done' && s.reportRunId) navigate(PATHS.report(s.reportRunId), { replace: true });
    else if (phase === 'idle') navigate(PATHS.new, { replace: true });
    // 'failed' stays where it is: the screen says what happened and what to do next.
  }, [loadPlan]);

  // Once the QA Tool answers: the AI setup, where any check-up is, and the recent check-ups.
  useEffect(() => {
    if (!reachable) return;
    getAiSetup()
      .then(setAi)
      .catch((err) => setLoadError(err instanceof RunnerError ? err.message : 'Release check-up didn’t answer. Reload the page.'));
    void reconcile();
    void refreshRuns();
  }, [reachable, reconcile, refreshRuns]);

  const onEvent = useCallback(
    (event: RunnerEvent) => {
      if (event.type === 'connected') {
        // The QA Tool replays the run's events after this, which rebuilds the live screens.
        resetLive();
        return;
      }
      const replayed = event.replayed === true;
      const onCheck = isCheckRoute(routeRef.current);
      if (typeof event.runId === 'string' && event.runId !== runIdRef.current && event.type !== 'HUB_PUSH_RESULT') {
        // Another run (started from another tab, or a new one here): its screens start afresh.
        runIdRef.current = event.runId;
        resetLive();
      }

      switch (event.type) {
        case 'DISCOVERY_PROGRESS': {
          const p = event as unknown as ScanProgress;
          if (p.stage === 'planning') planningStartedAt.current ??= Date.now();
          // Time left, from how long the AI requests so far took.
          const elapsed = planningStartedAt.current ? (Date.now() - planningStartedAt.current) / 1000 : 0;
          const secondsLeft = p.stage === 'planning' && p.done && p.total ? (elapsed / p.done) * Math.max(0, p.total - p.done) : undefined;
          setScan((before) => ({ ...before, ...p, pagesFound: p.pagesFound ?? before?.pagesFound, secondsLeft }));
          return;
        }
        case 'PLAN_UPDATE_STARTED':
          setPlanUpdate({ running: true, what: String(event.what ?? '') });
          return;
        case 'PLAN_UPDATE_PROGRESS':
          setPlanUpdate((u) => ({ ...u, running: true, step: String(event.what ?? '') }));
          return;
        case 'PLAN_UPDATED':
          void getPlan()
            .then(setPlan)
            .catch(() => {})
            .finally(() => setPlanUpdate({ running: false }));
          return;
        case 'PLAN_UPDATE_FAILED':
          setPlanUpdate({ running: false, error: 'The plan couldn’t be updated. Try again, or approve it as it is.' });
          return;
        case 'PLAN_READY':
          setPlanNotice(
            event.changedSinceApproval
              ? {
                  tone: 'warn',
                  title: 'Something changed since you approved this plan',
                  body: 'What’s new is marked “New”. Look it over, then approve the plan to start testing.',
                }
              : null
          );
          void loadPlan();
          setStatus((s) => (s ? { ...s, phase: 'awaiting-review', hasPlan: true } : s));
          if (!replayed && onCheck) navigate(PATHS.plan, { replace: true });
          return;
        case 'TESTING_STARTED':
          setFeed(reduceFeed(initialFeed('product'), event, 'product'));
          setPlanNotice(null);
          setStatus((s) => (s ? { ...s, phase: 'testing', isRunning: true } : s));
          if (!replayed && onCheck) navigate(PATHS.testing, { replace: true });
          return;
        case 'RUN_COMPLETED':
          setFeed((f) => reduceFeed(f, event, 'product'));
          if (!replayed) {
            // Done as far as the person is concerned; the QA Tool confirms it once the report is filed.
            setStatus((s) =>
              s ? { ...s, phase: 'done', isRunning: false, reportRunId: typeof event.runId === 'string' ? event.runId : s.reportRunId } : s
            );
            void refreshRuns();
            // The QA Tool files the report away, then says it's done.
            window.setTimeout(() => void reconcile(), 1500);
            if (onCheck && typeof event.runId === 'string') navigate(PATHS.report(event.runId), { replace: true });
          }
          return;
        case 'RUN_FAILED':
          failures.current++;
          setFeed((f) => reduceFeed(f, event, 'product'));
          if (event.planKept) {
            setPlanNotice({
              tone: 'fail',
              title: 'Testing stopped before it finished',
              body: `${plainFailure(event.error, 'product')} Your plan is kept: once the site is working, approve it again.`,
            });
            void loadPlan();
            if (!replayed && onCheck) navigate(PATHS.plan, { replace: true });
          }
          if (!replayed) void reconcile();
          return;
        case 'RUN_ABORTED':
          setFeed((f) => reduceFeed(f, event, 'product'));
          if (event.planKept) setPlanNotice(STOPPED_NOTICE);
          if (!replayed) void reconcile();
          return;
        default:
          setFeed((f) => reduceFeed(f, event, 'product'));
      }
    },
    [loadPlan, reconcile, refreshRuns, resetLive]
  );

  useRunnerStream(STREAM_URL, reachable, onEvent, reconcile);

  // While a scan or test run goes, the phase is checked now and then, in case an event was missed.
  const phase = status?.phase ?? 'idle';
  useEffect(() => {
    if (phase !== 'scanning' && phase !== 'testing' && !isCheckRoute(route)) return;
    const timer = setInterval(() => void reconcile(), RUN_SAFETY_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, route.name, reconcile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arriving on a check-up address (a bookmark, Back or Forward) asks where the check-up is.
  useEffect(() => {
    if (reachable && isCheckRoute(route)) void reconcile();
  }, [route.name, reachable, reconcile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Past check-ups are read again whenever a list of them is shown.
  useEffect(() => {
    if (reachable && (route.name === 'new' || route.name === 'reports')) void refreshRuns();
  }, [route.name, reachable, refreshRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Starts a check-up, asking first when a plan is waiting for review. Returns why it couldn't
   * start, in plain words, or null (started, or the person chose not to).
   */
  const start = async (request: StartRunRequest, options: { fillForm?: boolean } = {}): Promise<string | null> => {
    setStartError(null);
    startingRef.current = true;
    try {
      let runId: string;
      try {
        runId = await startRun(request);
      } catch (err) {
        if (!(err instanceof RunnerError) || err.code !== 'ERR_PLAN_WAITING') throw err;
        const waiting = (await getStatus())?.targetUrl;
        const ok = await confirm({
          title: 'Start a new check-up?',
          body: `The plan for ${waiting ? hostOf(waiting) : 'another site'} that’s waiting for your review will be thrown away.`,
          confirmLabel: 'Start a new check-up',
          cancelLabel: 'Keep the plan',
          danger: true,
        });
        if (!ok) return null;
        runId = await startRun({ ...request, replacePlan: true });
      }
      runIdRef.current = runId;
      // Started from a report for a site the form doesn't hold: the form takes it, so stopping the
      // scan returns to the address with everything filled in.
      if (options.fillForm) {
        setForm({
          ...emptyForm,
          address: request.targetUrl,
          owner: request.owner,
          ...materialsOf(request.productContext),
          maxPages: request.maxPages ?? DEFAULT_MAX_PAGES,
        });
      }
      resetLive();
      setPlan(null);
      setPlanNotice(null);
      setPlanUpdate({ running: false });
      setApproveError(null);
      setStatus((s) => ({
        ...(s ?? { isRunning: true, hasReport: false, lastRunError: null }),
        isRunning: true,
        phase: 'scanning',
        runId,
        targetUrl: request.targetUrl,
        lastRunError: null,
        lastErrorCode: null,
      }));
      navigate(PATHS.scan);
      return null;
    } catch (err) {
      if (err instanceof RunnerError && err.code === 'ERR_NO_AI_KEY') {
        // The key went missing: the new check-up screen asks for it first.
        setAi({ configured: false, model: null });
        setStartError('Your AI key is missing. Add it below, then scan again.');
        navigate(PATHS.new);
        return null;
      }
      return err instanceof RunnerError ? err.message : 'The check-up couldn’t be started. Try again.';
    } finally {
      startingRef.current = false;
    }
  };

  const startFromForm = async (): Promise<void> => {
    const facts = form.facts;
    if (!facts) return;
    const error = await start({
      targetUrl: facts.url,
      owner: form.owner,
      stagingHost: canMarkTestCopy(facts) ? form.markedTestCopy : undefined,
      productContext: productContextOf(form),
      designNotes: form.designNotes.trim() || undefined,
      maxPages: form.maxPages !== DEFAULT_MAX_PAGES ? form.maxPages : undefined,
    });
    if (error) setStartError(error);
  };

  /** The specs a check-up was planned with, read back from its folder. */
  const specsOf = (runId: string) => readRunText(runId, 'product-context.md').catch(() => undefined);

  /** The form holds the specs and page limit for this site: Go deeper and Test again carry them. */
  const formFor = (targetUrl: string) => (form.facts && hostOf(form.facts.url) === hostOf(targetUrl) ? form : null);

  /** Scans the site again and tests with the approved plan when nothing is new. */
  const testAgain = async (targetUrl: string, runId: string): Promise<string | null> => {
    const facts = await checkReachable(targetUrl).catch(() => null);
    if (facts && !facts.ok) return `${facts.reason} ${facts.suggestion}`;
    const same = formFor(targetUrl);
    return start(
      {
        targetUrl,
        owner: facts?.remembered?.owner ?? same?.owner ?? false,
        productContext: same ? productContextOf(same) : await specsOf(runId),
        designNotes: same?.designNotes.trim() || undefined,
        maxPages: same && same.maxPages !== DEFAULT_MAX_PAGES ? same.maxPages : undefined,
        testAgain: true,
      },
      { fillForm: !same }
    );
  };

  /** A new check-up of the same site that signs in first, with the same specs and page limit. */
  const goDeeper = async (targetUrl: string, runId: string, role: RoleCredential): Promise<string | null> => {
    const same = formFor(targetUrl);
    const facts = same ? null : await checkReachable(targetUrl).catch(() => null);
    return start(
      {
        targetUrl,
        owner: same?.owner ?? facts?.remembered?.owner ?? false,
        roles: [role],
        productContext: same ? productContextOf(same) : await specsOf(runId),
        designNotes: same?.designNotes.trim() || undefined,
        maxPages: same && same.maxPages !== DEFAULT_MAX_PAGES ? same.maxPages : undefined,
      },
      { fillForm: !same }
    );
  };

  const stopScan = async () => {
    const ok = await confirm({
      title: 'Stop scanning?',
      body: 'The pages found so far are thrown away. AI requests already used stay used.',
      confirmLabel: 'Stop scanning',
      cancelLabel: 'Keep scanning',
      danger: true,
    });
    if (!ok) return;
    await abortRun();
    runIdRef.current = null;
    resetLive();
    setStatus((s) => (s ? { ...s, phase: 'idle', isRunning: false } : s));
    navigate(PATHS.new, { replace: true });
    void reconcile();
  };

  const stopTesting = async () => {
    const ok = await confirm({
      title: 'Stop testing?',
      body: 'Results so far are thrown away. Your plan is kept, so you can change it and approve it again.',
      confirmLabel: 'Stop testing',
      cancelLabel: 'Keep testing',
      danger: true,
    });
    if (!ok) return;
    const result = await abortRun();
    if (result.planKept) {
      setPlanNotice(STOPPED_NOTICE);
      setStatus((s) => (s ? { ...s, phase: 'awaiting-review' } : s));
      await loadPlan();
      navigate(PATHS.plan, { replace: true });
    } else if (result.aborted) {
      setStatus((s) => (s ? { ...s, phase: 'idle', isRunning: false } : s));
      navigate(PATHS.new, { replace: true });
    }
    void reconcile();
  };

  const approve = async () => {
    setApproveError(null);
    // Cleared first: testing can fail before the approval's answer arrives, and its banner must stay.
    const notice = planNotice;
    const failuresBefore = failures.current;
    setPlanNotice(null);
    setFeed(initialFeed('product'));
    try {
      await approvePlan();
      // Unless the testing already failed and the plan is back for review, the testing screen shows it.
      if (failures.current !== failuresBefore) return;
      setStatus((s) => (s && s.phase === 'awaiting-review' ? { ...s, phase: 'testing', isRunning: true } : s));
      if (routeRef.current.name === 'plan') navigate(PATHS.testing, { replace: true });
    } catch (err) {
      setPlanNotice(notice);
      setApproveError(err instanceof RunnerError ? err.message : 'The plan couldn’t be approved. Try again.');
      void reconcile();
    }
  };

  const onRunDeleted = (runId: string) => setRuns((list) => list?.filter((r) => r.runId !== runId) ?? list);

  // ── Screens ──

  const inProgress = IN_PROGRESS.has(phase);
  const failure = feed.status === 'failed' && feed.failure ? feed.failure : phase === 'failed' ? plainFailure(status?.lastRunError, 'product') : null;
  const siteOfRun = status?.targetUrl || plan?.targetUrl || form.facts?.url || '';

  let screen: ReactNode;
  let step: Step | null = null;
  if (!reachable) {
    screen = checks > 0 ? <ConnectionScreen checks={checks} /> : <Loading label="Opening Release check-up…" />;
  } else if (loadError) {
    screen = <Loading label={loadError} error />;
  } else if (!ai || !status) {
    screen = <Loading label="Opening Release check-up…" />;
  } else {
    switch (route.name) {
      case 'new':
        screen = (
          <NewCheckupScreen
            ai={ai}
            onKeySaved={(model) => setAi({ configured: true, model })}
            form={form}
            setForm={setForm}
            onStart={startFromForm}
            startError={startError}
            status={status}
            recent={runs}
          />
        );
        break;
      case 'scan':
        step = 'plan';
        screen = <ScanningScreen targetUrl={siteOfRun} progress={scan} failure={phase === 'scanning' ? null : failure} onStop={stopScan} />;
        break;
      case 'plan':
        step = 'plan';
        screen = plan ? (
          <PlanReviewScreen
            key={plan.runId}
            plan={plan}
            onApprove={approve}
            onPlanUpdated={setPlan}
            update={planUpdate}
            approveError={approveError}
            notice={planNotice}
          />
        ) : phase === 'failed' ? (
          <ScanningScreen targetUrl={siteOfRun} progress={null} failure={failure} onStop={stopScan} />
        ) : (
          <Loading label="Opening the plan…" />
        );
        break;
      case 'testing':
        step = 'testing';
        screen = (
          <TestingScreen
            targetUrl={siteOfRun}
            plan={plan}
            feed={feed}
            failure={phase === 'testing' ? null : failure}
            planKept={!!feed.planKept}
            onStop={stopTesting}
          />
        );
        break;
      case 'reports':
        screen = (
          <PastCheckupsScreen
            runs={runs}
            error={runsError}
            confirm={confirm}
            onDeleted={onRunDeleted}
            onTestAgain={(run) => testAgain(run.targetUrl, run.runId)}
            busy={inProgress}
          />
        );
        break;
      case 'report': {
        step = 'report';
        const summary = runs?.find((r) => r.runId === route.runId);
        screen = (
          <ReportScreen
            key={route.runId}
            runId={route.runId}
            typedUrl={summary?.targetUrl}
            busy={inProgress}
            onTestAgain={(report: ReleaseReport, url: string) => testAgain(url, report.runId)}
            onGoDeeper={(report: ReleaseReport, url: string, role: RoleCredential) => goDeeper(url, report.runId, role)}
          />
        );
        break;
      }
      case 'settings':
        screen = <SettingsScreen onKeySaved={(model) => setAi({ configured: true, model })} />;
        break;
      default:
        screen = <NotFoundScreen />;
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper font-sans text-ink">
      <a
        href="#main"
        className="sr-only z-[60] rounded bg-stamp px-4 py-2 font-bold text-surface focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to the content
      </a>
      <TopBar route={route} hubConnected={!!status?.hubConnected} checkupInProgress={inProgress} />
      {step && <StepBar current={step} links={{ address: PATHS.new }} />}
      <main id="main" className="flex flex-1 flex-col">
        {screen}
      </main>
      {dialog}
    </div>
  );
}

function Loading({ label, error = false }: { label: string; error?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-ink-soft">
      {error ? <p role="alert">{label}</p> : <Spinner label={label} />}
    </div>
  );
}
