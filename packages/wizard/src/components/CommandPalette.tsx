import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { navigate, PATHS, type Route } from '../lib/router';
import { scrollBehavior } from '../lib/format';
import { downloadPlanMarkdown } from '../api';

export interface CommandAction {
  id: string;
  title: string;
  category: 'Go to' | 'Plan Review' | 'Report' | 'General';
  shortcut?: string;
  keywords?: string[];
  run: () => void;
}

/** The Website Audit places. Hidden on the shared (beta) copy, where only a Helper's own audits open. */
export const AUDIT_COMMANDS: { id: string; title: string; to: string; keywords: string[] }[] = [
  {
    id: 'nav-audit-new',
    title: 'Start a Website Audit',
    to: PATHS.auditNew,
    keywords: ['audit', 'website', 'new', 'start', 'address'],
  },
  {
    id: 'nav-audits',
    title: 'Go to Website Audits',
    to: PATHS.audits,
    keywords: ['audit', 'website', 'history', 'saved', 'list'],
  },
  {
    id: 'nav-shortlist',
    title: 'Go to Shortlist',
    to: PATHS.auditShortlist,
    keywords: ['audit', 'pitch', 'leads', 'outcome'],
  },
  {
    id: 'nav-audit-settings',
    title: 'Go to Audit settings',
    to: PATHS.auditSettings,
    keywords: ['audit', 'documents', 'ai', 'models', 'settings', 'proposal'],
  },
];

/** Scrolls a section of the screen into view, without motion when the device asks for less. */
function jumpTo(...ids: string[]) {
  const el = ids.map((id) => document.getElementById(id)).find(Boolean);
  el?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

/** The keys that work everywhere. */
const GENERAL_KEYS: Array<[string, string]> = [
  ['Find a command or a place', '⌘K or Ctrl+K'],
  ['Show keyboard shortcuts', '?'],
  ['Close this window', 'Esc'],
];

/** The keys PlanDocument handles on the Plan Review screen (and nowhere else). */
const PLAN_KEYS: Array<[string, string]> = [
  ['Next item', 'j'],
  ['Previous item', 'k'],
  ['Toggle Leave out item', 'Space'],
  ['Open or close the item’s details', 'Enter'],
  ['Jump to What approving runs', 'g then s'],
  ['Jump to Unanswered questions', 'g then q'],
  ['Jump to Pages', 'g then p'],
  ['Jump to Navigation checks', 'g then n'],
  ['Jump to Journeys', 'g then j'],
  ['Jump to Checks', 'g then c'],
  ['Jump to Won’t run', 'g then w'],
  ['Jump to Product context and design notes', 'g then d'],
  ['Top of the plan', 'g then g'],
  ['End of the plan', 'Shift+G'],
];

const KEY_CAP = 'rounded-control border border-edge bg-surface px-1.5 py-0.5 font-mono text-xs text-ink';
const TAB =
  'inline-flex min-h-[44px] items-center rounded-control px-3 text-sm font-bold transition-colors duration-fast';

function KeyList({ title, keys }: { title: string; keys: Array<[string, string]> }) {
  return (
    <section>
      <h2 className="mb-2 text-xl font-bold">{title}</h2>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        {keys.map(([what, key]) => (
          <div key={what} className="flex min-h-[44px] items-center justify-between gap-3 border-b border-rule py-1">
            <dt className="text-sm">{what}</dt>
            <dd>
              <kbd className={KEY_CAP}>{key}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function CommandPalette({ route, beta = false }: { route: Route; beta?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'command' | 'shortcuts'>('command');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<'command' | 'shortcuts', HTMLButtonElement | null>>({ command: null, shortcuts: null });
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    input: `${uid}-input`,
    list: `${uid}-list`,
    option: (actionId: string) => `${uid}-option-${actionId}`,
    tab: (m: 'command' | 'shortcuts') => `${uid}-tab-${m}`,
    panel: (m: 'command' | 'shortcuts') => `${uid}-panel-${m}`,
  };

  // Global keys: Cmd+K or Ctrl+K toggles, ? shows the shortcuts, Esc closes.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isInput =
        activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setMode('command');
        setQuery('');
        return;
      }

      if (e.key === '?' && !isInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
        setMode('shortcuts');
        return;
      }

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

  // Open as a modal dialog (the page behind is inert); on close, focus goes back to where it was.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  // The search field takes focus in Commands; the Shortcuts tab takes it otherwise.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (mode === 'command') inputRef.current?.focus();
      else tabRefs.current.shortcuts?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, mode]);

  const allActions = useMemo<CommandAction[]>(() => {
    const actions: CommandAction[] = [
      {
        id: 'nav-new',
        title: 'Go to New check-up',
        category: 'Go to',
        keywords: ['home', 'scan', 'start', 'address', 'check-ups'],
        run: () => navigate(PATHS.new),
      },
      {
        id: 'nav-past',
        title: 'Go to Past check-ups',
        category: 'Go to',
        keywords: ['reports', 'history', 'runs', 'check-ups'],
        run: () => navigate(PATHS.reports),
      },
      {
        id: 'nav-baselines',
        title: 'Go to Visual baselines',
        category: 'Go to',
        keywords: ['snapshots', 'diff', 'pixel', 'regression', 'visual'],
        run: () => navigate(PATHS.baselines),
      },
      {
        id: 'nav-benchmark',
        title: 'Go to Compare sites',
        category: 'Go to',
        keywords: ['competitor', 'gap', 'ux', 'friction', 'scorecard', 'another site'],
        run: () => navigate(PATHS.benchmark),
      },
      {
        id: 'nav-settings',
        title: 'Go to Settings',
        category: 'Go to',
        keywords: ['config', 'ai', 'keys', 'models', 'gates', 'schedules'],
        run: () => navigate(PATHS.settings),
      },
      ...(beta
        ? []
        : AUDIT_COMMANDS.map(
            (c): CommandAction => ({
              id: c.id,
              title: c.title,
              category: 'Go to',
              keywords: c.keywords,
              run: () => navigate(c.to),
            })
          )),
      {
        id: 'nav-gates',
        title: 'Change the release rule',
        category: 'Go to',
        keywords: ['criteria', 'thresholds', 'strict', 'standard', 'gates', 'blockers'],
        run: () => navigate(PATHS.settings),
      },
      {
        id: 'view-shortcuts',
        title: 'Show keyboard shortcuts',
        category: 'General',
        shortcut: '?',
        keywords: ['help', 'keys', 'hotkeys', 'cheatsheet'],
        run: () => setMode('shortcuts'),
      },
    ];

    // The Plan Review screen. These g-chords are the ones PlanDocument handles.
    if (route.name === 'plan') {
      actions.push(
        {
          id: 'plan-jump-summary',
          title: 'Jump to What approving runs',
          category: 'Plan Review',
          shortcut: 'g s',
          keywords: ['summary', 'overview', 'top'],
          run: () => jumpTo('plan-summary', 'main'),
        },
        {
          id: 'plan-jump-pages',
          title: 'Jump to Pages list',
          category: 'Plan Review',
          shortcut: 'g p',
          keywords: ['routes', 'tested', 'sample'],
          run: () => jumpTo('plan-pages'),
        },
        {
          id: 'plan-jump-nav',
          title: 'Jump to Navigation checks',
          category: 'Plan Review',
          shortcut: 'g n',
          keywords: ['links', 'menus', 'header', 'footer'],
          run: () => jumpTo('plan-navigation'),
        },
        {
          id: 'plan-jump-journeys',
          title: 'Jump to Journeys',
          category: 'Plan Review',
          shortcut: 'g j',
          keywords: ['flows', 'steps', 'actions'],
          run: () => jumpTo('plan-journeys'),
        },
        {
          id: 'plan-jump-questions',
          title: 'Jump to Unanswered questions',
          category: 'Plan Review',
          shortcut: 'g q',
          keywords: ['decisions', 'answers'],
          run: () => jumpTo('plan-questions'),
        },
        {
          id: 'plan-jump-docs',
          title: 'Jump to Product context and design notes',
          category: 'Plan Review',
          shortcut: 'g d',
          keywords: ['context', 'requirements', 'notes'],
          run: () => jumpTo('plan-docs'),
        },
        {
          id: 'plan-download',
          title: 'Download the plan as Markdown',
          category: 'Plan Review',
          keywords: ['export', 'save', 'md'],
          run: () => void downloadPlanMarkdown(),
        }
      );
    }

    if (route.name === 'report') {
      actions.push(
        {
          id: 'report-jump-problems',
          title: 'Jump to Problems found',
          category: 'Report',
          keywords: ['defects', 'bugs', 'issues', 'blockers'],
          run: () => jumpTo('problems-title'),
        },
        {
          id: 'report-jump-map',
          title: 'Jump to Map of results',
          category: 'Report',
          keywords: ['sitemap', 'visual'],
          run: () => jumpTo('map-title'),
        },
        {
          id: 'report-jump-improve',
          title: 'Jump to What to improve first',
          category: 'Report',
          keywords: ['recommendations', 'quick wins'],
          run: () => jumpTo('improve-title'),
        },
        {
          id: 'report-jump-aspects',
          title: 'Jump to How each area did',
          category: 'Report',
          keywords: ['grades', 'scores', 'findable', 'accessible'],
          run: () => jumpTo('aspects-title'),
        },
        {
          id: 'report-print',
          title: 'Print the report or save it as a PDF',
          category: 'Report',
          keywords: ['pdf', 'print', 'export'],
          run: () => window.print(),
        }
      );
    }

    return actions;
  }, [route, beta]);

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

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredActions]);

  const selected = filteredActions[selectedIndex];

  // Keep the highlighted option in sight while the arrows move it.
  useEffect(() => {
    if (!open || !selected) return;
    document.getElementById(ids.option(selected.id))?.scrollIntoView({ block: 'nearest' });
  }, [open, selected, uid]);

  if (!open) return null;

  const close = () => setOpen(false);
  const choose = (action: CommandAction) => {
    action.run();
    if (action.id !== 'view-shortcuts') close();
  };

  /** Tabs: Left and Right arrows move between them (and select). */
  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 'command' : e.key === 'End' ? 'shortcuts' : mode === 'command' ? 'shortcuts' : 'command';
    setMode(next);
    tabRefs.current[next]?.focus();
  };

  const tab = (m: 'command' | 'shortcuts', label: string) => (
    <button
      type="button"
      role="tab"
      id={ids.tab(m)}
      ref={(el) => {
        tabRefs.current[m] = el;
      }}
      aria-selected={mode === m}
      aria-controls={ids.panel(m)}
      tabIndex={mode === m ? 0 : -1}
      onKeyDown={onTabKey}
      onClick={() => setMode(m)}
      className={`${TAB} ${mode === m ? 'bg-stamp-tint text-ink' : 'text-ink-soft hover:bg-panel hover:text-ink'}`}
    >
      {label}
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ids.title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        // A click on the dimmed backdrop (the dialog box itself, outside its content) closes it.
        if (e.target === e.currentTarget) close();
      }}
      className="mx-auto mb-auto mt-[10vh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-panel border border-rule bg-raised p-0 text-ink shadow-level-4 backdrop:bg-ink/40"
    >
      <h2 id={ids.title} className="sr-only">
        Commands and keyboard shortcuts
      </h2>
      <div className="flex items-center gap-1 border-b border-rule px-3 py-1">
        <div role="tablist" aria-label="Commands and keyboard shortcuts" className="flex items-center gap-1">
          {tab('command', 'Commands')}
          {tab('shortcuts', 'Keyboard shortcuts')}
        </div>
        <button
          type="button"
          onClick={close}
          className={`${TAB} ml-auto gap-2 font-normal text-ink-soft hover:bg-panel hover:text-ink`}
        >
          Close
          <kbd className={KEY_CAP}>Esc</kbd>
        </button>
      </div>

      {mode === 'command' ? (
        <div role="tabpanel" id={ids.panel('command')} aria-labelledby={ids.tab('command')}>
          <div className="border-b border-rule px-4 py-3">
            <label htmlFor={ids.input} className="label">
              Find a command or a place
            </label>
            <input
              ref={inputRef}
              id={ids.input}
              type="text"
              role="combobox"
              aria-expanded={filteredActions.length > 0}
              aria-controls={ids.list}
              aria-autocomplete="list"
              aria-activedescendant={selected ? ids.option(selected.id) : undefined}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSelectedIndex((i) => (i + 1) % Math.max(1, filteredActions.length));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSelectedIndex((i) => (i - 1 + filteredActions.length) % Math.max(1, filteredActions.length));
                } else if (e.key === 'Enter' && selected) {
                  e.preventDefault();
                  choose(selected);
                }
              }}
              className="field"
            />
          </div>

          <div className="max-h-96 overflow-y-auto p-2">
            {filteredActions.length === 0 ? (
              <p role="status" className="p-6 text-center text-sm text-ink-soft">
                Nothing matches “{query}”. Try another word.
              </p>
            ) : (
              <ul role="listbox" id={ids.list} aria-label="Commands" className="grid gap-0.5">
                {filteredActions.map((action, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <li
                      key={action.id}
                      id={ids.option(action.id)}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => choose(action)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-control px-3 text-sm transition-colors duration-fast ${
                        isSelected ? 'bg-stamp-tint font-bold text-ink' : 'text-ink'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-xs text-ink-soft">{action.category}</span>
                        <span>{action.title}</span>
                      </span>
                      {action.shortcut && <kbd className={KEY_CAP}>{action.shortcut}</kbd>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="hidden border-t border-rule px-4 py-2 text-xs text-ink-soft sm:block">
            ↑ and ↓ to move, Enter to choose. <kbd className={KEY_CAP}>?</kbd> lists the keyboard shortcuts.
          </p>
        </div>
      ) : (
        <div
          role="tabpanel"
          id={ids.panel('shortcuts')}
          aria-labelledby={ids.tab('shortcuts')}
          // It scrolls and holds no controls, so it takes focus itself (keyboard users can scroll it).
          tabIndex={0}
          className="max-h-[30rem] space-y-6 overflow-y-auto p-5"
        >
          <KeyList title="Everywhere" keys={GENERAL_KEYS} />
          <KeyList title="On the plan" keys={PLAN_KEYS} />
        </div>
      )}
    </dialog>
  );
}
