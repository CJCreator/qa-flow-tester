import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { redactedMessage } from '../src/session/checkup-run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(path.join(here, '..', 'src', 'server.ts'), 'utf8');

describe('error messages hide every run secret', () => {
  it('hides a custom header value, tunnel authorization and a cookie value in the message', () => {
    const msg = redactedMessage(new Error('sent X-Bypass=hdr-SECRET-9931 tunnel=tunnel-SECRET-7712 sid=cookie-SECRET-4480'), {
      customHeaders: { 'X-Bypass': 'hdr-SECRET-9931' },
      tunnelAuth: 'tunnel-SECRET-7712',
      cookies: [{ name: 'sid', value: 'cookie-SECRET-4480' }],
    });
    expect(msg).not.toContain('hdr-SECRET-9931');
    expect(msg).not.toContain('tunnel-SECRET-7712');
    expect(msg).not.toContain('cookie-SECRET-4480');
  });
});

describe('GET /api/runner/status is read only', () => {
  // A source check: the handler must not call the functions that start a run or change run state.
  // A route test with a live server would show the same thing at run time.
  it('does not call begin() or ensurePlanLoaded() from the status handler', () => {
    const start = serverSource.indexOf("pathname === '/api/runner/status' && req.method === 'GET'");
    const end = serverSource.indexOf('const route = matchRoute(allRoutes', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = serverSource.slice(start, end);
    expect(handler).not.toContain('ensurePlanLoaded(');
    expect(handler).not.toContain('.begin(');
    expect(handler).not.toContain('setPhase(');
  });
});
