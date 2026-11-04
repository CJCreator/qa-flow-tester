/** Rejects Plan Items (ADR 0024): planned from the form's own rules, no AI. No browser. */
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

const signup: PlannerForm = {
  urlPath: '/lab/signup',
  method: 'POST',
  submitButtonSelector: '#go',
  inputs: [
    { selector: '#email', label: 'Email', type: 'email', required: true },
    { selector: '#code', label: 'Code', type: 'text', required: true, pattern: '[A-Z]{3}[0-9]{2}' },
    { selector: '#age', label: 'Age', type: 'number', min: '18', max: '99' },
  ],
};

describe('deriveRejects', () => {
  it('plans required, email, pattern, min and max items with no AI key', () => {
    const out = deriveRejects([page('/lab/signup')], [signup]);
    const names = out.map((o) => o.test.name);
    expect(names).toContain('Rejects: “Email” left empty');
    expect(names).toContain('Rejects: “Email” is not an email address');
    expect(names).toContain('Rejects: “Code” left empty');
    expect(names).toContain('Rejects: “Code” does not match the expected format');
    expect(names).toContain('Rejects: “Age” is below the minimum');
    expect(names).toContain('Rejects: “Age” is above the maximum');
    for (const { test } of out) {
      expect(test.intent).toBe('rejects');
      expect(test.needsTestCopy).toBe(true);
      expect(test.source).toBe('fallback');
      expect(test.expectations?.refusal).toEqual({ formPath: '/lab/signup', submitSelector: '#go' });
      expect(test.expectations?.origin).toBe('observed');
      expect(test.expectations?.refusal?.message).toBeUndefined();
      expect(test.steps[test.steps.length - 1]).toMatchObject({ action: 'click', selector: '#go' });
    }
  });

  it('breaks one rule at a time: other fields get values they accept', () => {
    const out = deriveRejects([page('/lab/signup')], [signup]);
    const emptyEmail = out.find((o) => o.test.name === 'Rejects: “Email” left empty')!.test;
    const fills = Object.fromEntries(
      emptyEmail.steps.filter((s) => s.action === 'fill').map((s) => [s.selector, s.value])
    );
    expect(fills['#email']).toBe('');
    expect(fills['#code']).toMatch(/^[A-Z]{3}[0-9]{2}$/);
  });

  it('breaks min and max by one', () => {
    const out = deriveRejects([page('/lab/signup')], [signup]);
    const val = (name: string) =>
      out.find((o) => o.test.name === name)!.test.steps.find((s) => s.selector === '#age')!.value;
    expect(val('Rejects: “Age” is below the minimum')).toBe('17');
    expect(val('Rejects: “Age” is above the maximum')).toBe('100');
  });

  it('plans one item per role that reaches the page, with stable ids', () => {
    const roles = page('/lab/signup', { reachedBy: ['visitor', 'Admin'] });
    const a = deriveRejects([roles], [signup]);
    const b = deriveRejects([roles], [signup]);
    expect(a.map((o) => o.test.id)).toEqual(b.map((o) => o.test.id));
    expect(new Set(a.map((o) => o.test.id)).size).toBe(a.length);
    expect(a.filter((o) => o.test.name === 'Rejects: “Email” left empty').map((o) => o.test.role)).toEqual([
      'visitor',
      'Admin',
    ]);
    expect(a[0].test.id).toMatch(/^rejects:\/lab\/signup:0:#email:required:visitor$/);
  });

  it('plans nothing for a GET form (a search box)', () => {
    const search: PlannerForm = {
      urlPath: '/s',
      method: 'GET',
      submitButtonSelector: '#q-go',
      inputs: [{ selector: '#q', label: 'Search', type: 'text', required: true }],
    };
    expect(deriveRejects([page('/s')], [search])).toEqual([]);
    expect(deriveRejects([page('/s')], [{ ...search, method: undefined }])).toEqual([]);
  });

  it('skips a pattern no tried value breaks, and a number with no min or max', () => {
    const form: PlannerForm = {
      urlPath: '/f',
      method: 'POST',
      submitButtonSelector: '#go',
      inputs: [
        { selector: '#any', label: 'Anything', type: 'text', pattern: '.*' },
        { selector: '#n', label: 'Count', type: 'number' },
      ],
    };
    expect(deriveRejects([page('/f')], [form])).toEqual([]);
  });

  it('skips an item when another required field has no value that fits its pattern', () => {
    const form: PlannerForm = {
      urlPath: '/f',
      method: 'POST',
      submitButtonSelector: '#go',
      inputs: [
        { selector: '#a', label: 'A', type: 'text', required: true },
        { selector: '#b', label: 'B', type: 'text', required: true, pattern: '(foo|bar)x' },
      ],
    };
    const names = deriveRejects([page('/f')], [form]).map((o) => o.test.name);
    expect(names).not.toContain('Rejects: “A” left empty');
  });

  it('ignores covered and switched-off pages, and forms with no submit button', () => {
    expect(deriveRejects([page('/lab/signup', { coverage: 'covered' })], [signup])).toEqual([]);
    expect(deriveRejects([page('/lab/signup', { skipped: true })], [signup])).toEqual([]);
    expect(deriveRejects([page('/lab/signup')], [{ ...signup, submitButtonSelector: undefined }])).toEqual([]);
  });

  it('carries the Source of a planned test that uses the form, but no message', () => {
    const docSource = { document: 'spec.md', section: 'Signup', requirementId: 'REQ-9' };
    const p = page('/lab/signup', {
      tests: [
        {
          id: 'pagetest:/lab/signup:1',
          name: 'Sign up',
          role: 'visitor',
          steps: [{ action: 'click', selector: '#go', name: 'Go' }],
          source: 'ai',
          docSource,
        },
      ],
    });
    const out = deriveRejects([p], [signup]);
    expect(out.length).toBeGreaterThan(0);
    for (const { test } of out) {
      expect(test.docSource).toEqual(docSource);
      expect(test.expectations?.refusal?.message).toBeUndefined();
    }
  });
});
