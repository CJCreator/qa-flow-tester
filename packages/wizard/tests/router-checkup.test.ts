import { describe, it, expect } from 'vitest';
import { isCheckRoute, matchRoute, PATHS } from '../src/lib/router';
import { canMarkTestCopy, fullTesting, materialsOf, productContextOf, emptyForm, type CheckedAddress } from '../src/lib/checkup';

describe('addresses (Task 2.1)', () => {
  it.each([
    ['/', { name: 'new' }],
    ['/check/scan', { name: 'scan' }],
    ['/check/plan/', { name: 'plan' }],
    ['/check/testing', { name: 'testing' }],
    ['/reports', { name: 'reports' }],
    ['/reports/run-1727700000000', { name: 'report', runId: 'run-1727700000000' }],
    ['/settings', { name: 'settings' }],
    ['/studio', { name: 'not-found', path: '/studio' }],
    ['/reports/a/b', { name: 'not-found', path: '/reports/a/b' }],
    ['/check', { name: 'not-found', path: '/check' }],
  ])('%s', (path, route) => {
    expect(matchRoute(path)).toEqual(route);
  });

  it('round-trips a report address, and treats only the check-up’s own screens as check routes', () => {
    expect(matchRoute(PATHS.report('run 1/x'))).toEqual({ name: 'report', runId: 'run 1/x' });
    expect(['scan', 'plan', 'testing'].map((name) => isCheckRoute(matchRoute(`/check/${name}`)))).toEqual([true, true, true]);
    expect([PATHS.new, PATHS.reports, PATHS.settings, PATHS.report('r')].some((p) => isCheckRoute(matchRoute(p)))).toBe(false);
  });
});

describe('the new check-up form', () => {
  const checked = (facts: Partial<CheckedAddress>): CheckedAddress => ({ url: 'http://localhost:3050/', reachable: true, ...facts });

  it('joins specs, design notes and journeys under their own headings, or sends nothing', () => {
    expect(productContextOf(emptyForm)).toBeUndefined();
    expect(productContextOf({ specs: '  ', designNotes: '', journeys: '\n' })).toBeUndefined();
    expect(productContextOf({ specs: '- Amount must be positive', designNotes: 'Blue buttons', journeys: 'Sign in and pay' })).toBe(
      '# Specs\n\n- Amount must be positive\n\n# Design notes\n\nBlue buttons\n\n# Journeys to test\n\nSign in and pay\n'
    );
  });

  it('reads the specs, design notes and journeys back out of a past check-up’s document', () => {
    const materials = { specs: '- Amount must be positive\n\n## Refunds\n- 5 days', designNotes: 'Blue buttons', journeys: 'Sign in and pay' };
    expect(materialsOf(productContextOf(materials))).toEqual(materials);
    expect(materialsOf(productContextOf({ specs: '', designNotes: '', journeys: 'Just this' }))).toEqual({ specs: '', designNotes: '', journeys: 'Just this' });
    // A document written some other way is all specs.
    expect(materialsOf('# Product Specification\n\n- Must work')).toEqual({ specs: '# Product Specification\n\n- Must work', designNotes: '', journeys: '' });
    expect(materialsOf(undefined)).toEqual({ specs: '', designNotes: '', journeys: '' });
  });

  it('offers "This is a test copy" only on a live-looking address, or one marked before', () => {
    expect(canMarkTestCopy(checked({ testCopy: true }))).toBe(false);
    expect(canMarkTestCopy(checked({ testCopy: false }))).toBe(true);
    expect(canMarkTestCopy(checked({ testCopy: true, remembered: { markedTestCopy: true } }))).toBe(true);
  });

  it('tests fully only when the owner says so and it’s a test copy', () => {
    const local = checked({ testCopy: true });
    const live = checked({ url: 'https://shop.example.com/', testCopy: false });
    expect(fullTesting({ owner: true, markedTestCopy: false, facts: local })).toBe(true);
    expect(fullTesting({ owner: false, markedTestCopy: false, facts: local })).toBe(false);
    expect(fullTesting({ owner: true, markedTestCopy: false, facts: live })).toBe(false);
    expect(fullTesting({ owner: true, markedTestCopy: true, facts: live })).toBe(true);
    expect(fullTesting({ owner: true, markedTestCopy: true, facts: undefined })).toBe(false);
  });
});
