/**
 * T-402: GET /api/runner/status carries `auditMaxPages` on a shared copy (the wizard's form bound and hint),
 * and omits it on a local runner, where a Website Audit has no cap of its own.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AUDIT_LIMIT_DEFAULTS } from '@qa/types';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const KEY = 'fake-access-key-for-tests-0123456789';
let runner: RunnerServer | undefined;

afterEach(async () => {
  await runner?.stop();
  runner = undefined;
});

describe('status auditMaxPages', () => {
  it('is the hosted cap on a shared copy', async () => {
    const port = await freePort();
    runner = new RunnerServer({ port, beta: true, accessToken: KEY });
    await runner.start();
    const res = await fetch(`http://localhost:${port}/api/runner/status`, { headers: { 'x-qa-access': KEY } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auditMaxPages?: number };
    expect(body.auditMaxPages).toBe(AUDIT_LIMIT_DEFAULTS.hostedMaxPages);
  });

  it('is absent on a local runner', async () => {
    const port = await freePort();
    runner = new RunnerServer({ port });
    await runner.start();
    const res = await fetch(`http://localhost:${port}/api/runner/status`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('auditMaxPages');
  });
});
