import http from 'http';
import path from 'path';
import { promises as fs } from 'fs';

/** The static Website audit fixture (Kaveri Sweets, a WordPress-style local business site). */
export const AUDIT_SITE_ROOT = path.resolve(__dirname, '../../../../fixtures/audit-site');

/** Where each scenario of the fixture lives, so tests name pages by purpose rather than by path. */
export const AUDIT_SITE_PAGES = {
  home: '/',
  about: '/about',
  services: '/services',
  /** Same title and meta description as duplicateB, different main text. */
  duplicateA: '/services/catering',
  duplicateB: '/services/party-orders',
  /** Images without alt text. */
  gallery: '/gallery',
  /** Text and links inserted by JavaScript; the link target is linked from nowhere else. */
  jsRendered: '/updates',
  jsOnlyTarget: '/updates/festival-hours',
  tamil: '/ta',
  hindi: '/hi',
  signIn: '/account/sign-in',
  shop: '/shop',
  /** Payment area: card-number field. */
  checkout: '/shop/checkout',
  /** Linked only from the checkout page. */
  checkoutOnlyTarget: '/shop/delivery-terms',
  blog: '/blog',
  /** Four and five link steps from the home page. */
  depth4: '/blog/2025/diwali/sweets',
  depth5: '/blog/2025/diwali/sweets/kaju-katli',
  /** Disallowed by robots.txt and linked from the footer. */
  privateLinked: '/private/staff-rota',
  /** Disallowed by robots.txt and listed only in sitemap.xml. */
  privateSitemapOnly: '/private/reports',
  /** Listed in sitemap.xml, linked from no page. */
  sitemapOnly: '/seasonal-offers',
  /** Linked from the about page; answers 404. */
  missing: '/old-price-list',
} as const;

/** Placeholder in text files, replaced with the origin the request was made to. */
export const ORIGIN_PLACEHOLDER = '{{ORIGIN}}';

export interface AuditSiteRequest {
  method: string;
  /** Path and query exactly as requested. */
  path: string;
  /** Response status; 0 until the response has finished. */
  status: number;
  userAgent: string;
  /** Milliseconds since the Unix epoch when the request arrived. */
  startedAt: number;
  /** Milliseconds since the Unix epoch when the response finished or the connection closed. */
  finishedAt?: number;
}

export interface AuditSiteServer {
  /** e.g. http://127.0.0.1:53124 */
  origin: string;
  port: number;
  url(pathAndQuery: string): string;
  /** Every request in arrival order, including robots.txt, sitemap.xml and assets. */
  readonly requests: readonly AuditSiteRequest[];
  clearRequests(): void;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Maps a URL path to a file under the root: `/a/b` → `a/b.html` or `a/b/index.html`; `/x.txt` → `x.txt`. */
async function resolveFile(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = path.resolve(root, '.' + decoded.replace(/\/+$/, ''));
  if (base !== root && !base.startsWith(root + path.sep)) return null;
  const candidates = path.extname(base) ? [base] : [base + '.html', path.join(base, 'index.html')];
  for (const file of candidates) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) return file;
  }
  return null;
}

/** Serves fixtures/audit-site on 127.0.0.1 and a port the OS picks, logging every request. */
export async function startAuditSite(): Promise<AuditSiteServer> {
  const root = AUDIT_SITE_ROOT;
  const requests: AuditSiteRequest[] = [];
  let port = 0;

  const server = http.createServer(async (req, res) => {
    const entry: AuditSiteRequest = {
      method: req.method || 'GET',
      path: req.url || '/',
      status: 0,
      userAgent: req.headers['user-agent'] || '',
      startedAt: Date.now(),
    };
    requests.push(entry);
    res.on('close', () => {
      entry.status = res.statusCode;
      entry.finishedAt = Date.now();
    });

    // No caching, so a repeated visit reaches the log instead of the browser cache.
    res.setHeader('Cache-Control', 'no-store');
    if (entry.method !== 'GET' && entry.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }

    try {
      const pathname = new URL(entry.path, 'http://fixture.local').pathname;
      const found = await resolveFile(root, pathname);
      const file = found ?? path.join(root, '404.html');
      const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
      let body: Buffer | string = await fs.readFile(file);
      if (type.includes('charset=utf-8')) {
        // The Host the client used, so sitemap and robots URLs stay on the host being crawled.
        const origin = `http://${req.headers.host || `127.0.0.1:${port}`}`;
        body = body.toString('utf8').split(ORIGIN_PLACEHOLDER).join(origin);
      }
      res.writeHead(found ? 200 : 404, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
      res.end(entry.method === 'HEAD' ? undefined : body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Fixture server error: ${String(err)}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    port,
    url: (pathAndQuery) => new URL(pathAndQuery, origin).toString(),
    requests,
    clearRequests: () => {
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
