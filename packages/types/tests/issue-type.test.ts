import { describe, it, expect } from 'vitest';
import { ISSUE_TYPES, issueTypeOf } from '../src/issue-type.js';

describe('issueTypeOf', () => {
  it('lists eight types ending with Other', () => {
    expect(ISSUE_TYPES).toHaveLength(8);
    expect(ISSUE_TYPES[7]).toBe('Other');
  });
  it('maps checkers', () => {
    expect(issueTypeOf({ checker: 'spec-conformance' })).toBe('Logical flow');
    expect(issueTypeOf({ checker: 'bug-detection', needsJudgement: true })).toBe('Logical flow');
    expect(issueTypeOf({ checker: 'bug-detection' })).toBe('Broken flow');
    expect(issueTypeOf({ checker: 'bug-detection', aspect: 'Accessible' })).toBe('Accessibility');
    expect(issueTypeOf({ checker: 'permission-matrix' })).toBe('Access');
    expect(issueTypeOf({ checker: 'bug-detection', intent: 'denied' })).toBe('Access');
    expect(issueTypeOf({ checker: 'security' })).toBe('Security');
    expect(issueTypeOf({ checker: 'performance' })).toBe('Performance');
    expect(issueTypeOf({ checker: 'design-standards' })).toBe('UI/UX');
    expect(issueTypeOf({ checker: 'ux-quality' })).toBe('Accessibility');
    expect(issueTypeOf({ checker: 'ux-quality', aspect: 'Accessible' })).toBe('Accessibility');
    expect(issueTypeOf({ checker: 'ux-quality', aspect: 'Fast and mobile' })).toBe('UI/UX');
    expect(issueTypeOf({ checker: 'ux-quality', aspect: 'Looks and reads well' })).toBe('UI/UX');
    expect(issueTypeOf({ checker: 'seo' })).toBe('Other');
    expect(issueTypeOf({ checker: 'ai-review', categoryTag: 'GEO' })).toBe('Other');
  });
});
