import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptVisualBaseline,
  deleteVisualBaseline,
  listVisualBaselines,
  RunnerError,
  type VisualBaselineItem,
} from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { Notice, Spinner } from '../components/text';
import { Badge, EmptyState, LoadError, Page, PageHeader } from '../components/ui';
import { formatWhen, scrollBehavior } from '../lib/format';
import { Link, PATHS } from '../lib/router';
import { useDocumentTitle } from '../lib/title';

/** A check's id as a name a person can read: "tc-home-hero" becomes "Home hero". */
export function baselineName(testCaseId: string): string {
  const words = testCaseId
    .replace(/^(tc|test|case)[-_:]+/i, '')
    .replace(/[-_:./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : testCaseId;
}

type BreakpointFilter = 'all' | '375px' | '768px' | '1440px';
type ViewMode = 'split' | 'overlay' | 'diff-only';

export function VisualBaselinesScreen() {
  useDocumentTitle('Visual baselines');
  const { confirm, dialog } = useConfirm();
  const inspectorRef = useRef<HTMLDivElement>(null);
  const [baselines, setBaselines] = useState<VisualBaselineItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ tone: 'pass' | 'fail' | 'warn'; text: string } | null>(null);
  const [breakpointFilter, setBreakpointFilter] = useState<BreakpointFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeItem, setActiveItem] = useState<VisualBaselineItem | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [sliderPosition, setSliderPosition] = useState(50);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadBaselines = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listVisualBaselines();
      setBaselines(items);
      setError(null);
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'The visual baselines couldn’t be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBaselines();
  }, [loadBaselines]);

  // Keep active item in sync after refresh
  useEffect(() => {
    if (activeItem && baselines) {
      const updated = baselines.find((b) => b.id === activeItem.id);
      setActiveItem(updated || null);
    }
  }, [baselines, activeItem]);

  const filteredBaselines = useMemo(() => {
    if (!baselines) return [];
    return baselines.filter((item) => {
      const matchesBp = breakpointFilter === 'all' || item.breakpoint === breakpointFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.testCaseId.toLowerCase().includes(q) ||
        item.breakpoint.toLowerCase().includes(q) ||
        item.fileName.toLowerCase().includes(q);
      return matchesBp && matchesSearch;
    });
  }, [baselines, breakpointFilter, searchQuery]);

  /** Choosing an item: on a phone the inspector sits below the list, so bring it into view and focus it. */
  const select = (item: VisualBaselineItem) => {
    setActiveItem(item);
    if (window.matchMedia?.('(max-width: 1023px)').matches) {
      window.requestAnimationFrame(() => {
        inspectorRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        inspectorRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const handleAccept = async (item: VisualBaselineItem) => {
    if (!item.currentUrl) {
      setActionMessage({ tone: 'warn', text: 'This check-up has no new screenshot to keep as the baseline.' });
      return;
    }
    setProcessingId(item.id);
    try {
      await acceptVisualBaseline(item.id, item.currentUrl);
      setActionMessage({
        tone: 'pass',
        text: `New baseline kept for ${baselineName(item.testCaseId)} (${item.breakpoint}).`,
      });
      await loadBaselines();
    } catch (err) {
      setActionMessage({
        tone: 'fail',
        text: err instanceof RunnerError ? err.message : 'The baseline couldn’t be updated. Try again.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (item: VisualBaselineItem) => {
    const ok = await confirm({
      title: 'Delete this baseline?',
      body: (
        <p>
          The saved screenshot of {baselineName(item.testCaseId)} at {item.breakpoint} is deleted. The next check-up
          saves a new one. This can’t be undone.
        </p>
      ),
      confirmLabel: 'Delete the baseline',
      danger: true,
    });
    if (!ok) return;
    setProcessingId(item.id);
    try {
      await deleteVisualBaseline(item.id);
      setActionMessage({
        tone: 'pass',
        text: `Baseline for ${baselineName(item.testCaseId)} (${item.breakpoint}) deleted.`,
      });
      if (activeItem?.id === item.id) setActiveItem(null);
      await loadBaselines();
    } catch (err) {
      setActionMessage({
        tone: 'fail',
        text: err instanceof RunnerError ? err.message : 'The baseline couldn’t be deleted. Try again.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const viewButton = (mode: ViewMode, label: string) => (
    <button type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>
      {label}
    </button>
  );

  return (
    <Page width="workspace">
      {dialog}
      <PageHeader
        title="Visual baselines"
        lede="Saved screenshots that each check-up is compared with. See what changed, then keep the new screenshot as the baseline, or leave it."
        actions={
          <button type="button" onClick={() => void loadBaselines()} className="btn-quiet btn-sm" disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      <div className="space-y-6">
        {actionMessage && (
          <Notice
            tone={actionMessage.tone}
            title={actionMessage.text}
            actions={
              <button type="button" onClick={() => setActionMessage(null)} className="btn-quiet btn-sm">
                Dismiss
              </button>
            }
          />
        )}

        {error && (
          <LoadError title="Visual baselines" onRetry={() => void loadBaselines()}>
            {error}
          </LoadError>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
          <div role="group" aria-label="Screen size" className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink-soft">Screen size</span>
            <div className="segmented [&>button]:min-h-[44px]">
              {(['all', '375px', '768px', '1440px'] as BreakpointFilter[]).map((bp) => (
                <button
                  key={bp}
                  type="button"
                  aria-pressed={breakpointFilter === bp}
                  onClick={() => setBreakpointFilter(bp)}
                >
                  {bp === 'all' ? 'All sizes' : bp}
                </button>
              ))}
            </div>
          </div>

          <div className="w-full sm:w-72">
            <label htmlFor="baseline-search" className="label">
              Search by name or file
            </label>
            <input
              id="baseline-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="field"
            />
          </div>
        </div>

        {loading && !baselines ? (
          <div className="py-16 text-center text-ink-soft">
            <Spinner label="Loading visual baselines…" />
          </div>
        ) : filteredBaselines.length === 0 ? (
          <EmptyState
            title="No visual baselines found"
            action={
              !(baselines && baselines.length > 0) ? (
                <Link to={PATHS.new} className="btn-primary">
                  Start a check-up
                </Link>
              ) : undefined
            }
          >
            {baselines && baselines.length > 0
              ? 'No baselines match the screen size or search. Change them to see more.'
              : 'Baselines are saved by a check-up that includes visual checks. Run a check-up, and its screenshots are kept here to compare with the next one.'}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-5">
              <h2 className="text-xl font-bold">Baselines ({filteredBaselines.length})</h2>
              <ul className="max-h-[46rem] space-y-2.5 overflow-y-auto pr-1">
                {filteredBaselines.map((item) => {
                  const isSelected = activeItem?.id === item.id;
                  const hasDiff = item.hasRegression || (item.diffPercent !== undefined && item.diffPercent > 0);
                  const hasPercent = item.diffPercent != null && Number.isFinite(item.diffPercent);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => select(item)}
                        className={`block min-h-[44px] w-full rounded-card border p-3.5 text-left transition-colors duration-fast ${
                          isSelected
                            ? 'border-stamp bg-stamp-tint ring-1 ring-stamp'
                            : 'border-edge bg-surface hover:border-ink-soft'
                        }`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="block min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-stamp">{item.breakpoint}</span>
                              <span className="truncate text-sm font-bold text-ink" title={item.testCaseId}>
                                {baselineName(item.testCaseId)}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-ink-soft" title={item.fileName}>
                              {item.fileName}
                            </span>
                          </span>
                          <span className="shrink-0">
                            {hasDiff ? <Badge tone="fail">Changed</Badge> : <Badge tone="pass">Matches</Badge>}
                          </span>
                        </span>
                        {hasDiff && hasPercent && (
                          <span className="mt-1 block text-xs text-ink-soft">
                            {item.diffPercent!.toFixed(1)}% of the screen changed
                          </span>
                        )}
                        <span className="mt-2.5 flex items-center justify-between border-t border-rule pt-2 text-xs text-ink-soft">
                          <span>{(Number(item.fileSizeBytes || 0) / 1024).toFixed(0)} KB</span>
                          <span>{formatWhen(item.updatedAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div ref={inspectorRef} tabIndex={-1} role="region" className="rounded-card lg:col-span-7" aria-label="Selected baseline">
              {activeItem ? (
                <div className="space-y-4 rounded-card border border-rule bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
                        <span title={activeItem.testCaseId}>{baselineName(activeItem.testCaseId)}</span>
                        <span className="rounded-control border border-edge bg-panel px-2 py-0.5 font-mono text-xs text-stamp">
                          {activeItem.breakpoint}
                        </span>
                      </h3>
                      <p className="text-xs text-ink-soft">
                        Updated {formatWhen(activeItem.updatedAt)} ·{' '}
                        {(Number(activeItem.fileSizeBytes || 0) / 1024).toFixed(1)} KB
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {activeItem.currentUrl && (
                        <button
                          type="button"
                          onClick={() => void handleAccept(activeItem)}
                          disabled={processingId === activeItem.id}
                          className="btn-primary btn-sm"
                        >
                          {processingId === activeItem.id ? 'Saving…' : 'Keep the new screenshot as the baseline'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDelete(activeItem)}
                        disabled={processingId === activeItem.id}
                        className="btn-quiet btn-sm border-fail text-fail hover:border-fail hover:bg-fail-tint"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="segmented [&>button]:min-h-[44px]" role="group" aria-label="How to compare">
                      {viewButton('split', 'Side by side')}
                      {viewButton('overlay', 'Slider')}
                      {activeItem.diffUrl && viewButton('diff-only', 'What changed')}
                    </div>

                    {activeItem.diffPercent != null && Number.isFinite(activeItem.diffPercent) && (
                      <span className="font-bold text-fail">
                        {activeItem.diffPercent.toFixed(1)}% of the screen changed
                      </span>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-control border border-edge bg-canvas p-2">
                    {viewMode === 'split' && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <div className="mb-1 text-center text-xs font-bold text-ink-soft">Baseline</div>
                          <div className="flex max-h-[30rem] items-center justify-center overflow-auto rounded-control border border-rule bg-panel p-2">
                            <img
                              src={activeItem.previewUrl}
                              alt={`Baseline for ${baselineName(activeItem.testCaseId)}`}
                              className="max-h-[28rem] rounded-control object-contain"
                            />
                          </div>
                        </div>

                        <div>
                          <div className="mb-1 text-center text-xs font-bold text-ink-soft">This check-up</div>
                          <div className="flex max-h-[30rem] items-center justify-center overflow-auto rounded-control border border-rule bg-panel p-2">
                            {activeItem.currentUrl ? (
                              <img
                                src={activeItem.currentUrl}
                                alt={`This check-up, ${baselineName(activeItem.testCaseId)}`}
                                className="max-h-[28rem] rounded-control object-contain"
                              />
                            ) : (
                              <div className="p-8 text-center text-xs text-ink-soft">
                                No screenshot from a check-up is attached.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {viewMode === 'overlay' && (
                      <div className="space-y-3">
                        <div className="relative mx-auto flex max-h-[32rem] select-none items-center justify-center overflow-hidden rounded-control border border-rule bg-panel">
                          <img src={activeItem.previewUrl} alt="Baseline" className="block max-h-[30rem] object-contain" />
                          {activeItem.currentUrl && (
                            <div
                              className="absolute inset-0 overflow-hidden"
                              style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
                            >
                              <img
                                src={activeItem.currentUrl}
                                alt="This check-up"
                                className="block h-full max-h-[30rem] w-full object-contain"
                              />
                            </div>
                          )}
                          <div
                            className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-stamp shadow-level-2"
                            style={{ left: `${sliderPosition}%` }}
                          />
                        </div>

                        <div className="flex items-center gap-3 px-2">
                          <span className="text-xs text-ink-soft">Baseline</span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={sliderPosition}
                            onChange={(e) => setSliderPosition(Number(e.target.value))}
                            aria-label="How much of this check-up to show over the baseline"
                            className="min-h-[44px] flex-1 accent-stamp"
                          />
                          <span className="text-xs text-ink-soft">This check-up</span>
                        </div>
                      </div>
                    )}

                    {viewMode === 'diff-only' && activeItem.diffUrl && (
                      <div>
                        <div className="mb-1 text-center text-xs font-bold text-fail">What changed, highlighted</div>
                        <div className="flex max-h-[32rem] items-center justify-center overflow-auto rounded-control border border-rule bg-panel p-2">
                          <img
                            src={activeItem.diffUrl}
                            alt={`What changed in ${baselineName(activeItem.testCaseId)}`}
                            className="max-h-[30rem] rounded-control object-contain"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-card border border-dashed border-edge bg-surface p-12 text-center text-ink-soft">
                  <p>Choose a baseline from the list to see what changed and decide whether to keep the new screenshot.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
