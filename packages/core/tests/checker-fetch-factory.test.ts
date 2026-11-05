import { describe, it, expect } from 'vitest';
import { resolveCheckerFetchOptions, CHECKER_FETCH_MAX_BYTES, CHECKER_FETCH_TIMEOUT_MS } from '../src/checker-fetch.js';
import type { HostPacer } from '../src/host-pacer.js';

const pacer = { wait: async () => {} } as unknown as HostPacer;

describe('shared checker fetch factory', () => {
  it('gives the audit and the orchestrator the same base options', () => {
    const audit = resolveCheckerFetchOptions({ caller: 'audit', allowPrivate: false, pacer });
    const orch = resolveCheckerFetchOptions({ caller: 'orchestrator' });
    expect(audit.maxRedirects).toBe(orch.maxRedirects);
    expect(audit.timeoutMs).toBe(orch.timeoutMs);
    expect(audit.maxBytes).toBe(orch.maxBytes);
    expect(audit.maxBytes).toBe(CHECKER_FETCH_MAX_BYTES);
    expect(audit.timeoutMs).toBe(CHECKER_FETCH_TIMEOUT_MS);
    expect(audit.maxRedirects).toBe(0);
  });

  it('keeps the audit pacer', () => {
    expect(resolveCheckerFetchOptions({ caller: 'audit', pacer }).pacer).toBe(pacer);
  });

  it('passes no pacer for the orchestrator, even if one is given', () => {
    expect(resolveCheckerFetchOptions({ caller: 'orchestrator' }).pacer).toBeUndefined();
    expect(resolveCheckerFetchOptions({ caller: 'orchestratorLinks', pacer }).pacer).toBeUndefined();
  });

  it('keeps the orchestrator link fetch redirect limit and timeout', () => {
    const o = resolveCheckerFetchOptions({ caller: 'orchestratorLinks' });
    expect(o.maxRedirects).toBe(10);
    expect(o.timeoutMs).toBe(10_000);
  });

  it('explicit fields override the caller defaults', () => {
    const o = resolveCheckerFetchOptions({ caller: 'audit', maxRedirects: 3, timeoutMs: 500 });
    expect(o.maxRedirects).toBe(3);
    expect(o.timeoutMs).toBe(500);
  });
});
