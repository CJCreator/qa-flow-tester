import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, type AuditSettingsReply } from '@qa/types';
import { auditSettingsDefaults, createLocalAuditStoreBackend } from '@qa/core';
import {
  auditSettingsRoutes,
  auditSettingsStoreOn,
  AUDIT_SETTINGS_KEY,
  type AuditSettingsDeps,
  type PagespeedKeyPort,
} from '../src/routes/audit-settings.js';
import { authorizeRoute, resolveRoute, type Route } from '../src/routes/route.js';

class MockResponse {
  statusCode = 200;
  body = '';
  writeHead(status: number) {
    this.statusCode = status;
    return this;
  }
  setHeader() {
    return this;
  }
  end(chunk?: unknown) {
    if (chunk) this.body += String(chunk);
    return this;
  }
  json<T = any>(): T {
    return JSON.parse(this.body) as T;
  }
}

function mockRequest(body: unknown, method = 'PUT'): http.IncomingMessage {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from([Buffer.from(payload, 'utf8')]) as unknown as http.IncomingMessage;
  req.method = method;
  req.headers = { 'content-type': 'application/json' };
  return req;
}

class FakeKeyPort implements PagespeedKeyPort {
  key: string | null = null;
  calls: (string | null)[] = [];
  async saved() {
    return this.key !== null;
  }
  async save(key: string | null) {
    this.calls.push(key);
    this.key = key;
  }
}

const OPT_OUT_TEXT_EN = auditSettingsDefaults().optOutText.en;
const OPT_OUT_TEXT_TA = auditSettingsDefaults().optOutText.ta;
const SECRET = 'AIza-test-pagespeed-key-1234567890';

let dataDir: string;
let port: FakeKeyPort;

function depsFor(): AuditSettingsDeps {
  // A fresh backend and route instance each time, over the same folder (a reopen or restart).
  return { settings: auditSettingsStoreOn(createLocalAuditStoreBackend(dataDir)), pagespeedKey: port };
}

function rowFor(routes: Route[], method: string): Route {
  const match = resolveRoute(routes, method, '/api/audit-settings');
  if (!match) throw new Error(`no ${method} row`);
  return match.route;
}

async function call(deps: AuditSettingsDeps, method: 'GET' | 'PUT', body?: unknown): Promise<MockResponse> {
  const res = new MockResponse();
  const req = method === 'PUT' ? mockRequest(body) : mockRequest('', 'GET');
  await rowFor(auditSettingsRoutes(deps), method).handle({
    server: undefined as never,
    req,
    res: res as unknown as http.ServerResponse,
    url: new URL('http://localhost/api/audit-settings'),
    params: {},
  });
  return res;
}

async function storedFileText(): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(await fs.readFile(full, 'utf8'));
    }
  }
  await walk(dataDir);
  return files.join('\n');
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-settings-'));
  port = new FakeKeyPort();
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('audit settings routes', () => {
  it('declare GET and PUT /api/audit-settings with access owner from AUDIT_API, closed in beta', () => {
    const routes = auditSettingsRoutes(depsFor());
    const get = rowFor(routes, 'GET');
    const put = rowFor(routes, 'PUT');
    expect(get.path).toBe(AUDIT_API.getSettings.path);
    expect(put.path).toBe(AUDIT_API.putSettings.path);
    expect(get.access).toBe('owner');
    expect(put.access).toBe('owner');
    expect(get.access).toBe(AUDIT_API.getSettings.access);
    expect(put.access).toBe(AUDIT_API.putSettings.access);
    for (const row of [get, put]) {
      expect(authorizeRoute(row, { hasAccessKey: false, beta: false, helper: () => true }).allow).toBe(false);
      expect(authorizeRoute(row, { hasAccessKey: true, beta: false }).allow).toBe(true);
      expect(authorizeRoute(row, { hasAccessKey: true, beta: true }).allow).toBe(false);
    }
  });

  it('GET with nothing saved returns the defaults and the defaults block', async () => {
    const res = await call(depsFor(), 'GET');
    expect(res.statusCode).toBe(200);
    const reply = res.json<AuditSettingsReply>();
    const defaults = auditSettingsDefaults();
    expect(reply.defaults).toEqual(defaults);
    expect(reply.settings.proposalTemplate).toBe(defaults.proposalTemplate);
    expect(reply.settings.optOutText.en).toBe(OPT_OUT_TEXT_EN);
    expect(reply.settings.optOutText.ta).toBe(OPT_OUT_TEXT_TA);
    expect(reply.settings.company.name).toBe('');
    expect(reply.settings.pagespeedKeySaved).toBe(false);
  });

  it('keeps an edited Proposal template and company details after reopening over the same store (REQ-027 AC-1)', async () => {
    const template = '# Proposal for {{site_name}}\n\nEdited by the tool user.';
    const put = await call(depsFor(), 'PUT', {
      proposalTemplate: template,
      company: { name: 'Acme Web', email: 'hi@acme.test' },
    });
    expect(put.statusCode).toBe(200);
    const putReply = put.json<AuditSettingsReply>();
    expect(putReply.settings.proposalTemplate).toBe(template);
    expect(putReply.defaults).toEqual(auditSettingsDefaults());

    const reopened = await call(depsFor(), 'GET');
    const reply = reopened.json<AuditSettingsReply>();
    expect(reply.settings.proposalTemplate).toBe(template);
    expect(reply.settings.company).toMatchObject({ name: 'Acme Web', email: 'hi@acme.test', phone: '' });
    // PUT reply has the same shape as GET.
    expect(Object.keys(putReply).sort()).toEqual(Object.keys(reply).sort());
    expect(putReply).toEqual(reply);

    // null puts the default template back.
    await call(depsFor(), 'PUT', { proposalTemplate: null });
    const reset = (await call(depsFor(), 'GET')).json<AuditSettingsReply>();
    expect(reset.settings.proposalTemplate).toBe(auditSettingsDefaults().proposalTemplate);
    expect(reset.settings.company.name).toBe('Acme Web');
  });

  it('returns saved English and Tamil opt-out text; null puts the default back', async () => {
    const en = 'Reply STOP and we will not write again.';
    const ta = 'மீண்டும் தொடர்பு வேண்டாம் என்றால் சொல்லுங்கள்.';
    await call(depsFor(), 'PUT', { optOutText: { en, ta } });
    let reply = (await call(depsFor(), 'GET')).json<AuditSettingsReply>();
    expect(reply.settings.optOutText).toMatchObject({ en, ta });

    await call(depsFor(), 'PUT', { optOutText: { ta: null } });
    reply = (await call(depsFor(), 'GET')).json<AuditSettingsReply>();
    expect(reply.settings.optOutText.en).toBe(en);
    expect(reply.settings.optOutText.ta).toBe(OPT_OUT_TEXT_TA);

    await call(depsFor(), 'PUT', { optOutText: { en: null } });
    reply = (await call(depsFor(), 'GET')).json<AuditSettingsReply>();
    expect(reply.settings.optOutText.en).toBe(OPT_OUT_TEXT_EN);
  });

  it('hands pagespeedKey only to the key port: never stored with the settings, never in a reply', async () => {
    const put = await call(depsFor(), 'PUT', { pagespeedKey: SECRET, company: { name: 'Acme' } });
    expect(put.statusCode).toBe(200);
    expect(port.calls).toEqual([SECRET]);
    expect(put.body).not.toContain(SECRET);
    expect(put.body).not.toContain('pagespeedKey"');
    expect(put.json<AuditSettingsReply>().settings.pagespeedKeySaved).toBe(true);

    const stored = await storedFileText();
    expect(stored).toContain('Acme');
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('pagespeedKey');

    const get = await call(depsFor(), 'GET');
    expect(get.body).not.toContain(SECRET);
    expect(get.json<AuditSettingsReply>().settings.pagespeedKeySaved).toBe(true);

    // null removes the key through the port.
    const removed = await call(depsFor(), 'PUT', { pagespeedKey: null });
    expect(port.calls).toEqual([SECRET, null]);
    expect(removed.json<AuditSettingsReply>().settings.pagespeedKeySaved).toBe(false);
  });

  it('does not call the key port when pagespeedKey is not sent', async () => {
    await call(depsFor(), 'PUT', { rewriteOverlapWords: 12 });
    expect(port.calls).toEqual([]);
    expect((await call(depsFor(), 'GET')).json<AuditSettingsReply>().settings.rewriteOverlapWords).toBe(12);
  });

  it('refuses an invalid body with 400 ERR_INVALID_REQUEST per field and keeps the stored settings', async () => {
    await call(depsFor(), 'PUT', { company: { name: 'Kept Ltd' }, proposalTemplate: '# Kept' });
    const before = await storedFileText();

    const res = await call(depsFor(), 'PUT', {
      proposalTemplate: '',
      rewriteOverlapWords: 0,
      optOutText: { xx: 'hello' },
      company: { name: 'Changed', fax: '1' },
      pagespeedKey: SECRET,
      extra: true,
    });
    expect(res.statusCode).toBe(400);
    const reply = res.json<{ code: string; error: string; fields: Record<string, string> }>();
    expect(reply.code).toBe('ERR_INVALID_REQUEST');
    expect(Object.keys(reply.fields).sort()).toEqual(
      ['company.fax', 'extra', 'optOutText.xx', 'proposalTemplate', 'rewriteOverlapWords'].sort()
    );
    expect(res.body).not.toContain(SECRET);
    expect(port.calls).toEqual([]);
    expect(await storedFileText()).toBe(before);
    const reread = (await call(depsFor(), 'GET')).json<AuditSettingsReply>();
    expect(reread.settings.company.name).toBe('Kept Ltd');
    expect(reread.settings.proposalTemplate).toBe('# Kept');
  });

  it('refuses a bad pagespeedKey without echoing it', async () => {
    const res = await call(depsFor(), 'PUT', { pagespeedKey: 'x'.repeat(600) });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fields: Record<string, string> }>().fields).toHaveProperty('pagespeedKey');
    expect(res.body).not.toContain('x'.repeat(600));
    expect(port.calls).toEqual([]);
  });

  it('refuses malformed JSON, a non-object and an over-long body with ERR_INVALID_REQUEST', async () => {
    for (const body of ['{not json', '[1,2]', 'null']) {
      const res = await call(depsFor(), 'PUT', body);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ code: string }>().code).toBe('ERR_INVALID_REQUEST');
    }
    const huge = await call(depsFor(), 'PUT', { proposalTemplate: 'a'.repeat(250_000) });
    expect(huge.statusCode).toBe(400);
    expect(huge.json<{ code: string }>().code).toBe('ERR_INVALID_REQUEST');
    expect(await storedFileText()).toBe('');
  });

  it('reads a damaged or hand-edited stored object as the defaults, and never returns a stored key', async () => {
    const backend = createLocalAuditStoreBackend(dataDir);
    await backend.putJson(AUDIT_SETTINGS_KEY, { proposalTemplate: 42, pagespeedKey: SECRET });
    let res = await call(depsFor(), 'GET');
    expect(res.statusCode).toBe(200);
    expect(res.json<AuditSettingsReply>().settings.proposalTemplate).toBe(auditSettingsDefaults().proposalTemplate);
    expect(res.body).not.toContain(SECRET);

    await backend.putJson(AUDIT_SETTINGS_KEY, { proposalTemplate: '# Ok', pagespeedKey: SECRET });
    res = await call(depsFor(), 'GET');
    expect(res.json<AuditSettingsReply>().settings.proposalTemplate).toBe('# Ok');
    expect(res.body).not.toContain(SECRET);
  });

  it('serialises concurrent PUTs so neither change is lost', async () => {
    const deps = depsFor();
    const [a, b] = await Promise.all([
      call(deps, 'PUT', { company: { name: 'Both' } }),
      call(deps, 'PUT', { proposalTemplate: '# Both' }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const reply = (await call(depsFor(), 'GET')).json<AuditSettingsReply>();
    expect(reply.settings.company.name).toBe('Both');
    expect(reply.settings.proposalTemplate).toBe('# Both');
  });

  it('answers a store or key-port failure with a fixed 500 message that carries no key or internals', async () => {
    const failingPort: PagespeedKeyPort = {
      saved: async () => false,
      save: async () => {
        throw new Error(`keychain failed for ${SECRET} at C:\\secret\\path`);
      },
    };
    const deps: AuditSettingsDeps = {
      settings: auditSettingsStoreOn(createLocalAuditStoreBackend(dataDir)),
      pagespeedKey: failingPort,
    };
    const res = await call(deps, 'PUT', { pagespeedKey: SECRET, company: { name: 'Nope' } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toContain('secret');
    expect(await storedFileText()).toBe('');

    const brokenStore: AuditSettingsDeps = {
      settings: { load: async () => Promise.reject(new Error('EACCES /data/x')), save: async () => undefined },
      pagespeedKey: port,
    };
    const get = await call(brokenStore, 'GET');
    expect(get.statusCode).toBe(500);
    expect(get.body).not.toContain('EACCES');
  });
});
