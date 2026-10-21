/**
 * T-52: /healthz answers from real checks (a writable data folder and a launchable Chromium, cached), the
 * container runs as a non-root user with a HEALTHCHECK, and the deploy verify loop is bounded by time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BrowserManager } from '@qa/core';
import { RunnerServer } from '../src/server.js';

const PORT = 3572;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scratch = path.join(root, '.tmp-T-52-health');

const readRepoFile = (rel: string): Promise<string> => fs.readFile(path.join(root, rel), 'utf8');

describe('GET /healthz', () => {
  let runner: RunnerServer | undefined;
  let dataDir: string;
  let readOnly = false;
  let launch: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dataDir = path.join(scratch, 'data');
    readOnly = false;
    // Only the data folder is made read-only here: its write-access check fails, everything else is real.
    const realAccess = fs.access.bind(fs);
    vi.spyOn(fs, 'access').mockImplementation((async (target: string, mode?: number) => {
      if (readOnly && path.resolve(String(target)) === path.resolve(dataDir)) {
        throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
      }
      return realAccess(target, mode);
    }) as typeof fs.access);
    launch = vi.spyOn(BrowserManager.prototype, 'launch').mockResolvedValue({} as never);
    runner = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir,
    });
    await runner.start();
  });

  afterEach(async () => {
    await runner?.stop();
    runner = undefined;
    vi.restoreAllMocks();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('answers 200 ok when the data folder takes a write and Chromium launches', async () => {
    const res = await fetch(`http://localhost:${PORT}/healthz`, { signal: AbortSignal.timeout(15000) });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('answers 503 when the data folder is read-only', async () => {
    readOnly = true;
    const res = await fetch(`http://localhost:${PORT}/healthz`, { signal: AbortSignal.timeout(15000) });

    expect(res.status).toBe(503);
    expect(await res.text()).toBe('unhealthy');
  });

  it('answers 503 when Chromium does not launch', async () => {
    launch.mockRejectedValueOnce(new Error("Executable doesn't exist at /ms-playwright/chromium\nRun playwright install"));
    const res = await fetch(`http://localhost:${PORT}/healthz`, { signal: AbortSignal.timeout(15000) });

    expect(res.status).toBe(503);
    expect(await res.text()).toBe('unhealthy');
  });

  it('checks once and reuses the result, so repeated probes do not relaunch Chromium', async () => {
    await fetch(`http://localhost:${PORT}/healthz`, { signal: AbortSignal.timeout(15000) });
    await fetch(`http://localhost:${PORT}/healthz`, { signal: AbortSignal.timeout(15000) });
    const res = await fetch(`http://localhost:${PORT}/healthz`, { signal: AbortSignal.timeout(15000) });

    expect(res.status).toBe(200);
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

describe('packages/runner/Dockerfile', () => {
  it('runs as the non-root pwuser, and the last USER directive is not root', async () => {
    const users = [...(await readRepoFile('packages/runner/Dockerfile')).matchAll(/^USER\s+(\S+)/gm)].map((m) => m[1]);

    expect(users).toContain('pwuser');
    expect(users.at(-1)).toBe('pwuser');
    expect(users).not.toContain('root');
    expect(users).not.toContain('0');
  });

  it('makes the data folder writable by pwuser before switching to it', async () => {
    const body = await readRepoFile('packages/runner/Dockerfile');

    expect(body.indexOf('chown pwuser:pwuser /data')).toBeGreaterThan(-1);
    expect(body.indexOf('chown pwuser:pwuser /data')).toBeLessThan(body.indexOf('\nUSER pwuser'));
  });

  it('keeps the Playwright tag on the FROM line that the version check reads', async () => {
    expect(await readRepoFile('packages/runner/Dockerfile')).toMatch(/^FROM\s+\S*playwright:v\d+\.\d+\.\d+-noble/m);
  });

  it('has a HEALTHCHECK that calls /healthz', async () => {
    const body = await readRepoFile('packages/runner/Dockerfile');

    expect(body).toMatch(/^HEALTHCHECK\s/m);
    expect(body).toContain("'/healthz'");
  });

  it('checks the base image Node major against .nvmrc', async () => {
    const body = await readRepoFile('packages/runner/Dockerfile');

    expect(body).toContain('/app/.nvmrc');
    expect(body).toContain('process.exit(1)');
  });
});

describe('deploy.yml verify step', () => {
  it('is bounded by the clock: a 10-minute deadline and no fixed attempt count', async () => {
    const body = await readRepoFile('.github/workflows/deploy.yml');
    const verify = body.slice(body.indexOf('- name: Verify Vercel serves this commit'));

    expect(verify).toContain('deadline=$(( $(date +%s) + 600 ))');
    expect(verify).toContain('while [ "$(date +%s)" -lt "$deadline" ]');
    expect(verify).not.toMatch(/seq 1 \d+/);
  });

  it('has a step timeout below the verify job timeout (15 minutes)', async () => {
    const body = await readRepoFile('.github/workflows/deploy.yml');
    const job = body.slice(body.indexOf('\n  verify:\n'));
    const verify = job.slice(job.indexOf('- name: Verify Vercel serves this commit'));
    const jobLimit = Number(/timeout-minutes:\s*(\d+)/.exec(job)?.[1]);
    const stepLimit = Number(/timeout-minutes:\s*(\d+)/.exec(verify)?.[1]);

    expect(jobLimit).toBe(15);
    expect(stepLimit).toBeGreaterThan(0);
    expect(stepLimit).toBeLessThan(jobLimit);
  });
});
