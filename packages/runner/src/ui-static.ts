import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type http from 'http';

/** A built single-page app served beside the API: the Wizard at "/". */
export interface UiApp {
  /** The address the app lives under, ending in "/". */
  base: string;
  /** The app's build output (Vite's dist folder), holding index.html. */
  dir: string;
  /** What to call the app when its build is missing. */
  name: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Vite fingerprints every file under assets/, so those never change and can be kept for good. */
const FOREVER = 'public, max-age=31536000, immutable';

/**
 * The Wizard build in this checkout, found from where this file sits (src/ or dist/). It's the only
 * app: QA Flow Studio was retired (ADR 0010), and the runner redirects its old addresses.
 */
export function defaultUiApps(): UiApp[] {
  const packagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return [{ base: '/', dir: path.join(packagesDir, 'wizard', 'dist'), name: 'Wizard' }];
}

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function readFileIfPresent(file: string): Promise<Buffer | null> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? await fs.readFile(file) : null;
  } catch {
    return null;
  }
}

function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  type: string,
  body: Buffer | string,
  cacheControl = 'no-cache'
): void {
  const content = typeof body === 'string' ? Buffer.from(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': content.length, 'Cache-Control': cacheControl });
  res.end(req.method === 'HEAD' ? undefined : content);
}

/**
 * Answers a request for one of the built UIs, and returns false when it isn't one, so the caller
 * can answer instead. A file in the build is sent as it is; any other page address gets the app's
 * index.html, and the app shows the right screen itself. Nothing outside a build folder is read.
 */
export async function serveUi(
  apps: UiApp[],
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  // An app's bare base ("/docs") becomes "/docs/", so its own addresses resolve inside it.
  const bare = apps.find((a) => a.base !== '/' && pathname === a.base.slice(0, -1));
  if (bare) {
    res.writeHead(308, { Location: bare.base });
    res.end();
    return true;
  }
  const app = [...apps].sort((a, b) => b.base.length - a.base.length).find((a) => pathname.startsWith(a.base));
  if (!app) return false;

  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(app.base.length));
  } catch {
    return false;
  }
  if (relative) {
    const file = path.resolve(app.dir, relative);
    if (!isInside(app.dir, file)) return false;
    const content = await readFileIfPresent(file);
    if (content) {
      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      send(req, res, 200, type, content, relative.startsWith('assets/') ? FOREVER : 'no-cache');
      return true;
    }
    // A missing file (it has an extension) is a 404, not the page.
    if (path.extname(relative)) return false;
  }

  const index = await readFileIfPresent(path.join(app.dir, 'index.html'));
  if (!index) {
    send(
      req,
      res,
      503,
      'text/html; charset=utf-8',
      `<!doctype html><meta charset="utf-8"><title>${app.name} not built</title>` +
        `<p>The ${app.name} hasn’t been built yet. Stop Release check-up and start it with <code>pnpm start</code>, which builds what’s missing.</p>`
    );
    return true;
  }
  send(req, res, 200, 'text/html; charset=utf-8', index);
  return true;
}
