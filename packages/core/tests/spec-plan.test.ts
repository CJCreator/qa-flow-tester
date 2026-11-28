import { describe, it, expect } from 'vitest';
import type { ParsedRequirementHint } from '@qa/types';
import { planFromSpec } from '../src/plan/spec-plan.js';
import { resolveRole, resolveRoleList } from '../src/plan/spec-roles.js';
import { crawlOf, el, page } from './helpers/spec-crawl.js';

const ROLES = ['Employee', 'Team Lead', 'Manager', 'HR/Admin', 'Alumni'];
const base = { document: 'spec.md', section: 'S' };
const hint = (h: Partial<ParsedRequirementHint> & { id: string }): ParsedRequirementHint => ({
  name: h.id,
  description: '',
  rules: [],
  ...base,
  ...h,
});
const pages = [
  page('/home'),
  page('/report', [el('Export', '#export')]),
  page('/requests', [el('New request', '#new'), el('Finalize run', '#fin'), el('Submit', '#submit')]),
];
const crawls = ROLES.map((r) => crawlOf(r, pages));
const plan = (hints: ParsedRequirementHint[], extra = {}) =>
  planFromSpec({ hints, roles: ROLES, crawls, readOnly: false, ...extra });

describe('resolveRole', () => {
  it('matches exact, whole-word and never guesses', () => {
    expect(resolveRole('HR / Admin', ROLES)).toBe('HR/Admin');
    expect(resolveRole('lead', ROLES)).toBe('Team Lead');
    expect(resolveRole('HR', ROLES)).toBe('HR/Admin');
    expect(resolveRole('Employee — Aarav Sharma', ROLES)).toBe('Employee');
    expect(resolveRole('Alumni (settled)', ROLES)).toBe('Alumni');
    expect(resolveRole('Wizard', ROLES)).toBeUndefined();
  });
  it('lists: all, all active, + not guessed', () => {
    expect(resolveRoleList('all', ROLES).roles).toEqual(ROLES);
    expect(resolveRoleList('all active', ROLES).roles).not.toContain('Alumni');
    expect(resolveRoleList('lead / manager / HR', ROLES).roles).toEqual(['Team Lead', 'Manager', 'HR/Admin']);
    expect(resolveRoleList('lead+', ROLES)).toEqual({ roles: [], unresolved: ['lead+'] });
  });
});

describe('planFromSpec', () => {
  const journey = hint({
    id: 'REQ-1',
    kind: 'journey',
    name: 'Leave',
    persona: 'Employee',
    preconditions: ['Onboarded'],
    steps: ['`/requests`', 'press `New request`', 'do magic'],
    assert: ['land on /home', 'status "Applied"', 'password complexity enforced server-side'],
  });
  const hints = [
    journey,
    hint({ id: 'REQ-2', kind: 'route', name: 'Report', route: '/report', rolesText: 'lead / manager / HR' }),
    hint({ id: 'REQ-3', kind: 'route', name: 'Gone', route: '/nowhere', rolesText: 'all' }),
    hint({ id: 'REQ-4', kind: 'route', name: 'Api', route: '/api/x', rolesText: 'all' }),
    hint({
      id: 'REQ-5',
      kind: 'negative',
      name: 'Negative specs',
      persona: 'Employee',
      rules: ['cannot open `/report` (redirect to `/home`)', 'cannot edit others (RLS)'],
    }),
    hint({ id: 'REQ-6', kind: 'capability', name: 'Run payroll', cells: { Employee: '❌', 'HR/Admin': '✅' } }),
  ];

  it('every item has docSource and a role; deterministic', () => {
    const a = plan(hints);
    expect(a).toEqual(plan(hints));
    for (const f of a.flows) expect(f.docSource?.document).toBe('spec.md');
    for (const t of a.pageTests) {
      expect(t.test.docSource?.requirementId).toMatch(/^REQ-/);
      expect(ROLES).toContain(t.test.role);
    }
  });

  it('flow: steps matched to routes/controls, unmatched kept as judgement', () => {
    const f = plan(hints).flows.find((x) => x.id === 'spec-REQ-1')!;
    expect(f.role).toBe('Employee');
    expect(f.steps.map((s) => s.action)).toEqual(['navigate', 'click']);
    expect(f.userRules?.some((r) => r.text === 'Step not run: do magic' && !r.checkable)).toBe(true);
    expect(f.userRules?.some((r) => r.text.startsWith('Precondition'))).toBe(true);
  });

  it('assertions: url and text become expectations, free text a judgement entry', () => {
    const f = plan(hints).flows.find((x) => x.id === 'spec-REQ-1')!;
    expect(f.candidateExpectations?.url?.pattern).toBe('/home');
    expect(f.candidateExpectations?.text?.contains).toBe('Applied');
    expect(f.candidateExpectations?.origin).toBe('ai-guess');
    expect(f.userRules?.some((r) => r.text.includes('password complexity'))).toBe(true);
  });

  it('routes: reach for allowed, negate denial for others, one denial per (role, route), Negative spec wins', () => {
    const out = plan(hints);
    const ids = out.pageTests.map((t) => t.test.id);
    expect(ids).toContain('route-reach:Manager:/report');
    expect(ids).toContain('route-denial:Alumni:/report');
    expect(ids.filter((i) => i === 'route-denial:Employee:/report')).toHaveLength(1);
    const emp = out.pageTests.find((t) => t.test.id === 'route-denial:Employee:/report')!.test;
    expect(emp.docSource?.requirementId).toBe('REQ-5');
    expect(emp.expectations?.url?.negate).toBe(true);
    expect(emp.intent).toBe('denied');
  });

  it('absent route is Not found, /api skipped', () => {
    const out = plan(hints);
    expect(out.notFound.map((n) => n.id)).toEqual(['notfound:REQ-3']);
    expect(out.pageTests.some((t) => t.urlPath.startsWith('/api') || t.urlPath === '/nowhere')).toBe(false);
  });

  it('matrix and non-route negative clauses are judgement only', () => {
    const out = plan(hints);
    expect(out.judgement.some((j) => j.role === 'Employee' && j.text.startsWith('Run payroll: not allowed'))).toBe(
      true
    );
    expect(out.judgement.some((j) => j.text.startsWith('cannot edit others'))).toBe(true);
  });

  it('persona without a role and all-unmatched steps need help', () => {
    const out = plan([
      hint({ id: 'REQ-1', kind: 'journey', name: 'A', persona: 'Wizard', steps: ['x'] }),
      hint({ id: 'REQ-2', kind: 'journey', name: 'B', persona: 'Employee', steps: ['nothing here'] }),
    ]);
    expect(out.flows[0].needsHelp).toEqual(['No role named "Wizard" in this Check-up']);
    expect(out.flows[1].needsHelp).toEqual(['None of the steps could be matched to a page or control']);
  });

  it('lead+ is not guessed', () => {
    const out = plan([hint({ id: 'REQ-1', kind: 'route', name: 'R', route: '/report', rolesText: 'lead+' })]);
    expect(out.pageTests.some((t) => t.test.intent === 'denied')).toBe(false);
    expect(out.notes.join(' ')).toContain('lead+');
    expect(out.judgement.length).toBe(1);
  });

  it('sensitive control never becomes a step; state-changing click sets needsTestCopy', () => {
    const out = plan([
      hint({
        id: 'REQ-1',
        kind: 'journey',
        name: 'J',
        persona: 'Employee',
        steps: ['click `Finalize run`', 'click `Submit`'],
      }),
    ]);
    const f = out.flows[0];
    expect(f.steps.filter((s) => s.action === 'click').map((s) => s.selector)).toEqual(['#submit']);
    expect(f.userRules?.some((r) => r.text.startsWith('Left out by the Safety Filter'))).toBe(true);
    expect(f.needsTestCopy).toBe(true);
  });

  it('skipRequirementIds leaves reached units alone', () => {
    const out = plan(hints, { skipRequirementIds: new Set(['REQ-1', 'REQ-2']) });
    expect(out.flows.some((f) => f.id === 'spec-REQ-1')).toBe(false);
    expect(out.pageTests.some((t) => t.test.docSource?.requirementId === 'REQ-2')).toBe(false);
  });
});
