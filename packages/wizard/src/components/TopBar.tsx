import { Link, PATHS, type Route } from '../lib/router';

/** The mark: an inspector's stamp with a tick. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" className="shrink-0 text-stamp">
      <rect
        x="3"
        y="3"
        width="26"
        height="26"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        transform="rotate(-6 16 16)"
      />
      <path
        d="M10 16.5l4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * On every screen: the places you can go. Nothing here stops or deletes anything. The check-up in
 * progress is reached from its Resume card on the new check-up screen.
 */
export function TopBar({ route, checkupInProgress }: { route: Route; checkupInProgress: boolean }) {
  const current = (names: Route['name'][]) => (names.includes(route.name) ? 'page' : undefined);
  const item = 'inline-flex min-h-[44px] items-center rounded px-2 text-sm font-bold transition-colors hover:text-ink';
  const tone = (active?: string) =>
    active ? 'text-ink underline decoration-stamp decoration-2 underline-offset-8' : 'text-ink-soft';
  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-1 sm:px-6">
        <div className="flex items-center gap-4">
          <Link to={PATHS.new} className="inline-flex min-h-[44px] items-center gap-2 font-bold text-ink">
            <Mark />
            Release check-up
          </Link>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent('qa:open-command-palette', { detail: { mode: 'command' } }))
            }
            className="hidden items-center gap-2 rounded-control border border-edge/60 bg-panel px-2.5 py-1 text-xs font-medium text-ink-soft hover:border-stamp hover:text-ink transition-colors sm:inline-flex"
            title="Search commands, sections & shortcuts (Cmd+K)"
          >
            <span>Commands</span>
            <kbd className="rounded border border-edge/40 bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent('qa:open-command-palette', { detail: { mode: 'shortcuts' } }))
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-control border border-edge/60 bg-panel font-mono text-xs font-bold text-ink-soft hover:border-stamp hover:text-ink"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            ?
          </button>
        </div>
        <nav aria-label="Main">
          <ul className="flex flex-wrap items-center gap-x-3 sm:gap-x-5">
            <li>
              <Link to={PATHS.new} aria-current={current(['new'])} className={`${item} ${tone(current(['new']))}`}>
                New check-up
                {checkupInProgress && route.name !== 'new' && (
                  <span
                    className="ml-1.5 inline-block h-2 w-2 rounded-full bg-stamp"
                    aria-label="(a check-up is in progress)"
                    role="img"
                  />
                )}
              </Link>
            </li>
            <li>
              <Link
                to={PATHS.reports}
                aria-current={current(['reports', 'report'])}
                className={`${item} ${tone(current(['reports', 'report']))}`}
              >
                Past check-ups
              </Link>
            </li>
            <li>
              <Link
                to={PATHS.baselines}
                aria-current={current(['baselines'])}
                className={`${item} ${tone(current(['baselines']))}`}
              >
                Baselines
              </Link>
            </li>
            <li>
              <Link
                to={PATHS.benchmark}
                aria-current={current(['benchmark'])}
                className={`${item} ${tone(current(['benchmark']))}`}
              >
                Compare sites
              </Link>
            </li>
            <li>
              <Link
                to={PATHS.settings}
                aria-current={current(['settings'])}
                className={`${item} ${tone(current(['settings']))}`}
              >
                Settings
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      {route.name !== 'landing' && (
        <div className="border-t border-rule/50 bg-surface/50">
          <nav
            aria-label="Breadcrumb"
            className="mx-auto flex max-w-6xl items-center gap-1.5 px-4 py-1 text-xs text-ink-soft sm:px-6"
          >
            <Link to={PATHS.landing} className="hover:text-ink">
              Home
            </Link>
            <span aria-hidden="true" className="text-edge">
              /
            </span>
            <span aria-current="page" className="font-medium text-ink">
              {route.name === 'new'
                ? 'New check-up'
                : route.name === 'reports'
                  ? 'Past check-ups'
                  : route.name === 'report'
                    ? 'Report'
                    : route.name === 'baselines'
                      ? 'Baselines'
                      : route.name === 'benchmark'
                        ? 'Compare sites'
                        : route.name === 'settings'
                          ? 'Settings'
                          : route.name === 'scan'
                            ? 'Scanning'
                            : route.name === 'testing'
                              ? 'Testing'
                              : route.name === 'plan'
                                ? 'Plan review'
                                : 'Page'}
            </span>
          </nav>
        </div>
      )}
    </header>
  );
}
