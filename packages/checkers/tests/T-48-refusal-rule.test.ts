import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { TestCase, StepEvidence } from '@qa/types';
import { judgeRefusal, captureRefusalBaseline, readRefusal } from '../src/refusal-rule.js';
import { SpecConformanceChecker } from '../src/spec-conformance.js';

/** T-48: the baseline covers alerts, the Source's wording wins over the browser's, probe-only is judged. */

const tc = (over: Record<string, unknown> = {}, refusal: Record<string, unknown> = {}): TestCase =>
  ({
    id: 'TC-T48',
    flowId: 'F-T48',
    startPage: '/signup',
    steps: [],
    expectations: { origin: 'observed', refusal: { formPath: '/signup', ...refusal } },
    ...over,
  }) as unknown as TestCase;
const ctx = (baseline: unknown) => ({
  role: 'guest',
  breakpoint: '1440px' as never,
  baseUrl: 'http://localhost',
  refusalBaseline: baseline as never,
});
const evidence: StepEvidence[] = [];

describe('T-48 refusal rule: alerts are judged against the baseline', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser.close();
  });

  it('a permanent role=alert already on the page is not a refusal signal', async () => {
    await page.setContent(
      '<html><body><h1>Join</h1><div role="alert">Heads up: maintenance on Sunday</div>' +
        '<form onsubmit="event.preventDefault()"><input name="qty" value="0"></form></body></html>'
    );
    const baseline = await captureRefusalBaseline(page);
    const seen = await readRefusal(page, { baseline });
    expect(seen.signals).not.toContain('alert');
    expect(judgeRefusal(seen).refused).toBe(false);
  });

  // No min attribute: a native :invalid would itself be a refusal; only the baselined alert is on the page.
  it('a form that accepts min-1 with a permanent role=alert gets a finding, not a pass', async () => {
    await page.setContent(
      '<html><body><h1>Join</h1><div role="alert">Heads up: maintenance on Sunday</div>' +
        '<form onsubmit="event.preventDefault()"><input name="qty" type="number" value="0"></form></body></html>'
    );
    const baseline = await captureRefusalBaseline(page);
    const findings = await new SpecConformanceChecker().check(
      page,
      tc({}, { submitSelector: 'button' }),
      evidence,
      ctx(baseline)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toMatch(/accepted a value it should refuse/);
  });

  it('an alert that appears after the submit is a refusal signal', async () => {
    await page.setContent('<html><body><h1>Join</h1><form onsubmit="event.preventDefault()"><input name="e"></form></body></html>');
    const baseline = await captureRefusalBaseline(page);
    await page.evaluate(() => {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'Email is required';
      document.body.appendChild(alert);
    });
    const seen = await readRefusal(page, { baseline });
    expect(seen.signals).toContain('alert');
    expect(seen.errorText).toBe('Email is required');
    expect(judgeRefusal(seen).refused).toBe(true);
  });
});

describe('T-48 refusal rule: the Source wording is compared with what the page shows', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser.close();
  });

  const SOURCE_SENTENCE = 'Please enter your email address';

  it('a novalidate form showing the Source sentence in an alert is not a wording finding', async () => {
    await page.setContent(
      '<html><body><h1>Sign up</h1><form novalidate onsubmit="event.preventDefault();' +
        "document.getElementById('msg').textContent='" +
        SOURCE_SENTENCE +
        '\'"><input name="email" type="email" required><button type="submit">Go</button>' +
        '<div id="msg" role="alert"></div></form></body></html>'
    );
    const baseline = await captureRefusalBaseline(page);
    await page.fill('input[name="email"]', '');
    await page.click('button[type="submit"]');
    const seen = await readRefusal(page, { baseline, message: SOURCE_SENTENCE });
    expect(seen.errorText).toBe(SOURCE_SENTENCE);
    const findings = await new SpecConformanceChecker().check(
      page,
      tc({ docSource: { document: 'Guide' } }, { message: SOURCE_SENTENCE, submitSelector: 'button[type="submit"]' }),
      evidence,
      ctx(baseline)
    );
    expect(findings.some((f) => /different wording/.test(f.title))).toBe(false);
    expect(findings).toEqual([]);
  });

  it('a native validation message is still the text when no alert or error shows', async () => {
    await page.setContent('<html><body><form><input name="e" required></form></body></html>');
    const baseline = await captureRefusalBaseline(page);
    const seen = await readRefusal(page, { baseline });
    expect(seen.signals).toContain('invalid');
    expect(seen.errorText).toBeTruthy();
  });
});

describe('T-48 refusal rule: probe-only and native refusals', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser.close();
  });

  it('probe-only judges a native :invalid field as refused', async () => {
    await page.setContent('<html><body><form><input name="e" type="email" required></form></body></html>');
    const baseline = await captureRefusalBaseline(page);
    const seen = await readRefusal(page, { baseline, probeOnly: true });
    expect(seen.signals).toContain('invalid');
    expect(judgeRefusal(seen).refused).toBe(true);
  });

  it('probe-only with a valid, accepting form is not refused', async () => {
    await page.setContent('<html><body><form><input name="e" value="ok"></form></body></html>');
    const baseline = await captureRefusalBaseline(page);
    const seen = await readRefusal(page, { baseline, probeOnly: true });
    expect(judgeRefusal(seen).refused).toBe(false);
  });
});
