import { useEffect, useRef } from 'react';
import { Link, PATHS } from '../../lib/router';

export type AuditTab = 'history' | 'results' | 'documents' | 'download' | 'share' | 'helpers';

/**
 * The places inside one Website Audit, as a row of tabs under its header. Results, Documents and Download
 * belong to one version, so they show only when the screen knows the version; History, Share and Helpers
 * belong to the whole audit. `hide` leaves tabs out (e.g. Share and Helpers for a Helper).
 */
export function AuditTabs({
  auditId,
  version,
  current,
  hide = [],
}: {
  auditId: string;
  version?: number;
  current: AuditTab;
  hide?: AuditTab[];
}) {
  const tabs: Array<{ id: AuditTab; label: string; to: string | null }> = [
    { id: 'results', label: 'Results', to: version ? PATHS.auditVersion(auditId, version) : null },
    { id: 'documents', label: 'Documents', to: version ? PATHS.auditReview(auditId, version) : null },
    { id: 'download', label: 'Download', to: version ? PATHS.auditExport(auditId, version) : null },
    { id: 'history', label: 'Versions', to: PATHS.audit(auditId) },
    { id: 'share', label: 'Share', to: PATHS.auditShare(auditId) },
    { id: 'helpers', label: 'Helpers', to: PATHS.auditHelpers(auditId) },
  ];
  const shown = tabs.filter((t): t is { id: AuditTab; label: string; to: string } => !!t.to && !hide.includes(t.id));
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Sets the strip's own scroll position: scrollIntoView was cancelled by the page's scroll to the top on arrival.
    const nav = navRef.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !on) return;
    const navBox = nav.getBoundingClientRect();
    const onBox = on.getBoundingClientRect();
    nav.scrollLeft += onBox.left - navBox.left - (navBox.width - onBox.width) / 2;
    // Again when tabs arrive late (those that need a version), which is when the strip starts to overflow.
  }, [current, shown.length]);
  return (
    <nav
      ref={navRef}
      aria-label="This Website Audit"
      className="[mask-image:linear-gradient(to_right,black_calc(100%-1rem),transparent)] sm:[mask-image:none] -mx-4 mb-8 overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex min-w-max gap-1">
        {shown.map((t) => {
          const on = t.id === current;
          return (
            <li key={t.id}>
              <Link
                to={t.to}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex min-h-[44px] items-center border-b-2 px-3 text-sm font-semibold transition-colors duration-fast ${
                  on ? 'border-stamp text-ink' : 'border-transparent text-ink-soft hover:text-ink'
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
