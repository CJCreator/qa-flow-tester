import { useEffect, useRef, useState, useMemo } from 'react';
import { navigate, PATHS, type Route } from '../lib/router';
import { downloadPlanMarkdown } from '../api';

export interface CommandAction {
  id: string;
  title: string;
  category: 'Navigation' | 'Plan Review' | 'Report' | 'General';
  shortcut?: string;
  keywords?: string[];
  run: () => void;
}

export function CommandPalette({ route }: { route: Route }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'command' | 'shortcuts'>('command');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isInput =
        activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable;

      // Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setMode('command');
        setQuery('');
        return;
      }

      // ? key for shortcut cheatsheet (when not in input)
      if (e.key === '?' && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
        setMode('shortcuts');
        return;
      }

      // Esc closes
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };

    const handleCustomOpen = (e: Event) => {
      const customEvent = e as CustomEvent<{ mode?: 'command' | 'shortcuts' }>;
      setOpen(true);
      setMode(customEvent.detail?.mode || 'command');
      setQuery('');
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('qa:open-command-palette', handleCustomOpen);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('qa:open-command-palette', handleCustomOpen);
    };
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open && mode === 'command') {
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, mode]);

  // All registered actions
  const allActions = useMemo<CommandAction[]>(() => {
    const actions: CommandAction[] = [
      // Navigation
      {
        id: 'nav-new',
        title: 'Go to New check-up',
        category: 'Navigation',
        shortcut: 'g h',
        keywords: ['home', 'scan', 'start', 'address'],
        run: () => navigate(PATHS.new),
      },
      {
        id: 'nav-past',
        title: 'Go to Past check-ups',
        category: 'Navigation',
        shortcut: 'g r',
        keywords: ['reports', 'history', 'runs'],
        run: () => navigate(PATHS.reports),
      },
      {
        id: 'nav-baselines',
        title: 'Go to Visual Baselines',
        category: 'Navigation',
        shortcut: 'g b',
        keywords: ['snapshots', 'diff', 'pixel', 'regression', 'visual'],
        run: () => navigate(PATHS.baselines),
      },
      {
        id: 'nav-benchmark',
        title: 'Go to Compare sites',
        category: 'Navigation',
        shortcut: 'g c',
        keywords: ['competitor', 'gap', 'ux', 'friction', 'scorecard'],
        run: () => navigate(PATHS.benchmark),
      },
      {
        id: 'nav-settings',
        title: 'Go to Settings',
        category: 'Navigation',
        shortcut: 'g ,',
        keywords: ['config', 'ai', 'keys', 'models', 'gates', 'schedules'],
        run: () => navigate(PATHS.settings),
      },
      {
        id: 'nav-gates',
        title: 'Configure Release Readiness Gates',
        category: 'Navigation',
        keywords: ['criteria', 'thresholds', 'strict', 'standard', 'gates', 'blockers'],
        run: () => navigate(PATHS.settings),
      },
      {
        id: 'view-shortcuts',
        title: 'View keyboard shortcuts cheatsheet',
        category: 'General',
        shortcut: '?',
        keywords: ['help', 'keys', 'hotkeys'],
        run: () => setMode('shortcuts'),
      },
    ];

    // Contextual: Plan Review Screen
    if (route.name === 'plan') {
      actions.push(
        {
          id: 'plan-jump-summary',
          title: 'Jump to Summary section',
          category: 'Plan Review',
          shortcut: 'g s',
          keywords: ['overview', 'top'],
          run: () => {
            const el = document.getElementById('plan-summary') || document.getElementById('main');
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'plan-jump-pages',
          title: 'Jump to Pages list',
          category: 'Plan Review',
          shortcut: 'g p',
          keywords: ['routes', 'tested', 'sample'],
          run: () => {
            document.getElementById('plan-pages')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'plan-jump-nav',
          title: 'Jump to Navigation checks',
          category: 'Plan Review',
          shortcut: 'g n',
          keywords: ['links', 'menus', 'header', 'footer'],
          run: () => {
            document.getElementById('plan-navigation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'plan-jump-journeys',
          title: 'Jump to Journeys',
          category: 'Plan Review',
          shortcut: 'g j',
          keywords: ['flows', 'steps', 'actions'],
          run: () => {
            document.getElementById('plan-journeys')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'plan-jump-questions',
          title: 'Jump to Unanswered questions',
          category: 'Plan Review',
          shortcut: 'g q',
          keywords: ['decisions', 'answers'],
          run: () => {
            document.getElementById('plan-questions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'plan-jump-docs',
          title: 'Jump to Specs and design notes',
          category: 'Plan Review',
          keywords: ['context', 'requirements', 'notes'],
          run: () => {
            document.getElementById('plan-docs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'plan-download',
          title: 'Download plan as Markdown',
          category: 'Plan Review',
          keywords: ['export', 'save', 'md'],
          run: () => void downloadPlanMarkdown(),
        }
      );
    }

    // Contextual: Report Screen
    if (route.name === 'report') {
      actions.push(
        {
          id: 'report-jump-problems',
          title: 'Jump to Problems found',
          category: 'Report',
          keywords: ['defects', 'bugs', 'issues', 'blockers'],
          run: () => {
            document.getElementById('problems-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'report-jump-map',
          title: 'Jump to Map of results',
          category: 'Report',
          keywords: ['sitemap', 'visual'],
          run: () => {
            document.getElementById('map-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'report-jump-improve',
          title: 'Jump to What to improve first',
          category: 'Report',
          keywords: ['recommendations', 'quick wins'],
          run: () => {
            document.getElementById('improve-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'report-jump-aspects',
          title: 'Jump to How each area did (Grades)',
          category: 'Report',
          keywords: ['grades', 'scores', 'findable', 'accessible'],
          run: () => {
            document.getElementById('aspects-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        {
          id: 'report-print',
          title: 'Print / Save as PDF report',
          category: 'Report',
          keywords: ['pdf', 'print', 'export'],
          run: () => window.print(),
        }
      );
    }

    return actions;
  }, [route]);

  // Filter actions based on query
  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allActions;
    return allActions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.keywords?.some((k) => k.toLowerCase().includes(q))
    );
  }, [allActions, query]);

  // Reset index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredActions]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-panel border border-rule bg-panel shadow-level-4 transition-all">
        {/* Header Tabs */}
        <div className="flex border-b border-rule bg-surface/60 px-4 py-2 text-sm">
          <button
            type="button"
            className={`rounded-control px-3 py-1.5 font-bold transition-colors ${
              mode === 'command' ? 'bg-stamp text-surface' : 'text-ink-soft hover:text-ink'
            }`}
            onClick={() => setMode('command')}
          >
            Commands
          </button>
          <button
            type="button"
            className={`ml-2 rounded-control px-3 py-1.5 font-bold transition-colors ${
              mode === 'shortcuts' ? 'bg-stamp text-surface' : 'text-ink-soft hover:text-ink'
            }`}
            onClick={() => setMode('shortcuts')}
          >
            Keyboard Shortcuts (?)
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close command palette"
            className="ml-auto inline-flex items-center rounded-control px-2 text-ink-soft hover:bg-surface hover:text-ink"
          >
            <kbd className="font-mono text-xs">ESC</kbd>
          </button>
        </div>

        {mode === 'command' ? (
          <div>
            {/* Input Bar */}
            <div className="flex items-center border-b border-rule px-4 py-3">
              <span className="mr-3 text-ink-soft" aria-hidden="true">
                🔍
              </span>
              <input
                ref={inputRef}
                type="text"
                placeholder="Type a command, search section, or jump to screen..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex((i) => (i + 1) % Math.max(1, filteredActions.length));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex((i) => (i - 1 + filteredActions.length) % Math.max(1, filteredActions.length));
                  } else if (e.key === 'Enter' && filteredActions[selectedIndex]) {
                    e.preventDefault();
                    filteredActions[selectedIndex].run();
                    setOpen(false);
                  }
                }}
                className="w-full bg-transparent text-lg text-ink placeholder:text-ink-soft focus:outline-none"
              />
            </div>

            {/* Actions List */}
            <div className="max-h-96 overflow-y-auto p-2">
              {filteredActions.length === 0 ? (
                <div className="p-6 text-center text-sm text-ink-soft">No commands match &ldquo;{query}&rdquo;</div>
              ) : (
                <ul className="space-y-1">
                  {filteredActions.map((action, index) => {
                    const isSelected = index === selectedIndex;
                    return (
                      <li key={action.id}>
                        <button
                          type="button"
                          onClick={() => {
                            action.run();
                            setOpen(false);
                          }}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={`flex w-full items-center justify-between rounded-control px-3 py-2.5 text-left text-sm transition-colors ${
                            isSelected
                              ? 'bg-stamp/15 text-stamp font-bold shadow-level-1'
                              : 'text-ink hover:bg-surface/60'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-ink-soft">
                              {action.category}
                            </span>
                            <span>{action.title}</span>
                          </div>
                          {action.shortcut && (
                            <kbd className="font-mono text-xs text-ink-soft rounded bg-surface px-1.5 py-0.5 border border-rule">
                              {action.shortcut}
                            </kbd>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer Hint */}
            <div className="flex items-center justify-between border-t border-rule bg-surface/40 px-4 py-2 text-xs text-ink-soft">
              <span>Use ↑ / ↓ to navigate, Enter to select</span>
              <span>
                Press <kbd className="font-mono text-ink">?</kbd> for full cheat sheet
              </span>
            </div>
          </div>
        ) : (
          /* Keyboard Shortcuts Cheatsheet */
          <div className="max-h-[30rem] overflow-y-auto p-5 space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-stamp">General Shortcuts</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Open Command Palette</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">⌘K / Ctrl+K</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Shortcuts Cheatsheet</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">?</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Close Overlay / Modal</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">Esc</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Go to New Check-up</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then h</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Go to Past Check-ups</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then r</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Go to Visual Baselines</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then b</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Go to Compare sites</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then c</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Go to Settings</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then ,</kbd>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-stamp">Plan Review Vim Navigation</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Move focus down list</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">j / ↓</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Move focus up list</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">k / ↑</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Toggle Run / Skip item</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">Space</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Expand / Collapse section</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">Enter</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Jump to Summary</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then s</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Jump to Pages</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then p</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Jump to Navigation</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then n</kbd>
                </div>
                <div className="flex items-center justify-between rounded border border-rule bg-surface/60 p-2">
                  <span>Jump to Journeys</span>
                  <kbd className="font-mono rounded bg-panel px-2 py-0.5 border border-edge/40">g then j</kbd>
                </div>
              </div>
            </div>

            <div className="text-center pt-2">
              <button
                type="button"
                className="btn-primary rounded-control px-5 py-2 text-sm"
                onClick={() => setOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
