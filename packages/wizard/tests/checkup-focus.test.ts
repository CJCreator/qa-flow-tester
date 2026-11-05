import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { neighbourAfterDelete } from '../src/lib/checkup-focus';

const list = [
  { runId: 'a', host: 'shop.example' },
  { runId: 'b', host: 'shop.example' },
  { runId: 'c', host: 'shop.example' },
  { runId: 'd', host: 'blog.example' },
];

describe('neighbourAfterDelete (focus after delete, W2)', () => {
  it('picks the next row of the same site', () => {
    expect(neighbourAfterDelete(list, 'a')).toBe('b');
  });

  it('picks the row before when the deleted one was last in its site', () => {
    expect(neighbourAfterDelete(list, 'c')).toBe('b');
  });

  it('returns null when the site has no other check-up (focus goes to the heading)', () => {
    expect(neighbourAfterDelete(list, 'd')).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(neighbourAfterDelete(list, 'zzz')).toBeNull();
  });
});

describe('PastCheckupsScreen focus wiring (W2)', () => {
  it('moves focus to the neighbour row or the heading after delete', () => {
    const src = readFileSync(new URL('../src/screens/PastCheckupsScreen.tsx', import.meta.url), 'utf8');
    expect(src).toContain('neighbourAfterDelete(');
    expect(src).toContain("document.querySelector<HTMLElement>('h1')?.focus()");
    expect(src).toContain('data-run-id={run.runId}');
  });
});
