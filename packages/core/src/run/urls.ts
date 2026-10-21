import { normalizeRoute } from '@qa/types';

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** The site a run is for, as rules about it are kept: "localhost:3050". */
export function siteHostOf(targetUrl: string): string | undefined {
  try {
    return new URL(targetUrl).host;
  } catch {
    return undefined;
  }
}

/**
 * Where a finding was, as a path on the site: "/dashboard", never "http://localhost:3050/dashboard",
 * so one page is never counted as two. A page on another host keeps its full address.
 */
export function sitePathOf(urlPath: string, targetUrl: string): string {
  try {
    const target = new URL(targetUrl);
    const url = new URL(urlPath, target);
    const route = normalizeRoute(url.pathname);
    return url.host === target.host ? route : url.origin + route;
  } catch {
    return normalizeRoute(urlPath);
  }
}
