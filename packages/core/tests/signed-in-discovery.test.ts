import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { MockAIProvider } from '../src/ai/providers/mock.js';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';

/** Plans no journeys; the page and menu planner gets the mock's plan, so only exploration is under test. */
class EmptyPlanAI implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  readonly prompts: string[] = [];
  private planner = new MockAIProvider();
  async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    this.prompts.push(prompt);
    if (!prompt.includes('synthesizing application flows')) return this.planner.generateText(messages, options);
    return JSON.stringify({ flows: [] });
  }
}

const USERS: Record<string, { password: string; role: string }> = {
  'member@example.com': { password: 'member-pass', role: 'member' },
  'admin@example.com': { password: 'admin-pass', role: 'admin' },
};

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><nav><a href="/">Home</a></nav><main><h1>${title}</h1>${body}</main></body></html>`;

function sessionRole(req: http.IncomingMessage): string | null {
  const m = (req.headers.cookie || '').match(/session=(\w+)/);
  return m ? m[1] : null;
}

function createSite(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const role = sessionRole(req);
    const send = (html: string, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'text/html' });
      res.end(html);
    };
    const gate = () => {
      res.writeHead(302, { Location: '/login' });
      res.end();
    };

    if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const user = USERS[form.get('email') || ''];
        if (user && user.password === form.get('password')) {
          res.writeHead(302, { 'Set-Cookie': `session=${user.role}; Path=/`, Location: '/account' });
          res.end();
        } else {
          send(page('Sign in', '<p role="alert">Wrong email or password</p>' + LOGIN_FORM));
        }
      });
      return;
    }

    switch (url.pathname) {
      case '/':
        return send(page('Welcome', '<a href="/login">Sign in</a> <a href="/account">My account</a>'));
      case '/login':
        return send(page('Sign in', LOGIN_FORM));
      case '/logout':
        res.writeHead(302, { 'Set-Cookie': 'session=; Path=/; Max-Age=0', Location: '/' });
        return res.end();
      case '/account':
        if (!role) return gate();
        return send(
          page(
            'My account',
            `<a href="/orders">Orders</a>
             <a href="#" id="settings-link" onclick="location.href='/settings'; return false;">Settings</a>
             ${role === 'admin' ? '<a href="/admin">Admin</a>' : ''}
             <a href="/logout">Log out</a>
             <button id="delete-account" onclick="location.href='/deleted'">Delete account</button>`
          )
        );
      case '/orders':
        return role ? send(page('Orders', '<p>No orders yet</p>')) : gate();
      case '/settings':
        return role ? send(page('Settings', '<label for="nick">Nickname</label><input id="nick">')) : gate();
      case '/admin':
        return role === 'admin' ? send(page('Admin', '<p>Users</p>')) : gate();
      case '/deleted':
        return send(page('Deleted', '<p>Your account was deleted</p>'));
      default:
        return send('Not found', 404);
    }
  });
}

const LOGIN_FORM = `<form method="post" action="/login">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="password">Password</label><input id="password" name="password" type="password">
  <button type="submit">Sign in</button>
</form>`;

describe('Discovery explores signed in', () => {
  const PORT = 3504;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-signed-in-discovery');
  let server: http.Server;

  beforeAll(async () => {
    server = createSite();
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('without a sign-in, lists the sign-in page and says what was not reached', async () => {
    const draft = await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'gated',
      outputDir: path.join(outputDir, 'signed-out'),
      aiProvider: new EmptyPlanAI(),
    });

    expect(draft.pages.map((p) => p.urlPath).sort()).toEqual(['/', '/login']);
    expect(draft.exploration?.signInPages).toEqual(['/login']);
    expect(draft.exploration?.notReached).toEqual(['/account']);
    expect(draft.exploration?.notes).toEqual([
      'Pages behind the sign-in were not reached (/account). Add a sign-in to test them.',
    ]);
  }, 60000);

  it('explores as each role, records who reached what, and never logs itself out or clicks risky buttons', async () => {
    const ai = new EmptyPlanAI();
    const draft = await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'gated',
      outputDir: path.join(outputDir, 'roles'),
      aiProvider: ai,
      profile: {
        name: 'Gated',
        productId: 'gated',
        roles: [
          { role: 'member', username: 'member@example.com', password: 'member-pass', loginPath: '/login' },
          { role: 'admin', username: 'admin@example.com', password: 'admin-pass', loginPath: '/login' },
        ],
      },
    });

    const reachedBy = Object.fromEntries(draft.pages.map((p) => [p.urlPath, p.reachedBy]));
    expect(reachedBy['/account']).toEqual(['member', 'admin']);
    expect(reachedBy['/orders']).toEqual(['member', 'admin']);
    expect(reachedBy['/settings']).toEqual(['member', 'admin']); // only reachable through a script-driven link
    expect(reachedBy['/admin']).toEqual(['admin']);
    expect(reachedBy['/logout']).toBeUndefined();
    expect(reachedBy['/deleted']).toBeUndefined();
    expect(draft.exploration).toMatchObject({
      signedInAs: ['member', 'admin'],
      signInFailed: [],
      notReached: [],
      notes: [],
    });
    expect(ai.prompts.find((p) => p.includes('synthesizing application flows'))).toContain(
      'Page /admin — "Admin" (reached by: admin)'
    );
  }, 90000);

  it('says so when a role cannot sign in', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const draft = await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'gated',
      outputDir: path.join(outputDir, 'wrong-password'),
      aiProvider: new EmptyPlanAI(),
      profile: {
        name: 'Gated',
        productId: 'gated',
        roles: [{ role: 'member', username: 'member@example.com', password: 'wrong', loginPath: '/login' }],
      },
    });
    warn.mockRestore();

    expect(draft.exploration?.signInFailed).toEqual(['member']);
    expect(draft.exploration?.notes).toContain(
      'Signing in as "member" didn\'t work, so nothing was explored as that role. Check its username, password and sign-in page.'
    );
  }, 60000);
});
