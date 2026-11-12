/** Form constraints checked in the browser: hostile or oversized pattern and minlength (T-305). No browser. */
import { describe, it, expect } from 'vitest';
import type { PlanPage } from '@qa/types';
import { deriveRejects } from '../src/plan/rejects.js';
import type { PlannerForm } from '../src/plan/ai-planner.js';

const page = (urlPath: string, extra: Partial<PlanPage> = {}): PlanPage => ({
  id: `page:${urlPath}`,
  urlPath,
  title: urlPath,
  coverage: 'tested',
  reachedBy: ['visitor'],
  tests: [],
  source: 'fallback',
  ...extra,
});

const form = (inputs: PlannerForm['inputs']): PlannerForm => ({
  urlPath: '/f',
  method: 'POST',
  submitButtonSelector: '#go',
  inputs,
});

describe('hostile forms', () => {
  it('a pattern that backtracks for minutes does not stop planning', () => {
    const start = performance.now();
    const out = deriveRejects(
      [page('/f')],
      [
        form([
          { selector: '#a', type: 'text', required: true, pattern: '(.*a){12}!' },
          { selector: '#b', type: 'text', required: true },
        ]),
      ]
    );
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(3000);
    const names = out.map((o) => o.test.name);
    expect(names.some((n) => n.includes('“#a” does not match'))).toBe(false);
  });

  it('a huge minlength plans no item and types no huge value', () => {
    const out = deriveRejects(
      [page('/f')],
      [
        form([
          { selector: '#a', type: 'text', minLength: 50_000_000 },
          { selector: '#b', type: 'text', required: true },
        ]),
      ]
    );
    expect(out.some((o) => o.test.name.includes('is too short'))).toBe(false);
    for (const { test } of out) {
      for (const step of test.steps) {
        if ('value' in step && typeof step.value === 'string') {
          expect(step.value.length).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  it('a huge repeat count in a pattern builds no huge value', () => {
    let out: ReturnType<typeof deriveRejects> = [];
    expect(() => {
      out = deriveRejects(
        [page('/f')],
        [
          form([
            { selector: '#a', type: 'text', required: true, pattern: 'a{100000000}' },
            { selector: '#b', type: 'text', required: true },
          ]),
        ]
      );
    }).not.toThrow();
    for (const { test } of out) {
      for (const step of test.steps) {
        if ('value' in step && typeof step.value === 'string') {
          expect(step.value.length).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  it('a pattern the browser ignores plans no pattern item', () => {
    const out = deriveRejects(
      [page('/f')],
      [
        form([
          { selector: '#a', type: 'text', required: true, pattern: '[A-Za-z0-9-_]+' },
          { selector: '#b', type: 'text', required: true },
        ]),
      ]
    );
    const names = out.map((o) => o.test.name);
    expect(names.some((n) => n.includes('does not match the expected format'))).toBe(false);
    expect(names).toContain('Rejects: “#b” left empty');
  });

  it('a pattern longer than 256 characters is not read', () => {
    const out = deriveRejects(
      [page('/f')],
      [
        form([
          { selector: '#a', type: 'text', required: true, pattern: 'a'.repeat(300) },
          { selector: '#b', type: 'text', required: true },
        ]),
      ]
    );
    const names = out.map((o) => o.test.name);
    expect(names.some((n) => n.includes('does not match the expected format'))).toBe(false);
  });
});
