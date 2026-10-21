import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { TestCase, StepEvidence } from '@qa/types';
import { judgeRefusal, captureRefusalBaseline, readRefusal, type RefusalResult } from '../src/refusal-rule.js';
import { SpecConformanceChecker } from '../src/spec-conformance.js';

const res = (over: Partial<RefusalResult> = {}): RefusalResult => ({
  moved: false,
  newRecord: false,
  signals: [],
  crashed: false,
  ...over,
});

describe('judgeRefusal (pure)', () => {
  it('refused needs a signal, no move, no new record', () => {
    expect(judgeRefusal(res({ signals: ['invalid'] })).refused).toBe(true);
    expect(judgeRefusal(res()).refused).toBe(false);
    expect(judgeRefusal(res({ signals: ['alert'], moved: true })).refused).toBe(false);
    expect(judgeRefusal(res({ signals: ['alert'], newRecord: true })).refused).toBe(false);
  });
  it('compares the message only when asked, case-insensitively', () => {
    const r = res({ signals: ['alert'], errorText: 'Please enter a valid Email' });
    expect(judgeRefusal(r).messageMatches).toBeUndefined();
    expect(judgeRefusal(r, { message: 'valid email' }).messageMatches).toBe(true);
    expect(judgeRefusal(r, { message: 'too short' }).messageMatches).toBe(false);
  });
});

const FORM =
  '<html><body><h1>Sign up</h1><form id="f"><input name="email" type="email" required><button type="submit">Go</button></form><table><tbody><tr><td>a</td></tr></tbody></table></body></html>';

describe('refusal rule in a page', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser.close();
  });

  const run = async (html: string, message?: string, probeOnly?: boolean) => {
    await page.setContent(html);
    const baseline = await captureRefusalBaseline(page);
    return { baseline, seen: await readRefusal(page, { baseline, message, probeOnly }) };
  };

  it('native :invalid is a signal', async () => {
    const { seen } = await run(FORM);
    expect(seen.signals).toContain('invalid');
    expect(judgeRefusal(seen).refused).toBe(true);
  });

  it('a visible role=alert is a signal', async () => {
    // T-48: an alert already there at baseline is not a signal; one that appears after is.
    await page.setContent('<html><body><h1>Hi</h1><p>x</p></body></html>');
    const baseline = await captureRefusalBaseline(page);
    await page.evaluate(() => {
      const a = document.createElement('div');
      a.setAttribute('role', 'alert');
      a.textContent = 'Email is wrong';
      document.body.appendChild(a);
    });
    const seen = await readRefusal(page, { baseline });
    expect(seen.signals).toContain('alert');
    expect(seen.errorText).toBe('Email is wrong');
  });

  it('aria-invalid="true" is a signal', async () => {
    const { seen } = await run('<html><body><h1>Hi</h1><input aria-invalid="true" value="x"><p>x</p></body></html>');
    expect(seen.signals).toContain('aria-invalid');
  });

  it('a toast with no role and no error markup is NOT a signal (AC4)', async () => {
    const { seen } = await run(
      '<html><body><h1>Hi</h1><div class="toast" aria-live="polite">Could not save</div></body></html>'
    );
    expect(seen.signals).toEqual([]);
    expect(judgeRefusal(seen).refused).toBe(false);
  });

  it('error text already there before the click is not new', async () => {
    const html = '<html><body><h1>Hi</h1><p class="error">Old problem</p></body></html>';
    await page.setContent(html);
    const fresh = await readRefusal(page, { baseline: { path: 'about:blank', records: 0, errorTexts: [] } });
    expect(fresh.signals).toContain('error-text');
    const baseline = await captureRefusalBaseline(page);
    const again = await readRefusal(page, { baseline });
    expect(again.signals).toEqual([]);
  });

  it('a new record means accepted', async () => {
    await page.setContent('<html><body><h1>L</h1><ul id="l"><li>a</li></ul><div role="alert">hmm</div></body></html>');
    const baseline = await captureRefusalBaseline(page);
    await page.evaluate(() => {
      document.getElementById('l')!.appendChild(document.createElement('li')).textContent = 'b';
    });
    const seen = await readRefusal(page, { baseline });
    expect(seen.newRecord).toBe(true);
    expect(judgeRefusal(seen).refused).toBe(false);
  });

  it('moving to another path means accepted', async () => {
    await page.setContent('<html><body><h1>L</h1><div role="alert">hmm</div></body></html>');
    const baseline = { ...(await captureRefusalBaseline(page)), path: '/before' };
    const seen = await readRefusal(page, { baseline });
    expect(seen.moved).toBe(true);
    expect(judgeRefusal(seen).refused).toBe(false);
  });

  it('probeOnly looks only at :invalid and aria-invalid', async () => {
    const { seen } = await run('<html><body><h1>Hi</h1><div role="alert">Nope</div></body></html>', undefined, true);
    expect(seen.signals).toEqual([]);
  });

  it('a blank page is crashed', async () => {
    const { seen } = await run('<html><body></body></html>');
    expect(seen.crashed).toBe(true);
  });

  it('a not-found heading is crashed', async () => {
    const { seen } = await run('<html><body><h1>Page not found</h1></body></html>');
    expect(seen.crashed).toBe(true);
  });
});

describe('SpecConformanceChecker refusal block', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser.close();
  });

  const tc = (over: Record<string, unknown> = {}, refusal: Record<string, unknown> = {}): TestCase =>
    ({
      id: 'TC1',
      flowId: 'F1',
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
  const accepted = '<html><body><h1>Saved</h1><p>All good</p></body></html>';

  it('generic accepted is Minor; Source-backed is Major', async () => {
    await page.setContent(accepted);
    const baseline = await captureRefusalBaseline(page);
    const generic = await new SpecConformanceChecker().check(page, tc(), evidence, ctx(baseline));
    expect(generic).toHaveLength(1);
    expect(generic[0].severity).toBe('Minor');
    const backed = await new SpecConformanceChecker().check(
      page,
      tc({ docSource: { document: 'Guide' } }),
      evidence,
      ctx(baseline)
    );
    expect(backed[0].severity).toBe('Major');
  });

  it('an AI-guess limit accepted becomes a suggestion needing confirmation', async () => {
    await page.setContent(accepted);
    const baseline = await captureRefusalBaseline(page);
    const t = tc();
    (t.expectations as { origin: string }).origin = 'ai-guess';
    const f = await new SpecConformanceChecker().check(page, t, evidence, ctx(baseline));
    expect(f[0].needsConfirmation).toBe(true);
    expect(f[0].severity).toBe('Suggestion');
  });

  it('a refusal produces no finding', async () => {
    await page.setContent(FORM);
    const baseline = await captureRefusalBaseline(page);
    expect(await new SpecConformanceChecker().check(page, tc(), evidence, ctx(baseline))).toEqual([]);
  });

  it('a different message is Major only when a message was stated', async () => {
    await page.setContent('<html><body><h1>Hi</h1></body></html>');
    const baseline = await captureRefusalBaseline(page);
    // T-48: the alert appears after the baseline, so it counts as the page's answer.
    await page.evaluate(() => {
      const a = document.createElement('div');
      a.setAttribute('role', 'alert');
      a.textContent = 'Something else';
      document.body.appendChild(a);
    });
    const stated = await new SpecConformanceChecker().check(
      page,
      tc({}, { message: 'valid email' }),
      evidence,
      ctx(baseline)
    );
    expect(stated).toHaveLength(1);
    expect(stated[0].severity).toBe('Major');
    const none = await new SpecConformanceChecker().check(page, tc(), evidence, ctx(baseline));
    expect(none).toEqual([]);
  });

  it('a crash is Major regardless of origin', async () => {
    await page.setContent('<html><body></body></html>');
    const baseline = await captureRefusalBaseline(page);
    const f = await new SpecConformanceChecker().check(page, tc(), evidence, ctx(baseline));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('Major');
  });
});
