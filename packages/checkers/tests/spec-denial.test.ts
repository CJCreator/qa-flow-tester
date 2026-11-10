import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import type { TestCase } from '@qa/types';
import { SpecConformanceChecker } from '../src/spec-conformance.js';

const denial = {
  id: 'route-denial:visitor:/admin',
  name: 'visitor cannot open /admin',
  role: 'visitor',
  steps: [],
  startPage: '/admin',
  expectations: { origin: 'user', url: { pattern: '/admin', negate: true, description: 'does not stay' } },
} as unknown as TestCase;

const pageWithStatus = (status: number) =>
  ({
    url: () => 'http://localhost:3000/admin',
    evaluate: async () => status,
  }) as unknown as Page;

const run = (status: number) =>
  new SpecConformanceChecker().check(pageWithStatus(status), denial, [], {
    role: 'visitor',
    breakpoint: '1440px',
    baseUrl: 'http://localhost:3000',
  });

describe('Denial Plan Item', () => {
  it.each([401, 403, 404])('passes when the page is refused with %i', async (status) => {
    expect(await run(status)).toHaveLength(0);
  });

  it('fails with a Blocker when the page opens with 200', async () => {
    const findings = await run(200);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('Blocker');
  });
});

describe('API call expectation', () => {
  const makeTestCase = (expectedStatus: number) =>
    ({
      id: 'tc-api',
      name: 'api test',
      role: 'visitor',
      steps: [],
      startPage: '/checkout',
      expectations: { apiCall: { method: 'POST', path: '/api/orders', status: expectedStatus } },
    }) as unknown as TestCase;

  const runApi = async (expectedStatus: number, failedRequests: any[]) => {
    const mockPage = {
      url: () => 'http://localhost:3000/checkout',
      evaluate: async () => 200,
    } as unknown as Page;
    const stepEvidenceList = [{ stepIndex: 0, failedRequests, consoleErrors: [], networkLogs: [] }] as any;
    const findings = await new SpecConformanceChecker().check(
      mockPage,
      makeTestCase(expectedStatus),
      stepEvidenceList,
      {
        role: 'visitor',
        breakpoint: '1440px',
        baseUrl: 'http://localhost:3000',
      }
    );
    return findings.filter((f) => f.title.startsWith('API call'));
  };

  it('reports a Major finding with needsConfirmation when an expected-refusal call has no failed request', async () => {
    const findings = await runApi(403, []);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('API call was not refused: POST /api/orders did not return 403');
    expect(findings[0].severity).toBe('Major');
    expect(findings[0].needsConfirmation).toBe(true);
  });

  it('passes when the expected refusal matches the failed request status', async () => {
    const findings = await runApi(403, [
      { url: 'https://app.test/api/orders', method: 'POST', status: 403, timestamp: 1 },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('reports a Blocker when the failed request returned a different error status', async () => {
    const findings = await runApi(403, [
      { url: 'https://app.test/api/orders', method: 'POST', status: 500, timestamp: 1 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('API call status mismatch: POST /api/orders returned 500');
    expect(findings[0].severity).toBe('Blocker');
  });

  it('passes when status 200 is expected and no failed request exists', async () => {
    const findings = await runApi(200, []);
    expect(findings).toHaveLength(0);
  });
});
