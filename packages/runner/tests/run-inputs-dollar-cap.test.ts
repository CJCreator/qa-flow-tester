import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, knownPrice } from '@qa/core';
import { checkDollarCapPrice } from '../src/run-inputs.js';

describe('run-inputs: checkDollarCapPrice', () => {
  it('refuses a dollar cap when the model has no price', () => {
    const r = checkDollarCapPrice({ dollars: 2 }, 'openai', undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.code).toBe('ERR_CAP_NO_PRICE');
  });

  it('accepts a dollar cap when the model has a price', () => {
    const r = checkDollarCapPrice({ dollars: 2 }, 'openai', { prompt: 2.5, completion: 10 });
    expect(r).toEqual({ ok: true, value: { dollars: 2 } });
  });

  it('accepts a request-only cap with no price', () => {
    const r = checkDollarCapPrice({ requests: 5 }, 'openrouter', null);
    expect(r).toEqual({ ok: true, value: { requests: 5 } });
  });

  it('knows the default models of the paid providers, and not an unknown one', () => {
    expect(knownPrice('anthropic', DEFAULT_MODELS.anthropic)).toBeDefined();
    expect(knownPrice('openai', 'no-such-model')).toBeUndefined();
  });
});
