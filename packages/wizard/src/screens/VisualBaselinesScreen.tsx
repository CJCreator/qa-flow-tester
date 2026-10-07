import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptVisualBaseline,
  deleteVisualBaseline,
  listVisualBaselines,
  RunnerError,
  type VisualBaselineItem,
} from '../api';
import { ErrorMessage, FocusHeading, Notice, Spinner } from '../components/text';
import { formatWhen } from '../lib/format';
import { useDocumentTitle } from '../lib/title';

type BreakpointFilter = 'all' | '375px' | '768px' | '1440px';
type ViewMode = 'split' | 'overlay' | 'diff-only';

export function VisualBaselinesScreen() {
  useDocumentTitle('Visual Baselines');
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
      setError(err instanceof RunnerError ? err.message : 'Could not load visual baselines.');
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

  const handleAccept = async (item: VisualBaselineItem) => {
    if (!item.currentUrl) {
      setActionMessage({ tone: 'warn', text: 'No current run screenshot available to accept as baseline.' });
      return;
    }
    setProcessingId(item.id);
    try {
      await acceptVisualBaseline(item.id, item.currentUrl);
      setActionMessage({ tone: 'pass', text: `Baseline updated for ${item.testCaseId} (${item.breakpoint}).` });
      await loadBaselines();
    } catch (err) {
      setActionMessage({ tone: 'fail', text: err instanceof RunnerError ? err.message : 'Failed to update baseline.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (item: VisualBaselineItem) => {
    if (!window.confirm(`Delete baseline snapshot for ${item.testCaseId} (${item.breakpoint})?`)) return;
    setProcessingId(item.id);
    try {
      await deleteVisualBaseline(item.id);
      setActionMessage({ tone: 'pass', text: `Baseline ${item.testCaseId} (${item.breakpoint}) deleted.` });
      if (activeItem?.id === item.id) setActiveItem(null);
      await loadBaselines();
    } catch (err) {
      setActionMessage({ tone: 'fail', text: err instanceof RunnerError ? err.message : 'Failed to delete baseline.' });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <FocusHeading className="text-3xl font-bold tracking-tight">Visual Regression Baselines</FocusHeading>
          <p className="mt-1 text-ink-soft">
            Review reference snapshots, compare current run screenshots, and accept or reject visual changes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void loadBaselines()}
            className="btn-quiet rounded-control px-3 py-1.5 text-sm"
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {actionMessage && (
        <Notice
          tone={actionMessage.tone}
          title={actionMessage.text}
          actions={
            <button
              type="button"
              onClick={() => setActionMessage(null)}
              className="btn-quiet px-2 py-0.5 text-xs font-bold"
            >
              Dismiss
            </button>
          }
        />
      )}

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-rule bg-surface p-3 shadow-level-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-soft">Breakpoint:</span>
          {(['all', '375px', '768px', '1440px'] as BreakpointFilter[]).map((bp) => (
            <button
              key={bp}
              type="button"
              onClick={() => setBreakpointFilter(bp)}
              className={`rounded-control px-3 py-1 text-xs font-bold transition-colors ${
                breakpointFilter === bp
                  ? 'bg-stamp text-surface shadow-level-1'
                  : 'bg-panel text-ink-soft hover:text-ink'
              }`}
            >
              {bp === 'all' ? 'All Sizes' : bp}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-72">
          <input
            type="search"
            placeholder="Search test case or file…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-control border border-edge/80 bg-panel px-3 py-1.5 text-sm text-ink placeholder:text-ink-soft focus:border-stamp focus:outline-none"
          />
        </div>
      </div>

      {loading && !baselines ? (
        <div className="py-16 text-center text-ink-soft">
          <Spinner label="Loading visual baselines…" />
        </div>
      ) : filteredBaselines.length === 0 ? (
        <div className="rounded-card border border-edge/60 bg-surface/40 p-12 text-center">
          <div className="mx-auto mb-3 text-3xl">📸</div>
          <h2 className="text-lg font-bold text-ink">No visual baselines found</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
            {baselines && baselines.length > 0
              ? 'No baselines match the current breakpoint or search filter.'
              : 'Baselines are automatically captured during check-up runs. When visual differences appear, review them here.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* List / Cards */}
          <div className="space-y-3 lg:col-span-5">
            <div className="text-xs font-bold uppercase tracking-wider text-ink-soft">
              Baselines ({filteredBaselines.length})
            </div>
            <div className="space-y-2.5 max-h-[46rem] overflow-y-auto pr-1">
              {filteredBaselines.map((item) => {
                const isSelected = activeItem?.id === item.id;
                const hasDiff = item.hasRegression || (item.diffPercent !== undefined && item.diffPercent > 0);
                return (
                  <div
                    key={item.id}
                    onClick={() => setActiveItem(item)}
                    className={`cursor-pointer rounded-card border p-3.5 transition-all ${
                      isSelected
                        ? 'border-stamp bg-stamp/5 shadow-level-2 ring-1 ring-stamp'
                        : 'border-edge/70 bg-surface hover:border-ink-soft/50 shadow-level-1'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-stamp">{item.breakpoint}</span>
                          <span className="truncate font-bold text-ink text-sm" title={item.testCaseId}>
                            {item.testCaseId}
                          </span>
                        </div>
                        <p className="truncate text-xs text-ink-soft mt-0.5" title={item.fileName}>
                          {item.fileName}
                        </p>
                      </div>
                      <div>
                        {hasDiff ? (
                          <span className="inline-flex items-center rounded-full bg-fail/15 px-2 py-0.5 text-xs font-bold text-fail">
                            {item.diffPercent !== undefined ? `${item.diffPercent.toFixed(1)}% diff` : 'Changed'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-pass/15 px-2 py-0.5 text-xs font-bold text-pass">
                            Matches
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-xs text-ink-soft border-t border-rule/50 pt-2">
                      <span>{(item.fileSizeBytes / 1024).toFixed(0)} KB</span>
                      <span>{formatWhen(item.updatedAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Inspector Panel */}
          <div className="lg:col-span-7">
            {activeItem ? (
              <div className="rounded-card border border-edge bg-surface shadow-level-2 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
                  <div>
                    <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                      <span>{activeItem.testCaseId}</span>
                      <span className="rounded bg-panel px-2 py-0.5 font-mono text-xs text-stamp border border-edge">
                        {activeItem.breakpoint}
                      </span>
                    </h3>
                    <p className="text-xs text-ink-soft">
                      Updated {formatWhen(activeItem.updatedAt)} · {(activeItem.fileSizeBytes / 1024).toFixed(1)} KB
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {activeItem.currentUrl && (
                      <button
                        type="button"
                        onClick={() => void handleAccept(activeItem)}
                        disabled={processingId === activeItem.id}
                        className="btn-primary rounded-control px-3 py-1.5 text-xs font-bold shadow-level-1"
                      >
                        {processingId === activeItem.id ? 'Accepting…' : '✓ Accept as Baseline'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(activeItem)}
                      disabled={processingId === activeItem.id}
                      className="btn-quiet rounded-control border border-fail/40 px-3 py-1.5 text-xs font-bold text-fail hover:bg-fail/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* View Mode Controls */}
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1 rounded-control border border-edge/60 bg-panel p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('split')}
                      className={`rounded px-2.5 py-1 font-bold ${
                        viewMode === 'split' ? 'bg-stamp text-surface shadow-level-1' : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      Side by Side
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('overlay')}
                      className={`rounded px-2.5 py-1 font-bold ${
                        viewMode === 'overlay' ? 'bg-stamp text-surface shadow-level-1' : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      Slider Overlay
                    </button>
                    {activeItem.diffUrl && (
                      <button
                        type="button"
                        onClick={() => setViewMode('diff-only')}
                        className={`rounded px-2.5 py-1 font-bold ${
                          viewMode === 'diff-only'
                            ? 'bg-stamp text-surface shadow-level-1'
                            : 'text-ink-soft hover:text-ink'
                        }`}
                      >
                        Diff Map
                      </button>
                    )}
                  </div>

                  {activeItem.diffPercent !== undefined && (
                    <div className="text-right">
                      <span className="font-bold text-fail">{activeItem.diffPercent.toFixed(2)}% difference</span>
                    </div>
                  )}
                </div>

                {/* Visual View Display */}
                <div className="overflow-hidden rounded-control border border-edge bg-canvas/40 p-2">
                  {viewMode === 'split' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="mb-1 text-center font-mono text-xs font-bold text-ink-soft">
                          Baseline Snapshot
                        </div>
                        <div className="overflow-auto max-h-[30rem] rounded border border-rule bg-panel flex items-center justify-center p-2">
                          <img
                            src={activeItem.previewUrl}
                            alt={`Baseline for ${activeItem.testCaseId}`}
                            className="max-h-[28rem] object-contain rounded"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="mb-1 text-center font-mono text-xs font-bold text-ink-soft">
                          Current Run Screenshot
                        </div>
                        <div className="overflow-auto max-h-[30rem] rounded border border-rule bg-panel flex items-center justify-center p-2">
                          {activeItem.currentUrl ? (
                            <img
                              src={activeItem.currentUrl}
                              alt={`Current run for ${activeItem.testCaseId}`}
                              className="max-h-[28rem] object-contain rounded"
                            />
                          ) : (
                            <div className="p-8 text-center text-xs text-ink-soft">
                              No current run screenshot attached.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {viewMode === 'overlay' && (
                    <div className="space-y-3">
                      <div className="relative mx-auto max-h-[32rem] overflow-hidden rounded border border-rule bg-panel flex items-center justify-center select-none">
                        {/* Baseline background */}
                        <img
                          src={activeItem.previewUrl}
                          alt="Baseline"
                          className="max-h-[30rem] object-contain block"
                        />
                        {/* Current screenshot clipped */}
                        {activeItem.currentUrl && (
                          <div
                            className="absolute inset-0 overflow-hidden"
                            style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
                          >
                            <img
                              src={activeItem.currentUrl}
                              alt="Current run"
                              className="max-h-[30rem] object-contain block h-full w-full"
                            />
                          </div>
                        )}
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-stamp pointer-events-none shadow-level-2"
                          style={{ left: `${sliderPosition}%` }}
                        />
                      </div>

                      <div className="flex items-center gap-3 px-2">
                        <span className="font-mono text-xs text-ink-soft">Baseline</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={sliderPosition}
                          onChange={(e) => setSliderPosition(Number(e.target.value))}
                          className="flex-1 accent-[#6C9BF2]"
                        />
                        <span className="font-mono text-xs text-ink-soft">Current</span>
                      </div>
                    </div>
                  )}

                  {viewMode === 'diff-only' && activeItem.diffUrl && (
                    <div>
                      <div className="mb-1 text-center font-mono text-xs font-bold text-fail">
                        Pixel Difference Mask (Highlighting Visual Changes)
                      </div>
                      <div className="overflow-auto max-h-[32rem] rounded border border-rule bg-panel flex items-center justify-center p-2">
                        <img
                          src={activeItem.diffUrl}
                          alt={`Diff mask for ${activeItem.testCaseId}`}
                          className="max-h-[30rem] object-contain rounded"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-card border border-edge/60 bg-surface/30 p-12 text-center text-ink-soft">
                <p>Select a baseline from the list to inspect pixel comparisons and approve changes.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
