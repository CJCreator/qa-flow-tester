import { describe, it, expect } from 'vitest';
import { buildIssuesModel, renderIssuesMarkdown } from '../src/issues-document.js';
import { finding, report } from './helpers/issues-fixtures.js';

const rep = report(
  [
    finding({ id: 'F-A', severity: 'Minor', title: 'Small UI', checker: 'design-standards', where: { urlPath: '/b', role: 'admin', breakpoint: '1440px' } }),
    finding({ id: 'F-B', severity: 'Blocker', title: 'Crash', where: { urlPath: '/a', role: 'admin', breakpoint: '1440px' } }),
    finding({ id: 'F-C', severity: 'Major', title: 'Another UI', checker: 'design-standards', where: { urlPath: '/a', role: 'admin', breakpoint: '1440px' } }),
    finding({
      id: 'F-D',
      severity: 'Major',
      checker: 'spec-conformance',
      title: 'Behaviour differs from Admin guide, section Users',
      docSource: { document: 'Admin guide', section: 'Users' },
      where: { urlPath: '/users', role: 'viewer', breakpoint: '1440px' },
    }),
    finding({
      id: 'F-E',
      severity: 'Suggestion',
      checker: 'spec-conformance',
      title: 'Could not verify: ended on /x',
      needsConfirmation: true,
      needsJudgement: true,
      where: { urlPath: '/x', role: 'viewer', breakpoint: '1440px' },
    }),
    finding({
      id: 'F-F',
      checker: 'permission-matrix',
      title: 'Viewer can open settings',
      where: { urlPath: '/settings', role: 'viewer', breakpoint: '1440px' },
    }),
  ],
  {
    rolesNotTested: [{ role: 'owner', reason: 'wrong-details', text: 'The sign-in details were not accepted.' }],
    documentedItems: { reached: 3, total: 4, notFound: [{ docSource: { document: 'Admin guide' }, reason: 'no page' }] },
    results: [
      { testCaseId: 't1', flowId: 'f', role: 'admin', status: 'Passed', durationMs: 1, findings: [], stepEvidence: [] },
      { testCaseId: 't2', flowId: 'f', role: 'viewer', status: 'Passed', durationMs: 1, findings: [], stepEvidence: [] },
    ],
  }
);

describe('issues document', () => {
  it('orders role, then issue type, then severity, then page', () => {
    const model = buildIssuesModel(rep);
    expect(model.roles.map((r) => r.role)).toEqual(['admin', 'viewer']);
    const admin = model.roles[0].byType;
    expect(Object.keys(admin)).toEqual(['UI/UX', 'Broken flow']);
    expect(admin['UI/UX']!.map((i) => i.id)).toEqual(['F-C', 'F-A']);
    expect(Object.keys(model.roles[1].byType)).toEqual(['Logical flow', 'Access']);
  });

  it('keeps title, severity, page, steps, evidence, fix and source on each issue', () => {
    const f = finding({
      id: 'F-X',
      evidence: { screenshotPath: 'evidence\\a.png' },
      docSource: { document: 'Spec' },
    });
    const [issue] = buildIssuesModel(report([f])).roles[0].byType['Broken flow']!;
    expect(issue).toMatchObject({
      title: 'Checkout crashes',
      severity: 'Major',
      page: '/checkout',
      steps: ['Open /checkout'],
      evidence: ['evidence/a.png'],
      fix: 'Fix the endpoint',
      docSource: { document: 'Spec' },
    });
  });

  it('opens with roles not tested, keeps judgement apart, shows mismatch wording and the access table', () => {
    const md = renderIssuesMarkdown(buildIssuesModel(rep));
    const firstHeading = md.split('\n').find((l) => l.startsWith('## '));
    expect(firstHeading).toBe('## Roles not tested and why');
    expect(md).toContain('`owner`: The sign-in details were not accepted.');
    expect(md).toContain('3 of 4 documented items reached; 1 not found in the app.');
    expect(md).toContain('Behaviour differs from Admin guide, section Users');
    const judgementAt = md.indexOf('## Needs your judgement');
    expect(judgementAt).toBeGreaterThan(md.indexOf('Behaviour differs'));
    expect(md.slice(0, judgementAt)).not.toContain('Could not verify: ended on /x');
    expect(md.slice(judgementAt)).toContain('Could not verify: ended on /x');
    expect(md).toMatch(/\| admin \| Denied \|/);
    expect(md).toMatch(/\| viewer \| Can reach it \|/);
    expect(md).not.toMatch(/\bbug\b/i);
  });

  it('accepted judgement items count in the main list', () => {
    const accepted = finding({ id: 'F-J', needsJudgement: true, judgementAccepted: true, needsConfirmation: false, checker: 'spec-conformance' });
    const model = buildIssuesModel(report([accepted]));
    expect(model.judgement).toEqual({});
    expect(model.roles[0].byType['Logical flow']).toHaveLength(1);
  });

  it('cleans control characters and pipes from page text', () => {
    const md = renderIssuesMarkdown(
      buildIssuesModel(report([finding({ title: 'Bad\u0007 title\nwith newline' })]))
    );
    expect(md).toContain('Bad title with newline');
    expect(md).not.toContain('\u0007');
  });
});
