import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import { PreFlightChecker, type PreFlightResult } from '../src/preflight.js';

// R1: every exit from run() closes the browsers, not only the happy path.
describe('orchestrator run closes the browser on every exit (R1)', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  });

  it('closes the browser manager when pre-flight fails and run throws', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-teardown-'));
    const closeSpy = vi.spyOn(BrowserManager.prototype, 'close');
    vi.spyOn(PreFlightChecker.prototype, 'runPreFlight').mockResolvedValue({
      ok: false,
      error: 'boom',
      roleAuthResults: {},
      roleStorageStates: {},
      roleLandingPaths: {},
      roleFailures: {},
      roleDiagnostics: {},
    } as PreFlightResult);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const orchestrator = new FlowTestOrchestrator();
    await expect(
      orchestrator.run({
        targetUrl: 'http://127.0.0.1:9',
        productId: 'teardown-test',
        specTestCases: [],
        outputDir: tmpDir,
      })
    ).rejects.toThrow('Pre-flight check failed: boom');

    expect(closeSpy).toHaveBeenCalled();
  });
});
