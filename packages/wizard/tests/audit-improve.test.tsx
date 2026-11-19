import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AUDIT_API, type AuditVersion, type ImproveListReply } from '@qa/types/src/browser.js';
import {
  ImprovedVersionView,
  costText,
  createImprove,
  listImprove,
  variantUrl,
  type ImprovedVersionViewProps,
} from '../src/screens/audit/improved/ImprovedVersionScreen';

const AUDIT_ID = 'a1';
const versions = [
  { auditId: AUDIT_ID, version: 2, status: 'done', startedAt: '2026-11-03T08:00:00Z' },
] as unknown as AuditVersion[];
const reply: ImproveListReply = {
  version: 2,
  language: 'en',
  pages: [
    { key: 'home', urlPath: '/', title: 'Home', layoutGroup: null },
    { key: 'p-services', urlPath: '/services', title: 'Services', layoutGroup: 'content' },
  ],
  variants: [
    { page: 'home', variant: 1, style: 'clean', status: 'made', createdAt: '2026-11-19T10:00:00Z' },
    {
      page: 'home',
      variant: 2,
      style: 'bold',
      status: 'failed',
      problem: 'budget-spent',
      createdAt: '2026-11-19T10:00:00Z',
    },
  ],
  estimate: { usdPerRequest: 0.05 },
};

const textOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

function view(over: Partial<ImprovedVersionViewProps> = {}): string {
  const props: ImprovedVersionViewProps = {
    auditId: AUDIT_ID,
    versions,
    version: 2,
    aiReady: true,
    onVersion: () => undefined,
    improve: { status: 'loaded', reply },
    chosen: ['home', 'p-services'],
    variantCount: 3,
    making: false,
    message: null,
    onTogglePage: () => undefined,
    onVariantCount: () => undefined,
    onMakeVariants: () => undefined,
    language: 'en',
    preview: { status: 'idle' },
    onLanguage: () => undefined,
    onMake: () => undefined,
    ...over,
  };
  return renderToStaticMarkup(createElement(ImprovedVersionView, props));
}

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

describe('design variants on the Improved version screen (T-413)', () => {
  it('lists the homepage and each Layout Group page with a tick box', () => {
    const html = view();
    expect(html).toMatch(/<input id="improve-page-home" type="checkbox"[^>]*checked=""/);
    expect(html).toMatch(
      /<label for="improve-page-p-services">\/services, the Sample Page of the Layout Group &quot;content&quot;<\/label>/
    );
    expect(html).toMatch(/<label[^>]*for="improve-variants"/);
    for (const n of [1, 2, 3, 4, 5]) expect(html).toContain(`<option value="${n}"`);
    expect(html).not.toContain('<option value="6"');
  });

  it('shows the AI requests and the cost before starting', () => {
    expect(textOf(view())).toContain('6 AI requests (2 pages × 3 variants), about $0.30');
    expect(costText(1, 1, null)).toBe(
      '1 AI request (1 page × 1 variant), charged to your own AI key. The price of your model is not known.'
    );
    const button = view().match(/<button [^>]*>Make the design variants<\/button>/)?.[0] ?? '';
    expect(button).toContain('aria-describedby="variants-cost"');
  });

  it('the make button says why it is off: no AI key, or no page ticked', () => {
    const noKey = view({ aiReady: false });
    expect(noKey.match(/<button [^>]*>Make the design variants<\/button>/)?.[0]).toContain('disabled=""');
    expect(noKey).toContain('id="variants-make-reason"');
    const none = view({ chosen: [] });
    expect(none.match(/<button [^>]*>Make the design variants<\/button>/)?.[0]).toContain(
      'aria-describedby="variants-pick-reason"'
    );
    expect(textOf(none)).toContain('Tick at least one page.');
  });

  it('links each made variant and says why one was not made', () => {
    const html = view();
    expect(html).toContain(`href="${variantUrl(AUDIT_ID, 2, 'home', 1)}"`);
    expect(variantUrl(AUDIT_ID, 2, 'home', 1)).toBe('/api/audits/a1/improve/home/1?version=2');
    expect(textOf(html)).toContain('Variant 2: not made, the AI Request Budget is spent');
  });

  it('calls listImprove and createImprove on their AUDIT_API rows', async () => {
    const list = fakeFetch(reply);
    expect(await listImprove(AUDIT_ID, 2, list.fetchImpl)).toEqual({ ok: true, value: reply });
    expect(list.calls[0]).toMatchObject({
      url: '/api/audits/a1/improve?version=2',
      method: AUDIT_API.listImprove.method,
    });

    const make = fakeFetch({ requests: 6, variants: [] });
    const body = { version: 2, pages: ['home', 'p-services'], variants: 3 };
    expect(await createImprove(AUDIT_ID, body, make.fetchImpl)).toEqual({
      ok: true,
      value: { requests: 6, variants: [] },
    });
    expect(make.calls[0]).toEqual({ url: '/api/audits/a1/improve', method: 'POST', body });

    const refused = fakeFetch({ error: 'x', code: 'ERR_NO_AI_KEY' }, 409);
    const outcome = await createImprove(AUDIT_ID, body, refused.fetchImpl);
    expect(outcome).toMatchObject({ ok: false, code: 'ERR_NO_AI_KEY' });
  });
});
