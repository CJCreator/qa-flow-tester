/**
 * A check-up's life on the real runner, against a small site this test controls: what the address
 * check says, a plan that waits for review and isn't thrown away without asking, stopping testing
 * without losing the plan, every report kept in its own folder, Test again, a page that reopens
 * mid-run catching up, and site data moving out of the working folder. Only the AI is a stand-in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import type { ReleaseReport, ReviewPlan, RunSummary } from '@qa/types';
import { MockAIProvider, emptySiteMemory, saveSiteMemory } from '@qa/core';
import { RunnerServer } from '../src/server.js';

const SITE_PORT = 3601;
const RUNNER_PORT = 3602;
const MOVE_PORT = 3605;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const siteUrl = `http://localhost:${SITE_PORT}`;
const siteHost = `localhost:${SITE_PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-check-ups');
const dataDir = `${outputDir}-data`;

/** A three-page site. Pages can be added while the test runs, as a site changes between check-ups. */
const pages: Record<string, { title: string; links: string[] }> = {
  '/': { title: 'Home', links: ['/about', '/contact'] },
  '/about': { title: 'About us', links: ['/'] },
  '/contact': { title: 'Contact', links: ['/'] },
};
function html(urlPath: string): string | null {
  const page = pages[urlPath];
  if (!page) return null;
  const nav = page.links.map((to) => `<a href="${to}">${pages[to]?.title ?? to}</a>`).join(' ');
  return `<!doctype html><html lang="en"><head><title>${page.title}</title><meta name="description" content="${page.title} of a small shop used to test check-ups."></head><body><nav>${nav}</nav><main><h1>${page.title}</h1><p>Welcome.</p></main></body></html>`;
}
const site = http.createServer((req, res) => {
  const body = html(new URL(req.url || '/', siteUrl).pathname);
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html' });
  res.end(body ?? 'Not found');
});

const makeRunner = () =>
  new RunnerServer({
    port: RUNNER_PORT,
    outputDir,
    dataDir,
    // A "live" host on this machine: decisions use the typed host, the connection goes to localhost.
    hostAliases: { 'shop.example.com': 'localhost' },
    createAIProvider: () => new MockAIProvider(),
  });

/** What the Wizard sends for a check-up of the site, with the AI stand-in and one screen size to keep it quick. */
const checkup = { targetUrl: siteUrl, owner: true, useAI: true, aiProvider: 'mock', skipReview: false, breakpoints: ['1440px'] };

async function post(route: string, body: unknown = {}): Promise<Response> {
  return fetch(`${runnerUrl}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function status(): Promise<{ phase: string; isRunning: boolean; lastRunError: string | null; reportRunId?: string | null; runId?: string | null }> {
  return (await fetch(`${runnerUrl}/api/runner/status`)).json();
}
async function waitForPhase(wanted: string[], seconds = 150): Promise<string> {
  for (let i = 0; i < seconds * 4; i++) {
    const s = await status();
    if (wanted.includes(s.phase)) return s.phase;
    if (s.phase === 'failed') throw new Error(`run failed: ${s.lastRunError}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`still ${(await status()).phase}`);
}
const plan = async (): Promise<ReviewPlan> => (await fetch(`${runnerUrl}/api/runner/plan`)).json();
const latestReport = async (): Promise<ReleaseReport> => (await fetch(`${runnerUrl}/api/report`)).json();
const runs = async (): Promise<RunSummary[]> => (await (await fetch(`${runnerUrl}/api/runs`)).json()).runs;

/** Reads the event stream until `until` sees what it waits for, then closes it. */
async function readStream(until: (events: Array<Record<string, unknown>>) => boolean, ms = 10000): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(`${runnerUrl}/api/runner/stream`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!until(events)) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const chunk = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)));
      }
    }
  } catch {
    // timed out: the caller checks what arrived
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

describe('Check-ups on the runner', () => {
  let runner: RunnerServer;
  /** The check-up whose plan was approved, stopped, approved again and finished. */
  let finishedRunId = '';

  beforeAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => site.listen(SITE_PORT, () => resolve()));
    runner = makeRunner();
    await runner.start();
  });

  afterAll(async () => {
    await runner?.stop();
    await new Promise<void>((resolve) => site.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('says whether an address can be tested fully, and what was chosen for the site last time', async () => {
    const local = await (await post('/api/runner/preflight', { targetUrl: siteUrl })).json();
    expect(local).toMatchObject({ reachable: true, host: siteHost, testCopy: true });
    expect(local.remembered).toBeUndefined();

    const live = await (await post('/api/runner/preflight', { targetUrl: `http://shop.example.com:${SITE_PORT}/` })).json();
    expect(live).toMatchObject({ reachable: true, host: `shop.example.com:${SITE_PORT}`, testCopy: false });

    // Marked as a test copy, and owned, the last time it was checked.
    await saveSiteMemory(dataDir, { ...emptySiteMemory(`shop.example.com:${SITE_PORT}`), staging: true, owner: true });
    const marked = await (await post('/api/runner/preflight', { targetUrl: `http://shop.example.com:${SITE_PORT}/` })).json();
    expect(marked).toMatchObject({ testCopy: true, remembered: { owner: true, markedTestCopy: true } });
  });

  it('won’t throw away a plan waiting for review unless asked, and stopping testing keeps the plan to approve again', async () => {
    const first = await post('/api/runner/run', checkup);
    expect(first.status).toBe(202);
    const firstRunId = (await first.json()).runId;
    await waitForPhase(['awaiting-review']);

    // The owner choice is remembered for the site's next check-up.
    expect((await (await post('/api/runner/preflight', { targetUrl: siteUrl })).json()).remembered).toMatchObject({ owner: true });

    // Starting over a waiting plan is refused, and the plan stays.
    const refused = await post('/api/runner/run', checkup);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'ERR_PLAN_WAITING', targetUrl: siteUrl });
    expect((await status()).phase).toBe('awaiting-review');
    expect((await plan()).runId).toBe(firstRunId);

    // Asked to replace it, a new check-up starts.
    const replaced = await post('/api/runner/run', { ...checkup, replacePlan: true });
    expect(replaced.status).toBe(202);
    const runId = (await replaced.json()).runId;
    expect(runId).not.toBe(firstRunId);
    await waitForPhase(['awaiting-review']);
    expect((await plan()).runId).toBe(runId);

    // Approved, then stopped mid-test: the plan waits for review again.
    expect((await post('/api/runner/plan/approve')).status).toBe(200);
    expect((await status()).phase).toBe('testing');
    const stopped = await (await post('/api/runner/abort')).json();
    expect(stopped).toMatchObject({ aborted: true, planKept: true });
    expect((await status()).phase).toBe('awaiting-review');
    expect((await plan()).runId).toBe(runId);

    // The same plan is approved again and tested to the end.
    expect((await post('/api/runner/plan/approve')).status).toBe(200);
    await waitForPhase(['done']);
    const report = await latestReport();
    expect(report.runId).toBe(runId);
    expect(report.results.length).toBeGreaterThan(0);
    finishedRunId = runId;
  }, 300000);

  it('keeps each check-up in its own folder, lists it, and serves its files with addresses inside it', async () => {
    const dir = path.join(outputDir, 'runs', finishedRunId);
    for (const file of ['report.json', 'summary.json', 'report.html', 'report.md', 'findings.json']) {
      expect(existsSync(path.join(dir, file)), file).toBe(true);
    }

    const list = await runs();
    expect(list[0]).toMatchObject({ runId: finishedRunId, host: siteHost, targetUrl: siteUrl });
    expect(['Ready to release', 'Not ready yet']).toContain(list[0].stamp);
    expect(list[0].counts).toHaveProperty('Blocker');

    const report: ReleaseReport = await (await fetch(`${runnerUrl}/api/runs/${finishedRunId}`)).json();
    expect(report.runId).toBe(finishedRunId);
    // No full path of this computer is handed out: files are addressed inside the run's folder.
    expect(JSON.stringify(report)).not.toContain(JSON.stringify(path.resolve(outputDir)).slice(1, -1));
    const shot = report.results.flatMap((r) => r.stepEvidence).find((s) => s.screenshotPath)?.screenshotPath;
    expect(shot).toBeTruthy();
    const image = await fetch(`${runnerUrl}/api/evidence/runs/${finishedRunId}/${shot}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');

    const html = await fetch(`${runnerUrl}/api/runs/${finishedRunId}/download/report.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-disposition')).toContain(`report-localhost_${SITE_PORT}-${finishedRunId}.html`);
    expect(await html.text()).toContain('Release check-up');
    expect((await fetch(`${runnerUrl}/api/runs/${finishedRunId}/download/secrets.txt`)).status).toBe(404);
    expect((await fetch(`${runnerUrl}/api/runs/..%2F..%2Fpackage.json`)).status).toBe(404);

    // A saved sign-in session is never served, even from inside a run's folder.
    await fs.mkdir(path.join(dir, 'auth'), { recursive: true });
    await fs.writeFile(path.join(dir, 'auth', 'member.json'), '{"cookies":"secret"}');
    expect((await fetch(`${runnerUrl}/api/evidence/runs/${finishedRunId}/auth/member.json`)).status).toBe(403);
    await fs.rm(path.join(dir, 'auth'), { recursive: true });
  });

  it('reads the latest report back after a restart', async () => {
    await runner.stop();
    runner = makeRunner();
    await runner.start();
    expect((await latestReport()).runId).toBe(finishedRunId);
    expect(await status()).toMatchObject({ phase: 'idle', reportRunId: finishedRunId });
  }, 30000);

  it('a page that opens mid-check-up catches up on the events so far', async () => {
    const started = await post('/api/runner/run', checkup);
    expect(started.status).toBe(202);
    const runId = (await started.json()).runId;
    await waitForPhase(['awaiting-review']);

    const events = await readStream((seen) => seen.some((e) => e.type === 'PLAN_READY'));
    expect(events[0].type).toBe('connected');
    const replayed = events.slice(1);
    expect(replayed.map((e) => e.type)).toContain('DISCOVERY_STARTED');
    expect(replayed.find((e) => e.type === 'PLAN_READY')).toMatchObject({ runId, replayed: true });
    expect(replayed.every((e) => e.replayed === true)).toBe(true);

    // Stopping a plan that waits for review throws it away: nothing was tested.
    expect(await (await post('/api/runner/abort')).json()).toMatchObject({ aborted: true, planKept: false });
    expect((await status()).phase).toBe('idle');
    expect((await fetch(`${runnerUrl}/api/runner/plan`)).status).toBe(404);
  }, 200000);

  it('Test again: nothing new tests at once with the approved plan; a new page pauses with only that page flagged', async () => {
    const again = await post('/api/runner/run', { ...checkup, testAgain: true });
    expect(again.status).toBe(202);
    const runId = (await again.json()).runId;
    // Straight to testing: the plan never waits for review.
    expect(await waitForPhase(['testing', 'awaiting-review', 'done'])).not.toBe('awaiting-review');
    await waitForPhase(['done']);
    const unchanged = await latestReport();
    expect(unchanged.runId).toBe(runId);
    expect(unchanged.testedWithApprovedPlan).toBeTruthy();
    expect((await runs()).find((r) => r.runId === runId)?.testedWithApprovedPlan).toBe(unchanged.testedWithApprovedPlan);

    // A page is added to the site: the check-up pauses for review, with only the new page flagged.
    pages['/pricing'] = { title: 'Pricing', links: ['/'] };
    pages['/'].links.push('/pricing');
    try {
      const events = readStream((seen) => seen.some((e) => e.type === 'PLAN_READY'), 150000);
      expect((await post('/api/runner/run', { ...checkup, testAgain: true })).status).toBe(202);
      await waitForPhase(['awaiting-review']);
      expect((await events).find((e) => e.type === 'PLAN_READY')).toMatchObject({ changedSinceApproval: true });
      const changed = await plan();
      expect(changed.pages.filter((p) => p.isNew).map((p) => p.urlPath)).toEqual(['/pricing']);
      expect((changed.planPages || []).filter((p) => p.isNew).map((p) => p.urlPath)).toEqual(['/pricing']);
      expect(changed.sinceLastRun).toMatchObject({ newPages: 1 });
      await post('/api/runner/abort');
    } finally {
      delete pages['/pricing'];
      pages['/'].links.pop();
    }
  }, 300000);

  it('keeps the newest 10 check-ups of a site: the 11th-newest goes, its grade history stays', async () => {
    const root = path.join(outputDir, 'runs');
    const mine = (await runs()).filter((r) => r.host === siteHost);
    // Older check-ups of the same site, filed as the runner files them, up to ten in all.
    const older: string[] = [];
    for (let i = 0; i < 10 - mine.length; i++) {
      const runId = `run-100000000000${i}`;
      older.push(runId);
      await fs.mkdir(path.join(root, runId), { recursive: true });
      const summary: RunSummary = {
        runId,
        targetUrl: siteUrl,
        host: siteHost,
        timestamp: new Date(Date.UTC(2020, 0, 1 + i)).toISOString(),
        durationMs: 1000,
        ready: true,
        stamp: 'Ready to release',
        reason: 'No problems found.',
        counts: { Blocker: 0, Major: 0, Minor: 0, Suggestion: 0 },
      };
      await fs.writeFile(path.join(root, runId, 'summary.json'), JSON.stringify(summary));
    }
    // Another site's check-ups are left alone, and so is a folder being written by the run in progress.
    await fs.mkdir(path.join(root, 'run-other'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'run-other', 'summary.json'),
      JSON.stringify({ runId: 'run-other', targetUrl: 'http://elsewhere.test', host: 'elsewhere.test', timestamp: '2019-01-01T00:00:00.000Z' })
    );
    expect((await runs()).filter((r) => r.host === siteHost)).toHaveLength(10);
    const historyFile = path.join(dataDir, 'sites', `localhost_${SITE_PORT}.history.json`);
    const historyBefore = await fs.readFile(historyFile, 'utf8');

    // One more check-up of the site: the oldest of the eleven is deleted.
    expect((await post('/api/runner/run', { targetUrl: siteUrl, mode: 'safe-public' })).status).toBe(202);
    await waitForPhase(['done']);
    const kept = (await runs()).filter((r) => r.host === siteHost);
    expect(kept).toHaveLength(10);
    expect(existsSync(path.join(root, older[0]))).toBe(false);
    for (const runId of older.slice(1)) expect(existsSync(path.join(root, runId)), runId).toBe(true);
    expect(existsSync(path.join(root, 'run-other'))).toBe(true);
    // The grade history keeps every check-up, deleted or not.
    expect(await fs.readFile(historyFile, 'utf8')).toBe(historyBefore);
  }, 120000);

  it('deletes a check-up by hand', async () => {
    const [newest] = await runs();
    const deleted = await fetch(`${runnerUrl}/api/runs/${newest.runId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect((await fetch(`${runnerUrl}/api/runs/${newest.runId}`)).status).toBe(404);
    expect(existsSync(path.join(outputDir, 'runs', newest.runId))).toBe(false);
    expect((await runs()).some((r) => r.runId === newest.runId)).toBe(false);
    // The latest report is now the newest one left.
    expect((await latestReport()).runId).toBe((await runs())[0].runId);
  });
});

describe('Site data on the first start', () => {
  it('moves sites/, the saved key setup and a waiting plan out of the working folder into .qa-data: copied, then removed', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-move-'));
    await fs.mkdir(path.join(work, 'sites'), { recursive: true });
    await fs.writeFile(path.join(work, 'sites', 'shop.example.com.json'), '{"host":"shop.example.com"}');
    await fs.writeFile(path.join(work, 'sites', 'shop.example.com.history.json'), '[]');
    await fs.writeFile(path.join(work, '.qa-ai-models.json'), '{"text":"vendor/helpful:free"}');

    // The data folder is the working folder's .qa-data unless it's set.
    const before = process.cwd();
    let moved: RunnerServer;
    process.chdir(work);
    try {
      moved = new RunnerServer({ port: MOVE_PORT, outputDir: path.join(work, 'report') });
    } finally {
      process.chdir(before);
    }
    await moved.start();
    try {
      expect(existsSync(path.join(work, 'sites'))).toBe(false);
      expect(existsSync(path.join(work, '.qa-ai-models.json'))).toBe(false);
      expect(await fs.readFile(path.join(work, '.qa-data', 'sites', 'shop.example.com.json'), 'utf8')).toContain('shop.example.com');
      expect(existsSync(path.join(work, '.qa-data', 'sites', 'shop.example.com.history.json'))).toBe(true);
      expect(await fs.readFile(path.join(work, '.qa-data', '.qa-ai-models.json'), 'utf8')).toContain('vendor/helpful:free');
    } finally {
      await moved.stop();
    }

    // Once moved, a sites/ folder that turns up again isn't copied over what's there.
    await fs.mkdir(path.join(work, 'sites'), { recursive: true });
    await fs.writeFile(path.join(work, 'sites', 'shop.example.com.json'), '{"host":"stale"}');
    process.chdir(work);
    try {
      moved = new RunnerServer({ port: MOVE_PORT, outputDir: path.join(work, 'report') });
    } finally {
      process.chdir(before);
    }
    await moved.start();
    try {
      expect(await fs.readFile(path.join(work, '.qa-data', 'sites', 'shop.example.com.json'), 'utf8')).toContain('"shop.example.com"');
    } finally {
      await moved.stop();
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  });
});
