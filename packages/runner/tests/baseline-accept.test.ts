/**
 * Accepting a visual baseline: the id is a plain name, and nothing outside the output folder, or from a
 * saved sign-in session (auth/), is ever copied into the baselines.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';

const PORT = 3733;
const scratch = path.join(process.cwd(), '.tmp-baseline-accept');
const outputDir = path.join(scratch, 'report');
const baselineDir = path.join(process.cwd(), '.qa-baselines');
const ID = 'tmp-t34-baseline-test';

function accept(body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: '/api/runner/baselines/accept',
        method: 'POST',
        headers: {
          host: `localhost:${PORT}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: text }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function get(urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port: PORT, path: urlPath, method: 'GET', headers: { host: `localhost:${PORT}` } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: text }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false
  );

describe('POST /api/runner/baselines/accept', () => {
  let server: RunnerServer;

  beforeAll(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
    await fs.mkdir(path.join(outputDir, 'auth'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'runs', 'run-1', 'evidence'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'auth', 'admin.json'), '{"cookies":"secret"}');
    await fs.writeFile(path.join(outputDir, 'runs', 'run-1', 'evidence', 'shot.png'), 'png');
    server = new RunnerServer({ port: PORT, outputDir, dataDir: path.join(scratch, 'data') });
    await server.start();
  });

  afterAll(async () => {
    await server?.stop();
    await fs.rm(path.join(baselineDir, `${ID}.png`), { force: true });
    await fs.rm(path.join(baselineDir, 'tmp-t267-TC-1-1440px.png'), { force: true });
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it.each(['../evil', 'a/b', '..', 'a\\b', '..%2Fx', ''])('refuses the id %j', async (id) => {
    const answer = await accept({ id, currentEvidencePath: 'runs/run-1/evidence/shot.png' });
    expect(answer.status).toBe(400);
  });

  it('refuses an id that is not text', async () => {
    expect((await accept({ id: ['x'] })).status).toBe(400);
  });

  it('never copies a saved sign-in session', async () => {
    const answer = await accept({ id: ID, currentEvidencePath: 'auth/admin.json' });
    expect(answer.status).toBe(200);
    expect(await exists(path.join(baselineDir, `${ID}.png`))).toBe(false);
  });

  it('never copies a file from outside the output folder', async () => {
    const answer = await accept({ id: ID, currentEvidencePath: '../../package.json' });
    expect(answer.status).toBe(200);
    expect(await exists(path.join(baselineDir, `${ID}.png`))).toBe(false);
  });

  it('copies a screenshot from a run', async () => {
    const answer = await accept({ id: ID, currentEvidencePath: 'runs/run-1/evidence/shot.png' });
    expect(answer.status).toBe(200);
    expect(await exists(path.join(baselineDir, `${ID}.png`))).toBe(true);
  });

  it('copies the screenshot named by its /api/evidence/ address', async () => {
    await fs.rm(path.join(baselineDir, `${ID}.png`), { force: true });
    const answer = await accept({ id: ID, currentEvidencePath: '/api/evidence/runs/run-1/evidence/shot.png' });
    expect(answer.status).toBe(200);
    expect(await exists(path.join(baselineDir, `${ID}.png`))).toBe(true);
  });

  it('never copies a saved sign-in session named by its address', async () => {
    await fs.rm(path.join(baselineDir, `${ID}.png`), { force: true });
    const answer = await accept({ id: ID, currentEvidencePath: '/api/evidence/auth/admin.json' });
    expect(answer.status).toBe(200);
    expect(await exists(path.join(baselineDir, `${ID}.png`))).toBe(false);
  });

  it('never copies a file outside the output folder named by its address', async () => {
    await fs.rm(path.join(baselineDir, `${ID}.png`), { force: true });
    const answer = await accept({ id: ID, currentEvidencePath: '/api/evidence/..%2F..%2Fpackage.json' });
    expect(answer.status).toBe(200);
    expect(await exists(path.join(baselineDir, `${ID}.png`))).toBe(false);
  });

  it('the baselines list sends the new screenshot and the diff', async () => {
    await fs.mkdir(baselineDir, { recursive: true });
    await fs.writeFile(path.join(baselineDir, 'tmp-t267-TC-1-1440px.png'), 'png');
    (server as unknown as { lastReport: unknown }).lastReport = {
      runId: 'run-1',
      findings: [
        {
          checker: 'design-standards',
          title: 'Visual regression against baseline at 1440px',
          testCaseId: 'tmp-t267-TC-1',
          where: { breakpoint: '1440px' },
          expectedVsActual: { actual: '2.00% of pixels differ (10 px)' },
          evidence: {
            screenshotPath: 'evidence/TC-1-1440px/visual-diff.png',
            currentScreenshotPath: 'evidence/TC-1-1440px/visual-current.png',
          },
        },
      ],
    };
    const answer = await get('/api/runner/baselines');
    expect(answer.status).toBe(200);
    const items = JSON.parse(answer.body) as { id: string; currentUrl?: string; diffUrl?: string }[];
    const item = items.find((i) => i.id === 'tmp-t267-TC-1-1440px');
    expect(item?.currentUrl).toBe('/api/evidence/runs/run-1/evidence/TC-1-1440px/visual-current.png');
    expect(item?.diffUrl).toBe('/api/evidence/runs/run-1/evidence/TC-1-1440px/visual-diff.png');
  });
});
