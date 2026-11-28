import type http from 'http';

/** The largest JSON request accepted (characters). Plans are the biggest, and stay far below this. */
export const MAX_BODY_CHARS = 5_000_000;

/** The request body passed its size limit: answered 413, never as a bad-JSON 400. */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

/** The fixed sentence for a 413. */
export const BODY_TOO_LARGE_MESSAGE = 'The request is too large.';

/** The request body as text; throws when it passes `maxChars` characters (or the stream fails). */
export async function readRawBody(req: http.IncomingMessage, maxChars: number = MAX_BODY_CHARS): Promise<string> {
  // Decode as one UTF-8 stream: joining Buffer chunks one by one breaks a character split across two.
  if (typeof req.setEncoding === 'function') req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxChars) throw new BodyTooLargeError();
  }
  return body;
}

export async function readJsonBody<T>(req: http.IncomingMessage, maxChars: number = MAX_BODY_CHARS): Promise<T> {
  return JSON.parse(await readRawBody(req, maxChars)) as T;
}

export function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  // A 413 stops reading the body midway, so the connection cannot carry another request: close it, or a
  // keep-alive client (every browser, Node's default agent) waits forever on its next request.
  const close = status === 413 ? { Connection: 'close' } : {};
  res.writeHead(status, { 'Content-Type': 'application/json', ...close, ...headers });
  res.end(JSON.stringify(body));
}

/**
 * The reply for a JSON body that could not be read: 413 with a fixed sentence when it was too large,
 * otherwise 400 `invalid` (default `{ error: 'Invalid JSON body' }`).
 */
export function refuseBadBody(
  res: http.ServerResponse,
  err: unknown,
  invalid: object = { error: 'Invalid JSON body' }
): void {
  if (err instanceof BodyTooLargeError) return sendJson(res, 413, { error: BODY_TOO_LARGE_MESSAGE });
  sendJson(res, 400, invalid);
}
