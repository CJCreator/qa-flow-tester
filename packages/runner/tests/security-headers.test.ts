/**
 * The runner's default frame, script and transport headers (T-303): every answer carries them,
 * HSTS only over https, and a page's own writeHead headers (the Shared Link) still win.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type http from 'http';
import { applySecurityHeaders, runnerCsp, servedOverHttps } from '../src/security-headers.js';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const req = (headers: Record<string, string>, encrypted = false) =>
  ({ headers, socket: { encrypted } }) as unknown as http.IncomingMessage;

describe('runnerCsp', () => {
  it('keeps the static site policy without sign-in hosts', () => {
    const csp = runnerCsp();
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('apis.google.com');
  });

  it('adds Firebase sign-in hosts when the auth domain is known', () => {
    const csp = runnerCsp('proj.firebaseapp.com');
    expect(csp).toMatch(/script-src [^;]*https:\/\/apis\.google\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/proj\.firebaseapp\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/identitytoolkit\.googleapis\.com/);
  });
});

describe('servedOverHttps', () => {
  it('reads the forwarded proto and the socket', () => {
    expect(servedOverHttps(req({ 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(servedOverHttps(req({ 'x-forwarded-proto': 'https, http' }))).toBe(true);
    expect(servedOverHttps(req({ 'x-forwarded-proto': 'http' }))).toBe(false);
    expect(servedOverHttps(req({}))).toBe(false);
    expect(servedOverHttps(req({}, true))).toBe(true);
  });
});

describe('applySecurityHeaders', () => {
  it('sets the frame and CSP defaults with setHeader', () => {
    const headers = new Map<string, string>();
    const res = {
      setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
    } as unknown as http.ServerResponse;
    applySecurityHeaders(req({}), res, "frame-ancestors 'self'");
    expect(headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(headers.has('strict-transport-security')).toBe(false);
  });
});

describe('RunnerServer answers', () => {
  let runner: RunnerServer | undefined;

  afterEach(async () => {
    await runner?.stop();
    runner = undefined;
  });

  async function start(): Promise<string> {
    const port = await freePort();
    runner = new RunnerServer({ port });
    await runner.start();
    return `http://localhost:${port}`;
  }

  it('sends the frame and CSP headers on the API, without HSTS over http', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/runner/status`);
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('sends HSTS when the visitor reached the runner over https', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/runner/status`, { headers: { 'X-Forwarded-Proto': 'https' } });
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
  });

  it('keeps the Shared Link page own headers over the defaults', async () => {
    const base = await start();
    const linkId = 'a'.repeat(22);
    const res = await fetch(`${base}/s/${linkId}`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).not.toContain("frame-ancestors 'self'");
  });
});
