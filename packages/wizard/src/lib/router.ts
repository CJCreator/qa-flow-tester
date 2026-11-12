import React, { useSyncExternalStore } from 'react';

/**
 * Every screen has its own address, so Back, Forward, refresh and bookmarks work. The route table is
 * fixed and short, so this is a few lines over the History API rather than a router library. The
 * QA Tool answers every address that isn't the API with this page (ui-static.ts), and the page
 * picks the screen from the address.
 */
export type Route =
  | { name: 'landing' }
  | { name: 'new' }
  | { name: 'scan' }
  | { name: 'plan' }
  | { name: 'testing' }
  | { name: 'reports' }
  | { name: 'report'; runId: string }
  | { name: 'visibility'; runId: string }
  | { name: 'baselines' }
  | { name: 'benchmark' }
  | { name: 'settings' }
  | { name: 'audit-new' }
  | { name: 'audits' }
  | { name: 'audit'; auditId: string }
  | { name: 'audit-version'; auditId: string; version: number }
  | { name: 'audit-review'; auditId: string; version: number }
  | { name: 'audit-export'; auditId: string; version: number }
  | { name: 'audit-share'; auditId: string }
  | { name: 'audit-helpers'; auditId: string }
  | { name: 'audit-settings' }
  | { name: 'audit-shortlist' }
  | { name: 'helper-sign-in' }
  | { name: 'not-found'; path: string };

export const PATHS = {
  landing: '/',
  new: '/check',
  scan: '/check/scan',
  plan: '/check/plan',
  testing: '/check/testing',
  reports: '/reports',
  report: (runId: string) => `/reports/${encodeURIComponent(runId)}`,
  visibility: (runId: string) => `/reports/${encodeURIComponent(runId)}/visibility`,
  baselines: '/baselines',
  benchmark: '/benchmark',
  settings: '/settings',
  // Website Audit screens. These are not Check-up routes: the Check-up phase never moves the user off them.
  // The addresses match AUDIT_PATHS in screens/audit/saved/saved-api.ts (a test pins them).
  auditNew: '/audits/new',
  audits: '/audits',
  audit: (auditId: string) => `/audits/${encodeURIComponent(auditId)}`,
  auditVersion: (auditId: string, version: number) => `/audits/${encodeURIComponent(auditId)}/versions/${version}`,
  auditReview: (auditId: string, version: number) =>
    `/audits/${encodeURIComponent(auditId)}/versions/${version}/review`,
  auditExport: (auditId: string, version: number) =>
    `/audits/${encodeURIComponent(auditId)}/versions/${version}/export`,
  auditShare: (auditId: string) => `/audits/${encodeURIComponent(auditId)}/share`,
  auditHelpers: (auditId: string) => `/audits/${encodeURIComponent(auditId)}/helpers`,
  auditSettings: '/audit-settings',
  auditShortlist: '/shortlist',
  helperSignIn: '/helper',
} as const;

/** The id in an address segment, or null when it can't be read or is empty. */
function readId(segment: string): string | null {
  try {
    return decodeURIComponent(segment) || null;
  } catch {
    return null;
  }
}

/** A version number in an address: a positive whole number written plainly. */
function readVersion(segment: string): number | null {
  return /^[1-9]\d{0,8}$/.test(segment) ? Number(segment) : null;
}

function matchAuditRoute(path: string): Route | null {
  const match = path.match(/^\/audits\/([^/]+)(?:\/(share|helpers)|\/versions\/([^/]+)(?:\/(review|export))?)?$/);
  if (!match) return null;
  const auditId = readId(match[1]);
  if (auditId === null) return null;
  if (match[2] === 'share') return { name: 'audit-share', auditId };
  if (match[2] === 'helpers') return { name: 'audit-helpers', auditId };
  if (match[3] === undefined) return { name: 'audit', auditId };
  const version = readVersion(match[3]);
  if (version === null) return null;
  if (match[4] === 'review') return { name: 'audit-review', auditId, version };
  if (match[4] === 'export') return { name: 'audit-export', auditId, version };
  return { name: 'audit-version', auditId, version };
}

export function matchRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/':
      return { name: 'landing' };
    case PATHS.new:
      return { name: 'new' };
    case PATHS.scan:
      return { name: 'scan' };
    case PATHS.plan:
      return { name: 'plan' };
    case PATHS.testing:
      return { name: 'testing' };
    case PATHS.reports:
      return { name: 'reports' };
    case PATHS.baselines:
      return { name: 'baselines' };
    case PATHS.benchmark:
      return { name: 'benchmark' };
    case PATHS.settings:
      return { name: 'settings' };
    case PATHS.auditNew:
      return { name: 'audit-new' };
    case PATHS.audits:
      return { name: 'audits' };
    case PATHS.auditSettings:
      return { name: 'audit-settings' };
    case PATHS.auditShortlist:
      return { name: 'audit-shortlist' };
    case PATHS.helperSignIn:
      return { name: 'helper-sign-in' };
  }
  const audit = matchAuditRoute(path);
  if (audit) return audit;
  const visibilityMatch = path.match(/^\/reports\/([^/]+)\/visibility$/);
  if (visibilityMatch) {
    try {
      return { name: 'visibility', runId: decodeURIComponent(visibilityMatch[1]) };
    } catch {
      // an address that can't be read is not found
    }
  }
  const report = path.match(/^\/reports\/([^/]+)$/);
  if (report) {
    try {
      return { name: 'report', runId: decodeURIComponent(report[1]) };
    } catch {
      // an address that can't be read is not found
    }
  }
  return { name: 'not-found', path };
}

/** True for the screens of the check-up in progress, where the QA Tool's phase decides the screen. */
export function isCheckRoute(route: Route): boolean {
  return route.name === 'scan' || route.name === 'plan' || route.name === 'testing';
}

/**
 * True where a `?url=` address from the landing page is read: the new check-up screen and the
 * check-up's own screens. (isCheckRoute stays narrower: only those screens follow the runner's phase.)
 */
export function readsAddressParam(route: Route): boolean {
  return route.name === 'new' || isCheckRoute(route);
}

/** Answers whether the person may leave the screen for `to`; true leaves. Set by a screen with unsaved work. */
export type LeaveCheck = (to: string) => Promise<boolean>;

let leaveCheck: LeaveCheck | null = null;
/** The address on screen, so Back can be undone while a screen holds unsaved work. */
let shownAddress = typeof window === 'undefined' ? '' : window.location.pathname + window.location.search;

/**
 * Makes every move ask `check` first. Returns the function that lifts the block. The newest block wins.
 * Back while blocked adds one history entry for the screen; that is the price of keeping the address and the screen in step.
 */
export function blockNavigation(check: LeaveCheck): () => void {
  leaveCheck = check;
  return () => {
    if (leaveCheck === check) leaveCheck = null;
  };
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function onPopState(): void {
  if (!leaveCheck) {
    shownAddress = window.location.pathname + window.location.search;
    notify();
    return;
  }
  const target = window.location.pathname + window.location.search;
  window.history.pushState(null, '', shownAddress);
  const currentCheck = leaveCheck;
  void currentCheck(target).then((leave) => {
    if (!leave) return;
    if (leaveCheck === currentCheck) leaveCheck = null;
    window.history.back();
  });
}

if (typeof window !== 'undefined') window.addEventListener('popstate', onPopState);

function go(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', to);
  else {
    window.history.pushState(null, '', to);
    window.scrollTo(0, 0);
  }
  shownAddress = to;
  notify();
}

/** Goes to an address in the app. `replace` swaps the current history entry, for moves the person didn't make. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const here = window.location.pathname + window.location.search;
  if (to === here) return;
  if (!leaveCheck) {
    go(to, options);
    return;
  }
  const currentCheck = leaveCheck;
  void currentCheck(to).then((leave) => {
    if (!leave) return;
    if (leaveCheck === currentCheck) leaveCheck = null;
    go(to, options);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current address's path, updated on navigate() and on Back and Forward. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/**
 * A link inside the app: a real <a href>, so it can be opened in a new tab or copied, that moves
 * without reloading the page on a plain click.
 */
export function Link({
  to,
  children,
  onClick,
  ...rest
}: { to: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return React.createElement(
    'a',
    {
      ...rest,
      href: to,
      onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          rest.target === '_blank'
        )
          return;
        e.preventDefault();
        navigate(to);
      },
    },
    children
  );
}
