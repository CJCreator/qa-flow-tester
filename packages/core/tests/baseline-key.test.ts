import { describe, it, expect } from 'vitest';
import { baselineKey } from '../src/plan/baseline-key.js';

const base = { targetUrl: 'https://shop.example.com', planItemId: 'page:/cart', testCaseId: 'PAGE-003', role: 'admin' };

describe('baselineKey', () => {
  it('gives different keys for the same Plan Item and role on two hosts', () => {
    const other = { ...base, targetUrl: 'https://blog.example.com' };
    expect(baselineKey(base)).not.toBe(baselineKey(other));
  });

  it('gives different keys when PAGE-003 means two different Plan Items after a re-plan', () => {
    const before = { ...base, planItemId: 'page:/cart', testCaseId: 'PAGE-003' };
    const after = { ...base, planItemId: 'page:/checkout', testCaseId: 'PAGE-003' };
    expect(baselineKey(before)).not.toBe(baselineKey(after));
  });

  it('gives the same key for the same inputs', () => {
    expect(baselineKey(base)).toBe(baselineKey({ ...base }));
  });

  it('keeps the same key when the test case id changes but the Plan Item does not', () => {
    expect(baselineKey(base)).toBe(baselineKey({ ...base, testCaseId: 'PAGE-007' }));
  });

  it('uses only file-name-safe characters, also for a role with a space and a path with a query', () => {
    const key = baselineKey({ ...base, role: 'shop owner', planItemId: '/a/b?x=1' });
    expect(key).toMatch(/^[\w-]+$/);
    expect(key).toContain('shop-owner');
  });

  it('tells localhost:3050 and localhost:3051 apart', () => {
    const a = baselineKey({ ...base, targetUrl: 'http://localhost:3050' });
    const b = baselineKey({ ...base, targetUrl: 'http://localhost:3051' });
    expect(a).not.toBe(b);
  });

  it('falls back to the test case id when there is no Plan Item id', () => {
    const key = baselineKey({ targetUrl: 'https://shop.example.com', testCaseId: 'PAGE-001', role: 'admin' });
    expect(key).toMatch(/^[\w-]+$/);
    expect(key).not.toBe(baselineKey(base));
  });
});
