import { useEffect, useState } from 'react';
import type { AuditPageState } from '@qa/types/src/browser.js';
import { skipReasonText } from '../../../lib/coverage-text';
import { formatDuration } from '../../../lib/format';
import { stopAudit } from './audit-start-api';

export interface LivePageListProps {
  pages: readonly AuditPageState[];
  /** Controlled elapsed time for testing or fixed displays. */
  elapsedMs?: number;
  /** Timestamp when the audit started. */
  startedAt?: number;
  /** Override the stop action for testing. */
  onStop?: () => void | Promise<void>;
  /** Set to true when the audit has completed or stopped. */
  stopped?: boolean;
}

export function pageStateLabel(state: AuditPageState['state']): string {
  switch (state) {
    case 'queued':
      return 'Queued';
    case 'loading':
      return 'Loading';
    case 'recorded':
      return 'Recorded';
    case 'retrying':
      return 'Retrying';
    case 'skipped':
      return 'Skipped';
  }
}

export function pageAiText(ai?: 'waiting' | 'done' | 'not-done'): string | null {
  switch (ai) {
    case 'waiting':
      return 'AI waiting';
    case 'done':
      return 'AI done';
    case 'not-done':
      return 'AI not done';
    default:
      return null;
  }
}

/**
 * Live page list under counters: shows each page's crawl state, plain-words skip reason,
 * AI assessment status, live elapsed time, and a Stop button (ADR 0042).
 */
export function LivePageList({ pages, elapsedMs, startedAt, onStop, stopped = false }: LivePageListProps) {
  const [stopping, setStopping] = useState(false);
  const [liveElapsed, setLiveElapsed] = useState(0);

  useEffect(() => {
    if (elapsedMs !== undefined || stopped) return;
    const start = startedAt ?? Date.now();
    const interval = setInterval(() => {
      setLiveElapsed(Date.now() - start);
    }, 1000);
    return () => clearInterval(interval);
  }, [elapsedMs, startedAt, stopped]);

  const elapsed = elapsedMs !== undefined ? elapsedMs : liveElapsed;

  const handleStop = async () => {
    if (stopping || stopped) return;
    setStopping(true);
    try {
      if (onStop) {
        await onStop();
      } else {
        await stopAudit();
      }
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="mt-6 border-t border-rule pt-4" data-testid="live-page-list">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-medium text-ink-soft" data-testid="live-elapsed">
          Elapsed: {formatDuration(elapsed)}
        </span>
        {!stopped && (
          <button
            type="button"
            className="btn-quiet btn-sm text-fail"
            onClick={() => void handleStop()}
            disabled={stopping}
            data-testid="audit-stop-button"
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>

      {pages.length > 0 ? (
        <ol className="mt-3 divide-y divide-rule/60 text-sm" aria-label="Audited pages">
          {pages.map((p) => {
            const skipReason = p.state === 'skipped' && p.reason ? skipReasonText(p.reason) : null;
            const ai = pageAiText(p.ai);
            return (
              <li
                key={p.path}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-testid={`page-row-${p.path}`}
              >
                <span className="break-all font-mono text-ink">{p.path}</span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-ink-soft">{pageStateLabel(p.state)}</span>
                  {skipReason && <span className="text-fail">({skipReason})</span>}
                  {ai && <span className="text-ink-soft">· {ai}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">No pages queued yet.</p>
      )}
    </div>
  );
}
