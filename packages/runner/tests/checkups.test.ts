/**
 * A check-up's life on the real runner, against a small site whose pages can change between runs:
 * a plan waiting for review isn't thrown away unasked, stopping testing keeps the plan, the event
 * stream replays the run to a page that opens late, every report is kept in its own folder (the
 * last ten per site), and Test again skips the review only when nothing changed. Only the AI is
 * scripted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AIProviderType, ReleaseReport, ReviewPlan, RunSummary } from '@qa/types';
import { RunnerServer } from '../src/server.js';

const SITE_PORT = 3601;
const RUNNER_PORT = 3602;
const LEGACY_PORT = 3603;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const siteUrl = `http://localhost:${SITE_PORT}/`;
const siteHost = `localhost:${SITE_PORT}`;
const scratch = path.join(process.cwd(), '.tmp-checkups');
const outputDir = path.join(scratch, 'report');
const dataDir = path.join(scratch, 'data');

/** Answers every AI request with nothing usable, so the plan uses the Fixed-Rule Fallback: quick and repeatable. */
class QuietAI {
  readonly providerType: AIProviderType = 'mock';
  async generateText(_messages: AIMessage[]): Promise<string> {
    return '{}';
  }
}

/** The site under test. Pages can be added between check-ups. */
const pages = new Map<string, { title: string; links: string[] }>([
  ['/', { title: 'Home', links: ['/about', '/contact'] }],
  ['/about', { title: 'About', links: ['/'] }],
  ['/contact', { title: 'Contact', links: ['/'] }],
]);
const site = http.createServer((req, res) => {
  const page = pages.get((req.url || '/').split('?')[0]);
  if (!page) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Not found</title><h1>Not found</h1>');
    return;
  }
  const nav = page.links.map((to) => `<a href="${to}">${pages.get(to)?.title ?? to}</a>`).join(' ');
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${page.title}</title></head>` +
      `<body><header><nav>${nav}</nav></header><main><h1>${page.title}</h1><p>The ${page.title.toLowerCase()} page.</p></main></body></html>`
  );
});

type RunnerEvent = { type: string; replayed?: boolean; runId?: string; [key: string]: unknown };

/** Listens to the runner's event stream, as the Wizard does. */
async function openStream(): Promise<{ events: RunnerEvent[]; close: () => void }> {
  const events: RunnerEvent[] = [];
  const controller = new AbortController();
  const res = await fetch(`${runnerUrl}/api/runner/stream`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)));
        }
      }
    } catch {
      // closed
    }
  })();
  return { events, close: () => controller.abort() };
}

const post = (route: string, body: unknown = {}) =>
  fetch(`${runnerUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = async <T>(route: string): Promise<T> => (await fetch(`${runnerUrl}${route}`)).json() as Promise<T>;
const status = () =>
  get<{
    phase: string;
    isRunning: boolean;
    runId: string | null;
    lastRunError: string | null;
    reportRunId: string | null;
    targetUrl: string | null;
  }>('/api/runner/status');

async function waitForPhase(wanted: string, seconds = 120): Promise<void> {
  for (let i = 0; i < seconds * 4; i++) {
    const s = await status();
    if (s.phase === wanted) return;
    if (s.phase === 'failed') throw new Error(`run failed: ${s.lastRunError}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`still ${(await status()).phase}, waiting for ${wanted}`);
}

/** The Wizard's start request for this site. */
const checkUp = (extra: Record<string, unknown> = {}) => ({
  targetUrl: siteUrl,
  owner: true,
  useAI: true,
  aiProvider: 'mock',
  mode: 'product',
  skipReview: false,
  breakpoints: ['1440px'],
  ...extra,
});

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false
  );
}

/** A finished run of the site, written as the runner writes one, dated `daysAgo` days back. */
async function fakeRun(runId: string, daysAgo: number): Promise<void> {
  const dir = path.join(outputDir, 'runs', runId);
  await fs.mkdir(dir, { recursive: true });
  const timestamp = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const summary: RunSummary = {
    runId,
    targetUrl: siteUrl,
    host: siteHost,
    timestamp,
    durationMs: 1000,
    ready: true,
    stamp: 'Ready to release',
    reason: 'No problems found.',
    counts: { Blocker: 0, Major: 0, Minor: 0, Suggestion: 0 },
  };
  await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary));
  await fs.writeFile(
    path.join(dir, 'report.json'),
    JSON.stringify({ runId, targetUrl: siteUrl, timestamp, findings: [], results: [] })
  );
}

describe('A check-up on the runner', () => {
  let runner: RunnerServer;
  const startRunner = async () => {
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir,
      // A live-looking shop on this machine: decisions use the typed host, the connection goes to localhost.
      hostAliases: { 'shop.example.test': 'localhost' },
      createAIProvider: () => new QuietAI(),
    });
    await runner.start();
  };

  beforeAll(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
    await new Promise<void>((resolve) => site.listen(SITE_PORT, 'localhost', () => resolve()));
    await startRunner();
  });

  afterAll(async () => {
    await runner?.stop();
    await new Promise<void>((resolve) => site.close(() => resolve()));
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  });

  it('says before the scan whether the address is a test copy, and what was chosen for it last time', async () => {
    const facts = async (targetUrl: string) => (await post('/api/runner/preflight', { targetUrl })).json();

    expect(await facts(siteUrl)).toMatchObject({ reachable: true, host: siteHost, testCopy: true });
    expect((await facts(siteUrl)).remembered).toBeUndefined();

    const shop = `http://shop.example.test:${SITE_PORT}/`;
    expect(await facts(shop)).toMatchObject({
      reachable: true,
      host: `shop.example.test:${SITE_PORT}`,
      testCopy: false,
    });

    // Marked as a test copy by its owner last time (the runner saves this when a check-up starts).
    await fs.mkdir(path.join(dataDir, 'sites'), { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'sites', `shop.example.test_${SITE_PORT}.json`),
      JSON.stringify({ host: `shop.example.test:${SITE_PORT}`, staging: true, owner: true, pages: [] })
    );
    expect(await facts(shop)).toMatchObject({ testCopy: true, remembered: { owner: true, markedTestCopy: true } });
  });

  let runId = '';

  it('never throws away a plan waiting for review unless asked to', async () => {
    const first = await post('/api/runner/run', checkUp());
    expect(first.status).toBe(202);
    const firstId = (await first.json()).runId;
    await waitForPhase('awaiting-review');

    // The owner choice is remembered from the start of the check-up.
    expect((await (await post('/api/runner/preflight', { targetUrl: siteUrl })).json()).remembered).toMatchObject({
      owner: true,
    });

    const refused = await post('/api/runner/run', checkUp());
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'ERR_PLAN_WAITING', targetUrl: siteUrl });
    expect((await get<ReviewPlan>('/api/runner/plan')).runId).toBe(firstId);

    const replaced = await post('/api/runner/run', checkUp({ replacePlan: true }));
    expect(replaced.status).toBe(202);
    runId = (await replaced.json()).runId;
    expect(runId).not.toBe(firstId);
    await waitForPhase('awaiting-review');
    expect((await get<ReviewPlan>('/api/runner/plan')).runId).toBe(runId);
    expect(await status()).toMatchObject({ runId, targetUrl: siteUrl });
  }, 240000);

  it('replays the check-up so far to a page that opens late, marked as replayed', async () => {
    const stream = await openStream();
    try {
      await expect.poll(() => stream.events.some((e) => e.type === 'PLAN_READY'), { timeout: 5000 }).toBe(true);
      expect(stream.events[0]).toMatchObject({ type: 'connected' });
      expect(stream.events[0].replayed).toBeUndefined();
      const replayed = stream.events.slice(1);
      expect(replayed.every((e) => e.replayed === true)).toBe(true);
      expect(replayed.map((e) => e.type)).toContain('DISCOVERY_STARTED');
      // Only this check-up's events: the replaced one's are gone.
      expect(replayed.every((e) => e.runId === undefined || e.runId === runId)).toBe(true);
    } finally {
      stream.close();
    }
  });

  it('refuses to delete the check-up in progress', async () => {
    expect((await fetch(`${runnerUrl}/api/runs/${runId}`, { method: 'DELETE' })).status).toBe(409);
  });

  it('stopping testing keeps the plan, which can be approved again', async () => {
    expect((await post('/api/runner/plan/approve')).status).toBe(200);
    expect((await status()).phase).toBe('testing');
    const stopped = await (await post('/api/runner/abort')).json();
    expect(stopped).toMatchObject({ aborted: true, planKept: true });
    expect(await status()).toMatchObject({ phase: 'awaiting-review', runId });
    expect((await get<ReviewPlan>('/api/runner/plan')).runId).toBe(runId);

    // Nine older check-ups of the site are already kept: this one makes ten, and an eleventh
    // (the oldest) is deleted when it finishes.
    for (let i = 1; i <= 10; i++) await fakeRun(`run-fake-${String(i).padStart(2, '0')}`, 30 + i);

    expect((await post('/api/runner/plan/approve')).status).toBe(200);
    await waitForPhase('done', 180);
    const report = await get<ReleaseReport>('/api/report');
    expect(report.runId).toBe(runId);
    expect(await status()).toMatchObject({ reportRunId: runId });
  }, 240000);

  it('keeps the report in the run’s own folder, and lists, serves and downloads it', async () => {
    const dir = path.join(outputDir, 'runs', runId);
    for (const file of [
      'report.json',
      'summary.json',
      'report.html',
      'report.md',
      'findings.json',
      'fix-these.md',
      'known-findings.json',
      'AGENTS.snippet.md',
    ]) {
      expect(await exists(path.join(dir, file)), file).toBe(true);
    }
    // The CI artifact folder gets the contract files too (ADR 0017).
    for (const file of ['findings.json', 'fix-these.md', 'known-findings.json', 'AGENTS.snippet.md']) {
      expect(await exists(path.join(outputDir, file)), `top-level ${file}`).toBe(true);
    }
    // Sign-in sessions stay beside the runs, never inside one.
    expect(await exists(path.join(dir, 'auth'))).toBe(false);

    const { runs } = await get<{ runs: RunSummary[] }>('/api/runs');
    expect(runs[0]).toMatchObject({
      runId,
      host: siteHost,
      targetUrl: siteUrl,
      stamp: expect.any(String),
      counts: expect.any(Object),
    });
    expect(runs.map((r) => r.timestamp)).toEqual([...runs.map((r) => r.timestamp)].sort().reverse());

    const report = await get<ReleaseReport>(`/api/runs/${runId}`);
    expect(report.runId).toBe(runId);
    // Evidence paths are relative to the run's folder, and served from it.
    const screenshot = report.results.flatMap((r) => r.stepEvidence).find((s) => s.screenshotPath)?.screenshotPath;
    expect(screenshot).toBeTruthy();
    expect(path.isAbsolute(screenshot!)).toBe(false);
    const image = await fetch(`${runnerUrl}/api/evidence/runs/${runId}/${screenshot}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');

    for (const file of ['report.html', 'report.md', 'findings.json']) {
      const download = await fetch(`${runnerUrl}/api/runs/${runId}/download/${file}`);
      expect(download.status, file).toBe(200);
      expect(download.headers.get('content-disposition'), file).toContain(runId);
      expect(Buffer.from(await download.arrayBuffer()).equals(await fs.readFile(path.join(dir, file))), file).toBe(
        true
      );
    }
    expect((await fetch(`${runnerUrl}/api/runs/${runId}/download/summary.json`)).status).toBe(404);
    expect((await fetch(`${runnerUrl}/api/runs/..%2F..%2Fdata/download/report.md`)).status).toBe(404);
    expect((await fetch(`${runnerUrl}/api/runs/run-does-not-exist`)).status).toBe(404);
  });

  it('keeps the newest ten check-ups of a site, and deletes one on request', async () => {
    const ofSite = (await get<{ runs: RunSummary[] }>('/api/runs')).runs.filter((r) => r.host === siteHost);
    expect(ofSite).toHaveLength(10);
    expect(ofSite.map((r) => r.runId)).not.toContain('run-fake-10'); // the oldest
    expect(await exists(path.join(outputDir, 'runs', 'run-fake-10'))).toBe(false);

    expect((await fetch(`${runnerUrl}/api/runs/run-fake-01`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${runnerUrl}/api/runs/run-fake-01`)).status).toBe(404);
    expect(await exists(path.join(outputDir, 'runs', 'run-fake-01'))).toBe(false);
  });

  it('still has the latest report after a restart', async () => {
    await runner.stop();
    await startRunner();
    expect((await get<ReleaseReport>('/api/report')).runId).toBe(runId);
    expect(await status()).toMatchObject({ phase: 'idle', reportRunId: runId });
    expect((await get<{ runs: RunSummary[] }>('/api/runs')).runs[0].runId).toBe(runId);
  });

  it('Test again tests at once with the approved plan when nothing on the site changed', async () => {
    const stream = await openStream();
    try {
      // No screen sizes sent, as from the Wizard: the plan's approved one (1440px) is used.
      const again = await post('/api/runner/run', checkUp({ testAgain: true, breakpoints: undefined }));
      expect(again.status).toBe(202);
      const againId = (await again.json()).runId;
      await waitForPhase('done', 180);
      const types = stream.events.filter((e) => e.runId === againId).map((e) => e.type);
      expect(types).toContain('TESTING_STARTED');
      expect(types).not.toContain('PLAN_READY');

      const report = await get<ReleaseReport>(`/api/runs/${againId}`);
      expect(report.testedWithApprovedPlan).toEqual(expect.any(String));
      expect(new Set(report.results.map((r) => r.breakpoint))).toEqual(new Set(['1440px']));
      expect(report.notes?.some((n) => n.includes('tested as approved, without a new review'))).toBe(true);
      expect((await get<{ runs: RunSummary[] }>('/api/runs')).runs[0]).toMatchObject({
        runId: againId,
        testedWithApprovedPlan: report.testedWithApprovedPlan,
      });
    } finally {
      stream.close();
    }
  }, 240000);

  it('Test again waits for review when a page was added, with only that page flagged', async () => {
    pages.set('/pricing', { title: 'Pricing', links: ['/'] });
    pages.get('/')!.links.push('/pricing');
    const stream = await openStream();
    try {
      expect((await post('/api/runner/run', checkUp({ testAgain: true }))).status).toBe(202);
      await waitForPhase('awaiting-review');
      expect(stream.events.find((e) => e.type === 'PLAN_READY')).toMatchObject({ changedSinceApproval: true });
      const plan = await get<ReviewPlan>('/api/runner/plan');
      expect(plan.pages.filter((p) => p.isNew).map((p) => p.urlPath)).toEqual(['/pricing']);
      expect(plan.sinceLastRun).toMatchObject({ newPages: 1 });
    } finally {
      stream.close();
      await post('/api/runner/abort');
    }
  }, 240000);

  it('moves site data kept in the working folder into .qa-data on start, copying before it deletes', async () => {
    const work = path.join(scratch, 'old-working-folder');
    await fs.mkdir(path.join(work, 'sites'), { recursive: true });
    await fs.writeFile(
      path.join(work, 'sites', 'shop.example.com.json'),
      JSON.stringify({ host: 'shop.example.com', pages: ['/'] })
    );
    await fs.writeFile(path.join(work, 'sites', 'shop.example.com.history.json'), '[]');
    await fs.writeFile(path.join(work, '.qa-ai-models.json'), JSON.stringify({ text: 'vendor/model:free' }));

    const before = process.cwd();
    process.chdir(work);
    try {
      // No data folder given: the default, .qa-data in the working folder.
      const legacy = new RunnerServer({ port: LEGACY_PORT, outputDir: path.join(work, 'report') });
      await legacy.start();
      await legacy.stop();
    } finally {
      process.chdir(before);
    }

    expect(await exists(path.join(work, 'sites'))).toBe(false);
    expect(await exists(path.join(work, '.qa-ai-models.json'))).toBe(false);
    expect(
      JSON.parse(await fs.readFile(path.join(work, '.qa-data', 'sites', 'shop.example.com.json'), 'utf8'))
    ).toMatchObject({ pages: ['/'] });
    expect(await exists(path.join(work, '.qa-data', 'sites', 'shop.example.com.history.json'))).toBe(true);
    expect(await exists(path.join(work, '.qa-data', '.qa-ai-models.json'))).toBe(true);
  });
});
