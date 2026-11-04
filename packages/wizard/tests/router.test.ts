import { describe, it, expect } from 'vitest';
import { isCheckRoute, matchRoute, PATHS, readsAddressParam } from '../src/lib/router';

describe('every screen has an address', () => {
  it.each([
    ['/', { name: 'landing' }],
    ['/check', { name: 'new' }],
    ['/check/scan', { name: 'scan' }],
    ['/check/plan', { name: 'plan' }],
    ['/check/testing/', { name: 'testing' }],
    ['/reports', { name: 'reports' }],
    ['/reports/run-1790000000000', { name: 'report', runId: 'run-1790000000000' }],
    ['/reports/run-1790000000000/visibility', { name: 'visibility', runId: 'run-1790000000000' }],
    ['/baselines', { name: 'baselines' }],
    ['/benchmark', { name: 'benchmark' }],
    ['/settings', { name: 'settings' }],
    ['/audits/new', { name: 'audit-new' }],
    ['/audits', { name: 'audits' }],
    ['/audits/a-1', { name: 'audit', auditId: 'a-1' }],
    ['/audits/a-1/versions/2', { name: 'audit-version', auditId: 'a-1', version: 2 }],
    ['/studio', { name: 'not-found', path: '/studio' }],
    ['/reports/a/b', { name: 'not-found', path: '/reports/a/b' }],
    ['/reports/%E0%A4%A', { name: 'not-found', path: '/reports/%E0%A4%A' }],
  ])('%s', (path, route) => {
    expect(matchRoute(path)).toEqual(route);
  });

  it('builds report and visibility addresses that read back as the same run', () => {
    expect(matchRoute(PATHS.report('run 1/x'))).toEqual({ name: 'report', runId: 'run 1/x' });
    expect(matchRoute(PATHS.visibility('run 1/x'))).toEqual({ name: 'visibility', runId: 'run 1/x' });
  });

  it('knows which addresses belong to the check-up in progress', () => {
    expect(['/check/scan', '/check/plan', '/check/testing'].map((path) => isCheckRoute(matchRoute(path)))).toEqual([
      true,
      true,
      true,
    ]);
    expect(isCheckRoute(matchRoute('/reports/run-1'))).toBe(false);
    expect(isCheckRoute(matchRoute('/'))).toBe(false);
    expect(isCheckRoute(matchRoute('/check'))).toBe(false);
  });

  it('reads the landing page address on /check as well as the check-up screens', () => {
    expect(readsAddressParam(matchRoute('/check'))).toBe(true);
    expect(readsAddressParam(matchRoute('/check/plan'))).toBe(true);
    expect(readsAddressParam(matchRoute('/'))).toBe(false);
    expect(readsAddressParam(matchRoute('/reports'))).toBe(false);
  });
});
