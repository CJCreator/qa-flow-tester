import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { StorageStateData } from '@qa/types';
import { EVIDENCE_REDACTION_FAILED_NOTE, FlowTestOrchestrator, type RunOptions } from '../src/orchestrator.js';
import { Redactor } from '../src/redact.js';
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

// T-393: a redaction that fails is never silent, and no unredacted evidence stays on disk.
describe('orchestrator deletes the evidence when redaction fails (T-393)', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  });

  const setup = async (ok: boolean) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-redact-fail-'));
    const dir = path.join(tmpDir, 'evidence');
    vi.spyOn(BrowserManager.prototype, 'close').mockResolvedValue(undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Redactor.prototype, 'files').mockRejectedValue(new Error(`EBUSY: cannot write ${PASSWORD}`));
    vi.spyOn(PreFlightChecker.prototype, 'runPreFlight').mockImplementation(async () => {
      await fs.mkdir(path.join(dir, 'nested'), { recursive: true });
      await fs.writeFile(path.join(dir, 'step-1.html'), `<p>${PASSWORD}</p>`, 'utf8');
      await fs.writeFile(path.join(dir, 'nested', 'step-2.json'), `{"p":"${PASSWORD}"}`, 'utf8');
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
    const options: RunOptions = {
      targetUrl: 'http://127.0.0.1:9',
      productId: 'redact-fails',
      specTestCases: [],
      outputDir: tmpDir,
      profile: { roles: [{ role: 'member', username: 'member', password: PASSWORD }] } as RunOptions['profile'],
    };
    return { dir, warn, options };
  };

  const expectDeletedAndLogged = async (dir: string, warn: ReturnType<typeof vi.spyOn>) => {
    expect(await fs.readdir(dir)).toEqual([]);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('Evidence redaction failed');
    expect(logged).not.toContain(PASSWORD);
  };

  it('an error exit: evidence deleted, the failure logged, and the run note on the error', async () => {
    const { dir, warn, options } = await setup(false);
    const err = await new FlowTestOrchestrator().run(options).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('Pre-flight check failed: boom');
    expect((err as Error).message).toContain(EVIDENCE_REDACTION_FAILED_NOTE);
    expect((err as { runNotes?: string[] }).runNotes).toEqual([EVIDENCE_REDACTION_FAILED_NOTE]);
    expect(EVIDENCE_REDACTION_FAILED_NOTE).toBe('Could not verify: evidence redaction failed; evidence was deleted');
    await expectDeletedAndLogged(dir, warn);
  });

  it('a stop: evidence deleted and the run note kept, the AbortError unchanged', async () => {
    const { dir, warn, options } = await setup(true);
    const controller = new AbortController();
    controller.abort();
    const err = await new FlowTestOrchestrator()
      .run({ ...options, signal: controller.signal })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'AbortError', runNotes: [EVIDENCE_REDACTION_FAILED_NOTE] });
    await expectDeletedAndLogged(dir, warn);
  });
});
