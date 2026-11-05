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
  it('lists the Product context files and the docs address under Adjust the check-up', async () => {
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
    expect(html).toContain('Docs address <span class="font-normal text-ink-soft">Optional</span>');
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
        {
          id: 'n1',
          docSource: { document: 'guide.md', section: 'Billing' },
          roles: [],
          reason: 'No Billing page found',
          skipped: false,
        },
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
      coverage: {
        totalTestPoints: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
        couldNotVerify: 0,
        completionRate: 0,
      },
      recommendations: [],
      rolesNotTested: [
        { role: 'manager', reason: 'wrong-details', text: 'The username or password was not accepted.' },
      ],
      documentedItems: {
        total: 3,
        reached: 2,
        notFound: [
          {
            id: 'n1',
            docSource: { document: 'guide.md', section: 'Billing' },
            roles: [],
            reason: 'No Billing page',
            skipped: false,
          },
        ],
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

describe('new check-up screen: recovery and choices', () => {
  const props = {
    onKeySaved: () => undefined,
    form: EMPTY_FORM,
    onFormChange: () => undefined,
    onStart: () => undefined,
    starting: false,
    startError: null,
    inProgress: null,
    recent: null,
  };

  it('offers no built-in test app shortcut while the address is empty', async () => {
    const { NewCheckupScreen } = await import('../src/screens/NewCheckupScreen');
    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, { ...props, ai: { configured: true, model: 'm' } })
    );
    expect(html).not.toContain('built-in test app');
    expect(html).not.toContain('pnpm fixture');
  });

  it('says why Start is off, and shows Retry beside the AI setup error', async () => {
    const { NewCheckupScreen } = await import('../src/screens/NewCheckupScreen');
    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, {
        ...props,
        ai: null,
        startError: 'Release check-up didn’t answer about its AI setup. Try again.',
        onRetryAi: () => undefined,
      })
    );
    expect(html).toContain('Waiting for Release check-up to answer');
    expect(html).toContain('AI setup. Try again.');
    expect(html).toContain('Retry');
  });

  it('says that looking sends and changes nothing', async () => {
    const { NewCheckupScreen } = await import('../src/screens/NewCheckupScreen');
    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, { ...props, ai: { configured: true, model: 'm' } })
    );
    expect(html).not.toContain('Only look at it instead</');
    const source = readFileSync(fileURLToPath(new URL('../src/screens/NewCheckupScreen.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Only look at it: nothing is sent or changed');
    // "Only look at it instead" must not record ownership.
    expect(source).toMatch(/setChoice\(\{ owner: false, markedTestCopy: false \}\)/);
  });
});

describe('T-37a copy, group A', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('uses the glossary terms and drops the overclaims on the check-up screen', () => {
    const newCheckup = read('../src/screens/NewCheckupScreen.tsx');
    expect(newCheckup).toContain('label="Product context"');
    expect(newCheckup).toContain('Product context files');
    expect(newCheckup).toContain('label="Design notes"');
    expect(newCheckup).toContain('Details for developers');
    expect(newCheckup).toContain('Exploring speed');
    expect(newCheckup).toContain('What you send may be kept and used to learn');
    expect(newCheckup).not.toContain('Documents (Sources)');
    expect(newCheckup).not.toContain('costs nothing');
    expect(newCheckup).not.toContain('label="Specs"');
    expect(newCheckup).not.toContain('acceptance criteria');
  });

  it('gives Plan Review one label for approve-and-test and a readable site type', () => {
    const planReview = read('../src/screens/PlanReviewScreen.tsx');
    expect(planReview).not.toContain("'Approve and test'");
    expect(planReview).toContain("'Approve the plan and start testing'");
    expect(planReview).toContain('siteTypeName(plan.siteType)');
    expect(planReview).not.toContain('Failed to');
  });

  it('shows the countdown once and the shared severity words while testing', () => {
    const testing = read('../src/screens/TestingScreen.tsx');
    expect(testing).not.toContain('{left} LEFT');
    expect(testing).not.toContain("'HIGH' : 'WARN'");
    expect(testing).toContain('{problem.label}');
    expect(testing).toContain("'Must fix'");
  });

  it('keeps the run stop copy and the sign-in labels plain', () => {
    expect(read('../src/lib/translate.ts')).not.toContain('Run was stopped');
    const signIn = read('../src/components/SignInRow.tsx');
    expect(signIn).toContain('Username field {OPTIONAL}');
    expect(signIn).toContain('Sign-in button {OPTIONAL}');
    expect(signIn).not.toMatch(/selector \{OPTIONAL\}|selector \(optional\)/i);
    expect(signIn).not.toContain('(optional)');
  });
});

describe('recovery wiring', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('App shows a retry for the plan, the lost-contact message and a stop notice', () => {
    const app = read('../src/App.tsx');
    expect(app).toContain('The plan couldn’t be opened');
    expect(app).toContain('Lost contact with Release check-up. Retrying…');
    expect(app).toContain('The check-up wasn’t stopped');
    expect(app).toContain('readsAddressParam');
  });

  it('Plan Review shows Nothing to test and clears a stuck wait', () => {
    const screen = read('../src/screens/PlanReviewScreen.tsx');
    expect(screen).toContain('Nothing to test');
    expect(screen).toContain('PENDING_TIMEOUT_MS');
    expect(screen).toContain('update.seq');
  });

  it('Visual Baselines shows names, not ids, and a Retry', async () => {
    const { baselineName } = await import('../src/screens/VisualBaselinesScreen');
    expect(baselineName('tc-home-hero')).toBe('Home hero');
    expect(baselineName('checkout_form')).toBe('Checkout form');
    expect(baselineName('---')).toBe('---');
    // LoadError carries the Try again button.
    expect(read('../src/screens/VisualBaselinesScreen.tsx')).toContain('<LoadError');
  });
});

describe('T-37b: wizard copy, labels and accessibility', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('Report and Past check-ups say New check-up of this site, never Test again', () => {
    for (const path of ['../src/screens/ReportScreen.tsx', '../src/screens/PastCheckupsScreen.tsx']) {
      const source = read(path);
      expect(source, path).toContain('New check-up of this site');
      expect(source, path).not.toContain('Test again');
    }
  });

  it('Report keeps the check-up id for developers, uses Requirements, and leaves theming to the app', () => {
    const report = read('../src/screens/ReportScreen.tsx');
    // The id is technical: only under Details for developers, never a crumb.
    expect(report).not.toContain('Check-up #');
    expect(report).toMatch(/Details for developers[\s\S]*?<dt className="text-ink-soft">Check-up<\/dt>/);
    expect(report).not.toContain('run #');
    expect(report).not.toContain('Spec Override');
    expect(report).not.toContain('Spec Drift Override');
    expect(report).toContain('How the site matches its requirements');
    expect(report).toContain('Record a requirement override');
    // The app has one theme setting and print is always light: no report-only Light view toggle.
    expect(report).not.toContain('Light view');
    expect(report).not.toContain('qa-report-light');
    expect(report).not.toContain("'Dark view'");
    expect(report).toContain('window.print()');
  });

  it('Report explains SEO, AEO and GEO as visible text, not only in a tooltip', () => {
    const report = read('../src/screens/ReportScreen.tsx');
    expect(report).toContain('<dd className="text-xs text-ink-soft">{hint}</dd>');
    expect(report).not.toContain('<div key={label} title={hint}>');
  });

  it('Report override fields are linked to their labels', () => {
    const report = read('../src/screens/ReportScreen.tsx');
    for (const id of ['override-status', 'override-url', 'override-selector', 'override-reason']) {
      expect(report, `label for ${id}`).toContain(`htmlFor="${id}"`);
      expect(report, `input ${id}`).toContain(`id="${id}"`);
    }
  });

  it('Report and Connection announce a failed copy', () => {
    const report = read('../src/screens/ReportScreen.tsx');
    // Copy as Markdown reuses DeveloperDetails' CopyButton: a live region, and the text to copy by hand on failure.
    expect(report).toContain('<CopyButton label="Copy as Markdown"');
    expect(report).not.toContain('// fallback');
    expect(report).not.toContain('(${group.bucket})');
    const details = read('../src/components/DeveloperDetails.tsx');
    expect(details).toContain('export function CopyButton(');
    expect(details).toContain('role="status"');
    expect(details).toContain('Your browser wouldn’t copy it. Select the text below and copy it yourself.');

    const connection = read('../src/screens/ConnectionScreen.tsx');
    expect(connection).toContain('setCopyFailed(true)');
    expect(connection).toContain('The copy didn’t work.');
  });

  it('Connection names the start step in words, not a command', () => {
    const connection = read('../src/screens/ConnectionScreen.tsx');
    expect(connection).toContain('Start Release check-up (see the README).');
    expect(connection).not.toContain('pnpm start');
  });

  it('Landing hero shows Sample report, never the raw URI, and the footer nav is Tool', () => {
    const landing = read('../src/screens/LandingScreen.tsx');
    expect(landing).toContain('Sample report');
    expect(landing).not.toContain('spec://');
    expect(landing).toContain('<nav aria-label="Tool">');
    expect(landing).not.toContain('>Product</p>');
  });

  it('Settings: an unset limit reads "No limit", sign-in wording and plain labels', () => {
    const settings = read('../src/screens/SettingsScreen.tsx');
    expect(settings).toContain('No limit');
    expect(settings).toContain('unlimitedWhenUnset');
    expect(settings).toContain('The stamp on every report always uses the Standard rule.');
    expect(settings).toContain('Site address');
    expect(settings).toContain('Shorter check-up (faster)');
    expect(settings).toContain('Use a test sign-in, not a real person’s.');
    for (const old of ['Target Website URL', 'Quick smoke scan', 'Quick check', 'window.confirm', 'accent-[#', 'Failed to', 'Use a test account']) {
      expect(settings, old).not.toContain(old);
    }
  });

  it('Visibility, Benchmark and SiteMap use the agreed names', () => {
    expect(read('../src/screens/VisibilityScreen.tsx')).not.toContain('Schema.org JSON-LD');
    const benchmark = read('../src/screens/BenchmarkScreen.tsx');
    expect(benchmark).not.toContain('competitor’s');
    expect(benchmark).not.toContain('competitor.com');
    expect(read('../src/components/SiteMap.tsx')).not.toContain('Serious problems');
  });

  it('Check-ups row: Visual baselines and Compare sites (ADR 0041, DESIGN.md)', () => {
    const areaNav = read('../src/components/AreaNav.tsx');
    expect(areaNav).toContain("label: 'Visual baselines'");
    expect(areaNav).toContain("label: 'Compare sites'");
    expect(areaNav).not.toContain("'Baselines'");
    expect(areaNav).not.toContain("'Visual Baselines'");
    expect(areaNav).not.toContain("'Compare with another site'");
  });

  it('Command palette: Product context, Leave out, Visual baselines and Compare sites', () => {
    const palette = read('../src/components/CommandPalette.tsx');
    expect(palette).toContain('Jump to Product context and design notes');
    expect(palette).not.toContain('Jump to Requirements and design notes');
    expect(palette).toContain('Toggle Leave out item');
    expect(palette).not.toContain('Jump to Specs');
    expect(palette).not.toContain('Run / Skip item');
    expect(palette).toContain('Go to Visual baselines');
    expect(palette).toContain('Go to Compare sites');
    expect(palette).not.toContain('Visual Baselines');
  });

  it('Plan Review heading is Product context and design notes', () => {
    const plan = read('../src/components/plan/PlanDocument.tsx');
    expect(plan).toContain('title="Product context and design notes"');
    expect(plan).not.toContain('Specs and design notes');
  });

  it('Show key button names what it does next (Show key / Hide key), so it carries no aria-pressed', () => {
    const keyField = read('../src/components/KeyField.tsx');
    expect(keyField).toContain("{reveal ? 'Hide key' : 'Show key'}");
    expect(keyField).not.toContain('aria-pressed={reveal}');
    expect(keyField).not.toContain("reveal ? 'Hide' : 'Show'");
  });
});
