import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  parseOpenApi,
  generateApiChecks,
  runApiChecks,
  apiChecksSection,
  NO_SPEC_NOTE,
  MIN_ERROR_SHARE,
} from '../src/api-spec-checks.js';

const spec = {
  openapi: '3.0.0',
  security: [{ bearer: [] }],
  paths: {
    '/items': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
              },
            },
          },
        },
      },
      post: {
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
        responses: { '201': {} },
      },
    },
    '/items/{id}': {
      get: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'integer', format: 'int64', example: 1 }, name: { type: 'string', maxLength: 20 } },
      },
    },
  },
};

let server: http.Server | undefined;
const seen: Array<{ method: string; url: string; auth?: string }> = [];
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  seen.length = 0;
});
async function start(h: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization });
    h(req, res);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('api spec checks', () => {
  it('with no spec generates nothing and says so', async () => {
    const plan = generateApiChecks(undefined);
    expect(plan.checks).toEqual([]);
    expect(plan.notChecked).toEqual([NO_SPEC_NOTE]);
    const r = await runApiChecks(plan, { baseUrl: 'http://127.0.0.1:1' });
    expect(apiChecksSection(r)).toEqual([NO_SPEC_NOTE]);
  });

  it('rejects a non-OpenAPI or non-JSON file with a plain sentence', () => {
    expect(parseOpenApi('openapi: 3.0.0').error).toContain('not JSON');
    expect(parseOpenApi('{"a":1}').error).toContain('not an OpenAPI');
    expect(parseOpenApi(JSON.stringify(spec)).spec).toBeDefined();
  });

  it('is negative-first: at least 40% error cases, writes marked', () => {
    const plan = generateApiChecks(spec);
    expect(plan.errorShare).toBeGreaterThanOrEqual(MIN_ERROR_SHARE);
    expect(plan.checks.filter((c) => c.kind === 'error').length).toBeGreaterThan(
      plan.checks.filter((c) => c.kind === 'happy').length - 1
    );
    expect(plan.checks.filter((c) => c.method === 'POST').every((c) => c.sends)).toBe(true);
    expect(plan.checks.some((c) => c.description.includes('sent without sign-in'))).toBe(true);
    expect(plan.checks.some((c) => c.description.includes('required field "name" left out'))).toBe(true);
  });

  it('sends GET only without write consent and flags a bad shape and accepted bad input', async () => {
    const url = await start((req, res) => {
      if (req.url === '/items') return json(res, 200, [{ id: 'x', name: 'a' }]); // id has wrong type
      if (req.url?.startsWith('/items/')) return json(res, 200, { id: 1, name: 'a' }); // accepts any id
      json(res, 404, {});
    });
    const r = await runApiChecks(generateApiChecks(spec), { baseUrl: url });
    expect(new Set(seen.map((s) => s.method))).toEqual(new Set(['GET']));
    expect(r.skippedWrites).toBeGreaterThan(0);
    expect(r.notChecked.some((l) => l.includes('not sent'))).toBe(true);
    expect(r.findings.some((f) => f.title.startsWith('Answer does not match the documented shape'))).toBe(true);
    expect(r.findings.some((f) => f.title.startsWith('Bad input accepted'))).toBe(true);
  });

  it('flags a 5xx on bad input and passes a well-behaved API', async () => {
    const good = await start((req, res) => {
      if (req.url === '/items') return json(res, 200, [{ id: 1, name: 'a' }]);
      if (req.url === '/items/1') return json(res, 200, { id: 1, name: 'a' });
      json(res, 404, {});
    });
    const ok = await runApiChecks(generateApiChecks(spec), { baseUrl: good, authHeader: 'Bearer s3cret-token-value' });
    expect(ok.findings.filter((f) => !f.title.startsWith('Bad input accepted'))).toEqual([]);
    await new Promise<void>((r) => server!.close(() => r()));
    const bad = await start((req, res) => json(res, req.url === '/items' ? 200 : 500, []));
    const r = await runApiChecks(generateApiChecks(spec), { baseUrl: bad });
    expect(r.findings.some((f) => f.title.startsWith('Server error on bad input'))).toBe(true);
  });

  it('sends the sign-in header but never puts it in a finding', async () => {
    const secret = 'Bearer s3cret-token-value';
    const url = await start((_req, res) => json(res, 500, { echo: secret }));
    const r = await runApiChecks(generateApiChecks(spec), { baseUrl: url, authHeader: secret });
    expect(seen.some((s) => s.auth === secret)).toBe(true);
    expect(seen.some((s) => s.auth === undefined)).toBe(true); // the no-sign-in case
    expect(r.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain('s3cret-token-value');
  });

  it('sends write checks only when writes are allowed', async () => {
    const url = await start((_req, res) => json(res, 400, {}));
    const r = await runApiChecks(generateApiChecks(spec), { baseUrl: url, allowWrites: true });
    expect(seen.some((s) => s.method === 'POST')).toBe(true);
    expect(r.skippedWrites).toBe(0);
  });
});
