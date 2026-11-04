import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, PATHS, type Route } from '../lib/router';
import { AUDIT_ROUTE_NAMES } from '../screens/audit/BetaAuditNotice';

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

type NavItem = { to: string; label: string; names: Route['name'][] };
const PRIMARY: NavItem[] = [
  { to: PATHS.new, label: 'New check-up', names: ['new'] },
  { to: PATHS.reports, label: 'Past check-ups', names: ['reports', 'report'] },
  { to: PATHS.audits, label: 'Website Audit', names: [...AUDIT_ROUTE_NAMES] },
  { to: PATHS.settings, label: 'Settings', names: ['settings'] },
];
const MORE: NavItem[] = [
  { to: PATHS.baselines, label: 'Visual Baselines', names: ['baselines'] },
  { to: PATHS.benchmark, label: 'Compare with another site', names: ['benchmark'] },
  { to: PATHS.auditShortlist, label: 'Shortlist', names: ['audit-shortlist'] },
  { to: PATHS.auditSettings, label: 'Website Audit settings', names: ['audit-settings'] },
];
/** The owner's Website Audit items: the shared (beta) copy hides them. */
const OWNER_AUDIT_TO: string[] = [PATHS.audits, PATHS.auditShortlist, PATHS.auditSettings];

/** The top bar's destinations. On the shared (beta) copy the owner's Website Audit items are left out. */
export function navItems(beta = false): { primary: NavItem[]; more: NavItem[] } {
  const keep = (l: NavItem) => !beta || !OWNER_AUDIT_TO.includes(l.to);
  return { primary: PRIMARY.filter(keep), more: MORE.filter(keep) };
}

/**
 * The breadcrumb trail for each screen. A `Record` over every route name, so adding a route fails to compile
 * until it has a label. The route holds only the audit's id, not its site, so audit crumbs are generic.
 * "Version" becomes "Version N" for the routes that carry a version.
 */
export const CRUMB_LABELS: Record<Route['name'], string[]> = {
  landing: ['Release check-up'],
  new: ['New check-up'],
  scan: ['Scanning'],
  plan: ['Plan review'],
  testing: ['Testing'],
  reports: ['Past check-ups'],
  report: ['Report'],
  visibility: ['Visibility'],
  baselines: ['Visual Baselines'],
  benchmark: ['Compare with another site'],
  settings: ['Settings'],
  'audit-new': ['Website Audits', 'New Website Audit'],
  audits: ['Website Audits'],
  audit: ['Website Audits', 'Website Audit'],
  'audit-version': ['Website Audits', 'Website Audit', 'Version'],
  'audit-review': ['Website Audits', 'Website Audit', 'Version', 'Review'],
  'audit-export': ['Website Audits', 'Website Audit', 'Version', 'Export'],
  'audit-share': ['Website Audits', 'Website Audit', 'Shared Links'],
  'audit-helpers': ['Website Audits', 'Website Audit', 'Helpers'],
  'audit-settings': ['Website Audits', 'Website Audit settings'],
  'audit-shortlist': ['Website Audits', 'Shortlist'],
  'helper-sign-in': ['Helper sign-in'],
  'not-found': ['Page not found'],
};

export function crumbTrail(route: Route): string[] {
  const version = 'version' in route ? `Version ${route.version}` : 'Version';
  return CRUMB_LABELS[route.name].map((l) => (l === 'Version' ? version : l));
}

/** Where an earlier crumb leads, when it leads anywhere. */
function crumbTo(route: Route, label: string): string | undefined {
  if (label === 'Website Audits') return PATHS.audits;
  if (!('auditId' in route)) return undefined;
  if (label === 'Website Audit') return PATHS.audit(route.auditId);
  if (label.startsWith('Version ') && 'version' in route) return PATHS.auditVersion(route.auditId, route.version);
  return undefined;
}
/** Check-up screens show the StepBar instead of a breadcrumb row. */
const NO_CRUMBS: Route['name'][] = ['new', 'scan', 'plan', 'testing', 'report'];

const ITEM =
  'inline-flex min-h-[44px] items-center rounded-control px-2.5 text-sm font-bold transition-colors duration-150 hover:bg-panel hover:text-ink';
const tone = (active?: string) =>
  active ? 'bg-panel text-ink underline decoration-stamp decoration-2 underline-offset-8' : 'text-ink-soft';

function NavLink({
  item: l,
  route,
  checkupInProgress,
  onNavigate,
  extra = '',
}: {
  item: NavItem;
  route: Route;
  checkupInProgress: boolean;
  onNavigate: () => void;
  extra?: string;
}) {
  const current = l.names.includes(route.name) ? 'page' : undefined;
  return (
    <Link to={l.to} aria-current={current} onClick={onNavigate} className={`${ITEM} ${tone(current)} ${extra}`}>
      {l.label}
      {l.to === PATHS.new && checkupInProgress && route.name !== 'new' && (
        <span className="relative ml-2 flex h-2 w-2" aria-label="(a check-up is in progress)" role="img">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stamp opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-stamp" />
        </span>
      )}
    </Link>
  );
}

/** Phones: every destination in one full-width list under the brand row. */
export function MobileMenu({
  items,
  route,
  checkupInProgress,
  onNavigate,
}: {
  items: NavItem[];
  route: Route;
  checkupInProgress: boolean;
  onNavigate: () => void;
}) {
  return (
    <nav id="mobile-menu" aria-label="Main" className="basis-full sm:hidden">
      <ul>
        {items.map((l) => (
          <li key={l.to}>
            <NavLink
              item={l}
              route={route}
              checkupInProgress={checkupInProgress}
              onNavigate={onNavigate}
              extra="w-full"
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * On every screen: the places you can go. Nothing here stops or deletes anything. The check-up in
 * progress is reached from its Resume card on the new check-up screen.
 */
export function TopBar({
  route,
  checkupInProgress,
  showDeveloperShortcuts = false,
  beta = false,
}: {
  route: Route;
  checkupInProgress: boolean;
  /** The Commands and shortcuts buttons: hidden until a first check-up is done. The keys still work. */
  showDeveloperShortcuts?: boolean;
  /** The shared copy: the owner's Website Audit items are hidden. */
  beta?: boolean;
}) {
  const { primary, more } = navItems(beta);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLLIElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setMenuOpen(false);
    setMoreOpen(false);
  };
  const link = (l: NavItem, extra = '') => (
    <NavLink item={l} route={route} checkupInProgress={checkupInProgress} onNavigate={close} extra={extra} />
  );

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!menuOpen || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-rule/80 bg-surface/85 backdrop-blur-md shadow-level-1 supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-1.5 sm:px-6">
        <div className="flex items-center gap-4">
          <Link
            to={PATHS.new}
            className="inline-flex min-h-[44px] items-center gap-2 font-bold text-ink hover:text-stamp transition-colors"
          >
            <Mark />
            Release check-up
          </Link>
          {showDeveloperShortcuts && (
            <>
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
            </>
          )}
        </div>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? 'mobile-menu' : undefined}
          onClick={() => setMenuOpen((o) => !o)}
          className={`${ITEM} border border-edge/60 text-ink sm:hidden`}
        >
          Menu
        </button>
        <nav aria-label="Main" className="hidden sm:block">
          <ul className="flex items-center gap-x-5">
            {primary.map((l) => (
              <li key={l.to}>{link(l)}</li>
            ))}
            <li className="relative" ref={moreRef}>
              <button
                type="button"
                ref={moreButtonRef}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
                className={`${ITEM} ${tone(more.some((l) => l.names.includes(route.name)) ? 'page' : undefined)}`}
              >
                More
              </button>
              {moreOpen && (
                <ul className="absolute right-0 top-full z-50 min-w-[11rem] rounded-control border border-rule bg-surface p-1 shadow-level-1">
                  {more.map((l) => (
                    <li key={l.to}>{link(l, 'w-full')}</li>
                  ))}
                </ul>
              )}
            </li>
          </ul>
        </nav>
        {menuOpen && (
          <MobileMenu
            items={[...primary, ...more]}
            route={route}
            checkupInProgress={checkupInProgress}
            onNavigate={close}
          />
        )}
      </div>
      {!NO_CRUMBS.includes(route.name) && route.name !== 'landing' && (
        <div className="border-t border-rule/50 bg-panel/40">
          <nav
            aria-label="Breadcrumb"
            className="mx-auto flex max-w-6xl items-center gap-1.5 px-4 py-1 text-xs text-ink-soft sm:px-6 font-mono"
          >
            <Link to={PATHS.landing} className="font-sans hover:text-ink">
              Home
            </Link>
            {crumbTrail(route).map((label, i, all) => {
              const last = i === all.length - 1;
              const to = last ? undefined : crumbTo(route, label);
              return (
                <Fragment key={`${i}-${label}`}>
                  <span aria-hidden="true" className="text-edge/70 px-0.5">
                    /
                  </span>
                  {to ? (
                    <Link to={to} className="font-sans hover:text-ink">
                      {label}
                    </Link>
                  ) : (
                    <span
                      aria-current={last ? 'page' : undefined}
                      className={last ? 'font-sans font-medium text-ink' : 'font-sans'}
                    >
                      {label}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
