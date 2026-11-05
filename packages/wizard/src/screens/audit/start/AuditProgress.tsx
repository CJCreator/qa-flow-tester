import type { AuditProgressEvent, AuditStage } from '@qa/types/src/browser.js';
import { count } from '../../../lib/format';

export type AuditProgressSnapshot = Extract<AuditProgressEvent, { type: 'progress' }>;

/** Where a Website Audit stands, as the start screen shows it. */
export type AuditProgressState =
  | { status: 'starting' }
  | { status: 'working'; progress: AuditProgressSnapshot }
  | { status: 'done'; progress: AuditProgressSnapshot | null }
  | { status: 'stopped'; progress: AuditProgressSnapshot | null; message: string };

export const AUDIT_STAGE_LABELS: Readonly<Record<AuditStage, string>> = {
  'checking-address': 'Checking the address',
  crawling: 'Reading the pages',
  'checking-pages': 'Checking the Sample Pages',
  'measuring-speed': 'Measuring speed',
  assessing: 'Writing notes on each area',
  ranking: 'Ranking what to repair first',
  saving: 'Saving the results',
};

const STAGE_ORDER = Object.keys(AUDIT_STAGE_LABELS) as AuditStage[];

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
  if (event.type === 'progress') return { status: 'working', progress: event };
  if (event.type === 'done') return { status: 'done', progress: last };
  return { status: 'stopped', progress: last, message: stoppedText(event) };
}

/**
 * A Website Audit's progress from its stream: the stage, the pages recorded and the Skipped Pages so far,
 * then done or stopped. Counts only; there is no verdict on the website.
 */
export function AuditProgress({
  address,
  state,
  reconnecting = false,
  streamEnded = false,
}: {
  address: string;
  state: AuditProgressState;
  /** The stream closed for good: nothing more will arrive. */
  streamEnded?: boolean;
  /** The stream dropped and the browser is reconnecting. */
  reconnecting?: boolean;
}) {
  const progress = state.status === 'starting' ? null : state.progress;
  const stageIndex = progress ? STAGE_ORDER.indexOf(progress.stage) : -1;
  const finished = state.status === 'done';

  return (
    <section aria-labelledby="audit-progress-title" className="mt-2 rounded-card border border-rule bg-surface p-4 sm:p-6">
      <h2 id="audit-progress-title" className="mb-1 break-words text-lg font-bold">
        Website Audit of {address}
      </h2>

      <div role="status" aria-live="polite" className="sr-only">
        {auditStatusText(state)}
      </div>

      <ol className="mb-6 mt-4 space-y-2" aria-label="Stages">
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

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="audit-counts">
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

      {state.status === 'working' && progress?.currentPath && (
        <p className="mt-4 break-all font-mono text-sm text-ink-soft">Reading {progress.currentPath}</p>
      )}

      {streamEnded && state.status !== 'done' && state.status !== 'stopped' ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          The progress stream ended, so this page cannot show more. Open the Website Audit's history to see where it
          stands.
        </p>
      ) : (
        reconnecting &&
        state.status !== 'done' &&
        state.status !== 'stopped' && <p className="mt-4 text-sm text-warn">The connection dropped. Reconnecting…</p>
      )}

      {state.status === 'done' && (
        <p className="mt-6 rounded-card border border-stamp bg-stamp-tint px-4 py-3 font-semibold text-ink">
          The Website Audit is done: {count(progress?.pagesRecorded ?? 0, 'page', 'pages')} recorded,{' '}
          {count(progress?.pagesSkipped ?? 0, 'Skipped Page', 'Skipped Pages')}. A Skipped Page was not checked.
        </p>
      )}

      {state.status === 'stopped' && (
        <div role="alert" className="mt-6 rounded-card border border-fail bg-fail-tint px-4 py-3 text-fail">
          <p className="font-semibold">The Website Audit stopped.</p>
          <p className="mt-1">{state.message}</p>
        </div>
      )}
    </section>
  );
}
