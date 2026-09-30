import { describe, it, expect } from 'vitest';
import {
  initialFeed,
  looksTechnical,
  plainFailure,
  reduceFeed,
  secondsLeft,
  timeLeft,
  translateReviewPlan,
  type FeedState,
  type RunnerEvent,
} from '../src/lib/translate';
import { plainTitle } from '../src/lib/summary';

const run = (events: RunnerEvent[], mode: 'product' | 'website' = 'product'): FeedState =>
  events.reduce((state, e) => reduceFeed(state, e, mode), initialFeed(mode));

/** Everything a person could see on the progress screen. */
const visibleText = (s: FeedState) => [s.current, ...s.history, s.failure ?? ''].join('\n');

const EVERY_EVENT_TYPE: RunnerEvent[] = [
  { type: 'connected', timestamp: 1 },
  { type: 'DISCOVERY_STARTED', runId: 'r' },
  { type: 'DISCOVERY_COMPLETED', runId: 'r', flowsFound: 3 },
  { type: 'RUN_STARTED', runId: 'r', targetUrl: 'http://x', productId: 'p', testCaseCount: 3 },
  { type: 'PREFLIGHT_STARTED', roles: ['admin', 'customer'] },
  { type: 'TEST_POINT_STARTED', testCaseId: 'TC-1', testCaseName: 'Create Invoice', role: 'admin', breakpoint: '1440px', index: 0, total: 3 },
  { type: 'STEP_STARTED', stepIndex: 0, stepName: 'Click [data-testid="save-btn"]', action: 'click', target: '[data-testid="save-btn"]', testCaseId: 'TC-1' },
  { type: 'STEP_COMPLETED', stepIndex: 0, passed: false, durationMs: 10, error: 'locator.click: Timeout 4000ms exceeded' },
  { type: 'FINDINGS_UPDATED', totalFindings: 2 },
  { type: 'HUB_PUSH_RESULT', synced: true },
  { type: 'RUN_COMPLETED', runId: 'r', report: {} },
];

describe('reduceFeed', () => {
  it('has a plain sentence for every event type the runner emits, and never shows raw internals', () => {
    const state = run(EVERY_EVENT_TYPE);
    const text = visibleText(state);
    expect(text).not.toMatch(/data-testid|\[|\]|locator|Timeout 4000|_[A-Z]|RUN_|STEP_|DISCOVERY|PREFLIGHT|FINDINGS|http:\/\//);
    expect(state.history).toEqual([
      'Exploring your site to learn what people can do on it…',
      'Found 3 things people can do on your site. Planning how to test them…',
      'Getting ready to test 3 things…',
      'Checking your site is up and signing in as admin and customer…',
      'Testing “Create Invoice” as admin (1 of 3)…',
      'All done. Putting your report together…',
    ]);
    expect(state.status).toBe('completed');
    expect(state.findings).toBe(2);
  });

  it('describes a step with a technical name by its action only', () => {
    const state = run([{ type: 'STEP_STARTED', stepIndex: 0, stepName: 'Click [data-testid="save-btn"]', action: 'click' }]);
    expect(state.current).toBe('Clicking a button…');
    expect(run([{ type: 'STEP_STARTED', stepName: 'Save invoice', action: 'click' }]).current).toBe('Clicking “Save invoice”…');
  });

  it('falls back to a generic line for unknown events instead of rendering nothing', () => {
    const state = run([{ type: 'SOMETHING_NEW', detail: 'x' }]);
    expect(state.current).toBe('Working on it…');
  });

  it('counts findings live and advances progress per test point', () => {
    let state = run([{ type: 'TEST_POINT_STARTED', testCaseName: 'A', role: 'anonymous', index: 0, total: 2 }]);
    expect(state.progress).toEqual({ done: 0, total: 2 });
    expect(state.current).toBe('Testing “A” (1 of 2)…');
    state = reduceFeed(state, { type: 'FINDINGS_UPDATED', totalFindings: 1 }, 'product');
    expect(state).toMatchObject({ findings: 1, progress: { done: 1, total: 2 } });
  });

  it('uses website wording for a read-only scan', () => {
    const state = run(
      [
        { type: 'RUN_STARTED', mode: 'safe-public', testCaseCount: 1 },
        { type: 'STEP_STARTED', stepName: 'Expanded “Pricing”', action: 'click' },
      ],
      'website'
    );
    expect(state.history[0]).toBe('Looking around the site safely. Nothing will be submitted or changed.');
    expect(visibleText(state)).not.toMatch(/signing in/i);
  });

  it('turns a failure into a plain explanation', () => {
    const state = run([{ type: 'RUN_FAILED', error: 'Pre-flight check failed: Target URL is unreachable (fetch failed).' }]);
    expect(state.status).toBe('failed');
    expect(state.failure).toBe('Your site couldn’t be reached. Make sure it’s running and the address is right, then try again.');
  });
});

describe('live testing state (Task 1.6)', () => {
  const started = (index: number, startPage: string): RunnerEvent => ({
    type: 'TEST_POINT_STARTED',
    testCaseId: `TC-${index}`,
    testCaseName: 'Open the cart',
    role: 'visitor',
    breakpoint: '375px',
    startPage,
    index,
    total: 412,
  });

  it('TEST_POINT_STARTED: which test of how many, the page under test, and the screen size', () => {
    const state = run([started(36, 'http://shop.example.com/cart?x=1')]);
    expect(state.test).toEqual({ name: 'Open the cart', role: 'visitor', size: '375px', index: 36, total: 412 });
    expect(state.progress).toEqual({ done: 36, total: 412 });
    expect(state.currentPage).toBe('/cart');
    expect(state.pages['/cart']).toEqual({ status: 'pass', issues: 0 });
    expect(state.testingStartedAt).toBeTypeOf('number');
  });

  it('STEP_COMPLETED: the newest screenshot, and the page the browser is on now', () => {
    const state = run([
      started(0, '/'),
      { type: 'STEP_COMPLETED', stepIndex: 0, passed: true, screenshotUrl: '/api/evidence/runs/run-1/evidence/TC-0/step-1.png', urlPath: '/checkout' },
    ]);
    expect(state.screenshot).toEqual({ url: '/api/evidence/runs/run-1/evidence/TC-0/step-1.png', page: '/checkout' });
    expect(state.currentPage).toBe('/checkout');
    // A step without a screenshot keeps the last one.
    expect(reduceFeed(state, { type: 'STEP_COMPLETED', stepIndex: 1, passed: true, urlPath: '/done' }, 'product').screenshot).toEqual(state.screenshot);
  });

  it('FINDINGS_UPDATED: pins each new problem to its page, and colours the page by the worst one', () => {
    const state = run([
      started(0, '/cart'),
      {
        type: 'FINDINGS_UPDATED',
        totalFindings: 2,
        latest: [
          { id: 'F-1', title: 'Touch target too small', severity: 'Minor', checker: 'ux-quality', urlPath: '/cart', breakpoint: '375px' },
          { id: 'F-2', title: 'HTTP 500', severity: 'Major', checker: 'bug-detection', urlPath: 'http://shop.example.com/api', breakpoint: '375px' },
        ],
      },
      {
        type: 'FINDINGS_UPDATED',
        totalFindings: 3,
        latest: [{ id: 'F-3', title: 'Uncaught Exception', severity: 'Blocker', checker: 'bug-detection', urlPath: '/cart', breakpoint: '375px' }],
      },
    ]);
    expect(state.findings).toBe(3);
    expect(state.pages['/cart']).toEqual({ status: 'fail', issues: 2 });
    expect(state.pages['/api']).toEqual({ status: 'fail', issues: 1 });
    // Newest first.
    expect(state.found.map((f) => [f.id, f.urlPath])).toEqual([
      ['F-3', '/cart'],
      ['F-2', '/api'],
      ['F-1', '/cart'],
    ]);
    // One FINDINGS_UPDATED closes each test point.
    expect(state.progress).toEqual({ done: 2, total: 412 });
  });

  it('estimates the time left from how long each test has taken so far', () => {
    const state: FeedState = { ...run([started(10, '/')]), testingStartedAt: 1_000, progress: { done: 10, total: 70 } };
    // 10 tests in 100 seconds: 60 more take about 10 minutes.
    expect(secondsLeft(state, 101_000)).toBe(600);
    expect(timeLeft(secondsLeft(state, 101_000))).toBe('about 10 minutes left');
    expect(timeLeft(30)).toBe('under a minute left');
    expect(timeLeft(90)).toBe('about 2 minutes left');
    expect(timeLeft(undefined)).toBeNull();
    // Nothing done yet: no guess.
    expect(secondsLeft({ ...state, progress: { done: 0, total: 70 } })).toBeUndefined();
  });

  it('RUN_FAILED and RUN_ABORTED say whether the plan was kept', () => {
    const failed = run([started(0, '/'), { type: 'RUN_FAILED', error: 'net::ERR_CONNECTION_REFUSED', planKept: true }]);
    expect(failed).toMatchObject({ status: 'failed', planKept: true });
    expect(failed.failure).toMatch(/couldn’t be reached/);
    expect(run([{ type: 'RUN_ABORTED', planKept: false }])).toMatchObject({ status: 'failed', planKept: false });
  });
});

describe('plainFailure', () => {
  it.each([
    ['robots.txt on https://x disallows crawling /', /asks automated tools not to look around/],
    ['No OpenRouter key is saved. Add one before starting an AI run.', /AI key is missing\. Add it again in Settings/],
    ['OpenAI/OpenRouter API error (401): {"error":"bad"}', /turned the request down/],
    ['page.goto: Timeout 30000ms exceeded', /took too long/],
    ['TypeError: Cannot read properties of undefined', /Something went wrong/],
  ])('%s', (error, expected) => {
    const text = plainFailure(error, 'product');
    expect(text).toMatch(expected);
    expect(text).not.toContain(error);
  });
});

describe('looksTechnical', () => {
  it.each(['[data-testid="x"]', '#submit', 'save-btn', 'div > a.nav', 'https://x.com/a', 'createInvoiceFlow', 'user_name'])(
    'flags %s',
    (label) => expect(looksTechnical(label)).toBe(true)
  );
  it.each(['Save invoice', 'Sign-in', 'Create Invoice Flow', 'E-mail address'])('accepts %s', (label) =>
    expect(looksTechnical(label)).toBe(false)
  );
});

describe('translateReviewPlan (Task 1.3)', () => {
  it('turns a technical discovery plan into plain sentences with no selectors, patterns or jargon', () => {
    const rawPlan: any = {
      runId: 'run-123',
      targetUrl: 'http://localhost:3501',
      discoveredAt: new Date().toISOString(),
      pages: [
        { urlPath: '/', title: 'Home', interactiveElementsCount: 5, formsCount: 0 },
        { urlPath: '/invoices/new', title: 'New Invoice', interactiveElementsCount: 3, formsCount: 1 },
      ],
      flows: [
        {
          id: 'flow-invoice',
          name: 'Create Invoice',
          role: 'manager',
          startPage: '/invoices/new',
          steps: [
            { action: 'fill', selector: '[data-testid="customer-field"]', name: 'customer-field', value: 'Acme Corp' },
            { action: 'fill', selector: '#amount-field', name: 'amount-field', value: '500' },
            { action: 'click', selector: '[data-testid="save-btn"]', name: 'save-btn' },
            { action: 'navigate', value: '^/invoices/\\d+$', name: 'View created invoice' },
            { action: 'wait', name: 'wait-load' },
          ],
          candidateExpectations: {
            origin: 'observed',
            url: { pattern: '^/invoices/\\d+$' },
            validationError: { field: 'customer-field' },
          },
          candidateValidationRules: [
            {
              field: 'amount',
              selector: '#amount-field',
              expectedError: 'must be positive',
              origin: 'ai-guess',
            },
          ],
        },
      ],
      questions: [],
    };

    const translated = translateReviewPlan(rawPlan);
    expect(translated.journeys).toBeDefined();
    expect(translated.journeys!.length).toBe(1);

    const journey = translated.journeys![0];
    expect(journey.steps).toEqual([
      'Fill in “Customer field” with “Acme Corp”',
      'Fill in “Amount field” with “500”',
      'Click “Save button”',
      'Open page “/invoices”',
      'Wait for the page to finish loading',
    ]);

    // Checks have plain sentences and correct origin tags
    expect(journey.checks).toEqual([
      {
        sentence: 'Shows an error message if “Customer field” is invalid',
        origin: 'observed',
      },
      {
        sentence: 'Reaches page “/invoices”',
        origin: 'observed',
      },
      {
        sentence: 'Validates “Amount field”: must be positive',
        origin: 'ai-guess',
      },
    ]);

    // Site-wide checks are provided
    expect(translated.siteWideChecks?.length).toBeGreaterThanOrEqual(5);
    expect(translated.siteWideChecks?.some((c) => c.name.includes('WCAG'))).toBe(true);

    // Page groups are organized by section and layout
    expect(translated.pageGroups?.length).toBeGreaterThan(0);

    // User-facing translated plan text contains zero selectors, raw regex, or testids
    const userFacingText = JSON.stringify({
      journeys: translated.journeys,
      siteWideChecks: translated.siteWideChecks,
      pageGroups: translated.pageGroups,
    });
    expect(userFacingText).not.toMatch(/data-testid|#amount-field|#save-btn|\^|\$|\\d\+/);
  });
});


describe('plainTitle (M6 gap fixes)', () => {
  it('rewrites raw regex patterns into plain English sentences', () => {
    const finding: any = {
      title: 'URL did not match expected pattern: "^/invoices/new$"',
      checker: 'spec-conformance',
      id: 'F-1',
    };
    expect(plainTitle(finding)).toBe('Didn’t reach “/invoices/new” as expected');
  });

  it('rewrites library WCAG titles into plain English sentences', () => {
    const finding: any = {
      title: 'WCAG Violation: Elements must meet minimum color contrast ratio thresholds (color-contrast)',
      checker: 'ux-quality',
      id: 'F-A11Y-1',
    };
    expect(plainTitle(finding)).toBe('Text doesn’t have enough contrast with its background');
  });

  it('rewrites image-alt WCAG titles into plain English', () => {
    const finding: any = {
      title: 'WCAG Violation: Images must have alternate text (image-alt)',
      checker: 'ux-quality',
      id: 'F-A11Y-2',
    };
    expect(plainTitle(finding)).toBe('An image is missing a text description for screen readers');
  });
});

