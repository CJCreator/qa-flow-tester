/**
 * The URL-first flow against the real runner and the fixture app: the test-host rule, planning
 * without an AI key, turning a sentence into a test, and remembering a site between runs. Only the
 * AI is scripted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs, mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import net, { type AddressInfo } from 'net';
import type { AIMessage, AIProviderType, DiscoveredFlow, ReleaseReport, ReviewPlan } from '@qa/types';
import { KeyResolver } from '@qa/core';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

// Ports the OS picks, set in beforeAll. The fixed ports 3190/3191 could be held by a vitest worker left over from
// an earlier run: `listen` then emits 'error' instead of calling back, and beforeAll hung until its 30 s timeout
// with all six tests skipped (EV-0006, QA-706).
let FIXTURE_PORT = 0;
let runnerUrl = '';

/** Listens on a port the OS picks; a listen error rejects at once instead of hanging the hook. */
function listenOnFreePort(server: http.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** A port the OS reports free. RunnerServer reads port 0 as its default 3001, so a runner gets one picked here. */
function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
// A new folder per run, outside the repository: inside OneDrive the sync client picks up every file a run
// writes (screenshots, videos), competes with Chromium for the CPU and holds files open so the clean-up fails.
const scratch = mkdtempSync(path.join(os.tmpdir(), 'qa-test-url-first-'));
const outputDir = path.join(scratch, 'report');
const dataDir = `${outputDir}-data`;

/** Plans two journeys and answers the review's sentence questions the way a model would. */
class ScriptedAI {
  readonly providerType: AIProviderType = 'mock';
  async generateText(messages: AIMessage[]): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    if (prompt.includes('synthesizing application flows')) {
      return JSON.stringify({
        siteType: 'SaaS',
        flows: [
          {
            id: 'FLOW-INVOICE',
            name: 'Create an invoice',
            role: 'visitor',
            description: 'Managers bill customers from here.',
            startPage: '/invoices/new',
            steps: [
              { action: 'fill', selector: '[data-testid="amount-field"]', value: '50', name: 'Enter the amount' },
              { action: 'click', selector: '[data-testid="save-btn"]', name: 'Save' },
            ],
            candidateExpectations: { text: { contains: 'Invoice created successfully' } },
          },
          {
            id: 'FLOW-DASHBOARD',
            name: 'Open the dashboard',
            role: 'visitor',
            description: 'The first thing people see.',
            startPage: '/dashboard',
            steps: [{ action: 'wait', name: 'Look at the dashboard' }],
          },
        ],
      });
    }
    if (prompt.includes('A person describes a test')) {
      const sentence = prompt.match(/The person wrote: "([^"]*)"/)?.[1] || '';
      if (/export/i.test(sentence)) {
        return JSON.stringify({ understood: false, unclear: 'I couldn’t find a button called “Export” on this page.' });
      }
      return JSON.stringify({
        understood: true,
        name: 'Save with an empty amount',
        steps: [
          { action: 'fill', selector: '[data-testid="amount-field"]', value: '', name: 'Leave the amount empty' },
          { action: 'click', selector: '[data-testid="save-btn"]', name: 'Save' },
        ],
        expected: { kind: 'error-message', field: 'Amount' },
      });
    }
    return '{}';
  }
}

async function post(route: string, body: unknown = {}): Promise<Response> {
  return fetch(`${runnerUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function status(): Promise<{ phase: string; isRunning: boolean; lastRunError: string | null }> {
  return (await fetch(`${runnerUrl}/api/runner/status`)).json();
}
// A full scan and test of the fixture in Chromium took 200 to 250 s alone on a 4-core laptop (more beside other
// browser tests), against well under 200 s on a CI runner: the wait allows for the slower machine.
async function waitForPhase(wanted: string[], seconds = 600): Promise<string> {
  for (let i = 0; i < seconds * 2; i++) {
    const s = await status();
    if (wanted.includes(s.phase)) return s.phase;
    if (s.phase === 'failed') throw new Error(`run failed: ${s.lastRunError}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`still ${(await status()).phase}`);
}
const plan = async (): Promise<ReviewPlan> => (await fetch(`${runnerUrl}/api/runner/plan`)).json();
const report = async (): Promise<ReleaseReport> => (await fetch(`${runnerUrl}/api/report`)).json();

describe('URL-first runs', () => {
  let runner: RunnerServer;
  const sent: string[] = [];
  const onRequest = (req: http.IncomingMessage) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') sent.push(`${req.method} ${req.url}`);
  };

  beforeAll(async () => {
    FIXTURE_PORT = await listenOnFreePort(fixtureServer);
    fixtureServer.on('request', onRequest);
    const runnerPort = await freePort();
    runnerUrl = `http://localhost:${runnerPort}`;
    runner = new RunnerServer({
      port: runnerPort,
      outputDir,
      dataDir,
      // A "live" shop on this machine: decisions use the typed host, the connection goes to localhost.
      hostAliases: { 'shop.example.com': 'localhost' },
      createAIProvider: () => new ScriptedAI(),
    });
    await runner.start();
  });

  afterAll(async () => {
    // Undefined only when beforeAll failed; its own error is the one to read.
    await runner?.stop();
    fixtureServer.off('request', onRequest);
    if (fixtureServer.listening) await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });

  // A test that fails or times out must not leave its run going: the next test's start would be refused (one
  // run at a time) and it would fail for a reason that is not its own. Only after a failure, since a plan one
  // test leaves waiting for review is replaced on purpose by a later one.
  afterEach(async ({ task }) => {
    if (task.result?.state !== 'fail') return;
    try {
      for (let attempt = 0; attempt < 3 && (await status()).isRunning; attempt++) {
        await post('/api/runner/abort', { discard: true });
      }
    } catch {
      // Runner not reachable: nothing to stop.
    }
  }, 30000);

  it('keeps a live host read-only even when the owner box is ticked: nothing is sent', async () => {
    sent.length = 0;
    const res = await post('/api/runner/run', {
      targetUrl: `http://shop.example.com:${FIXTURE_PORT}/`,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: false,
      maxPages: 10,
      breakpoints: ['1440px'],
    });
    expect(res.status).toBe(202);
    await waitForPhase(['awaiting-review']);

    const reviewed = await plan();
    expect(reviewed.readOnly).toBe(true);
    expect(reviewed.readOnlyReason).toContain('live site');
    expect(reviewed.flows.find((f) => f.id === 'FLOW-INVOICE')?.needsTestCopy).toBe(true);
    expect(reviewed.flows.find((f) => f.id === 'FLOW-DASHBOARD')?.needsTestCopy).toBeUndefined();
    // Every page has a thumbnail the map can show, in the run's own folder.
    const thumb = reviewed.pages.find((p) => p.urlPath === '/dashboard')?.screenshotPath;
    expect(thumb).toMatch(/^plan-pages\/.+\.jpg$/);
    expect((await fetch(`${runnerUrl}/api/evidence/runs/${reviewed.runId}/${thumb}`)).status).toBe(200);

    expect((await post('/api/runner/plan/approve')).status).toBe(200);
    await waitForPhase(['done']);
    const result = await report();
    expect(result.scanMode).toBe('read-only');
    const invoice = result.results.find((r) => r.flowId === 'FLOW-INVOICE');
    expect(invoice).toMatchObject({ status: 'Skipped' });
    expect(invoice?.skipReason).toContain('Needs a test copy');
    expect(result.notes?.some((n) => n.includes('need a test copy') || n.includes('needs a test copy'))).toBe(true);
    expect(sent).toEqual([]);
  }, 900000); // a scan and a test run of the fixture: 194 s alone on a 4-core laptop, see waitForPhase

  it('tests localhost fully when the owner box is ticked', async () => {
    sent.length = 0;
    await post('/api/runner/run', {
      targetUrl: `http://localhost:${FIXTURE_PORT}/`,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: true,
      breakpoints: ['1440px'],
    });
    await waitForPhase(['done']);
    const result = await report();
    expect(result.scanMode).toBeUndefined();
    expect(result.results.find((r) => r.flowId === 'FLOW-INVOICE')?.status).not.toBe('Skipped');
    expect(sent).toContain('POST /api/invoices');
  }, 660000); // a full scan and test of the fixture: over 200 s alone on a 4-core laptop, see waitForPhase

  it('without the owner box, even localhost is only looked at', async () => {
    await post('/api/runner/run', { targetUrl: `http://localhost:${FIXTURE_PORT}/`, owner: false, skipReview: false });
    await waitForPhase(['awaiting-review']);
    const reviewed = await plan();
    expect(reviewed.readOnly).toBe(true);
    expect(reviewed.readOnlyReason).toContain('didn’t say you own');
  }, 120000);

  it('refuses a wizard scan until an AI key is set up: the AI writes the plan', async () => {
    // Its own runner, with an empty key store, so a key saved on this machine can't count.
    const keylessPort = await freePort();
    const keyless = new RunnerServer({
      port: keylessPort,
      outputDir: `${outputDir}-keyless`,
      dataDir: `${dataDir}-keyless`,
      keyResolver: new KeyResolver(`${dataDir}-keyless`, { get: async () => null, set: async () => {} }),
    });
    await keyless.start();
    try {
      const res = await fetch(`http://localhost:${keylessPort}/api/runner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: `http://localhost:${FIXTURE_PORT}/`,
          owner: true,
          useAI: true,
          aiProvider: 'openrouter',
          mode: 'product',
          skipReview: false,
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'ERR_NO_AI_KEY' });
      expect((await (await fetch(`http://localhost:${keylessPort}/api/runner/status`)).json()).phase).toBe('idle');
    } finally {
      await keyless.stop();
      await fs.rm(`${outputDir}-keyless`, { recursive: true, force: true }).catch(() => {});
      await fs.rm(`${dataDir}-keyless`, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('plans with fixed rules when there is no AI, and says describing a test needs it', async () => {
    // The plan from the test before is still waiting for review: this replaces it.
    await post('/api/runner/run', {
      targetUrl: `http://localhost:${FIXTURE_PORT}/`,
      owner: true,
      skipReview: false,
      replacePlan: true,
    });
    await waitForPhase(['awaiting-review']);
    const reviewed = await plan();
    expect(reviewed.aiAvailable).toBe(false);
    expect(reviewed.flows.length).toBeGreaterThan(0);
    expect(reviewed.flows.every((f) => f.source === 'fallback')).toBe(true);
    expect(reviewed.notes?.some((n) => n.includes('No AI key'))).toBe(true);

    const reply = await (
      await post('/api/runner/plan/interpret', { sentence: 'Save an invoice', urlPath: '/invoices/new' })
    ).json();
    expect(reply).toEqual({ ok: false, message: expect.stringContaining('needs the AI helper') });
  }, 120000);

  it('turns a sentence into a test after the owner confirms it, and remembers the site next time', async () => {
    await post('/api/runner/run', {
      targetUrl: `http://localhost:${FIXTURE_PORT}/`,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: false,
      breakpoints: ['1440px'],
      replacePlan: true,
    });
    await waitForPhase(['awaiting-review']);
    const first = await plan();

    // Something that isn't on the page gets a plain reply, and nothing is added.
    const missing = await (
      await post('/api/runner/plan/interpret', { sentence: 'Press Export', urlPath: '/invoices/new' })
    ).json();
    expect(missing).toEqual({ ok: false, message: 'I couldn’t find a button called “Export” on this page.' });

    const understood = await (
      await post('/api/runner/plan/interpret', {
        sentence: 'Save an invoice with an empty amount — it should show an error',
        urlPath: '/invoices/new',
      })
    ).json();
    expect(understood.ok).toBe(true);
    const added: DiscoveredFlow = understood.flow;
    expect(added).toMatchObject({
      source: 'user',
      startPage: '/invoices/new',
      candidateExpectations: { origin: 'user' },
    });
    expect((await plan()).flows.some((f) => f.source === 'user')).toBe(false); // not added until confirmed

    // The owner confirms it, answers the form question, and skips the dashboard journey.
    const formQuestion = first.questions.find((q) => q.category === 'untested_form' && q.urlPath === '/invoices/new')!;
    const flows = [...first.flows.map((f) => (f.id === 'FLOW-DASHBOARD' ? { ...f, outOfScope: true } : f)), added];
    const patched = await fetch(`${runnerUrl}/api/runner/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flows, answers: { [formQuestion.id]: 'Just check nothing breaks' } }),
    });
    expect(patched.status).toBe(200);
    expect((await post('/api/runner/plan/approve')).status).toBe(200);
    await waitForPhase(['done']);

    const result = await report();
    const userTest = result.results.find((r) => r.flowId === added.id);
    expect(userTest?.status).toBe('Failed'); // the fixture shows no error for an empty amount
    expect(
      result.findings.some((f) => f.title === 'No error appeared after leaving "Amount" empty' && !f.needsConfirmation)
    ).toBe(true);
    expect(result.results.some((r) => r.flowId === 'FLOW-DASHBOARD')).toBe(false);

    // Pretend /about is new since that run.
    const memoryFile = path.join(dataDir, 'sites', `localhost_${FIXTURE_PORT}.json`);
    const memory = JSON.parse(await fs.readFile(memoryFile, 'utf8'));
    memory.pages = memory.pages.filter((p: string) => p !== '/about');
    await fs.writeFile(memoryFile, JSON.stringify(memory));

    await post('/api/runner/run', {
      targetUrl: `http://localhost:${FIXTURE_PORT}/`,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: false,
      breakpoints: ['1440px'],
    });
    await waitForPhase(['awaiting-review']);
    const second = await plan();
    // No question answered last time is asked again, and it keeps last time's answer.
    const again = second.questions.find((q) => q.key === formQuestion.key)!;
    expect(again).toMatchObject({ selectedAnswer: 'Just check nothing breaks' });
    expect(again.isNew).toBeUndefined();
    // The skipped journey stays skipped, the described test comes back, and the new page is flagged.
    expect(second.flows.find((f) => f.name === 'Open the dashboard')?.outOfScope).toBe(true);
    expect(second.flows.some((f) => f.source === 'user' && f.name === 'Save with an empty amount')).toBe(true);
    expect(second.pages.filter((p) => p.isNew).map((p) => p.urlPath)).toEqual(['/about']);
    expect(second.sinceLastRun).toMatchObject({ newPages: 1, rememberedAnswers: expect.any(Number) });
  }, 900000); // a scan, a test run and a second scan of the fixture: 249 s alone on a 4-core laptop
});
