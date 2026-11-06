import type { AuditAiStatus, AuditPageState, AuditProgressEvent, AuditStage } from '@qa/types/src/browser.js';
import { ErrorMessage } from '../../../components/text';
import { count } from '../../../lib/format';
import { AuditStatusChips, type AuditSpeedSource } from './AuditStatusChips';
import { LivePageList } from './LivePageList';

export type AuditProgressSnapshot = Extract<AuditProgressEvent, { type: 'progress' }>;

/** Where a Website Audit stands, as the start screen shows it. */
export type AuditProgressState =
  | {
      status: 'starting';
      pages?: AuditPageState[];
      ai?: AuditAiStatus;
      speed?: AuditSpeedSource;
    }
  | {
      status: 'working';
      progress: AuditProgressSnapshot;
      pages?: AuditPageState[];
      ai?: AuditAiStatus;
      speed?: AuditSpeedSource;
    }
  | {
      status: 'done';
      progress: AuditProgressSnapshot | null;
      pages?: AuditPageState[];
      ai?: AuditAiStatus;
      speed?: AuditSpeedSource;
    }
  | {
      status: 'stopped';
      progress: AuditProgressSnapshot | null;
      message: string;
      pages?: AuditPageState[];
      ai?: AuditAiStatus;
      speed?: AuditSpeedSource;
    };

export const AUDIT_STAGE_LABELS: Readonly<Record<AuditStage | 'ready', string>> = {
  'checking-address': 'Checking the address',
  crawling: 'Reading the pages',
  'checking-pages': 'Checking the Sample Pages',
  'measuring-speed': 'Measuring speed',
  assessing: 'Writing notes on each area',
  ranking: 'Ranking what to repair first',
  'writing-documents': 'Writing documents',
  saving: 'Saving the results',
  ready: 'Ready',
};

export const STAGE_ORDER: readonly (AuditStage | 'ready')[] = [
  'checking-address',
  'crawling',
  'checking-pages',
  'measuring-speed',
  'assessing',
  'ranking',
  'writing-documents',
  'saving',
  'ready',
];

/** The sentence the live region reads out: the stage only, so path changes do not chatter. */
export function auditStatusText(state: AuditProgressState): string {
  switch (state.status) {
    case 'starting':
      return 'Starting the Website Audit…';
    case 'working':
      return `${AUDIT_STAGE_LABELS[state.progress.stage] ?? 'Working'}…`;
    case 'done':
      return 'The Website Audit is done.';
    case 'stopped':
      return 'The Website Audit stopped.';
  }
}

/** The state after one stream event. `stoppedText` turns a `failed` event into a plain sentence. */
export function applyAuditEvent(
  state: AuditProgressState,
  event: AuditProgressEvent,
  stoppedText: (event: Extract<AuditProgressEvent, { type: 'failed' }>) => string
): AuditProgressState {
  if (state.status === 'done' || state.status === 'stopped') return state;
  const last = state.status === 'starting' ? null : state.progress;
  const pages = 'pages' in state && state.pages ? state.pages : undefined;
  const ai = 'ai' in state ? state.ai : undefined;
  const speed = 'speed' in state ? state.speed : undefined;

  if (event.type === 'snapshot') {
    const progress: AuditProgressSnapshot = {
      type: 'progress',
      auditId: event.auditId,
      version: event.version,
      stage: event.stage,
      pagesFound: event.counts.pagesFound,
      pagesRecorded: event.counts.pagesRecorded,
      pagesSkipped: event.counts.pagesSkipped,
      currentPath: last?.currentPath,
    };
    return {
      status: 'working',
      progress,
      pages: [...event.pages],
      ai: event.ai ?? ai,
      speed: event.speed ?? speed,
    };
  }

  if (event.type === 'page') {
    const existing = pages ?? [];
    const index = existing.findIndex((p) => p.path === event.path);
    const updatedPage: AuditPageState = {
      path: event.path,
      state: event.state,
      reason: event.reason,
      ai: event.ai,
    };
    const nextPages =
      index >= 0
        ? [...existing.slice(0, index), { ...existing[index], ...updatedPage }, ...existing.slice(index + 1)]
        : [...existing, updatedPage];

    const updatedProgress = last
      ? {
          ...last,
          currentPath: event.state === 'loading' ? event.path : last.currentPath,
        }
      : null;

    if (!updatedProgress) {
      return {
        ...state,
        pages: nextPages,
        ...(ai ? { ai } : {}),
        ...(speed ? { speed } : {}),
      };
    }
    return {
      status: 'working',
      progress: updatedProgress,
      pages: nextPages,
      ...(ai ? { ai } : {}),
      ...(speed ? { speed } : {}),
    };
  }

  if (event.type === 'status') {
    if (state.status === 'starting') {
      return {
        status: 'starting',
        ...(pages ? { pages } : {}),
        ai: event.ai,
        speed: event.speed,
      };
    }
    return {
      ...state,
      ...(pages ? { pages } : {}),
      ai: event.ai,
      speed: event.speed,
    };
  }

  if (event.type === 'progress') {
    return {
      status: 'working',
      progress: event,
      ...(pages ? { pages } : {}),
      ...(ai ? { ai } : {}),
      ...(speed ? { speed } : {}),
    };
  }

  if (event.type === 'done') {
    return {
      status: 'done',
      progress: last,
      ...(pages ? { pages } : {}),
      ...(ai ? { ai } : {}),
      ...(speed ? { speed } : {}),
    };
  }

  if (event.type === 'failed') {
    return {
      status: 'stopped',
      progress: last,
      message: stoppedText(event),
      ...(pages ? { pages } : {}),
      ...(ai ? { ai } : {}),
      ...(speed ? { speed } : {}),
    };
  }

  return state;
}

/**
 * A Website Audit's progress from its stream: the stage stepper, live status chips, counters,
 * live page list with skip reasons and AI state, then done or stopped.
 * English only (ADR 0033). Never judges the website.
 */
export function AuditProgress({
  address,
  state,
  reconnecting = false,
  streamEnded = false,
  elapsedMs,
  onStop,
}: {
  address: string;
  state: AuditProgressState;
  /** The stream closed for good: nothing more will arrive. */
  streamEnded?: boolean;
  /** The stream dropped and the browser is reconnecting. */
  reconnecting?: boolean;
  /** Elapsed time in milliseconds for testing or fixed displays. */
  elapsedMs?: number;
  /** Callback to stop the audit. */
  onStop?: () => void | Promise<void>;
}) {
  const progress = state.status === 'starting' ? null : state.progress;
  const stageIndex = progress ? STAGE_ORDER.indexOf(progress.stage) : -1;
  const finished = state.status === 'done';
  const stopped = state.status === 'stopped';
  const running = !finished && !stopped;

  return (
    <section
      aria-labelledby="audit-progress-title"
      className="mt-2 rounded-card border border-rule bg-surface p-4 sm:p-6"
    >
      <h2 id="audit-progress-title" className="mb-1 break-words text-lg font-bold">
        Website Audit of {address}
      </h2>

      <div role="status" aria-live="polite" className="sr-only">
        {auditStatusText(state)}
      </div>

      <ol className="mb-4 mt-4 space-y-2" aria-label="Stages">
        {STAGE_ORDER.map((stage, i) => {
          const step =
            finished || i < stageIndex ? 'done' : i === stageIndex && state.status === 'working' ? 'current' : 'todo';
          return (
            <li key={stage} className="flex items-center gap-3" aria-current={step === 'current' ? 'step' : undefined}>
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  step === 'done'
                    ? 'border-stamp bg-stamp text-on-stamp'
                    : step === 'current'
                      ? 'border-stamp bg-surface text-stamp ring-2 ring-stamp/40'
                      : 'border-edge bg-panel text-ink-soft'
                }`}
              >
                {step === 'done' ? '✓' : i + 1}
              </span>
              <span className={step === 'todo' ? 'font-medium text-ink-soft' : 'font-bold text-ink'}>
                {AUDIT_STAGE_LABELS[stage]}
              </span>
              <span className="sr-only">{step === 'done' ? '(done)' : step === 'current' ? '(now)' : '(to come)'}</span>
            </li>
          );
        })}
      </ol>

      {running && <p className="mt-2 text-sm text-ink-soft">Keep this tab open until the audit finishes.</p>}

      <AuditStatusChips ai={'ai' in state ? state.ai : undefined} speed={'speed' in state ? state.speed : undefined} />

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="audit-counts">
        <div>
          <dt className="text-sm text-ink-soft">Pages found</dt>
          <dd className="text-xl font-bold">{progress?.pagesFound ?? 0}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Pages recorded</dt>
          <dd className="text-xl font-bold">{progress?.pagesRecorded ?? 0}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Skipped Pages</dt>
          <dd className="text-xl font-bold">{progress?.pagesSkipped ?? 0}</dd>
        </div>
      </dl>

      <LivePageList
        pages={'pages' in state && state.pages ? state.pages : []}
        elapsedMs={elapsedMs}
        onStop={onStop}
        stopped={!running}
      />

      {state.status === 'working' && progress?.currentPath && (
        <p className="mt-4 break-all font-mono text-sm text-ink-soft">Reading {progress.currentPath}</p>
      )}

      {streamEnded && !finished && !stopped ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          The progress stream ended, so this page cannot show more. Open the Website Audit's history to see where it
          stands.
        </p>
      ) : (
        reconnecting &&
        !finished &&
        !stopped && <p className="mt-4 text-sm text-warn">The connection dropped. Reconnecting…</p>
      )}

      {finished && (
        <p className="mt-6 rounded-card border border-stamp bg-stamp-tint px-4 py-3 font-semibold text-ink">
          The Website Audit is done: {count(progress?.pagesRecorded ?? 0, 'page', 'pages')} recorded,{' '}
          {count(progress?.pagesSkipped ?? 0, 'Skipped Page', 'Skipped Pages')}. A Skipped Page was not checked.
        </p>
      )}

      {stopped && (
        <ErrorMessage>
          <span className="block font-semibold">The Website Audit stopped.</span>
          <span className="mt-1 block">{state.message}</span>
        </ErrorMessage>
      )}
    </section>
  );
}
