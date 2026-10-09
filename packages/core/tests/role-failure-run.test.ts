import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { TestCase } from '@qa/types';
import { FlowTestOrchestrator } from '../src/orchestrator.js';

const LOGIN_FORM = `<form method="post" action="/login">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="password">Password</label><input id="password" name="password" type="password">
  <button type="submit">Sign in</button>
</form>`;
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

describe('A role that cannot sign in is not tested', () => {
  const PORT = 3512;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-role-failure-run');
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const signedIn = (req.headers.cookie || '').includes('session=ok');
      const send = (html: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      };
      if (url.pathname === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (new URLSearchParams(body).get('password') === 'good') {
            res.writeHead(302, { 'Set-Cookie': 'session=ok; Path=/', Location: '/account' });
            res.end();
          } else send(page('Sign in', '<p role="alert">Wrong email or password</p>' + LOGIN_FORM));
        });
        return;
      }
      if (url.pathname === '/login') return send(page('Sign in', LOGIN_FORM));
      if (url.pathname === '/account') {
        if (!signedIn) {
          res.writeHead(302, { Location: '/login' });
          return res.end();
        }
        return send(page('My account', '<p>Hello member</p>'));
      }
      send(page('Home', '<a href="/account">Account</a>'));
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  const testFor = (id: string, role: string): TestCase => ({
    id,
    requirementId: `REQ-${id}`,
    flowId: `flow-${id}`,
    name: `Account page as ${role}`,
    role,
    startPage: '/account',
    steps: [{ action: 'wait', name: 'Look at the page' }],
    expectations: { text: { contains: 'Hello member' } },
  });

  it('skips the failed role with a plain reason, runs the others, and lists it under rolesNotTested', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const report = await new FlowTestOrchestrator().run({
        targetUrl: baseUrl,
        productId: 'gated',
        specTestCases: [testFor('TC-1', 'member'), testFor('TC-2', 'viewer')],
        profile: {
          name: 'Gated',
          productId: 'gated',
          roles: [
            { role: 'member', username: 'm@example.com', password: 'good', loginPath: '/login' },
            { role: 'viewer', username: 'v@example.com', password: 'badpass', loginPath: '/login' },
          ],
        },
        headless: true,
        outputDir,
        breakpoints: ['1440px'],
        repoRoot: process.cwd(),
        enableA11y: false,
        recordVideo: false,
      });

      const viewer = report.results.find((r) => r.testCaseId === 'TC-2')!;
      expect(viewer.status).toBe('Skipped');
      expect(viewer.skipReason).toBe(
        'Not tested: The username or password was not accepted. Check them and try again.'
      );
      expect(viewer.stepEvidence).toHaveLength(0);
      const member = report.results.find((r) => r.testCaseId === 'TC-1')!;
      // Ran for real (other checks may still flag the plain test page); it was not skipped.
      expect(member.status).not.toBe('Skipped');
      expect(member.stepEvidence.length).toBeGreaterThan(0);
      expect(report.rolesNotTested).toEqual([
        {
          role: 'viewer',
          reason: 'wrong-details',
          text: 'The username or password was not accepted. Check them and try again.',
        },
      ]);
      expect(report.notes?.join('\n')).not.toContain('ran signed out');
      expect(report.notes).toContain(`Signing in as "viewer" didn't work, so that role was not tested.`);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  }, 120000);
});
