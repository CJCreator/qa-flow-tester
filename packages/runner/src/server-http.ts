import http from 'http';
import { timingSafeEqual } from 'crypto';
import zlib from 'zlib';
import { LOOPBACK_HOSTS } from './session/checkup-session.js';

/**
 * Holds a response's head until its body is known, so a text or JSON answer over 1 KB goes out gzipped when the
 * browser accepts gzip. A response written in pieces (the live stream, a piped file) sends its head at the first
 * write, unzipped.
 */
export function gzipLargeAnswers(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return;
  const writeHead = res.writeHead.bind(res) as unknown as (...args: unknown[]) => http.ServerResponse;
  const write = res.write.bind(res) as unknown as (...args: unknown[]) => boolean;
  const end = res.end.bind(res) as unknown as (...args: unknown[]) => http.ServerResponse;
  let head: unknown[] | null = null;
  // Sends the held head, or the implicit one when a route only set headers.
  const sendHead = (): void => {
    if (head) {
      const args = head;
      head = null;
      writeHead(...args);
    } else if (!res.headersSent) {
      writeHead(res.statusCode);
    }
  };
  const headerObject = (): Record<string, unknown> | undefined =>
    head?.find((a): a is Record<string, unknown> => typeof a === 'object' && a !== null && !Array.isArray(a));
  res.writeHead = ((...args: unknown[]) => {
    head = args;
    return res;
  }) as unknown as typeof res.writeHead;
  res.write = ((...args: unknown[]) => {
    sendHead();
    return write(...args);
  }) as unknown as typeof res.write;
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    const body = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.isBuffer(chunk) ? chunk : undefined;
    const given = headerObject();
    const typeKey = Object.keys(given ?? {}).find((k) => k.toLowerCase() === 'content-type');
    const type = String(typeKey ? given?.[typeKey] : (res.getHeader('Content-Type') ?? ''));
    if (body && body.length > 1024 && /^(text\/|application\/(json|javascript)|image\/svg)/.test(type)) {
      const zipped = zlib.gzipSync(body);
      if (given) for (const key of Object.keys(given)) if (key.toLowerCase() === 'content-length') delete given[key];
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', zipped.length);
      res.setHeader('Vary', 'Accept-Encoding');
      sendHead();
      return end(zipped);
    }
    sendHead();
    return end(chunk, ...rest);
  }) as unknown as typeof res.end;
}

/** The Host header names this computer. A page that points a name it controls at this port (DNS rebinding) doesn't. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOOPBACK_HOSTS.includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** The cookie that carries the access key once a shared link has been opened. */
export const ACCESS_COOKIE = 'qa_access';

/** One cookie's value from a Cookie header. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const at = part.indexOf('=');
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Compared in constant time, so how long a refusal takes says nothing about the key. */
export function matchesSecret(given: string | null | undefined, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

