import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { StorageStateData } from '@qa/types';
import { FlowTestOrchestrator, type RunOptions } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import { PreFlightChecker, type PreFlightResult } from '../src/preflight.js';

const PASSWORD = 'Hunter2-password!';
const HEADER = 'bypass-0123456789';
const TUNNEL = 'tunnel-abcdefgh';
const COOKIE = 'cookie-value-12345';

// T-316: evidence is redacted on every exit from run(), not only the one that builds the report.
describe('orchestrator redacts the evidence on every exit (T-316)', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  });

  const preflight = (ok: boolean, outputDir: string): void => {
    vi.spyOn(BrowserManager.prototype, 'close').mockResolvedValue(undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(PreFlightChecker.prototype, 'runPreFlight').mockImplementation(async () => {
      const dir = path.join(outputDir, 'evidence');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'step-1.html'), `<p>${PASSWORD} ${HEADER} ${TUNNEL} ${COOKIE}</p>`, 'utf8');
      return {
        ok,
        ...(ok ? {} : { error: 'boom' }),
        roleAuthResults: {},
        roleStorageStates: {},
        roleLandingPaths: {},
        roleFailures: {},
        roleDiagnostics: {},
      } as PreFlightResult;
    });
  };

  const options = (outputDir: string, extra: Partial<RunOptions> = {}): RunOptions => ({
    targetUrl: 'http://127.0.0.1:9',
    productId: 'redact-every-exit',
    specTestCases: [],
    outputDir,
    profile: { roles: [{ role: 'member', username: 'member', password: PASSWORD }] } as RunOptions['profile'],
    customHeaders: { 'x-bypass': HEADER },
    tunnelAuth: TUNNEL,
    ...extra,
  });

  const readEvidence = () => fs.readFile(path.join(tmpDir!, 'evidence', 'step-1.html'), 'utf8');

  it('a failed pre-flight leaves no secret in the evidence', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-redact-'));
    preflight(false, tmpDir);
    await expect(new FlowTestOrchestrator().run(options(tmpDir))).rejects.toThrow('Pre-flight check failed: boom');
    const text = await readEvidence();
    for (const secret of [PASSWORD, HEADER, TUNNEL]) expect(text).not.toContain(secret);
    expect(text).toContain('***');
  });

  it('a stop leaves no secret in the evidence', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-redact-'));
    preflight(true, tmpDir);
    const controller = new AbortController();
    controller.abort();
    await expect(new FlowTestOrchestrator().run(options(tmpDir, { signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
    const text = await readEvidence();
    for (const secret of [PASSWORD, HEADER, TUNNEL]) expect(text).not.toContain(secret);
    expect(text).toContain('***');
  });

  it('a supplied session value is hidden', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-redact-'));
    preflight(false, tmpDir);
    const member = { cookies: [{ name: 'sid', value: COOKIE }], origins: [] } as unknown as StorageStateData;
    await expect(new FlowTestOrchestrator().run(options(tmpDir, { suppliedSessions: { member } }))).rejects.toThrow();
    expect(await readEvidence()).not.toContain(COOKIE);
  });
});
