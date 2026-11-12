/** The host without a leading "www.", lower-cased, so example.com and www.example.com match. */
function withoutWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * True when two hosts are one site: identical, or one is the other's www twin (example.com and
 * www.example.com). Ports must match, and any other subdomain (app.example.com) is another site.
 */
export function isSameSite(host: string, siteHost: string): boolean {
  return withoutWww(host) === withoutWww(siteHost);
}

/**
 * The full address of a Plan's start page or `navigate` step, or null when it leaves the checked App:
 * http or https only, no user name or password in it, on the target's site (its www twin included) or a host
 * on the Domain Allowlist.
 */
export function onSiteAddress(value: string, targetUrl: string, allowedHosts: string[] = []): string | null {
  try {
    const target = new URL(targetUrl);
    const u = new URL(value, target);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    const host = u.host.toLowerCase();
    const allowed = isSameSite(host, target.host) || allowedHosts.some((h) => isSameSite(host, h.toLowerCase()));
    return allowed ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A Plan path on the site itself: starts with one `/` and names no other host (`//x`, `/\x` do). */
export function isSitePath(value: string | undefined): boolean {
  if (!value || !value.startsWith('/')) return false;
  try {
    return new URL(value, 'http://site.invalid').host === 'site.invalid';
  } catch {
    return false;
  }
}
