import { describe, expect, it } from 'vitest';
import type { Finding, PlanNotFound } from '@qa/types';
import {
  confirmRolesEdit,
  docSourceLabel,
  documentedLine,
  notFoundByDocument,
  originLabel,
  parseRoles,
  removeNotFoundEdit,
  rolesLine,
  rolesToConfirm,
  severityEdit,
  staleEdit,
} from '../src/lib/plan-sources';
import { bucketOf, groupProblems, judgementByRole } from '../src/lib/summary';
import { translateReviewPlan } from '../src/lib/translate';
import { capOf, contextDocumentsOf, EMPTY_FORM, savedSessionsOf } from '../src/lib/form';

const nf = (id: string, document: string, skipped = false): PlanNotFound => ({
  id,
  docSource: { document, section: 'Billing' },
  roles: ['admin'],
  reason: 'No page or control matching “Billing” was found as admin',
  skipped,
});

describe('plan Source view helpers', () => {
  it('labels a Source with its document and section', () => {
    expect(docSourceLabel({ document: 'guide.md', section: 'Users > Create' })).toBe(
      'guide.md, section Users > Create'
    );
    expect(docSourceLabel({ document: 'guide.md' })).toBe('guide.md');
  });
  it('says who proposed or confirmed roles, and counts those to confirm', () => {
    expect(rolesLine({ proposedRoles: ['admin', 'anonymous'], rolesConfirmed: false })).toBe(
      'Roles proposed by the AI: admin, visitor'
    );
    expect(rolesLine({ proposedRoles: ['admin'], rolesConfirmed: true })).toBe('Roles (confirmed): admin');
    expect(rolesLine({})).toBeNull();
    const test = (c: boolean) => ({ docSource: { document: 'a.md' }, proposedRoles: ['admin'], rolesConfirmed: c });
    expect(rolesToConfirm({ planPages: [{ tests: [test(false), test(true)] }] } as never)).toBe(1);
  });
  it('marks planned-while-scanning and added-after-scan', () => {
    expect(originLabel('while-crawling')).toBe('Planned while scanning');
    expect(originLabel('after-crawl')).toBe('Added after the scan');
    expect(originLabel(undefined)).toBeNull();
  });
  it('builds the edit payloads', () => {
    expect(confirmRolesEdit('t1')).toEqual([{ itemId: 't1', confirm: true }]);
    expect(confirmRolesEdit('t1', ['admin'])).toEqual([{ itemId: 't1', confirm: true, roles: ['admin'] }]);
    expect(severityEdit('t1', 'Minor')).toEqual([{ itemId: 't1', severity: 'Minor' }]);
    expect(staleEdit('t1', true)).toEqual([{ itemId: 't1', stale: true }]);
    expect(removeNotFoundEdit('n1')).toEqual([{ id: 'n1', remove: true }]);
    expect(parseRoles(' Admin, viewer ,admin;')).toEqual(['admin', 'viewer']);
  });
  it('groups Not found by document and hides removed ones', () => {
    const groups = notFoundByDocument([nf('1', 'a.md'), nf('2', 'b.md'), nf('3', 'a.md'), nf('4', 'a.md', true)]);
    expect(groups.map((g) => [g.document, g.items.length])).toEqual([
      ['a.md', 2],
      ['b.md', 1],
    ]);
  });
  it('writes the documented-items line only with documents', () => {
    expect(documentedLine({ reached: 4, total: 6 })).toBe('4 of 6 documented items reached');
    expect(documentedLine({ reached: 0, total: 0 })).toBeNull();
    expect(documentedLine(undefined)).toBeNull();
  });
  it('keeps the new plan fields through the translation helper', () => {
    const plan = translateReviewPlan({
      flows: [],
      pages: [],
      questions: [],
      notFound: [nf('1', 'a.md')],
      rolesNotTested: [{ role: 'admin', reason: 'mfa', text: 'needs a code' }],
      plannedWhileCrawling: true,
    } as never);
    expect(plan.notFound).toHaveLength(1);
    expect(plan.rolesNotTested?.[0].role).toBe('admin');
    expect(plan.plannedWhileCrawling).toBe(true);
  });
});

describe('Needs your judgement bucket', () => {
  const f = (over: Partial<Finding>): Finding =>
    ({
      id: 'f',
      title: 'Behaviour differs',
      severity: 'Major',
      checker: 'spec-conformance',
      where: { urlPath: '/a', role: 'admin' },
      ...over,
    }) as Finding;
  it('puts unaccepted judgement items in their own bucket, per role', () => {
    expect(bucketOf({ severity: 'Major', needsConfirmation: true, needsJudgement: true })).toBe('judgement');
    expect(bucketOf({ severity: 'Major', needsConfirmation: true })).toBe('to-confirm');
    const groups = groupProblems([f({ needsConfirmation: true, needsJudgement: true })]);
    expect(groups.judgement).toHaveLength(1);
    expect(groups['to-confirm']).toHaveLength(0);
    expect(judgementByRole(groups.judgement)[0].role).toBe('admin');
  });
  it('an accepted item counts as a normal problem', () => {
    const groups = groupProblems([f({ needsJudgement: true, judgementAccepted: true })]);
    expect(groups.judgement).toHaveLength(0);
    expect(groups['must-fix']).toHaveLength(1);
  });
});

describe('new check-up form to run body', () => {
  it('maps documents, sessions (by role) and cap; empty form sends nothing', () => {
    expect(contextDocumentsOf(EMPTY_FORM)).toBeUndefined();
    expect(savedSessionsOf(EMPTY_FORM)).toBeUndefined();
    expect(capOf(EMPTY_FORM)).toBeUndefined();
    const form = {
      ...EMPTY_FORM,
      contextFiles: [{ name: 'a.md', content: '# A' }],
      savedSessions: [{ role: 'Admin', fileName: 's.json', state: { cookies: [], origins: [] } }],
      capRequests: '50',
    };
    expect(contextDocumentsOf(form)).toEqual([{ name: 'a.md', text: '# A' }]);
    expect(Object.keys(savedSessionsOf(form)!)).toEqual(['admin']);
    expect(capOf(form)).toEqual({ requests: 50 });
  });
});
