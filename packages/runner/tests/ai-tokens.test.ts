import { describe, it, expect } from 'vitest';
import { addTokens, type StageTokens } from '../src/ai-tokens.js';

const use = (requests: number) => ({
  requests,
  promptTokens: requests * 10,
  completionTokens: requests * 5,
  reasoningTokens: requests * 2,
  truncated: 0,
});

describe('addTokens', () => {
  it('adds the same stage', () => {
    const result = addTokens({ planning: use(1) }, { planning: use(2) });
    expect(result).toEqual({
      planning: {
        requests: 3,
        promptTokens: 30,
        completionTokens: 15,
        reasoningTokens: 6,
        truncated: 0,
      },
    });
  });

  it('keeps stages that appear on one side only', () => {
    const result = addTokens({ planning: use(1) }, { repair: use(2) });
    expect(result).toEqual({
      planning: use(1),
      repair: use(2),
    });
  });

  it('does not change either input', () => {
    const a: StageTokens = { planning: use(1), journeys: use(2) };
    const b: StageTokens = { planning: use(3), assessment: use(4) };
    const aBefore = JSON.stringify(a);
    const bBefore = JSON.stringify(b);

    const result = addTokens(a, b);

    expect(JSON.stringify(a)).toBe(aBefore);
    expect(JSON.stringify(b)).toBe(bBefore);
    expect(result).not.toBe(a);
    expect(result).not.toBe(b);
  });

  it('adding nothing returns the first argument as it is', () => {
    const a: StageTokens = { planning: use(1) };
    expect(addTokens(a, {})).toBe(a);
    expect(addTokens(a, undefined)).toBe(a);
    expect(addTokens(undefined, {})).toBeUndefined();
    expect(addTokens(undefined, undefined)).toBeUndefined();
  });

  it('adding to nothing copies the second', () => {
    const b: StageTokens = { planning: use(1) };
    const r = addTokens(undefined, b);
    expect(r).toEqual(b);
    expect(r).not.toBe(b);
    expect(r!.planning).not.toBe(b.planning);
  });

  it('handles multiple stages including journeys, visual-review, and assessment', () => {
    const a: StageTokens = {
      journeys: use(1),
      'visual-review': use(2),
    };
    const b: StageTokens = {
      journeys: use(3),
      repair: use(4),
      assessment: use(5),
    };
    const result = addTokens(a, b);
    expect(result).toEqual({
      journeys: {
        requests: 4,
        promptTokens: 40,
        completionTokens: 20,
        reasoningTokens: 8,
        truncated: 0,
      },
      'visual-review': use(2),
      repair: use(4),
      assessment: use(5),
    });
  });

  it('accumulates usage across multiple sequential calls', () => {
    let budget: StageTokens | undefined;
    budget = addTokens(budget, { journeys: use(1) });
    budget = addTokens(budget, { planning: use(2) });
    budget = addTokens(budget, { journeys: use(2), planning: use(1) });
    budget = addTokens(budget, {});
    budget = addTokens(budget, undefined);

    expect(budget).toEqual({
      journeys: {
        requests: 3,
        promptTokens: 30,
        completionTokens: 15,
        reasoningTokens: 6,
        truncated: 0,
      },
      planning: {
        requests: 3,
        promptTokens: 30,
        completionTokens: 15,
        reasoningTokens: 6,
        truncated: 0,
      },
    });
  });
});
