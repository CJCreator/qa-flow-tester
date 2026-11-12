import http from 'http';
import net from 'net';
import { isPublicAddress } from './address-class.js';
import { getBrowserPolicy } from './browser.js';
import { defaultNetDeps, resolvePublic, type NetDeps } from './safe-net.js';

/**
 * The egress proxy for Chromium on a shared machine (ADR 0045). Node only. Every browser connection goes
 * here; the proxy resolves each host afresh, requires a public address and connects to that checked address,
 * so the browser never resolves a name itself. Refused hosts get 403. Only `127.0.0.1` is listened on.
 */

export interface EgressProxy {
  /** `http://127.0.0.1:<port>`, for Playwright's `proxy.server`. */
  url: string;
  close(): Promise<void>;
}

export interface EgressProxyOptions {
  /** DNS lookup (tests pass a fake). Default: safe-net's lookup. */
  lookup?: NetDeps['lookup'];
  /** Opens the TCP connection to a checked address (tests point it at a loopback server). Default: net.connect. */
  connect?: (address: string, port: number) => net.Socket;
  /** Most connections open at once; more are answered 503. Default 256. */
  maxOpen?: number;
}

const CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OPEN = 256;

function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase();
}

/**
 * The address to connect to for a host, or null when refused. A pin from the shared policy is used only if it
 * is public. Otherwise the name is resolved now: no cache, so each connection is checked on its own.
 */
async function checkedAddress(host: string, lookup: NetDeps['lookup']): Promise<string | null> {
  const h = normalizeHost(host);
  const pinned = getBrowserPolicy()?.pinned?.[h];
  if (pinned) return isPublicAddress(pinned) ? pinned : null;
  const result = await resolvePublic(h, { lookup });
  return result.ok ? result.address : null;
}

/** Parses `host:port` (CONNECT target). A missing or out-of-range port is null. */
function parseHostPort(target: string | undefined): { host: string; port: number } | null {
  const m = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(target ?? '');
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  return { host: m[1], port };
}

export async function startEgressProxy(opts: EgressProxyOptions = {}): Promise<EgressProxy> {
  const lookup = opts.lookup ?? defaultNetDeps.lookup;
  const connect = opts.connect ?? ((address: string, port: number) => net.connect(port, address));
  const maxOpen = opts.maxOpen ?? DEFAULT_MAX_OPEN;
  const sockets = new Set<net.Socket>();
  const server = http.createServer();

  const noop = () => {};
  const overLimit = () => sockets.size > maxOpen;

  server.on('connection', (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('error', noop);
    socket.once('close', () => sockets.delete(socket));
  });

  // HTTPS and WSS (and WS, which Chromium also tunnels) arrive as CONNECT.
  server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    const refuse = (status: string) => {
      if (!client.destroyed) client.end(`HTTP/1.1 ${status}\r\n\r\n`);
    };
    if (overLimit()) return refuse('503 Service Unavailable');
    const target = parseHostPort(req.url);
    if (!target) return refuse('400 Bad Request');
    void checkedAddress(target.host, lookup).then((address) => {
      if (!address) return refuse('403 Forbidden');
      if (client.destroyed) return;
      const upstream = connect(address, target.port);
      upstream.on('error', noop);
      let connected = false;
      const timer = setTimeout(() => {
        refuse('504 Gateway Timeout');
        upstream.destroy();
      }, CONNECT_TIMEOUT_MS);
      upstream.once('connect', () => {
        connected = true;
        clearTimeout(timer);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.once('error', () => {
        clearTimeout(timer);
        if (!connected) refuse('502 Bad Gateway');
        client.destroy();
      });
      upstream.once('close', () => {
        clearTimeout(timer);
        client.destroy();
      });
      client.once('close', () => upstream.destroy());
    });
  });

  // Plain http: in absolute form. Other schemes are refused.
  server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    const answer = (status: number) => {
      if (!res.headersSent) res.writeHead(status);
      res.end();
    };
    if (overLimit()) return answer(503);
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      return answer(400);
    }
    if (url.protocol !== 'http:') return answer(400);
    const port = url.port ? Number(url.port) : 80;
    void checkedAddress(url.hostname, lookup).then((address) => {
      if (!address) return answer(403);
      const headers: http.IncomingHttpHeaders = { ...req.headers };
      delete headers['proxy-connection'];
      delete headers['proxy-authorization'];
      // The absolute-form URL names the host; the Host header follows it, whatever the client sent.
      headers.host = url.host;
      const upstream = http.request({
        method: req.method,
        path: url.pathname + url.search,
        headers,
        setHost: false,
        createConnection: () => connect(address, port),
      });
      upstream.on('response', (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      });
      upstream.on('error', () => answer(502));
      req.pipe(upstream);
    });
  });

  // Chromium tunnels WebSockets with CONNECT, so a plain upgrade is unexpected: refused.
  server.on('upgrade', (_req: http.IncomingMessage, socket: net.Socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.unref();
  const port = (server.address() as net.AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
