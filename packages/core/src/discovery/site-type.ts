import type {
  DiscoveredFlow,
  PageInventoryItem,
  RoleCredential,
} from '@qa/types';
import type { SpiderResult } from './deterministic-spider.js';

export type SiteType = 'shop' | 'SaaS' | 'content' | 'booking' | 'app' | 'other';

/** A whole word in an address: "shop" in shop.example.com or /shop/, not in workshop.example.com. */
const addressWord = (words: string) => new RegExp(`(^|[./-])(${words})([./-]|$)`, 'i');
const SHOP_ADDRESS = addressWord('shop|store|boutique|cart|catalogue|catalog');
const BOOKING_ADDRESS = addressWord('booking|bookings|hotel|hotels|flights?|reservations?');

/**
 * Names the kind of site from what the scan found: page addresses and titles, and the names of
 * the buttons, links and fields on each page. Only fixed rules, so the same pages always give the
 * same answer.
 */
export function detectSiteType(pages: PageInventoryItem[], targetUrl: string): SiteType {
  let shopSignals = 0;
  let saasSignals = 0;
  let appSignals = 0;
  let bookingSignals = 0;
  let contentSignals = 0;

  try {
    const { hostname, pathname } = new URL(targetUrl);
    if (SHOP_ADDRESS.test(hostname) || SHOP_ADDRESS.test(pathname)) shopSignals += 3;
    if (BOOKING_ADDRESS.test(hostname) || BOOKING_ADDRESS.test(pathname)) bookingSignals += 3;
  } catch {
    // an unreadable address gives no signal
  }

  for (const page of pages) {
    const pPath = page.urlPath.toLowerCase();
    const pTitle = (page.title || '').toLowerCase();

    if (/cart|basket|checkout|product|catalogue|catalog|\/item|order/.test(pPath) || /\b(cart|basket|shop|store|products?)\b/.test(pTitle)) {
      shopSignals += 3;
    }
    if (/invoice|billing|pricing|\/plans?\b|dashboard|team|organi[sz]ation|workspace/.test(pPath) || /dashboard|pricing|workspace/.test(pTitle)) {
      saasSignals += 3;
    }
    if (/reservation|appointment|hotel|room|flight|\/book(ing)?s?\//.test(pPath) && !/catalogue/.test(pPath)) {
      bookingSignals += 3;
    }
    if (/blog|article|news|post|docs?\b|guide/.test(pPath) || /\b(blog|articles?|news)\b/.test(pTitle)) {
      contentSignals += 2;
    }
    if (/\b(todos?|to-do|tasks?|kanban|notes?)\b/.test(pTitle)) {
      appSignals += 3;
    }

    for (const el of page.elements || []) {
      const combined = `${el.name || ''} ${el.testId || ''}`.toLowerCase();

      if (/add to (?:basket|cart|bag)|checkout|buy now|in stock|out of stock/.test(combined)) {
        shopSignals += 2;
      }
      if (/new.?todo|todo.?list|clear completed|what needs to be done|add (a )?task|new task/.test(combined)) {
        appSignals += 3;
      }
      if (/check-in|check-out|reserve|book now|guests/.test(combined)) {
        bookingSignals += 2;
      }
      if (/upgrade|subscribe|pricing|invoice/.test(combined)) {
        saasSignals += 2;
      }
    }
  }

  // One or two screens you work in, rather than pages you read: an app.
  const oneScreenApp =
    pages.length <= 2 &&
    pages.some((p) => (p.elements || []).some((el) => el.role === 'textbox' && !el.insideForm && el.inputType !== 'search'));
  if (oneScreenApp) appSignals += 2;

  const scores: Array<{ type: SiteType; score: number }> = [
    { type: 'shop', score: shopSignals },
    { type: 'app', score: appSignals },
    { type: 'SaaS', score: saasSignals },
    { type: 'booking', score: bookingSignals },
    { type: 'content', score: contentSignals },
  ];

  scores.sort((a, b) => b.score - a.score);
  if (scores[0].score >= 2) {
    return scores[0].type;
  }

  return 'other';
}

const flowId = (n: number) => `FLOW-${String(n).padStart(3, '0')}`;

/**
 * Builds 3-5 journeys from fixed rules when the AI can't plan (no key, no free model, or its plan
 * was unusable): one that fits the site type, one per form found, and a visit to the main pages.
 */
export function generateFallbackJourneys(
  siteType: SiteType,
  spiderResult: SpiderResult,
  roles: RoleCredential[] = []
): DiscoveredFlow[] {
  const flows: DiscoveredFlow[] = [];
  const defaultRole = roles[0]?.role || 'anonymous';
  let flowCounter = 1;
  const homePage = spiderResult.pages.find((p) => p.urlPath === '/' || p.urlPath === '') || spiderResult.pages[0];

  // 1. Site-type specific primary journey
  if (siteType === 'shop' && homePage) {
    const productLink = homePage.elements?.find(
      (el) => el.role === 'link' && el.visible && (/catalogue|product|book|item/i.test(el.selector) || /catalogue|product|book|item/i.test(el.href || ''))
    );

    if (productLink) {
      flows.push({
        id: flowId(flowCounter++),
        name: 'Browse and view product',
        role: defaultRole,
        description: 'Checks shoppers can browse the catalogue and open a product.',
        startPage: homePage.urlPath || '/',
        steps: [
          { action: 'navigate', value: homePage.urlPath || '/', name: 'Open store homepage' },
          { action: 'click', selector: productLink.selector, name: `Click "${productLink.name || 'product'}"` },
        ],
        candidateExpectations: {
          url: { pattern: '/*' },
        },
        source: 'fallback',
      });
    }
  } else if (siteType === 'app' && homePage) {
    const input = homePage.elements?.find((el) => el.role === 'textbox' && el.visible);

    if (input) {
      flows.push({
        id: flowId(flowCounter++),
        name: 'Create an item',
        role: defaultRole,
        description: 'Checks the main thing people type into works.',
        startPage: homePage.urlPath || '/',
        steps: [
          { action: 'navigate', value: homePage.urlPath || '/', name: 'Open application' },
          { action: 'fill', selector: input.selector, value: 'Test Item 1', name: `Fill "${input.name || 'item'}"` },
          { action: 'wait', name: 'Wait for item update' },
        ],
        source: 'fallback',
      });
    }
  }

  // 2. Add form submission flows from discovered forms (never the sign-in form)
  const NON_FILLABLE_TYPES = new Set(['submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden']);
  for (const form of spiderResult.forms) {
    if (flows.length >= 3) break;
    if (form.inputs.some((inp) => inp.type === 'password')) continue;
    const fillableInputs = form.inputs.filter((inp) => !NON_FILLABLE_TYPES.has(inp.type));
    if (fillableInputs.length === 0 || !form.submitButtonSelector) continue;

    flows.push({
      id: flowId(flowCounter++),
      name: `Send the form on ${form.urlPath}`,
      role: defaultRole,
      description: `Checks the form on ${form.urlPath} can be filled in and sent.`,
      startPage: form.urlPath,
      steps: [
        ...fillableInputs.map((inp) => ({
          action: 'fill' as const,
          selector: inp.selector,
          value: (() => {
            const hint = `${inp.selector || ''} ${inp.label || ''} ${inp.name || ''}`.toLowerCase();
            if (inp.type === 'number') return '100';
            if (inp.type === 'email' || hint.includes('email')) return 'test.user@example.com';
            if (inp.type === 'url' || hint.includes('url') || hint.includes('address') || hint.includes('site') || hint.includes('host') || hint.includes('domain')) {
              return 'https://example.com';
            }
            if (inp.type === 'tel' || hint.includes('phone') || hint.includes('tel')) return '5555550123';
            if (hint.includes('password') || hint.includes('pass')) return 'TestPassword123!';
            return 'Test Value';
          })(),
          name: `Fill ${inp.label || 'field'}`,
        })),
        { action: 'click' as const, selector: form.submitButtonSelector, name: 'Send the form' },
      ],
      source: 'fallback',
    });
  }

  // 3. Visit the main pages: every run gets at least this one
  const mainPages = spiderResult.pages.filter((p) => !p.outOfScope && !p.hasSignInForm).slice(0, 6);
  if (mainPages.length > 0) {
    flows.push({
      id: flowId(flowCounter++),
      name: 'Visit the main pages',
      role: defaultRole,
      description: 'Opens each main page in turn, so every check runs on them.',
      startPage: mainPages[0].urlPath,
      steps: mainPages.map((p) => ({ action: 'navigate' as const, value: p.urlPath, name: `Open ${p.title || p.urlPath}` })),
      source: 'fallback',
    });
  } else {
    flows.push({
      id: flowId(flowCounter++),
      name: 'Open the start page',
      role: defaultRole,
      description: 'Checks the start page loads without errors.',
      startPage: '/',
      steps: [{ action: 'wait', name: 'Wait for page load' }],
      source: 'fallback',
    });
  }

  return flows;
}
