/**
 * T-89 (ADR 0040): End-to-end runner flow from start to stored documents (writeAllDocuments).
 *
 * Runs a real RunnerServer against Chromium with context.route().fulfill() mock pages.
 * The test:
 * 1. Starts RunnerServer with an audit access key.
 * 2. Starts an audit via POST /api/audits.
 * 3. Streams progress events via GET /api/audits/:id/stream until 'done'.
 * 4. Verifies all 7 stored documents (structure, content, findings, roadmap, proposal,
 *    pitch-glimpse, owner-audit) exist in store via store.readAuditDocument (markdown and html).
 * 5. Verifies GET /api/audits/:id returns version status 'done' with ready documents.
 * 6. Verifies export endpoints (e.g. GET /api/audits/:id/export/proposal.md).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { AUDIT_DOCUMENT_KINDS, type AuditProgressEvent } from '@qa/types';
import { runAuditCrawl, type NetDeps, type PinnedRequest } from '@qa/core';
import { RunnerServer } from '../src/server.js';

const PORT = 3849;
const ACCESS = 'flow-test-access-token-987654321';
const ORIGIN = 'https://flow-test.example';

let scratch: string;
let server: RunnerServer;
let browser: Browser;

function makeNetDeps(): NetDeps {
  return {
    lookup: async () => ['93.184.216.34'],
    connect: async (req: PinnedRequest) => {
      if (req.url.pathname === '/robots.txt') {
        return { status: 404, headers: {}, body: 'Not found' };
      }
      if (req.url.pathname === '/sitemap.xml') {
        return { status: 404, headers: {}, body: 'Not found' };
      }
      return { status: 200, headers: {}, body: 'OK' };
    },
  };
}

function request(
  method: string,
  pathname: string,
  body?: unknown
): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: pathname,
        method,
        headers: {
          'x-qa-access': ACCESS,
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.byteLength) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json, text });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readStream(auditId: string): Promise<AuditProgressEvent[]> {
  return new Promise((resolve, reject) => {
    const events: AuditProgressEvent[] = [];
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: `/api/audits/${auditId}/stream`,
        method: 'GET',
        headers: {
          'x-qa-access': ACCESS,
        },
      },
      (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6));
                events.push(event);
                if (event.type === 'done' || event.type === 'failed') {
                  res.destroy();
                  resolve(events);
                  return;
                }
              } catch {}
            }
          }
        });
        res.on('end', () => resolve(events));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-flow-browser-'));
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
    ],
  });

  const browserManager = {
    createContext: async (options?: any) => {
      const ctx = await browser.newContext(options);
      await ctx.route('**/*', async (route) => {
        const url = route.request().url();
        if (url === `${ORIGIN}/` || url === ORIGIN) {
          return route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Flow Test Home</title></head>
<body>
  <header><h1>Welcome to Flow Test</h1></header>
  <main>
    <p>We provide full-stack audit services for high-reliability systems.</p>
    <nav>
      <a href="/about">About Us</a>
      <a href="/products">Our Products</a>
    </nav>
  </main>
</body>
</html>`,
          });
        }
        if (url === `${ORIGIN}/about`) {
          return route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>About Us</title></head>
<body>
  <header><h1>About Our Company</h1></header>
  <main>
    <p>Founded in 2024, our engineers build tools for quality web infrastructure.</p>
    <a href="/">Back to Home</a>
  </main>
</body>
</html>`,
          });
        }
        if (url === `${ORIGIN}/products`) {
          return route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Our Products</title></head>
<body>
  <header><h1>Product Lineup</h1></header>
  <main>
    <p>Explore our fast and accurate testing tools for every modern team.</p>
    <a href="/">Back to Home</a>
  </main>
</body>
</html>`,
          });
        }
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });
      });
      return ctx;
    },
  };

  server = new RunnerServer({
    port: PORT,
    host: 'localhost',
    outputDir: path.join(scratch, 'report'),
    dataDir: path.join(scratch, 'data'),
    accessToken: ACCESS,
    auditCheckAddress: async (url) => ({
      ok: true,
      finalUrl: url,
      status: 200,
    }),
    auditCrawl: (requestData, opts) =>
      runAuditCrawl(requestData, {
        ...opts,
        deps: {
          browserManager,
          netDeps: makeNetDeps(),
          minGapMs: 10,
        },
      }),
  });

  await server.start();
}, 40000);

afterAll(async () => {
  await server?.stop();
  await browser?.close();
  if (scratch) {
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

describe('audit-flow-browser: end-to-end runner flow from start to stored documents (T-89, ADR 0040)', () => {
  it('executes full audit pipeline to stored documents', async () => {
    // 1. Start the audit via POST /api/audits
    const startRes = await request('POST', '/api/audits', {
      url: `${ORIGIN}/`,
      limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
      language: 'en',
    });

    expect(startRes.status).toBe(202);
    expect(startRes.json).toBeDefined();
    expect(startRes.json.auditId).toMatch(/^[a-z0-9_-]+$/i);
    const auditId = startRes.json.auditId as string;

    // 2. Stream progress until completion
    const events = await readStream(auditId);
    expect(events.length).toBeGreaterThan(0);

    const doneEvent = events.find((e) => e.type === 'done');
    const failedEvent = events.find((e) => e.type === 'failed');

    expect(failedEvent, `Audit failed with event: ${JSON.stringify(failedEvent)}`).toBeUndefined();
    expect(doneEvent).toBeDefined();
    expect(doneEvent).toMatchObject({
      type: 'done',
      auditId,
      version: 1,
    });

    // 3. Verify store holds all 7 documents in markdown and html formats
    const store = server.auditWiring.store;
    for (const kind of AUDIT_DOCUMENT_KINDS) {
      const md = await store.readAuditDocument(auditId, 1, kind, 'markdown');
      const html = await store.readAuditDocument(auditId, 1, kind, 'html');

      expect(md, `Document ${kind} should have markdown content`).toBeTruthy();
      expect(typeof md).toBe('string');
      expect(md!.length).toBeGreaterThan(10);

      expect(html, `Document ${kind} should have html content`).toBeTruthy();
      expect(typeof html).toBe('string');
      expect(html!.length).toBeGreaterThan(10);
    }

    // 4. Verify GET /api/audits/:id returns version status 'done'
    const auditRes = await request('GET', `/api/audits/${auditId}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.json).toBeDefined();
    expect(auditRes.json.summary).toBeDefined();
    expect(auditRes.json.summary.versions).toHaveLength(1);

    const v1 = auditRes.json.version;
    expect(v1.status).toBe('done');
    expect(v1.pagesRecorded).toBe(3);
    expect(v1.documents).toBeDefined();

    // 5. Verify export route serves stored document
    const exportRes = await request('GET', `/api/audits/${auditId}/export?format=md&documents=proposal`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text.length).toBeGreaterThan(20);
    expect(exportRes.text.toLowerCase()).toContain('proposal');
  }, 120000);
});
