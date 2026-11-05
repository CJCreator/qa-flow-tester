/**
 * Website Audit: pages that stand between the tool and the site (ADR 0042). Node only.
 * - Dev tunnels (Microsoft devtunnels, ngrok) show a warning page to browsers until a skip header is sent. The
 *   audit's Chromium sends it on requests to the audited site only, the way the Check-up's browser does
 *   (`browser.ts` tunnelHeaders). Without it, the crawl recorded the warning page as the whole site: 1 page,
 *   no links, and findings about the warning page.
 * - A start page that is still a tunnel warning or a bot check after that is never recorded as the site: the
 *   crawl fails with a plain sentence instead of finishing "done" with the wrong page.
 */
import type { BrowserContext, Page } from 'playwright';

/** Sent on same-site requests only: they are what a tunnel's warning page waits for. */
export const TUNNEL_SKIP_HEADERS: Readonly<Record<string, string>> = {
  'X-Tunnel-Skip-AntiPhishing-Page': 'true',
  'ngrok-skip-browser-warning': '1',
};

/** The start host and its www twin, which the crawl treats as one site. */
export function siteHosts(start: URL): Set<string> {
  const host = start.hostname.toLowerCase();
  const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  return new Set([host, twin]);
}

/** True when `url` is on the audited site (same host or its www twin). Never for other sites. */
export function isAuditedSite(url: string, hosts: ReadonlySet<string>): boolean {
  try {
    return hosts.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Adds the tunnel skip headers to every request for the audited site. Installed after the request guard and
 * blockChanges, so it runs first and hands the request on (`fallback`) with the headers; the guard still
 * decides whether it is sent. Other sites never see the headers.
 */
export async function addTunnelSkipHeaders(context: Pick<BrowserContext, 'route'>, start: URL): Promise<void> {
  const hosts = siteHosts(start);
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!isAuditedSite(request.url(), hosts)) return route.fallback();
    return route.fallback({ headers: { ...request.headers(), ...TUNNEL_SKIP_HEADERS } });
  });
}

export type InterstitialKind = 'tunnel-warning' | 'bot-check';

/** Text that only a tunnel's warning page or a bot check shows. Matched on the start page only. */
const TUNNEL_MARKERS = [
  /you are about to connect to a developer tunnel/i,
  /ERR_NGROK_6024/,
  /you are about to visit.{0,200}ngrok/is,
];
const BOT_TITLE = [/^just a moment\.{0,3}$/i, /^attention required!? \| cloudflare$/i];
const BOT_TEXT = [/checking your browser before accessing/i, /enable javascript and cookies to continue/i];

/** What the start page is, when it is not the site: a tunnel's warning page or a bot check. Null otherwise. */
export function classifyInterstitial(page: { title: string; text: string }): InterstitialKind | null {
  const title = page.title.trim();
  const text = page.text.slice(0, 8000);
  if (TUNNEL_MARKERS.some((re) => re.test(text) || re.test(title))) return 'tunnel-warning';
  if (BOT_TITLE.some((re) => re.test(title)) || BOT_TEXT.some((re) => re.test(text))) return 'bot-check';
  return null;
}

/** Reads the open page's title and visible text, for classifyInterstitial. Empty strings when it cannot. */
export async function readInterstitialSignals(
  page: Pick<Page, 'title' | 'evaluate'>
): Promise<{ title: string; text: string }> {
  const title = await page.title().catch(() => '');
  const text = await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 8000)).catch(() => '');
  return { title, text };
}

const BLOCKED_TEXT: Record<InterstitialKind, string> = {
  'tunnel-warning':
    "The address showed the tunnel's warning page instead of the website. Check that the tunnel allows anonymous access and that the app behind it is running, then start the audit again.",
  'bot-check':
    'The website showed a bot check instead of its pages, so it blocks automated visitors. A Website Audit cannot read it.',
};

/** The start page was a tunnel warning or a bot check, so the audit read nothing of the site. Plain message. */
export class AuditCrawlBlockedError extends Error {
  readonly kind: InterstitialKind;
  constructor(kind: InterstitialKind) {
    super(BLOCKED_TEXT[kind]);
    this.name = 'AuditCrawlBlockedError';
    this.kind = kind;
  }
}
