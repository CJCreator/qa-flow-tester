import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CompetitorsState } from '@qa/types/src/browser.js';
import { CompetitorsView, COMPETITORS_NO_KEY_REASON } from '../src/screens/audit/improved/CompetitorsPanel';
import { crawlCompetitors, loadCompetitors } from '../src/screens/audit/improved/competitors-api';

const page = {
  urlPath: '/',
  pageType: 'home' as const,
  title: 'Home',
  sections: ['Welcome'],
  ctas: ['Book a visit'],
  trustSignals: ['testimonials'],
  contactOptions: ['phone' as const],
  speedMs: 220,
};

const STATE: CompetitorsState = {
  version: 1,
  discoveredAt: '2026-11-19T10:00:00.000Z',
  candidates: [
    { url: 'https://a.example', host: 'a.example', reason: 'Same city', status: 'ok' },
    { url: 'https://b.example', host: 'b.example', reason: 'Same services', status: 'ok' },
    { url: 'http://10.0.0.1', host: '10.0.0.1', reason: '', status: 'refused', refusal: 'Private address.' },
  ],
  sites: [{ url: 'https://a.example', host: 'a.example', reason: 'Same city', status: 'read', pages: [page] }],
  comparison: [{ pageType: 'home', audited: page, competitors: [{ host: 'a.example', page }] }],
};

function view(extra: Partial<Parameters<typeof CompetitorsView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(CompetitorsView, {
      state: STATE,
      busy: null,
      error: null,
      aiReady: true,
      kept: new Set(['a.example']),
      onToggle: () => {},
      onFind: () => {},
      onRead: () => {},
      ...extra,
    })
  );
}

describe('similar sites panel', () => {
  it('lists the 3 named sites, each kept one with a tick box; a refused one shows why', () => {
    const html = view();
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('Private address.');
    expect(html).toContain('Side by side, page by page');
    expect(html).toContain('Calls to action: Book a visit');
    expect(html).not.toMatch(/score/i);
  });

  it('without an AI key the find button says why it is disabled', () => {
    const html = view({ aiReady: false, state: null });
    expect(html).toContain(COMPETITORS_NO_KEY_REASON);
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('a GET with nothing stored is no competitors, not an error; crawl posts the kept hosts', async () => {
    const empty = await loadCompetitors(
      'audit_1',
      1,
      async () => new Response(JSON.stringify({ error: 'none', code: 'ERR_AUDIT_NOT_FOUND' }), { status: 404 })
    );
    expect(empty).toEqual({ ok: true, value: null });
    let sent: unknown;
    const got = await crawlCompetitors('audit_1', 1, ['a.example'], async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ competitors: STATE }), { status: 200 });
    });
    expect(sent).toEqual({ version: 1, hosts: ['a.example'] });
    expect(got.ok).toBe(true);
  });
});
