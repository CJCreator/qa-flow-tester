import { describe, it, expect } from 'vitest';
import { createStepBudget, resolveStepTimeoutMs, DEFAULT_STEP_TIMEOUT_MS } from '../src/step-budget.js';

describe('missing-element step cap value', () => {
  it('a missing-element cap of 0, NaN or negative falls back to 10 s', () => {
    for (const bad of [0, -5, NaN, Infinity, 'abc', '', undefined, null, {}]) {
      expect(resolveStepTimeoutMs(bad)).toBe(DEFAULT_STEP_TIMEOUT_MS);
    }
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(10_000);
  });

  it('a missing-element cap keeps a valid number or numeric text and limits a huge one to 300000', () => {
    expect(resolveStepTimeoutMs(2000)).toBe(2000);
    expect(resolveStepTimeoutMs('15000')).toBe(15000);
    expect(resolveStepTimeoutMs(10_000_000)).toBe(300_000);
  });
});

describe('missing-element step budget', () => {
  it('shrinks as time passes and is spent at the cap', () => {
    let t = 1000;
    const budget = createStepBudget(10_000, 1000, () => t);
    expect(budget.remaining()).toBe(10_000);
    expect(budget.spent()).toBe(false);
    t = 4000;
    expect(budget.remaining()).toBe(7000);
    t = 11_000;
    expect(budget.remaining()).toBe(0);
    expect(budget.spent()).toBe(true);
  });

  it('clamp cuts a timeout to what is left', () => {
    let t = 0;
    const budget = createStepBudget(10_000, 0, () => t);
    expect(budget.clamp(4000)).toBe(4000);
    expect(budget.clamp(Infinity)).toBe(10_000);
    t = 8000;
    expect(budget.clamp(4000)).toBe(2000);
    expect(budget.clamp(Infinity)).toBe(2000);
  });

  it('a missing-element step never runs with timeout 0', () => {
    let t = 0;
    const budget = createStepBudget(1000, 0, () => t);
    t = 5000;
    expect(budget.spent()).toBe(true);
    expect(budget.clamp(4000)).toBeGreaterThanOrEqual(1);
    expect(budget.clamp(Infinity)).toBeGreaterThanOrEqual(1);
  });
});
