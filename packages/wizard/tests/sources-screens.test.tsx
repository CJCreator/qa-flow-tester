import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_FORM } from '../src/lib/form';

beforeAll(() => {
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { origin: 'http://localhost:3001', pathname: '/', search: '' },
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('new check-up screen: Sources', () => {
  it('lists the Product Context files and the docs address under More options', async () => {
    const { NewCheckupScreen } = await import('../src/screens/NewCheckupScreen');
    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, {
        ai: { configured: true, model: 'm' },
        onKeySaved: () => undefined,
        form: {
          ...EMPTY_FORM,
          contextFiles: [{ name: 'admin-guide.md', text: '# Admin' } as never],
          contextUrl: 'http://docs.example/guide',
        },
        onFormChange: () => undefined,
        onStart: () => undefined,
        starting: false,
        startError: null,
        inProgress: null,
        recent: null,
      })
    );
    expect(html).toContain('admin-guide.md');
    expect(html).toContain('aria-label="Remove admin-guide.md"');
    expect(html).toContain('Docs address (optional)');
    expect(html).toContain('http://docs.example/guide');
  });
});

describe('Plan Review: Sources', () => {
  it('shows the Source, role confirmation, Not found in app and Roles not tested', async () => {
    const { PlanDocument } = await import('../src/components/plan/PlanDocument');
    const noop = () => undefined;
    const actions = new Proxy({ busy: false }, { get: (t, k) => (k in t ? (t as never)[k] : noop) }) as never;
    const plan = {
      runId: 'r',
      targetUrl: 'http://x.example/',
      pages: [],
      flows: [],
      questions: [],
      planPages: [
        {
          id: 'page:/users',
          urlPath: '/users',
          title: 'Users',
          coverage: 'tested',
          reachedBy: ['visitor'],
          source: 'ai',
          tests: [
            {
              id: 'pagetest:/users:1',
              name: 'Admin creates a user',
              steps: [],
              source: 'ai',
              docSource: { document: 'guide.md', section: 'Users > Create' },
              proposedRoles: ['admin'],
              rolesConfirmed: false,
            },
          ],
        },
      ],
      navigation: [],
      notFound: [
        { id: 'n1', docSource: { document: 'guide.md', section: 'Billing' }, roles: [], reason: 'No Billing page found', skipped: false },
      ],
      documentedItems: { total: 2, reached: 1 },
      rolesNotTested: [{ role: 'viewer', reason: 'wrong-details', text: 'The username or password was not accepted.' }],
    };
    const html = renderToStaticMarkup(createElement(PlanDocument, { plan: plan as never, actions }));
    expect(html).toContain('guide.md, section Users &gt; Create');
    expect(html).toContain('Roles proposed by the AI: admin');
    expect(html).toContain('Confirm roles');
    expect(html).toContain('Not found in app');
    expect(html).toContain('No Billing page found');
    expect(html).toContain('Roles not tested and why');
    expect(html).toContain('The username or password was not accepted.');
  });
});

describe('new check-up screen: saved session', () => {
  it('shows "Saved session added" and never the contents', async () => {
    const { NewCheckupScreen } = await import('../src/screens/NewCheckupScreen');
    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, {
        ai: { configured: true, model: 'm' },
        onKeySaved: () => undefined,
        form: {
          ...EMPTY_FORM,
          savedSessions: [
            {
              role: 'viewer',
              fileName: 'viewer.json',
              state: { cookies: [{ name: 'sid', value: 'SECRET-COOKIE-VALUE' }], origins: [] } as never,
            },
          ],
        },
        onFormChange: () => undefined,
        onStart: () => undefined,
        starting: false,
        startError: null,
        inProgress: null,
        recent: null,
      })
    );
    expect(html).toContain('Saved session added');
    expect(html).toContain('viewer');
    expect(html).not.toContain('SECRET-COOKIE-VALUE');
  });
});

describe('Report: Sources', () => {
  it('shows the judgement bucket with Accept, issues downloads, documented count and roles not tested', async () => {
    const { Report } = await import('../src/screens/ReportScreen');
    const finding = {
      id: 'f1',
      title: 'Viewer can open Create user',
      severity: 'Major',
      description: 'The guide says only Admin can.',
      needsJudgement: true,
      needsConfirmation: true,
      checker: 'flow',
      where: { urlPath: '/account/users/new', breakpoint: '1440px', role: 'viewer' },
      evidence: {},
    };
    const report = {
      runId: 'run-1',
      productId: 'p',
      targetUrl: 'http://x.example/',
      generatedAt: new Date().toISOString(),
      results: [],
      findings: [finding],
      grades: { aspects: {} },
      coverage: { totalTestPoints: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, couldNotVerify: 0, completionRate: 0 },
      recommendations: [],
      rolesNotTested: [{ role: 'manager', reason: 'wrong-details', text: 'The username or password was not accepted.' }],
      documentedItems: {
        total: 3,
        reached: 2,
        notFound: [{ id: 'n1', docSource: { document: 'guide.md', section: 'Billing' }, roles: [], reason: 'No Billing page', skipped: false }],
      },
    };
    const html = renderToStaticMarkup(
      createElement(Report, {
        report: report as never,
        actions: { onTestAgain: () => undefined, onGoDeeper: () => undefined, starting: false, actionError: null },
        onReportChanged: () => undefined,
      })
    );
    expect(html).toContain('Needs your judgement');
    // The Accept button sits inside the item's collapsed detail, which static markup does not open.
    expect(readFileSync(fileURLToPath(new URL('../src/screens/ReportScreen.tsx', import.meta.url)), 'utf8')).toContain(
      'Accept as a problem'
    );
    expect(html).toContain('Download issues.md');
    expect(html).toContain('Download issues.html');
    expect(html).toMatch(/2 of 3 documented items/);
    expect(html).toContain('Roles not tested and why');
    expect(html).toContain('The username or password was not accepted.');
  });
});
