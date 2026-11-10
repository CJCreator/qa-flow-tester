import { describe, it, expect } from 'vitest';
import { INTENTS, intentOf, normalizePlanIntents } from '../src/intent.js';

const legacy = { kind: 'denial' };

describe('intent', () => {
  it('lists the four Intents in Plan order', () => {
    expect(INTENTS).toEqual(['works', 'rejects', 'limits', 'denied']);
  });

  it('legacy kind:denial reads as Denied', () => {
    expect(intentOf(legacy)).toBe('denied');
    expect(intentOf({ kind: 'page-test' })).toBeUndefined();
    expect(intentOf({ intent: 'rejects', kind: 'denial' })).toBe('rejects');
  });

  it('normalizePlanIntents sets intent, drops legacy kind, and does not mutate', () => {
    const plan = {
      planPages: [
        {
          urlPath: '/a',
          tests: [
            { id: 't1', ...legacy },
            { id: 't2', intent: 'works' as const },
          ],
        },
      ],
      flows: [{ id: 'f1', ...legacy }],
    };
    const out = normalizePlanIntents(plan);
    expect(out.planPages![0].tests[0]).toEqual({ id: 't1', intent: 'denied' });
    expect(out.planPages![0].tests[1]).toEqual({ id: 't2', intent: 'works' });
    expect(out.flows![0]).toEqual({ id: 'f1', intent: 'denied' });
    expect((plan.planPages[0].tests[0] as { kind?: string }).kind).toBe('denial');
  });
});
