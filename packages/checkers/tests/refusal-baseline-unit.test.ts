import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import type { TestCase } from '@qa/types';
import { SpecConformanceChecker } from '../src/spec-conformance.js';

/**
 * Unit tests for the refusal block without a browser: the in-page sources run against a small fake
 * DOM, so probe-only baselines, alert-after-baseline and the shown-text order are checked here.
 * (The real-Chromium versions live in refusal-rule.test.ts, browser project.)
 */

interface FakeEl {
  innerText: string;
  invalid?: boolean;
  ariaInvalid?: boolean;
  validationMessage?: string;
  /** Visible on the page. Default true. */
  shown?: boolean;
}

interface FakePage {
  path: string;
  /** Elements with role="alert". */
  alerts: FakeEl[];
  /** Elements with error-looking classes. */
  errors: FakeEl[];
  /** input/select/textarea. */
  controls: FakeEl[];
}

interface Baseline {
  path: string;
  records: number;
  errorTexts: string[];
}

const el = (over: Partial<FakeEl> & { innerText: string }): FakeEl => ({ shown: true, ...over });

function fakeGlobals(state: FakePage) {
  const elementFor = (e: FakeEl) => ({
    innerText: e.innerText,
    validationMessage: e.validationMessage,
    getBoundingClientRect: () => ({ width: e.shown === false ? 0 : 10, height: e.shown === false ? 0 : 10 }),
    matches: (s: string) => s === ':invalid' && !!e.invalid,
    getAttribute: (name: string) => (name === 'aria-invalid' && e.ariaInvalid ? 'true' : null),
  });
  const querySelectorAll = (sel: string) => {
    if (sel.startsWith('input, select')) return state.controls.map(elementFor);
    if (sel === '[aria-invalid="true"]') return state.controls.filter((c) => c.ariaInvalid).map(elementFor);
    if (sel === '[role="alert"]') return state.alerts.map(elementFor);
    if (sel.includes('role="alert"')) return [...state.alerts, ...state.errors].map(elementFor);
    if (sel.includes('class*="error"')) return state.errors.map(elementFor);
    return [];
  };
  return {
    document: {
      querySelectorAll,
      body: { innerText: 'Form page' },
      title: 'Form',
      querySelector: () => null,
    },
    location: { pathname: state.path },
    performance: { getEntriesByType: () => [] },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
  };
}

/** A Page whose evaluate() runs the real in-page sources against the fake DOM. */
function fakePage(state: FakePage): Page {
  const g = fakeGlobals(state);
  const evaluate = async (src: string) => {
    const run = new Function(
      'document',
      'location',
      'performance',
      'getComputedStyle',
      `return ${src};`
    ) as (...args: unknown[]) => unknown;
    return run(g.document, g.location, g.performance, g.getComputedStyle);
  };
  return {
    url: () => `http://localhost:3000${state.path}`,
    evaluate,
    title: async () => 'Form',
    innerText: async () => 'Form page',
  } as unknown as Page;
}

const submitTest = (refusal: Record<string, unknown> = {}): TestCase =>
  ({
    id: 'TEST-1',
    name: 'Rejects: “Email” is not an email address',
    role: 'visitor',
    flowId: 'page-test',
    startPage: '/form',
    steps: [{ action: 'click', selector: '#go', name: 'Send' }],
    expectations: {
      origin: 'observed',
      refusal: { formPath: '/form', submitSelector: '#go', ...refusal },
    },
  }) as unknown as TestCase;

const probeTest = (): TestCase =>
  ({
    id: 'TEST-2',
    name: 'Rejects: probe only',
    role: 'visitor',
    flowId: 'page-test',
    startPage: '/form',
    steps: [{ action: 'fill', selector: '#email', value: 'not-an-email', name: 'Email' }],
    expectations: {
      origin: 'observed',
      refusal: { formPath: '/form', submitSelector: '#go', probeOnly: true },
    },
  }) as unknown as TestCase;

/** A context with no refusal baseline, as the orchestrator gives a probe-only item. */
const context = (observations: string[] = [], refusalBaseline?: Baseline) => ({
  role: 'visitor',
  breakpoint: '1440px' as const,
  baseUrl: 'http://localhost:3000',
  onObservation: (o: string) => observations.push(o),
  refusalBaseline,
});

/** The page as it was right before the submit click: nothing on it yet. */
const before = (errorTexts: string[] = []): Baseline => ({ path: '/form', records: 0, errorTexts });

const check = (page: Page, tc: TestCase, ctx: ReturnType<typeof context> = context()) =>
  new SpecConformanceChecker().check(page, tc, [], ctx);

describe('probe-only Rejects get a baseline without a submit click (C2)', () => {
  it('a probe that finds the field invalid is refused, not skipped', async () => {
    const page = fakePage({
      path: '/form',
      alerts: [],
      errors: [],
      controls: [el({ innerText: '', invalid: true, validationMessage: 'Please include an "@"' })],
    });
    const observations: string[] = [];
    const findings = await check(page, probeTest(), context(observations));
    expect(findings).toHaveLength(0);
    expect(observations.join(' ')).toContain('Please include an "@"');
  });

  it('a probe that finds nothing invalid reports the value as accepted', async () => {
    const page = fakePage({ path: '/form', alerts: [], errors: [], controls: [el({ innerText: '' })] });
    const findings = await check(page, probeTest());
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('accepted a value it should refuse');
  });
});

describe('alerts count only when new since the baseline (C3)', () => {
  it('a permanent alert already on the page is not a refusal signal', async () => {
    const page = fakePage({
      path: '/form',
      alerts: [el({ innerText: 'Cookies are on' })],
      errors: [],
      controls: [],
    });
    const findings = await check(page, submitTest(), context([], before(['Cookies are on'])));
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('accepted a value it should refuse');
  });

  it('an alert that was not on the page before the submit is a refusal', async () => {
    const page = fakePage({
      path: '/form',
      alerts: [el({ innerText: 'Enter a valid email' })],
      errors: [],
      controls: [],
    });
    const findings = await check(page, submitTest(), context([], before(['Cookies are on'])));
    expect(findings).toHaveLength(0);
  });
});

describe('the shown text prefers the page alert over the native message (C6)', () => {
  it('a Source sentence in the alert matches, even when the browser has its own message', async () => {
    const page = fakePage({
      path: '/form',
      alerts: [el({ innerText: 'Enter a valid email address' })],
      errors: [],
      controls: [el({ innerText: '', invalid: true, validationMessage: 'Please include an "@"' })],
    });
    const observations: string[] = [];
    const findings = await check(
      page,
      submitTest({ message: 'valid email address' }),
      context(observations, before())
    );
    expect(findings).toHaveLength(0);
    expect(observations.join(' ')).toContain('Enter a valid email address');
    expect(observations.join(' ')).not.toContain('Please include');
  });

  it('the native message is the shown text when nothing else is on the page', async () => {
    const page = fakePage({
      path: '/form',
      alerts: [],
      errors: [],
      controls: [el({ innerText: '', invalid: true, validationMessage: 'Please include an "@"' })],
    });
    const findings = await check(page, submitTest({ message: 'valid email address' }), context([], before()));
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('different wording');
    expect(findings[0].expectedVsActual.actual).toContain('Please include');
  });
});
