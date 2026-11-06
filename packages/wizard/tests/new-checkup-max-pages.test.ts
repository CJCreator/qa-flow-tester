import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { committedMaxPages, DEFAULT_MAX_PAGES } from '../src/lib/form';

const source = readFileSync(fileURLToPath(new URL('../src/screens/NewCheckupScreen.tsx', import.meta.url)), 'utf8');

describe('W17: Enter submits the max-pages value shown', () => {
  it('a typed but uncommitted value is the one submitted, and is marked changed', () => {
    // Stored 100 (the default is different), the user types 250 and presses Enter without leaving the box.
    expect(committedMaxPages('250', 100)).toEqual({ value: 250, changed: true });
  });

  it('a typed value equal to the stored one needs no commit', () => {
    expect(committedMaxPages('100', 100)).toEqual({ value: 100, changed: false });
  });

  it('the typed value is clamped the same way the blur commit clamps it', () => {
    expect(committedMaxPages('5000', 100)).toEqual({ value: 1000, changed: true });
    expect(committedMaxPages('0', 100)).toEqual({ value: 1, changed: true });
    expect(committedMaxPages('', DEFAULT_MAX_PAGES)).toEqual({ value: DEFAULT_MAX_PAGES, changed: false });
  });

  it('the form submit commits the field first and runs the submit once the form has the value', () => {
    expect(source).toContain('const typedMax = committedMaxPages(maxPagesText, form.maxPages);');
    expect(source).toContain('onFormChange((f) => ({ ...f, maxPages: typedMax.value }));');
    expect(source).toContain('setPendingMax(typedMax.value);');
    expect(source).toContain('if (pendingMax === null || form.maxPages !== pendingMax) return;');
  });
});
