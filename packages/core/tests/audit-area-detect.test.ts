/**
 * BE-201 (REQ-006, REQ-036, Q-10). Pages the Website Audit crawl leaves alone: payment areas (card-number
 * field, payment-provider frame, checkout path) and pages that are nothing but a sign-in form. Rules run
 * over plain fact objects; the page reader runs against a stand-in page that records every call.
 */
import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import {
  isCheckoutPath,
  isPaymentProviderHost,
  paymentEvidence,
  areaVerdict,
  readAreaFacts,
  pageAreaVerdict,
  type AreaFacts,
  type AreaInputFact,
} from '../src/audit/crawl/area-detect.js';
import type { ReadForm } from '../src/discovery/interactive-states.js';

const field = (over: Partial<AreaInputFact> = {}): AreaInputFact => ({
  type: 'text',
  name: '',
  id: '',
  autocomplete: '',
  label: '',
  ...over,
});
const facts = (inputs: AreaInputFact[] = [], frameHosts: string[] = []): AreaFacts => ({ inputs, frameHosts });

const form = (inputs: Array<{ name: string; type: string; label?: string }>, visible = true): ReadForm => ({
  action: '/x',
  method: 'POST',
  visible,
  inputs: inputs.map((i) => ({ name: i.name, type: i.type, label: i.label ?? i.name, selector: `[name="${i.name}"]` })),
});
const SIGN_IN = form([
  { name: 'email', type: 'email', label: 'Email' },
  { name: 'password', type: 'password', label: 'Password' },
]);
const SEARCH = form([{ name: 'q', type: 'search', label: 'Search' }]);

const FIXED_DETAILS = ['card-field', 'provider-frame', 'checkout-path', 'sign-in-form'];

describe('isCheckoutPath', () => {
  it.each(['/checkout', '/shop/checkout', '/cart/checkout/pay', '/payment', '/account/billing', '/Checkout/', '/pay'])(
    '%s is a checkout path',
    (p) => expect(isCheckoutPath(p)).toBe(true)
  );

  it.each([
    '/checkout-guide-blog-post',
    '/blog/how-checkout-works',
    '/paypal-review',
    '/shop',
    '/about',
    '/',
    '/payday',
  ])('%s is not a checkout path', (p) => expect(isCheckoutPath(p)).toBe(false));

  it('does not throw on a malformed escape', () => {
    expect(isCheckoutPath('/%E0%A4%A/checkout')).toBe(true);
    expect(isCheckoutPath('/%E0%A4%A')).toBe(false);
  });
});

describe('paymentEvidence: card-number field', () => {
  it('autocomplete cc-number, alone or with a section token', () => {
    expect(paymentEvidence(facts([field({ autocomplete: 'cc-number' })]))).toBe('card-field');
    expect(paymentEvidence(facts([field({ autocomplete: 'billing CC-Number' })]))).toBe('card-field');
  });

  it.each([
    { name: 'cardnumber' },
    { name: 'card_number' },
    { id: 'cardNumber' },
    { id: 'cc-number' },
    { name: 'ccnum' },
    { label: 'Card number' },
    { label: 'Credit card no.' },
    { label: 'Debit Card Number' },
  ])('name/id/label %o names a card number', (over) => {
    expect(paymentEvidence(facts([field(over)]))).toBe('card-field');
  });

  it.each([
    { name: 'email', label: 'Email' },
    { name: 'account_number', label: 'Account number' },
    { name: 'phone', label: 'Phone number' },
    { name: 'discard_number' },
    { name: 'card_notes', label: 'Card notes' },
    { autocomplete: 'cc-name', label: 'Name on card' },
  ])('%o is not a card-number field', (over) => {
    expect(paymentEvidence(facts([field(over)]))).toBeUndefined();
  });
});

describe('paymentEvidence: payment-provider frame', () => {
  it.each([
    'js.stripe.com',
    'm.stripe.network',
    'api.razorpay.com',
    'www.paypal.com',
    'securegw.paytm.in',
    'secure.payu.in',
    'sdk.cashfree.com',
    'mercury.phonepe.com',
    'secure.ccavenue.com',
    'www.instamojo.com',
    'assets.braintreegateway.com',
    'checkoutshopper-live.adyen.com',
    'web.squarecdn.com',
  ])('a frame from %s is a payment area', (host) => {
    expect(isPaymentProviderHost(host)).toBe(true);
    expect(paymentEvidence(facts([], [host]))).toBe('provider-frame');
  });

  it.each([
    'www.google.com',
    'www.youtube.com',
    'player.vimeo.com',
    'maps.google.com',
    'notstripe.com',
    'stripe.com.evil.test',
  ])('a frame from %s is not', (host) => {
    expect(isPaymentProviderHost(host)).toBe(false);
    expect(paymentEvidence(facts([], [host]))).toBeUndefined();
  });

  it('a page with no fields and no frames has no evidence', () => {
    expect(paymentEvidence(facts())).toBeUndefined();
  });
});

describe('areaVerdict', () => {
  it('payment from a card field, a provider frame, or a checkout path', () => {
    expect(areaVerdict('/donate', facts([field({ autocomplete: 'cc-number' })]), [])).toEqual({
      why: 'payment',
      detail: 'card-field',
    });
    expect(areaVerdict('/donate', facts([], ['js.stripe.com']), [])).toEqual({
      why: 'payment',
      detail: 'provider-frame',
    });
    expect(areaVerdict('/shop/checkout', facts(), [])).toEqual({ why: 'payment', detail: 'checkout-path' });
  });

  it('payment wins over a sign-in form', () => {
    expect(areaVerdict('/checkout', facts(), [SIGN_IN])?.why).toBe('payment');
  });

  it('sign-in when the page is nothing but a sign-in form', () => {
    expect(areaVerdict('/login', facts(), [SIGN_IN])).toEqual({ why: 'sign-in', detail: 'sign-in-form' });
    // A hidden search form does not count against it.
    expect(areaVerdict('/login', facts(), [SIGN_IN, form([{ name: 'q', type: 'search' }], false)])?.why).toBe(
      'sign-in'
    );
  });

  it('no verdict for a sign-in form beside another content form (LC-002)', () => {
    expect(areaVerdict('/', facts(), [SIGN_IN, SEARCH])).toBeUndefined();
  });

  it('no verdict for a change-password form', () => {
    const change = form([
      { name: 'current-password', type: 'password', label: 'Current password' },
      { name: 'display-name', type: 'text', label: 'Display name' },
    ]);
    expect(areaVerdict('/account/security', facts(), [change])).toBeUndefined();
  });

  it('no verdict for an ordinary page', () => {
    expect(areaVerdict('/about', facts([field({ name: 'q' })], ['www.youtube.com']), [SEARCH])).toBeUndefined();
  });

  it('detail is always one of the fixed words, never page text', () => {
    const label = 'Card number — enter your 16 digits here';
    const v = areaVerdict('/x', facts([field({ label })]), []);
    expect(FIXED_DETAILS).toContain(v?.detail);
    expect(JSON.stringify(v)).not.toContain('16 digits');
  });
});

/**
 * A stand-in page: `evaluate` returns the given DOM read, `$$eval` the given forms, `frames` the given
 * frame URLs. Any other method (click, fill, focus, press, type, check, dispatchEvent, locator...) is
 * recorded and fails the test.
 */
function fakePage(read: { inputs: AreaInputFact[]; frameSrcs: string[] }, forms: ReadForm[], frameUrls: string[] = []) {
  const calls: string[] = [];
  const allowed: Record<string, unknown> = {
    evaluate: async () => read,
    $$eval: async () => forms,
    frames: () => frameUrls.map((u) => ({ url: () => u })),
  };
  const page = new Proxy(
    {},
    {
      get(_t, prop) {
        const name = String(prop);
        if (name === 'then') return undefined;
        calls.push(name);
        if (name in allowed) return allowed[name];
        throw new Error(`page.${name} must not be used by the area reader`);
      },
    }
  ) as unknown as Page;
  return { page, calls };
}

describe('readAreaFacts', () => {
  it('only evaluates DOM properties: no click, focus, fill or submit', async () => {
    const { page, calls } = fakePage(
      { inputs: [field({ autocomplete: 'cc-number' })], frameSrcs: ['https://js.stripe.com/v3/elements'] },
      []
    );
    const read = await readAreaFacts(page);
    expect(read.inputs).toHaveLength(1);
    expect(new Set(calls)).toEqual(new Set(['evaluate', 'frames']));
  });

  it('keeps http(s) frame hosts from iframe sources and loaded frames, without paths or duplicates', async () => {
    const { page } = fakePage(
      { inputs: [], frameSrcs: ['https://www.youtube.com/embed/abc?x=1', 'about:blank', '', 'not a url'] },
      [],
      ['about:blank', 'https://JS.Stripe.com/v3/', 'https://www.youtube.com/embed/abc', 'data:text/html,x']
    );
    const read = await readAreaFacts(page);
    expect(read.frameHosts.sort()).toEqual(['js.stripe.com', 'www.youtube.com']);
  });
});

describe('pageAreaVerdict', () => {
  it('a checkout path is payment without reading the page', async () => {
    const { page, calls } = fakePage({ inputs: [], frameSrcs: [] }, []);
    expect(await pageAreaVerdict(page, new URL('https://shop.test/cart/checkout/pay'))).toEqual({
      why: 'payment',
      detail: 'checkout-path',
    });
    expect(calls).toEqual([]);
  });

  it('a provider frame loaded by script is payment', async () => {
    const { page } = fakePage({ inputs: [], frameSrcs: [''] }, [], ['https://checkout.razorpay.com/v1/x']);
    expect(await pageAreaVerdict(page, new URL('https://shop.test/donate'))).toEqual({
      why: 'payment',
      detail: 'provider-frame',
    });
  });

  it('a sign-in-only page is sign-in; reading it touches nothing', async () => {
    const { page, calls } = fakePage({ inputs: [], frameSrcs: [] }, [SIGN_IN]);
    expect(await pageAreaVerdict(page, new URL('https://site.test/login'))).toEqual({
      why: 'sign-in',
      detail: 'sign-in-form',
    });
    expect(new Set(calls)).toEqual(new Set(['evaluate', 'frames', '$$eval']));
  });

  it('a sign-in form beside a content form, or an ordinary page, gets no verdict', async () => {
    const both = fakePage({ inputs: [], frameSrcs: ['https://www.google.com/maps/embed'] }, [SIGN_IN, SEARCH]);
    expect(await pageAreaVerdict(both.page, new URL('https://site.test/'))).toBeUndefined();
    const plain = fakePage({ inputs: [], frameSrcs: [] }, []);
    expect(await pageAreaVerdict(plain.page, new URL('https://site.test/about'))).toBeUndefined();
  });
});
