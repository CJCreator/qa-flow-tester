import { describe, it, expect } from 'vitest';
import type { DiscoveredFlow, PlanPage, PlanPageTest } from '@qa/types';
import { withDocumentedFlows, withDocumentedPages, withDocumentedTests } from '../src/plan/replan.js';

const doc = { document: 'Spec', section: '4 > 4.1', requirementId: 'R-1' };
const test = (id: string, over: Partial<PlanPageTest> = {}): PlanPageTest =>
  ({ id, name: id, role: 'visitor', steps: [], source: 'fallback', ...over }) as PlanPageTest;
const page = (urlPath: string, tests: PlanPageTest[]): PlanPage =>
  ({
    id: `page:${urlPath}`,
    urlPath,
    title: urlPath,
    coverage: 'tested',
    reachedBy: ['visitor'],
    tests,
    source: 'ai',
  }) as PlanPage;

describe('withDocumentedTests', () => {
  it('keeps document tests the fresh list lacks, and the denied one', () => {
    const before = [
      test('a'),
      test('route:1', { docSource: doc }),
      test('denial:1', { docSource: doc, intent: 'denied' }),
    ];
    const out = withDocumentedTests([test('b')], before);
    expect(out.map((t) => t.id)).toEqual(['b', 'route:1', 'denial:1']);
  });
  it('does not repeat a test the fresh list already has', () => {
    const out = withDocumentedTests([test('route:1')], [test('route:1', { docSource: doc })]);
    expect(out).toHaveLength(1);
  });
});

describe('withDocumentedFlows', () => {
  it('keeps document journeys the fresh list lacks', () => {
    const flow = (id: string, docSource?: typeof doc) =>
      ({ id, name: id, steps: [], docSource }) as unknown as DiscoveredFlow;
    const out = withDocumentedFlows([flow('new')], [flow('old'), flow('spec', doc)]);
    expect(out.map((f) => f.id)).toEqual(['new', 'spec']);
  });
});

describe('withDocumentedPages', () => {
  it('puts document tests back on a re-planned page', () => {
    const out = withDocumentedPages([page('/a', [test('x')])], [page('/a', [test('d', { docSource: doc })])]);
    expect(out[0].tests.map((t) => t.id)).toEqual(['x', 'd']);
  });
  it('keeps a documented page the re-plan did not produce, with only its document tests', () => {
    const before = [page('/admin', [test('plain'), test('d', { docSource: doc })])];
    const out = withDocumentedPages([page('/a', [])], before);
    expect(out.map((p) => p.urlPath)).toEqual(['/a', '/admin']);
    expect(out[1].tests.map((t) => t.id)).toEqual(['d']);
  });
  it('drops a page with no document tests that the re-plan did not produce', () => {
    const out = withDocumentedPages([page('/a', [])], [page('/gone', [test('plain')])]);
    expect(out.map((p) => p.urlPath)).toEqual(['/a']);
  });
});
