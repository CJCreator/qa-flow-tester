import { useEffect, useId, useRef, useState } from 'react';
import { Link, PATHS, type Route } from '../lib/router';
import { AREA_LINK, AREA_TITLES, areaOf, areaTone, menuGroups, type AreaLink } from './AreaNav';

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

/** The screens of a check-up in progress: no dot there, you are already looking at it. */
const CHECKUP_SCREENS: Route['name'][] = ['new', 'scan', 'plan', 'testing'];

/** A check-up is running somewhere else: a small cobalt dot with a spoken label. */
function InProgressDot() {
  return (
    <span className="relative ml-2 flex h-2 w-2" aria-label="A check-up is in progress" role="status">
      <span className="absolute inline-flex h-full w-full rounded-full bg-stamp motion-safe:animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-stamp" />
    </span>
  );
}

/** The developer shortcuts: only where there is a keyboard and a pointer, from 640px. */
const DESKTOP_POINTER = 'hidden [@media(min-width:640px)_and_(pointer:fine)]:inline-flex';
const SHORTCUT_BUTTON = `${DESKTOP_POINTER} min-h-[44px] items-center gap-2 rounded-control px-3 text-sm text-ink-soft transition-colors duration-fast hover:bg-panel hover:text-ink`;
const KEY_CAP = 'rounded-control border border-edge bg-surface px-1.5 font-mono text-xs text-ink';

const openPalette = (mode: 'command' | 'shortcuts') =>
  window.dispatchEvent(new CustomEvent('qa:open-command-palette', { detail: { mode } }));

/**
 * On every screen but the landing page: the brand, the two areas (Check-ups and Website Audits) and Settings.
 * Each area's own places sit in the AreaNav row under it. Nothing here stops or deletes anything. The check-up
 * in progress is reached from its Resume card on the new check-up screen.
 */
export function TopBar({
  route,
  checkupInProgress,
  showDeveloperShortcuts = false,
  beta = false,
  auditOwner = false,
}: {
  route: Route;
  checkupInProgress: boolean;
  /** The Commands and shortcuts buttons: hidden until a first check-up is done. The keys still work. */
  showDeveloperShortcuts?: boolean;
  /** The shared copy: the owner's Website Audits are hidden. */
  beta?: boolean;
  /** The caller is an audit owner on the shared copy (ADR 0042 / T-86). */
  auditOwner?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const area = areaOf(route);
  const dot = checkupInProgress && !CHECKUP_SCREENS.includes(route.name);

  // Phones: Esc closes the menu and puts focus back on its button.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Growing past phone width closes the menu; the full bar takes over.
  useEffect(() => {
    if (!menuOpen || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [menuOpen]);

  const top = (to: string, label: string, current: 'page' | 'true' | undefined, withDot = false) => (
    <Link to={to} aria-current={current} className={`${AREA_LINK} ${areaTone(!!current)}`}>
      {label}
      {withDot && <InProgressDot />}
    </Link>
  );

  return (
    <header className="sticky top-0 z-header border-b border-rule bg-raised/95">
      <div className="mx-auto flex max-w-workspace flex-wrap items-center justify-between gap-x-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <Link
            to={PATHS.new}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 font-bold text-ink transition-colors duration-fast hover:text-stamp"
          >
            <Mark />
            Release check-up
          </Link>
          <nav aria-label="Main" className="hidden sm:block">
            <ul className="flex items-center gap-1">
              <li>{top(PATHS.new, AREA_TITLES.checkups, area === 'checkups' ? 'true' : undefined, dot)}</li>
              {(!beta || auditOwner) && (
                <li>{top(PATHS.audits, AREA_TITLES.audits, area === 'audits' ? 'true' : undefined)}</li>
              )}
            </ul>
          </nav>
        </div>
        <div className="flex items-center gap-1">
          {showDeveloperShortcuts && (
            <>
              <button
                type="button"
                onClick={() => openPalette('command')}
                className={SHORTCUT_BUTTON}
                title="Find a command or a place (Cmd+K or Ctrl+K)"
              >
                Commands
                <kbd className={KEY_CAP}>⌘K</kbd>
              </button>
              <button
                type="button"
                onClick={() => openPalette('shortcuts')}
                className={`${SHORTCUT_BUTTON} min-w-[44px] justify-center`}
                title="Keyboard shortcuts (?)"
                aria-label="Keyboard shortcuts (?)"
              >
                <kbd className={KEY_CAP}>?</kbd>
              </button>
            </>
          )}
          <span className="hidden sm:block">
            {top(PATHS.settings, 'Settings', route.name === 'settings' ? 'page' : undefined)}
          </span>
          <button
            type="button"
            ref={menuButtonRef}
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={() => setMenuOpen((o) => !o)}
            className="btn-quiet btn-sm sm:hidden"
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        {menuOpen && (
          <MobileMenu
            id={menuId}
            route={route}
            beta={beta}
            auditOwner={auditOwner}
            checkupInProgress={dot}
            onNavigate={() => setMenuOpen(false)}
          />
        )}
      </div>
    </header>
  );
}

/** Phones: every place, grouped by area, in one full-width list under the brand row. */
export function MobileMenu({
  id,
  route,
  beta = false,
  auditOwner = false,
  checkupInProgress,
  onNavigate,
}: {
  id: string;
  route: Route;
  beta?: boolean;
  auditOwner?: boolean;
  /** Show the in-progress dot on New check-up. */
  checkupInProgress: boolean;
  onNavigate: () => void;
}) {
  return (
    <nav id={id} aria-label="Main" className="basis-full border-t border-rule pb-3 sm:hidden">
      {menuGroups(beta, auditOwner).map((group) => {
        const headingId = `${id}-${group.title.replace(/\W+/g, '-').toLowerCase()}`;
        return (
          <div key={group.title} className="pt-3">
            <p id={headingId} className="px-3 pb-1 text-sm text-ink-soft">
              {group.title}
            </p>
            <ul aria-labelledby={headingId}>
              {group.links.map((l: AreaLink) => {
                const current = l.names.includes(route.name);
                return (
                  <li key={l.to}>
                    <Link
                      to={l.to}
                      aria-current={current ? 'page' : undefined}
                      onClick={onNavigate}
                      className={`${AREA_LINK} w-full ${areaTone(current)}`}
                    >
                      {l.label}
                      {l.to === PATHS.new && checkupInProgress && <InProgressDot />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
