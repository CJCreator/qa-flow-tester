import type http from 'http';

/** The largest JSON request accepted (characters). Plans are the biggest, and stay far below this. */
export const MAX_BODY_CHARS = 5_000_000;

export async function readJsonBody<T>(req: http.IncomingMessage, maxChars: number = MAX_BODY_CHARS): Promise<T> {
  // Decode as one UTF-8 stream: joining Buffer chunks one by one breaks a character split across two.
  if (typeof req.setEncoding === 'function') req.setEncoding('utf8');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxChars) throw new Error('Request body too large');
  }
  return JSON.parse(body) as T;
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
