import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOL_REF, toolRefFor, workflowFor } from '../src/lib/workflow';

const root = resolve(__dirname, '../../..');

describe('workflow template', () => {
  it('fills the ref and leaves no placeholder', () => {
    const out = workflowFor('https://x.test');
    expect(out).not.toContain('__QA_TOOL_REF__');
    expect(out).not.toContain('__DEFAULT_URL__');
    expect(out).toContain(`ref: ${TOOL_REF}`);
    expect(out).not.toContain('v0.1.0');
    expect(out).toContain("default: 'https://x.test'");
  });

  it('toolRefFor accepts only a full 40-hex SHA, lower-cased, else main', () => {
    const sha = 'ABCDEF0123456789abcdef0123456789ABCDEF01';
    expect(toolRefFor(sha)).toBe(sha.toLowerCase());
    for (const bad of ['', undefined, 'abc1234', 'main', `${sha}\n`]) expect(toolRefFor(bad)).toBe('main');
  });

  it('ref is main or 40 hex characters', () => {
    expect(TOOL_REF === 'main' || /^[0-9a-f]{40}$/.test(TOOL_REF)).toBe(true);
    expect(workflowFor('https://x.test')).toContain(`ref: ${TOOL_REF}`);
  });

  it('every action in the template is pinned to a commit SHA', () => {
    const raw = readFileSync(resolve(root, 'templates/qa-check.yml'), 'utf8');
    const uses = raw.split(/\r?\n/).filter((l) => /\buses:/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const line of uses) expect(line).toMatch(/@[0-9a-f]{40}\b/);
  });

  it('the AI key is given to the check-up step only, not the job', () => {
    const raw = readFileSync(resolve(root, 'templates/qa-check.yml'), 'utf8').replace(/\r\n/g, '\n');
    const [head, ...steps] = raw.split('- name:');
    const envBlock = head.slice(head.indexOf('    env:'));
    expect(envBlock).not.toContain('secrets.QA_AI_API_KEY');
    const run = steps.find((s) => s.startsWith(' Run the check-up'));
    expect(run).toContain('QA_AI_API_KEY: ${{ secrets.QA_AI_API_KEY }}');
    expect(steps.filter((s) => s.includes('secrets.QA_AI_API_KEY')).length).toBe(1);
  });

  it('url quote is escaped', () => {
    expect(workflowFor("https://x.test/a'b")).toContain("a''b");
  });

  it('permissions are not widened', () => {
    const out = workflowFor('https://x.test').replace(/\r\n/g, '\n');
    expect(out).toContain('permissions:\n  contents: read');
    expect(out).not.toContain('contents: write');
    expect(out).not.toContain('id-token');
    expect(out).not.toContain('pull-requests: write');
  });

  it('the template file keeps the placeholder', () => {
    const raw = readFileSync(resolve(root, 'templates/qa-check.yml'), 'utf8');
    expect(raw.split('__QA_TOOL_REF__').length - 1).toBe(1);
  });
});
