/**
 * Website Audit: which pages the crawl must leave alone (Q-10, REQ-006, REQ-036).
 * - A payment area: a card-number field, a payment-provider frame, or a checkout path. Nothing on it is
 *   clicked or sent and its links are not followed.
 * - A sign-in page: nothing but the site's way in (same rule as the Check-up Spider, LC-002).
 * Pure rules plus one thin reader that only evaluates DOM properties: it never clicks, focuses, fills in
 * or submits anything. Verdicts carry a short fixed `detail`, never page text.
 */
import type { Page } from 'playwright';
import type { ReadForm } from '../../discovery/interactive-states.js';
import { isSignInOnlyForm, readPageForms } from '../../discovery/deterministic-spider.js';

/** One field on the page, as the area rules see it. */
export interface AreaInputFact {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  label: string;
}

/** What the area rules read from a rendered page. */
export interface AreaFacts {
  inputs: AreaInputFact[];
  /** Host names of the frames on the page (lower case). */
  frameHosts: string[];
}

export type PaymentEvidence = 'card-field' | 'provider-frame';
export type AreaDetail = PaymentEvidence | 'checkout-path' | 'sign-in-form';

export interface AreaVerdict {
  why: 'payment' | 'sign-in';
  detail: AreaDetail;
}

/** Path segments that name a checkout or payment step. A whole segment only: /checkout-guide is not one. */
const CHECKOUT_SEGMENTS = new Set(['checkout', 'check-out', 'payment', 'payments', 'pay', 'billing']);

/** Card-number wording in a name, id or label: card number, card_no, cardnum, cc-number, ccnum... */
const CARD_NUMBER = /(?<![a-z])(?:card[\s_-]*(?:number|num|no\b|nr\b)|cc[\s_-]*(?:number|num|no\b))/i;

/** Hosts (and their sub-domains) that serve payment-provider frames. */
export const PAYMENT_PROVIDER_HOSTS = [
  'stripe.com',
  'stripe.network',
  'razorpay.com',
  'paypal.com',
  'paytm.com',
  'paytm.in',
  'payu.in',
  'payu.com',
  'payumoney.com',
  'cashfree.com',
  'phonepe.com',
  'ccavenue.com',
  'instamojo.com',
  'braintreegateway.com',
  'braintree-api.com',
  'adyen.com',
  'adyenpayments.com',
  'squareup.com',
  'squarecdn.com',
] as const;

/** Whether a URL path has a checkout or payment segment (/checkout, /shop/checkout, /cart/checkout/pay). */
export function isCheckoutPath(pathname: string): boolean {
  return pathname.split('/').some((raw) => {
    let segment = raw;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      // A malformed escape is compared as written.
    }
    return CHECKOUT_SEGMENTS.has(segment.trim().toLowerCase());
  });
}

/** Whether a host is one of the payment providers or a sub-domain of one. */
export function isPaymentProviderHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return PAYMENT_PROVIDER_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function isCardNumberField(input: AreaInputFact): boolean {
  if (input.autocomplete.toLowerCase().split(/\s+/).includes('cc-number')) return true;
  return [input.name, input.id, input.label].some((s) => CARD_NUMBER.test(s));
}

/** The payment evidence on a page, or undefined when there is none. */
export function paymentEvidence(facts: AreaFacts): PaymentEvidence | undefined {
  if (facts.inputs.some(isCardNumberField)) return 'card-field';
  if (facts.frameHosts.some(isPaymentProviderHost)) return 'provider-frame';
  return undefined;
}

/** The verdict from facts already read: payment first (checkout path, then evidence), then sign-in, else none. */
export function areaVerdict(pathname: string, facts: AreaFacts, forms: ReadForm[]): AreaVerdict | undefined {
  if (isCheckoutPath(pathname)) return { why: 'payment', detail: 'checkout-path' };
  const evidence = paymentEvidence(facts);
  if (evidence) return { why: 'payment', detail: evidence };
  if (isSignInOnlyForm(forms)) return { why: 'sign-in', detail: 'sign-in-form' };
  return undefined;
}

/** Reads the fields and frame hosts of the rendered page. Only DOM properties are read; nothing is touched. */
export async function readAreaFacts(page: Page): Promise<AreaFacts> {
  const read = await page.evaluate(() => {
    const clean = (s: string | null | undefined) =>
      (s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea')).map(
      (inp) => {
        const id = inp.getAttribute('id') || '';
        let forLabel: Element | null = null;
        if (id) {
          try {
            forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          } catch {
            forLabel = null;
          }
        }
        const wrapping = inp.closest('label');
        return {
          type: (inp.getAttribute('type') || inp.tagName).toLowerCase(),
          name: inp.getAttribute('name') || '',
          id,
          autocomplete: inp.getAttribute('autocomplete') || '',
          label:
            clean(inp.getAttribute('aria-label')) ||
            clean(forLabel?.textContent) ||
            clean(wrapping?.textContent) ||
            clean(inp.getAttribute('placeholder')),
        };
      }
    );
    const frameSrcs = Array.from(document.querySelectorAll('iframe')).map(
      (f) => (f as HTMLIFrameElement).src || f.getAttribute('src') || ''
    );
    return { inputs, frameSrcs };
  });
  const hosts = new Set<string>();
  const addHost = (src: string) => {
    try {
      const u = new URL(src);
      if (/^https?:$/.test(u.protocol) && u.hostname) hosts.add(u.hostname.toLowerCase());
    } catch {
      // about:blank, srcdoc frames and malformed sources have no host.
    }
  };
  read.frameSrcs.forEach(addHost);
  // Frames loaded by script (Stripe Elements, PayPal buttons) can start blank; their current URL is in frames().
  for (const frame of page.frames()) addHost(frame.url());
  return { inputs: read.inputs, frameHosts: [...hosts] };
}

/**
 * The Spider's `inspectPage` for the Website Audit: `payment` for a payment area, else `sign-in` for a
 * page that is nothing but a sign-in form, else undefined.
 */
export async function pageAreaVerdict(page: Page, landed: URL): Promise<AreaVerdict | undefined> {
  // Cheapest first: a checkout path needs no page read, payment evidence needs no form read.
  if (isCheckoutPath(landed.pathname)) return { why: 'payment', detail: 'checkout-path' };
  const facts = await readAreaFacts(page);
  if (paymentEvidence(facts)) return areaVerdict(landed.pathname, facts, []);
  return areaVerdict(landed.pathname, facts, await readPageForms(page));
}
