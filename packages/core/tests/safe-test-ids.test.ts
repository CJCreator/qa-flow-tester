import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { safeIdPart, pathInside, testPointDir } from '../src/safe-id.js';
import { TestPlanner } from '../src/discovery/test-planner.js';
import { expandValidationTestCases } from '../src/validator-expander.js';
import type { DiscoveryDraft, TestCase } from '@qa/types';

describe('safeIdPart', () => {
  it('preserves valid characters and replaces unsafe ones', () => {
    expect(safeIdPart('TC-FLOW-001')).toBe('TC-FLOW-001');
    expect(safeIdPart('../../etc/x')).toBe('______etc_x');
    expect(safeIdPart('a:b/c\\d')).toBe('a_b_c_d');
    expect(safeIdPart('')).toBe('_');
    const longId = 'a'.repeat(200);
    expect(safeIdPart(longId)).toBe('a'.repeat(80));
    expect(safeIdPart(longId).length).toBe(80);
  });
});

describe('pathInside and testPointDir', () => {
  it('keeps testPointDir inside evidenceDir even with traversal attempts', () => {
    const dir = '/run/evidence';
    const result1 = testPointDir(dir, '../../outside', '1440px');
    const rel1 = path.relative(path.resolve(dir), result1);
    expect(rel1.startsWith('..')).toBe(false);
    const base1 = path.basename(result1);
    expect(base1).not.toContain('/');
    expect(base1).not.toContain('\\');
    expect(base1).not.toContain('..');

    const result2 = testPointDir(dir, 'TC-1', '../../x');
    const rel2 = path.relative(path.resolve(dir), result2);
    expect(rel2.startsWith('..')).toBe(false);
    const base2 = path.basename(result2);
    expect(base2).not.toContain('/');
    expect(base2).not.toContain('\\');
    expect(base2).not.toContain('..');
  });

  it('pathInside throws if leaving dir and resolves when inside', () => {
    expect(() => pathInside('/run/base', '../x.png')).toThrow('A test file name would leave its folder.');
    expect(pathInside('/run/base', 'TC-1-1440px.png')).toBe(path.resolve('/run/base', 'TC-1-1440px.png'));
  });
});

describe('TestPlanner with unsafe flow IDs', () => {
  it('generates safe, unique test case IDs and preserves flowId', () => {
    const draft: DiscoveryDraft = {
      version: '1.0',
      productId: 'test-product',
      targetUrl: 'http://localhost:3000',
      timestamp: new Date().toISOString(),
      pages: [{ urlPath: '/app', title: 'App', interactiveElementsCount: 1, formsCount: 0 }],
      forms: [],
      ambiguityQuestions: [],
      sensitiveActions: [],
      flows: [
        {
          id: '../evil',
          name: 'Evil 1',
          role: 'anon',
          description: 'Flow with traversal id',
          startPage: '/app',
          steps: [{ action: 'click', selector: '#btn1', name: 'Click 1' }],
        },
        {
          id: '.._evil',
          name: 'Evil 2',
          role: 'anon',
          description: 'Flow with traversal id 2',
          startPage: '/app',
          steps: [{ action: 'click', selector: '#btn2', name: 'Click 2' }],
        },
      ],
    };

    const planner = new TestPlanner();
    const spec = planner.plan(draft);
    expect(spec.testCases).toHaveLength(2);
    const [tc1, tc2] = spec.testCases;
    expect(tc1.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tc2.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tc1.id).not.toBe(tc2.id);
    expect(tc1.flowId).toBe('../evil');
    expect(tc2.flowId).toBe('.._evil');
  });
});

describe('expandValidationTestCases with unsafe field names', () => {
  it('produces safe test IDs for all expanded validation test cases', () => {
    const testCases: TestCase[] = [
      {
        id: 'TC-1',
        flowId: 'test-flow',
        role: 'user',
        startPage: '/form',
        steps: [
          { action: 'fill', selector: '[data-testid="../x-field"]', value: 'hello', name: 'Fill' },
          { action: 'click', selector: '#submit', name: 'Submit' },
        ],
        expectations: { url: { pattern: '/*' } },
        validationRules: [
          {
            field: '../x',
            min: 1,
            max: 100,
            expectedError: 'Required',
          },
        ],
      },
    ];

    const expanded = expandValidationTestCases(testCases);
    expect(expanded.length).toBeGreaterThan(1);
    for (const tc of expanded) {
      expect(tc.id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
