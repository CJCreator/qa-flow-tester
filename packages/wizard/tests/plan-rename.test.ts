import { describe, expect, it } from 'vitest';
import { staysInForm } from '../src/components/plan/PlanDocument';

describe('Plan rename field', () => {
  const inside = {} as EventTarget;
  const form = { contains: (n: Node | null) => n === (inside as unknown as Node) };

  it('does not treat focus moving to Save or Cancel as leaving', () => {
    expect(staysInForm(form, inside)).toBe(true);
  });
  it('treats focus leaving the form as leaving', () => {
    expect(staysInForm(form, {} as EventTarget)).toBe(false);
    expect(staysInForm(form, null)).toBe(false);
    expect(staysInForm(null, inside)).toBe(false);
  });
});
