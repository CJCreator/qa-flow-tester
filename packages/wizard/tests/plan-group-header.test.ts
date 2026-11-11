import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/components/plan/PlanDocument.tsx'), 'utf8');

describe('Plan group header', () => {
  it('keeps every control out of the <summary>', () => {
    const summaries = [...source.matchAll(/<summary[\s\S]*?<\/summary>/g)].map((m) => m[0]);
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      expect(s).not.toMatch(/<button|<BulkSwitch|actions\}/);
    }
  });
  it('no longer has a headerRight prop', () => {
    expect(source).not.toContain('headerRight');
  });
});
