import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReleaseReport } from '@qa/types';
import {
  getReport,
  getStatus,
  getAiSetup,
  RunnerError,
  startRun,
  STREAM_URL,
  type StartRunRequest,
} from './api';
import { Shell, Spinner, type LedgerItem } from './components/Shell';
import { useRunnerConnection } from './hooks/useRunnerConnection';
import { useRunnerStream } from './hooks/useRunnerStream';
import { buildProductContext, type ReferenceFile } from './lib/context';
import { initialFeed, plainFailure, reduceFeed, type FeedState, type RunMode, type RunnerEvent } from './lib/translate';
import { displayHost } from './lib/url';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { KeySetupScreen } from './screens/KeySetupScreen';
import { MaterialsStep } from './screens/MaterialsStep';
import { ProgressScreen } from './screens/ProgressScreen';
import { ReportScreen } from './screens/ReportScreen';
import { RolesStep, toRoleCredentials, type RoleRow } from './screens/RolesStep';
import { TargetTypeScreen, type TargetType } from './screens/TargetTypeScreen';
import { UrlStep } from './screens/UrlStep';

type Step = 'connect' | 'loading' | 'key' | 'target' | 'url' | 'roles' | 'materials' | 'progress' | 'report';

interface ActiveRun {
  id?: string;
  mode: RunMode;
  startedAt: number;
  finished: boolean;
}

/** While a run is active, status is also polled this often, in case a stream event was missed. */
const RUN_SAFETY_POLL_MS = 10000;

export default function App() {
  const { reachable, checks } = useRunnerConnection();
  const [step, setStep] = useState<Step>('connect');
  const [model, setModel] = useState<string | null>(null);
  const [keyReturnStep, setKeyReturnStep] = useState<Step | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Answers. Kept when moving back and forth, and after a failed run, so nothing has to be retyped.
  const [targetType, setTargetType] = useState<TargetType>();
  const [url, setUrl] = useState<string>();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [rolesDecided, setRolesDecided] = useState(false);
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [pasted, setPasted] = useState('');

  // The run
  const runRef = useRef<ActiveRun | null>(null);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [feed, setFeed] = useState<FeedState>(initialFeed('product'));
  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Once the QA Tool answers, decide whether AI setup is needed.
  useEffect(() => {
    if (!reachable || step !== 'connect') return;
    setStep('loading');
    getAiSetup()
      .then((setup) => {
        setModel(setup.model);
        setStep(setup.configured && setup.model ? 'target' : 'key');
      })
      .catch((err) => setLoadError(err instanceof RunnerError ? err.message : 'The QA Tool didn’t answer. Reload the page.'));
  }, [reachable, step]);

  const finishRun = useCallback(async () => {
    const active = runRef.current;
    if (!active || active.finished) return;
    active.finished = true;
    try {
      const finished = await getReport();
      setReport(finished);
      setStep('report');
    } catch (err) {
      setFeed((f) => ({ ...f, status: 'failed', failure: err instanceof RunnerError ? err.message : plainFailure('', active.mode) }));
    }
  }, []);

  const failRun = useCallback((error: unknown) => {
    const active = runRef.current;
    if (!active || active.finished) return;
    active.finished = true;
    setFeed((f) => reduceFeed(f, { type: 'RUN_FAILED', error }, active.mode));
  }, []);

  /** Catches up with the runner when stream events may have been missed. */
  const reconcile = useCallback(async () => {
    const active = runRef.current;
    if (!active || active.finished || !active.id) return;
    const status = await getStatus();
    if (!status || status.isRunning) return;
    if (status.lastRunError) failRun(status.lastRunError);
    else if (status.hasReport) finishRun();
  }, [failRun, finishRun]);

  const onEvent = useCallback(
    (event: RunnerEvent) => {
      const active = runRef.current;
      if (!active || active.finished) return;
      if (typeof event.runId === 'string' && active.id && event.runId !== active.id) return;
      if (event.type === 'RUN_FAILED') {
        failRun(event.error);
        return;
      }
      setFeed((f) => reduceFeed(f, event, active.mode));
      if (event.type === 'RUN_COMPLETED') finishRun();
    },
    [failRun, finishRun]
  );

  const connection = useRunnerStream(STREAM_URL, reachable, onEvent, reconcile);

  useEffect(() => {
    if (step !== 'progress') return;
    const timer = setInterval(reconcile, RUN_SAFETY_POLL_MS);
    return () => clearInterval(timer);
  }, [step, reconcile]);

  /** Starts a run. Throws RunnerError (plain language) if it couldn't be started. */
  const begin = async (mode: RunMode, request: StartRunRequest) => {
    const pending: ActiveRun = { mode, startedAt: Date.now(), finished: false };
    runRef.current = pending;
    setFeed(initialFeed(mode));
    setReport(null);
    try {
      pending.id = await startRun(request);
      setRun({ ...pending });
      setStep('progress');
    } catch (err) {
      runRef.current = null;
      throw err;
    }
  };

  const startProductRun = async () => {
    if (!url) return setStep('url');
    if (!model) return setStep('key');
    setStarting(true);
    setStartError(null);
    try {
      await begin('product', {
        mode: 'product',
        targetUrl: url,
        aiModel: model,
        roles: toRoleCredentials(roles),
        productContext: buildProductContext(files, pasted),
      });
    } catch (err) {
      setStartError(err instanceof RunnerError ? err.message : 'The check couldn’t be started. Try again.');
    } finally {
      setStarting(false);
    }
  };

  const retry = () => {
    runRef.current = null;
    setRun(null);
    setStep(targetType === 'website' ? 'url' : 'materials');
  };

  const checkAnother = () => {
    runRef.current = null;
    setRun(null);
    setReport(null);
    setTargetType(undefined);
    setUrl(undefined);
    setRoles([]);
    setRolesDecided(false);
    setFiles([]);
    setPasted('');
    setStep('target');
  };

  const openKeySetup = () => {
    setKeyReturnStep(step);
    setStep('key');
  };

  const canChangeKey = ['target', 'url', 'roles', 'materials', 'report'].includes(step);
  const headerAction = canChangeKey ? (
    <button type="button" className="btn-link" onClick={openKeySetup}>
      Change AI key
    </button>
  ) : undefined;

  const ledger = buildLedger(step, targetType, url, roles, rolesDecided, files, pasted);

  let content: JSX.Element;
  switch (step) {
    case 'connect':
      return (
        <Shell>
          <ConnectionScreen checks={checks} />
        </Shell>
      );
    case 'loading':
      return (
        <Shell>{loadError ? <p role="alert" className="text-fail">{loadError}</p> : <Spinner label="Connecting to the QA Tool…" />}</Shell>
      );
    case 'key':
      return (
        <Shell>
          <KeySetupScreen
            onDone={(chosen) => {
              setModel(chosen);
              setStep(keyReturnStep ?? 'target');
              setKeyReturnStep(null);
            }}
            onCancel={
              keyReturnStep && model
                ? () => {
                    setStep(keyReturnStep);
                    setKeyReturnStep(null);
                  }
                : undefined
            }
          />
        </Shell>
      );
    case 'target':
      content = (
        <TargetTypeScreen
          selected={targetType}
          onChoose={(type) => {
            setTargetType(type);
            setStep('url');
          }}
        />
      );
      break;
    case 'url':
      content =
        targetType === 'website' ? (
          <UrlStep
            key="website"
            question="Which website should we look at?"
            lead="Enter its address. You’ll get a report of anything that looks broken or is hard to use."
            before={
              <p className="mb-8 rounded-md border-l-4 border-stamp bg-stamp-tint px-4 py-3">
                <strong>This is a read-only check.</strong> It only looks around the site. It won’t submit forms, sign in,
                or change anything.
              </p>
            }
            initialUrl={url}
            submitLabel="Start the read-only check"
            busyLabel="Starting the check…"
            onBack={() => setStep('target')}
            onReachable={async (reachableUrl) => {
              setUrl(reachableUrl);
              await begin('website', { mode: 'safe-public', targetUrl: reachableUrl });
            }}
          />
        ) : (
          <UrlStep
            key="product"
            question="Where can we find your product?"
            lead="Enter the address you open it at. It can be a live site or one running on your computer."
            initialUrl={url}
            submitLabel="Next"
            onBack={() => setStep('target')}
            onReachable={(reachableUrl) => {
              setUrl(reachableUrl);
              setStep('roles');
            }}
          />
        );
      break;
    case 'roles':
      content = (
        <RolesStep
          rows={roles}
          onChange={setRoles}
          onBack={() => setStep('url')}
          onNext={(rows) => {
            setRoles(rows);
            setRolesDecided(true);
            setStep('materials');
          }}
        />
      );
      break;
    case 'materials':
      content = (
        <MaterialsStep
          files={files}
          pasted={pasted}
          onFilesChange={setFiles}
          onPastedChange={setPasted}
          onBack={() => setStep('roles')}
          onStart={startProductRun}
          starting={starting}
          startError={startError}
        />
      );
      break;
    case 'progress':
      content = <ProgressScreen feed={feed} startedAt={run?.startedAt ?? Date.now()} connection={connection} onRetry={retry} />;
      break;
    case 'report':
      content = report ? <ReportScreen report={report} checkedUrl={url} onCheckAnother={checkAnother} /> : <Spinner label="Loading the report…" />;
      break;
  }

  return (
    <Shell ledger={ledger} headerAction={headerAction}>
      {content}
    </Shell>
  );
}

function buildLedger(
  step: Step,
  targetType: TargetType | undefined,
  url: string | undefined,
  roles: RoleRow[],
  rolesDecided: boolean,
  files: ReferenceFile[],
  pasted: string
): LedgerItem[] {
  const items: Array<{ step: Step; label: string; value?: string }> =
    targetType === 'website'
      ? [
          { step: 'target', label: 'What to check', value: 'A public website' },
          { step: 'url', label: 'Website address', value: url && displayHost(url) },
          { step: 'progress', label: 'Read-only check' },
        ]
      : [
          { step: 'target', label: 'What to check', value: targetType && 'A product I work on' },
          { step: 'url', label: 'Website address', value: url && displayHost(url) },
          {
            step: 'roles',
            label: 'Signing in',
            value: rolesDecided ? (roles.length ? roles.map((r) => r.role).join(', ') : 'Not needed') : undefined,
          },
          {
            step: 'materials',
            label: 'How it should work',
            value:
              files.length || pasted.trim()
                ? [files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'}` : '', pasted.trim() ? 'your notes' : '']
                    .filter(Boolean)
                    .join(' and ')
                : undefined,
          },
          { step: 'progress', label: 'Check-up' },
        ];

  const order: Step[] = ['target', 'url', 'roles', 'materials', 'progress', 'report'];
  const position = order.indexOf(step);
  return items.map((item) => {
    const itemPosition = order.indexOf(item.step);
    const state = step === 'report' || itemPosition < position ? 'done' : itemPosition === position ? 'current' : 'todo';
    return { label: item.label, value: state === 'todo' ? undefined : item.value, state };
  });
}
