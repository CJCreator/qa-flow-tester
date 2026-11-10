/**
 * LAT-2/LAT-3: the run list and the waiting plans come from memory after the first read.
 * Unit tier: temp folders, no browser, no runner server.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { DefaultReportStore } from '../src/session/report-store.js';
import { DefaultPlanStore, type StoredPlanRecord } from '../src/session/plan-store.js';
import { DefaultRunSecrets } from '../src/session/run-secrets.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'store-index-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const summary = (runId: string, timestamp: string) => ({
  runId,
  targetUrl: 'https://site.test/',
  host: 'site.test',
  timestamp,
  durationMs: 1,
  ready: true,
  stamp: 'ready',
  reason: '',
  counts: {},
});

describe('DefaultReportStore.list index (LAT-2)', () => {
  it('lists runs newest first and sees a run folder added later', async () => {
    const paths = {
      outputDir: path.join(root, 'out'),
      dataDir: path.join(root, 'data'),
      authDir: path.join(root, 'auth'),
    };
    const runs = path.join(paths.outputDir, 'runs');
    await fs.mkdir(path.join(runs, 'run-a'), { recursive: true });
    await fs.writeFile(
      path.join(runs, 'run-a', 'summary.json'),
      JSON.stringify(summary('run-a', '2026-01-01T00:00:00Z'))
    );
    const store = new DefaultReportStore(paths);
    expect((await store.list()).map((r) => r.runId)).toEqual(['run-a']);

    await fs.mkdir(path.join(runs, 'run-b'));
    await fs.writeFile(
      path.join(runs, 'run-b', 'summary.json'),
      JSON.stringify(summary('run-b', '2026-02-01T00:00:00Z'))
    );
    // Make the folder change visible even on a coarse file-system clock.
    const later = new Date(Date.now() + 5000);
    await fs.utimes(runs, later, later);
    expect((await store.list()).map((r) => r.runId)).toEqual(['run-b', 'run-a']);
  });

  it('a run folder removed elsewhere drops out of the list', async () => {
    const paths = {
      outputDir: path.join(root, 'out'),
      dataDir: path.join(root, 'data'),
      authDir: path.join(root, 'auth'),
    };
    const runs = path.join(paths.outputDir, 'runs');
    await fs.mkdir(path.join(runs, 'run-a'), { recursive: true });
    await fs.writeFile(
      path.join(runs, 'run-a', 'summary.json'),
      JSON.stringify(summary('run-a', '2026-01-01T00:00:00Z'))
    );
    const store = new DefaultReportStore(paths);
    expect(await store.list()).toHaveLength(1);
    await fs.rm(path.join(runs, 'run-a'), { recursive: true, force: true });
    const later = new Date(Date.now() + 5000);
    await fs.utimes(runs, later, later);
    expect(await store.list()).toHaveLength(0);
  });

  it('invalidate() makes list() re-read a summary rewritten in place', async () => {
    const paths = {
      outputDir: path.join(root, 'out'),
      dataDir: path.join(root, 'data'),
      authDir: path.join(root, 'auth'),
    };
    const runs = path.join(paths.outputDir, 'runs');
    await fs.mkdir(path.join(runs, 'run-a'), { recursive: true });
    await fs.writeFile(
      path.join(runs, 'run-a', 'summary.json'),
      JSON.stringify({ ...summary('run-a', '2026-01-01T00:00:00Z'), ready: false })
    );
    const store = new DefaultReportStore(paths);
    const firstList = await store.list();
    expect(firstList[0].ready).toBe(false);

    await fs.writeFile(
      path.join(runs, 'run-a', 'summary.json'),
      JSON.stringify({ ...summary('run-a', '2026-01-01T00:00:00Z'), ready: true })
    );

    store.invalidate();
    const secondList = await store.list();
    expect(secondList[0].ready).toBe(true);
  });
});

describe('DefaultPlanStore.waiting (LAT-3)', () => {
  const record = (host: string) =>
    ({
      status: 'awaiting-review',
      plan: { runId: `run-${host}`, targetUrl: `https://${host}/`, pages: [], flows: [], questions: [] },
      context: { targetUrl: `https://${host}/`, productId: 'p', runId: `run-${host}` },
    }) as unknown as StoredPlanRecord;

  it('reads the folder once, then answers from memory (park and unpark keep it in step)', async () => {
    const dataDir = path.join(root, 'data');
    await fs.mkdir(path.join(dataDir, 'waiting-plans'), { recursive: true });
    const store = new DefaultPlanStore(dataDir, new DefaultRunSecrets(path.join(root, 'auth')));
    await fs.writeFile(store.parkedFileFor('one.test'), JSON.stringify(record('one.test')));
    expect((await store.waiting()).map((w) => w.host)).toEqual(['one.test']);

    await store.park(record('two.test'));
    expect((await store.waiting()).map((w) => w.host).sort()).toEqual(['one.test', 'two.test']);

    await store.unpark('one.test');
    expect((await store.waiting()).map((w) => w.host)).toEqual(['two.test']);
  });
});
