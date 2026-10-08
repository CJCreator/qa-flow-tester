import type { BrowserContext } from 'playwright';
import type { DiscoveredFlow, DiscoveryDraft, PageInventoryItem } from '@qa/types';
import { isPrivateHost } from './competitive/safe-crawler.js';
import { SafetyFilter } from './discovery/safety-filter.js';
import { isIpLiteral, isPrivateTextHost } from './address-class.js';
import { decideTestCopy, type TestCopyReason } from './domain-verification.js';
import { defaultNetDeps } from './safe-net.js';

/**
 * The rules that keep a live site unchanged. Full testing (sending forms, pressing buttons that
 * save or delete) needs both the owner's say-so and a test host. Anything else is treated as live:
 * it is explored and checked, but nothing is sent.
 */

export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Hosts that are test copies by nature: this machine, private networks, Docker's name for the host,
 * Microsoft dev tunnels, and hosts the owner marked as staging. Anything uncertain is live.
 *
 * Local mode only: it reads the name and does no DNS lookup. A shared machine (RUNNER_BETA=1) uses
 * resolveTestHost, which needs a Verified Domain proof (ADR 0014).
 */
export function isTestHost(hostname: string, stagingHosts: string[] = []): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isPrivateHost(h)) return true;
  if (h === '0.0.0.0') return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) addresses
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (h.endsWith('.devtunnels.ms')) return true;
  return stagingHosts.some((s) => s.trim().toLowerCase() === h);
}

/**
 * Whether an address is a Test Copy, for a shared machine (ADR 0014) or local mode. Local mode is the
 * text-only rule with no lookup. On a shared machine the host must be marked by the owner, every
 * address its name resolves to must be public, and the Verified Domain proof must pass; the proof is
 * fetched only when the first two hold and the address is https. A failed or slow lookup is not a test copy.
 */
export async function resolveTestHost(
  hostname: string,
  opts: {
    shared: boolean;
    marked: boolean;
    origin: string;
    proof?: () => Promise<boolean>;
    lookup?: (host: string) => Promise<string[]>;
  }
): Promise<{ testCopy: boolean; reason: TestCopyReason; addresses: string[] }> {
  if (!opts.shared) {
    const textTestHost = isTestHost(hostname, opts.marked ? [hostname] : []);
    return {
      ...decideTestCopy({ shared: false, textTestHost, marked: opts.marked, addresses: [], proofOk: false }),
      addresses: [],
    };
  }
  const decide = (addresses: string[], proofOk: boolean) => ({
    ...decideTestCopy({ shared: true, textTestHost: false, marked: opts.marked, addresses, proofOk }),
    addresses,
  });
  if (!opts.marked) return decide([], false);
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  let addresses: string[] = [];
  if (isPrivateTextHost(h)) {
    addresses = ['127.0.0.1'];
  } else if (isIpLiteral(h)) {
    addresses = [h];
  } else {
    try {
      const found = await (opts.lookup ?? defaultNetDeps.lookup)(h);
      addresses = Array.isArray(found) ? found : [];
    } catch {
      addresses = [];
    }
  }
  const first = decide(addresses, false);
  if (first.reason !== 'not-verified') return first;
  if (!opts.origin.toLowerCase().startsWith('https://') || !opts.proof) return first;
  let ok = false;
  try {
    ok = await opts.proof();
  } catch {
    ok = false;
  }
  return decide(addresses, ok);
}

/**
 * Aborts every request that could change data (POST, PUT, PATCH, DELETE) in this browser context.
 * Returns the list it fills with what it blocked ("METHOD url"), so those can be kept out of the
 * findings: they are the tool's doing, not the site's.
 */
export async function blockChanges(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (MUTATING_METHODS.includes(method)) {
      blocked.push(`${method} ${request.url()}`);
      return route.abort('blockedbyclient');
    }
    // Hand on to any other route (the shared-machine guard), which continues the request when it is fine.
    return route.fallback();
  });
  return blocked;
}

/** Button words that save, send or delete something. Links with a real address are only navigation. */
const CHANGES_SOMETHING =
  /\b(save|submit|send|delete|remove|pay|buy|purchase|order|subscribe|register|sign ?up|create|publish|comment|confirm|finish|upload|invite|reserve|book now|add to (?:cart|basket|bag)|check ?out|place order|update)\b/i;

type FormInfo = NonNullable<DiscoveryDraft['forms']>[number];

/**
 * True when the journey sends a form or presses something that changes data, so on a live site it
 * is kept in the plan, marked "needs a test copy", and not run. Typing alone sends nothing; a
 * search form (sent with GET) only fetches a page.
 */
export function needsTestCopy(flow: DiscoveredFlow, pages: PageInventoryItem[], forms: FormInfo[] = []): boolean {
  const safety = new SafetyFilter();
  const elements = pages.flatMap((p) => p.elements || []);
  for (const step of flow.steps || []) {
    if (step.action !== 'click' || !step.selector) continue;
    const el = elements.find((e) => e.selector === step.selector);
    const name = el?.name || step.name;
    const form = forms.find((f) => f.submitButtonSelector === step.selector);
    if (form) {
      // A GET form only fetches a page, unless a script sends it another way: its button says so.
      if ((form.method || 'GET').toUpperCase() !== 'GET' || CHANGES_SOMETHING.test(name)) return true;
      continue;
    }
    if (safety.isSensitive(name, step.selector)) return true;
    const isLink = el
      ? el.role === 'link' && !!el.href && el.href !== '#' && !el.href.startsWith('javascript:')
      : false;
    if (isLink) continue;
    if (el?.insideForm && (el.role === 'button' || el.inputType === 'submit')) return true;
    if (CHANGES_SOMETHING.test(name)) return true;
  }
  return false;
}

/** Marks every journey that needs a test copy. The mark shows in the plan on any site. */
export function markJourneysNeedingTestCopy(draft: Pick<DiscoveryDraft, 'flows' | 'pages' | 'forms'>): void {
  for (const flow of draft.flows) {
    if (needsTestCopy(flow, draft.pages, draft.forms)) flow.needsTestCopy = true;
    else delete flow.needsTestCopy;
  }
}

export const NEEDS_TEST_COPY = 'Needs a test copy: it sends a form or changes data, which isn’t done on a live site.';
