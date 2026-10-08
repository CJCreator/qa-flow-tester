import { describe, it, expect } from 'vitest';
import type { TestCaseStep } from '@qa/types';
import { EntityNamespacer } from '../src/entity-namespacing.js';

const fill = (value: string | undefined, name = 'Type a value', selector = '[data-testid="f"]'): TestCaseStep => ({
  action: 'fill',
  selector,
  name,
  value,
});

describe('namespacing: run token', () => {
  it('namespacing: runToken is stable for same run+test+breakpoint', () => {
    expect(EntityNamespacer.runToken('run-1', 'TC-1', 'mobile')).toBe(
      EntityNamespacer.runToken('run-1', 'TC-1', 'mobile')
    );
  });

  it('namespacing: runToken differs per run, test and breakpoint, is 6 letters', () => {
    const a = EntityNamespacer.runToken('run-1', 'TC-1', 'mobile');
    const others = [
      EntityNamespacer.runToken('run-2', 'TC-1', 'mobile'),
      EntityNamespacer.runToken('run-1', 'TC-2', 'mobile'),
      EntityNamespacer.runToken('run-1', 'TC-1', 'desktop'),
    ];
    expect(a).toMatch(/^[a-z]{6}$/);
    for (const o of others) {
      expect(o).toMatch(/^[a-z]{6}$/);
      expect(o).not.toBe(a);
    }
  });

  it('namespacing: injectStepValues with a run token is the same on every call', () => {
    const step = fill('{{unique}} and {{entityName}}');
    const one = EntityNamespacer.injectStepValues(step, 1, 'abcdef');
    const two = EntityNamespacer.injectStepValues(step, 1, 'abcdef');
    expect(one.value).toBe(two.value);
    expect(one.value).toBe('w1_abcdef and entity_w1_abcdef');
  });

  it('namespacing: legacy injectStepValues without token still random-unique', () => {
    const step = fill('{{unique}}');
    const one = EntityNamespacer.injectStepValues(step, 1);
    const two = EntityNamespacer.injectStepValues(step, 1);
    expect(one.value).toMatch(/^w1_/);
    expect(one.value).not.toBe(two.value);
  });
});

describe('namespacing: fill values', () => {
  const token = 'abcdef';

  it('namespacing: email gets plus-address, free text gets suffix, idempotent', () => {
    const email = EntityNamespacer.namespaceFillValue(fill('jo@example.com', 'Type email'), token);
    expect(email).toBe('jo+abcdef@example.com');
    expect(EntityNamespacer.namespaceFillValue(fill(email, 'Type email'), token)).toBe(email);

    const text = EntityNamespacer.namespaceFillValue(fill('Jane Doe', 'Type name'), token);
    expect(text).toBe('Jane Doe abcdef');
    expect(EntityNamespacer.namespaceFillValue(fill(text, 'Type name'), token)).toBe(text);

    expect(EntityNamespacer.namespaceFillValue(fill('{{unique}}'), token)).toBe('w_abcdef');
    expect(EntityNamespacer.namespaceFillValue(fill('{{entityName}}'), token)).toBe('entity_w_abcdef');
  });

  it('namespacing: leaves digits, phone, date, password-hinted, long and empty values unchanged', () => {
    expect(EntityNamespacer.namespaceFillValue(fill('12345'), token)).toBe('12345');
    expect(EntityNamespacer.namespaceFillValue(fill('Jane', 'Type phone'), token)).toBe('Jane');
    expect(EntityNamespacer.namespaceFillValue(fill('2026-01-01', 'Type date'), token)).toBe('2026-01-01');
    expect(EntityNamespacer.namespaceFillValue(fill('hunter two', 'Type password'), token)).toBe('hunter two');
    const long = 'a'.repeat(120);
    expect(EntityNamespacer.namespaceFillValue(fill(long), token)).toBe(long);
    expect(EntityNamespacer.namespaceFillValue(fill(''), token)).toBe('');
    expect(EntityNamespacer.namespaceFillValue(fill(undefined), token)).toBe('');
  });

  it('namespacing: never touches {{username}}/{{password}}', () => {
    expect(EntityNamespacer.namespaceFillValue(fill('{{username}}', 'Type email'), token)).toBe('{{username}}');
    expect(EntityNamespacer.namespaceFillValue(fill('{{password}}'), token)).toBe('{{password}}');
  });
});
