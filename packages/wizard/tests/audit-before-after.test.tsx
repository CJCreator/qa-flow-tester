import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditVersion, ImproveListReply, ImproveVariant } from '@qa/types/src/browser.js';
import {
  BeforeAfter,
  FRAME_WIDTHS,
  SUGGESTION_LABEL,
  markerHref,
  screenshotUrl,
} from '../src/screens/audit/improved/BeforeAfter';
import {
  ImprovedVersionView,
  bestVariant,
  improvedZipUrl,
  setBest,
  type ImprovedVersionViewProps,
} from '../src/screens/audit/improved/ImprovedVersionScreen';

const AUDIT_ID = 'a1';
const page = { key: 'home', urlPath: '/', title: 'Home', layoutGroup: null, screenshotPath: 'shots/home-phone.png' };
const made = (n: number, passed = true): ImproveVariant => ({
  page: 'home',
  variant: n,
  style: n === 1 ? 'clean' : 'bold',
  status: 'made',
  createdAt: '2026-11-19T10:00:00Z',
  cites: ['AF-004', 's2'],
  gate: { passed, failed: passed ? [] : ['citations'], reasons: passed ? [] : ['x'] },
});
const reply: ImproveListReply = {
  version: 2,
  language: 'en',
  pages: [page],
  variants: [made(1, false), made(2), made(3)],
  estimate: { usdPerRequest: null },
};

function before(html: string | null = '<p>Variant</p>') {
  return renderToStaticMarkup(
    createElement(BeforeAfter, {
      auditId: AUDIT_ID,
      version: 2,
      page,
      variant: made(2),
      html,
      findingTitles: { 'AF-004': 'The call to action is hard to find' },
    })
  );
}

describe('before/after view (T-415)', () => {
  it('shows the stored phone screenshot beside the variant framed at 1440 and 375 px, labelled a suggestion', () => {
    const html = before();
    expect(html).toContain(`src="${screenshotUrl(AUDIT_ID, 2, 'shots/home-phone.png').replace(/&/g, '&amp;')}"`);
    expect(screenshotUrl(AUDIT_ID, 2, 'shots/home-phone.png')).toBe(
      '/api/audits/a1/file?version=2&path=shots%2Fhome-phone.png'
    );
    expect(FRAME_WIDTHS).toEqual([1440, 375]);
    for (const width of FRAME_WIDTHS) expect(html).toMatch(new RegExp(`<iframe [^>]*width="${width}"`));
    expect(html.match(/sandbox=""/g)).toHaveLength(2);
    expect(html).toContain(SUGGESTION_LABEL);
    expect(html).toContain('Suggestion, not the live site');
  });

  it('links each change marker to its finding', () => {
    const html = before();
    expect(markerHref(AUDIT_ID, 2, 'AF-004')).toBe('/audits/a1/versions/2#AF-004');
    expect(html).toContain('href="/audits/a1/versions/2#AF-004"');
    expect(html).toContain('AF-004: The call to action is hard to find');
    expect(html).toMatch(/<li data-marker="s2">Section s2<\/li>/);
  });

  it('waits for the variant before framing it', () => {
    expect(before(null)).not.toContain('<iframe');
  });
});

describe('download, best and the screen (T-415)', () => {
  const view = (over: Partial<ImprovedVersionViewProps> = {}) =>
    renderToStaticMarkup(
      createElement(ImprovedVersionView, {
        auditId: AUDIT_ID,
        versions: [
          { auditId: AUDIT_ID, version: 2, status: 'done', startedAt: '2026-11-03T08:00:00Z' },
        ] as unknown as AuditVersion[],
        version: 2,
        aiReady: true,
        onVersion: () => undefined,
        improve: { status: 'loaded', reply },
        chosen: ['home'],
        variantCount: 3,
        making: false,
        message: null,
        onTogglePage: () => undefined,
        onVariantCount: () => undefined,
        onMakeVariants: () => undefined,
        onTryAgain: () => undefined,
        language: 'en',
        preview: { status: 'idle' },
        onLanguage: () => undefined,
        onMake: () => undefined,
        ...over,
      })
    );

  it('the best defaults to the first variant that passed; a starred one wins', () => {
    expect(bestVariant(reply)).toEqual({ page: 'home', variant: 2 });
    expect(bestVariant({ ...reply, best: { page: 'home', variant: 3 } })).toEqual({ page: 'home', variant: 3 });
    // A starred variant that no longer passes the checks is not the best.
    expect(bestVariant({ ...reply, best: { page: 'home', variant: 1 } })).toEqual({ page: 'home', variant: 2 });
    const html = view();
    expect(html).toMatch(/<input id="best-home-2" type="radio"[^>]*checked=""/);
    expect(html).not.toContain('id="best-home-1"');
  });

  it('offers one variant as HTML and every passing one as a zip', () => {
    const html = view();
    expect(html).toMatch(/<a href="\/api\/audits\/a1\/improve\/home\/2\?version=2" download="home-2-bold.html"/);
    expect(html).toContain(`href="${improvedZipUrl(AUDIT_ID, 2)}"`);
    expect(improvedZipUrl(AUDIT_ID, 2)).toBe('/api/audits/a1/improve-export?version=2');
  });

  it('opens the before/after view for one variant', () => {
    const html = view({ opened: { page: 'home', variant: 3, html: '<p>x</p>' } });
    expect(html).toMatch(/aria-expanded="true"[^>]*>Hide before and after/);
    expect(html.match(/<iframe /g)).toHaveLength(2);
  });

  it('stars with PUT /api/audits/:id/improve-best', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const outcome = await setBest(AUDIT_ID, { version: 2, page: 'home', variant: 3 }, async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ best: { page: 'home', variant: 3 } }), { status: 200 });
    });
    expect(outcome).toEqual({ ok: true, value: { best: { page: 'home', variant: 3 } } });
    expect(calls[0]!.url).toBe('/api/audits/a1/improve-best');
    expect(calls[0]!.init?.method).toBe('PUT');
  });
});
