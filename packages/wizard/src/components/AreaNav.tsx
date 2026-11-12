import { useEffect, useRef } from 'react';
import { Link, PATHS, type Route } from '../lib/router';
import { AUDIT_ROUTE_NAMES } from '../screens/audit/BetaAuditNotice';

/**
 * The two areas of the app (ADR 0041). Each has its own row of places under the top bar; on phones the
 * Menu lists the same places, grouped by area. Settings belongs to neither.
 */
export type Area = 'checkups' | 'audits';

export type AreaLink = { to: string; label: string; names: readonly Route['name'][] };

/** Every route of the Check-ups area: the top bar's Check-ups link is current on these. */
export const CHECKUP_ROUTE_NAMES: readonly Route['name'][] = [
  'new',
  'scan',
  'plan',
  'testing',
  'reports',
  'report',
  'visibility',
  'baselines',
  'benchmark',
];

export const CHECKUP_LINKS: readonly AreaLink[] = [
  { to: PATHS.new, label: 'New check-up', names: ['new', 'scan', 'plan', 'testing'] },
  { to: PATHS.reports, label: 'Past check-ups', names: ['reports', 'report', 'visibility'] },
  { to: PATHS.baselines, label: 'Visual baselines', names: ['baselines'] },
  { to: PATHS.benchmark, label: 'Compare sites', names: ['benchmark'] },
];

export const AUDIT_LINKS: readonly AreaLink[] = [
  {
    to: PATHS.audits,
    label: 'Audits',
    names: AUDIT_ROUTE_NAMES.filter((n) => n !== 'audit-shortlist' && n !== 'audit-settings' && n !== 'helper-sign-in'),
  },
  { to: PATHS.auditShortlist, label: 'Shortlist', names: ['audit-shortlist'] },
  { to: PATHS.auditSettings, label: 'Audit settings', names: ['audit-settings'] },
];

export const AREA_TITLES: Record<Area, string> = { checkups: 'Check-ups', audits: 'Website Audits' };

/** The area a screen belongs to, or null (landing, settings, not found). Helper sign-in is a Website Audit screen. */
export function areaOf(route: Route): Area | null {
  if (CHECKUP_ROUTE_NAMES.includes(route.name)) return 'checkups';
  if (AUDIT_ROUTE_NAMES.includes(route.name)) return 'audits';
  return null;
}

/** The places of an area. The shared (beta) copy has no Website Audits unless the caller is an audit owner. */
export function areaLinks(area: Area, beta = false, auditOwner = false): readonly AreaLink[] {
  if (area === 'checkups') return CHECKUP_LINKS;
  return beta && !auditOwner ? [] : AUDIT_LINKS;
}

/** The phone menu's groups, in order: Check-ups, Website Audits (not on beta unless audit owner), Settings. */
export function menuGroups(beta = false, auditOwner = false): { title: string; links: readonly AreaLink[] }[] {
  const groups = [
    { title: AREA_TITLES.checkups, links: areaLinks('checkups', beta, auditOwner) },
    { title: AREA_TITLES.audits, links: areaLinks('audits', beta, auditOwner) },
    {
      title: 'Settings',
      links: [{ to: PATHS.settings, label: 'Settings', names: ['settings'] }] as readonly AreaLink[],
    },
  ];
  return groups.filter((g) => g.links.length > 0);
}

export const AREA_LINK =
  'inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-control px-3 text-sm font-bold transition-colors duration-fast hover:bg-panel hover:text-ink';

/** Current links: ink with a cobalt underline. Others: the softer ink. */
export const areaTone = (current: boolean) =>
  current ? 'text-ink underline decoration-stamp decoration-2 underline-offset-8' : 'text-ink-soft';

/**
 * The area's row of places, under the top bar. Not shown on the landing page, Settings, Helper sign-in or
 * Page not found; the check-up's own screens show the step bar instead (App decides).
 */
export function AreaNav({
  route,
  beta = false,
  auditOwner = false,
}: {
  route: Route;
  beta?: boolean;
  auditOwner?: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const link = ul.querySelector<HTMLElement>('[aria-current="page"]');
    if (!link) return;
    const box = ul.getBoundingClientRect();
    const on = link.getBoundingClientRect();
    ul.scrollLeft += on.left - box.left - (box.width - on.width) / 2;
  }, [route.name]);
  if (route.name === 'helper-sign-in') return null;
  const area = areaOf(route);
  if (!area) return null;
  const links = areaLinks(area, beta, auditOwner);
  if (links.length === 0) return null;
  return (
    <nav aria-label={AREA_TITLES[area]} className="border-b border-rule bg-canvas" data-area={area}>
      <div className="mx-auto max-w-workspace px-4 sm:px-6 lg:px-8">
        <ul
          ref={listRef}
          className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0 [mask-image:linear-gradient(to_right,black_calc(100%-1rem),transparent)] sm:[mask-image:none]"
        >
          {links.map((l) => {
            const current = l.names.includes(route.name);
            return (
              <li key={l.to} className="shrink-0">
                <Link
                  to={l.to}
                  aria-current={current ? 'page' : undefined}
                  className={`${AREA_LINK} ${areaTone(current)}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
