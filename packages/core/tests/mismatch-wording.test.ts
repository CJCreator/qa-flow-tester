import { describe, it, expect } from 'vitest';
import type { DiscoveryDraft, TestCase } from '@qa/types';
import { withSourceWording } from '../src/source-wording.js';
import { expandPlan } from '../src/plan/expand.js';
import { finding } from './helpers/issues-fixtures.js';

const tc = (over: Partial<TestCase> = {}): TestCase => ({
  id: 'TEST-1',
  flowId: 'page-test',
  role: 'member',
  startPage: '/users',
  steps: [],
  expectations: { origin: 'user', text: { contains: 'Create user' } },
  ...over,
});
const spec = (over = {}) => finding({ id: 'F-SPEC-1', checker: 'spec-conformance', title: 'Expected text not found', ...over });
const source = { document: 'Admin guide', section: 'Users > Create' };

describe('mismatch wording (ADR 0020)', () => {
  it('a failed expectation with a Source reads "Behaviour differs from <document> <section>"', () => {
    const out = withSourceWording(spec(), tc({ docSource: source }));
    expect(out.title).toBe('Behaviour differs from Admin guide, section Users > Create');
    expect(out.severity).toBe('Major');
    expect(out.docSource).toEqual(source);
    expect(out.expectedVsActual.expected).toContain('Admin guide');
    expect(out.needsConfirmation).toBeUndefined();
  });

  it('uses the severity the person chose', () => {
    expect(withSourceWording(spec(), tc({ docSource: source, docSeverity: 'Blocker' })).severity).toBe('Blocker');
  });

  it('a stale document makes it Could not verify, not counted', () => {
    const out = withSourceWording(spec(), tc({ docSource: source, docStale: true }));
    expect(out.needsConfirmation).toBe(true);
    expect(out.title).toContain('may be out of date');
  });

  it('a failed AI guess becomes a judgement item', () => {
    const out = withSourceWording(
      spec({ needsConfirmation: true, severity: 'Suggestion' }),
      tc({ expectations: { origin: 'ai-guess', text: { contains: 'x' } } })
    );
    expect(out.needsConfirmation).toBe(true);
    expect(out.needsJudgement).toBe(true);
  });

  it('leaves other findings and tests without a Source alone', () => {
    const f = spec();
    expect(withSourceWording(f, tc())).toBe(f);
    const other = finding({ checker: 'design-standards' });
    expect(withSourceWording(other, tc({ docSource: source }))).toBe(other);
  });

  it('never says "bug"', () => {
    const out = withSourceWording(spec(), tc({ docSource: source, docStale: true }));
    expect(JSON.stringify([out.title, out.resolution, out.expectedVsActual])).not.toMatch(/\bbug\b/i);
  });

  it('expandPlan carries the Source onto the test', () => {
    const draft = {
      pages: [],
      flows: [],
      ambiguityQuestions: [],
      inferredPermissions: [],
      prerequisites: [],
      plan: {
        pages: [
          {
            id: 'page:/users',
            urlPath: '/users',
            title: 'Users',
            coverage: 'tested',
            reachedBy: ['member'],
            tests: [
              {
                id: 'test:1',
                name: 'Create user is offered',
                role: 'member',
                steps: [],
                expectations: { text: { contains: 'Create user' } },
                source: 'ai',
                docSource: source,
                docSeverity: 'Minor',
                docStale: true,
              },
            ],
          },
        ],
        navigation: [],
        layoutGroups: [],
        otherHosts: [],
      },
    } as unknown as DiscoveryDraft;
    const { testCases } = expandPlan(draft, { readOnly: false, screenSizes: ['1440px'] });
    const pageTest = testCases.find((t) => t.kind === 'page-test')!;
    expect(pageTest.docSource).toEqual(source);
    expect(pageTest.docSeverity).toBe('Minor');
    expect(pageTest.docStale).toBe(true);
  });
});
