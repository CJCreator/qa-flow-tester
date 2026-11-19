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

  // The keep-alive call a running Check-up makes to the runner's own public address (ADR 0050, T-436): it does
  // nothing, needs no sign-in and says nothing. Cloud Run sees the traffic and keeps the instance up.
  if (pathname === '/api/runner/ping' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : '{}');
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
