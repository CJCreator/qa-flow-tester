import type { AspectGrade } from '@qa/types';

/**
 * The palette tokens each grade is drawn in: A and B pass, C and D warn, F fails. Only palette
 * tokens, so tests/contrast.test.ts checks every pairing.
 */
export const GRADE_TOKENS: Record<
  AspectGrade,
  { text: 'pass' | 'warn' | 'fail'; tint: 'pass-tint' | 'warn-tint' | 'fail-tint' }
> = {
  A: { text: 'pass', tint: 'pass-tint' },
  B: { text: 'pass', tint: 'pass-tint' },
  C: { text: 'warn', tint: 'warn-tint' },
  D: { text: 'warn', tint: 'warn-tint' },
  F: { text: 'fail', tint: 'fail-tint' },
};

/** The same, as whole class names, so Tailwind finds them in the source. */
const TONE_CLASSES = {
  pass: 'border-pass bg-pass-tint text-pass',
  warn: 'border-warn bg-warn-tint text-warn',
  fail: 'border-fail bg-fail-tint text-fail',
} as const;

export function gradeClasses(grade: AspectGrade): string {
  return TONE_CLASSES[GRADE_TOKENS[grade].text];
}
