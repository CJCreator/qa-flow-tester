import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../src/screens/PlanReviewScreen.tsx'), 'utf8');

describe('Plan Review approve', () => {
  it('never calls onApprove straight from a button: it goes through approve(), which saves switches first', () => {
    expect(src).not.toMatch(/onClick=\{\(\) => onApprove\(\)\}/);
    expect(src).not.toMatch(/onSubmit=\{\(roles\) => onApprove\(roles\)\}/);
    expect(src).toMatch(/if \(!\(await flushToggles\(\)\)\) return;\s*onApprove\(roles\);/);
  });
});
