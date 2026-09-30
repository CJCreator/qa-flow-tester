import React, { useEffect, useSyncExternalStore } from 'react';

/**
 * Every screen has its own address, so Back, Forward, refresh and bookmarks work. The route table is
 * fixed and short, so this is a few lines over the History API rather than a router library. The
 * QA Tool answers every address that isn't the API with this page (ui-static.ts), and the page
 * picks the screen from the address.
 */
export type Route =
  | { name: 'new' }
  | { name: 'scan' }
  | { name: 'plan' }
  | { name: 'testing' }
  | { name: 'reports' }
  | { name: 'report'; runId: string }
  | { name: 'settings' }
  | { name: 'not-found'; path: string };

export const PATHS = {
  new: '/',
  scan: '/check/scan',
  plan: '/check/plan',
  testing: '/check/testing',
  reports: '/reports',
  report: (runId: string) => `/reports/${encodeURIComponent(runId)}`,
  settings: '/settings',
} as const;

export function matchRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/':
      return { name: 'new' };
    case PATHS.scan:
      return { name: 'scan' };
    case PATHS.plan:
      return { name: 'plan' };
    case PATHS.testing:
      return { name: 'testing' };
    case PATHS.reports:
      return { name: 'reports' };
    case PATHS.settings:
      return { name: 'settings' };
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

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

/** Goes to an address in the app. `replace` swaps the current history entry, for moves the person didn't make. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const here = window.location.pathname + window.location.search;
  if (to === here) return;
  if (options.replace) window.history.replaceState(null, '', to);
  else {
    window.history.pushState(null, '', to);
    window.scrollTo(0, 0);
  }
  notify();
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
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
        e.preventDefault();
        navigate(to);
      },
    },
    children
  );
}

/** Names the browser tab after the screen, e.g. "Past check-ups · Release check-up". */
export function useTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · Release check-up` : 'Release check-up';
  }, [title]);
}
