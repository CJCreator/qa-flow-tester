import type * as http from 'http';

/**
 * Health check endpoints (/health, /healthz).
 * Extracted per T-23 / G35 modularization.
 */
export function handleHealthRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  if (pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : 'ok');
    return true;
  }

  if (pathname === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(
      req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) })
    );
    return true;
  }

  return false;
}
