/**
 * T-416: automatic competitors. The AI is a fake provider behind the real stage AI (so the T-398 counter is
 * the real one); the network is a fake `NetDeps` behind the real pinned outbound fetch, so no real site is
 * ever reached.
 */
import { describe, it, expect } from 'vitest';
import type { AuditResult, PageContent } from '@qa/types';
import {
  auditAiRequestBudget,
  checkAuditAddress,
  compareSites,
  competitorSummary,
  discoverCompetitors,
  lightCrawlSite,
  lightCrawlSites,
  makeOutboundFetch,
  pageFactsFromHtml,
  parseCompetitorAnswer,
  resolveAuditAi,
  type AIProvider,
  type NetDeps,
  type PinnedRequest,
} from '@qa/core';

const PUBLIC_IP = '93.184.216.34';

/** A fake network: every name resolves to a public address, except names mapped to a private one. */
function fakeNet(pages: Record<string, { status: number; body: string; type?: string }>, privateHosts: string[] = []) {
  const requested: string[] = [];
  const net: NetDeps = {
    async lookup(host) {
      return [privateHosts.includes(host) ? '10.0.0.7' : PUBLIC_IP];
    },
    async connect(req: PinnedRequest) {
      const key = `${req.url.host}${req.url.pathname}`;
      requested.push(key);
      const page = pages[key];
      if (!page) return { status: 404, headers: { 'content-type': 'text/html' }, body: 'Not found' };
      return { status: page.status, headers: { 'content-type': page.type ?? 'text/html' }, body: page.body };
    },
  };
  return { net, requested };
}

async function aiAnswering(text: string) {
  const budget = auditAiRequestBudget();
  const provider: AIProvider = {
    providerType: 'openrouter',
    async generateText() {
      return text;
    },
  };
  const resolved = await resolveAuditAi({
    setup: { provider: 'openrouter' },
    keys: { resolveKey: async () => ({ provider: 'openrouter', apiKey: 'test-only', source: 'keychain' }) },
    budget,
    createProvider: () => provider,
  });
  if (!resolved.ok) throw new Error('no ai');
  return { ai: resolved.ai, budget };
}

const HOME: PageContent = {
  urlPath: '/',
  title: 'Green Leaf Clinic, Chennai',
  description: 'Family clinic in Chennai',
  text: 'Family doctors and dental care in Chennai. Book an appointment.',
  headings: [{ level: 1, text: 'Family clinic in Chennai' } as PageContent['headings'][number]],
  images: [],
  links: [
    { text: 'Services', to: '/services', region: 'menu' },
    { text: 'Call us', to: 'tel:+914400000000', region: 'menu' },
  ],
  forms: [],
  ctas: [{ text: 'Book an appointment', kind: 'link', to: '/contact' }],
  language: { detected: 'en' } as PageContent['language'],
  sections: [],
};

describe('discovery', () => {
  it('the mock AI names 3 sites in one request; a private address is refused', async () => {
    const answer = JSON.stringify({
      competitors: [
        { url: 'https://clinic-one.example', reason: 'A family clinic in Chennai, like the reviewed site.' },
        { url: 'clinic-two.example/about', reason: 'Offers dental care in the same city.' },
        { url: 'http://10.1.2.3', reason: 'A clinic.' },
      ],
    });
    const { ai, budget } = await aiAnswering(answer);
    const { net } = fakeNet({
      'clinic-one.example/': { status: 200, body: 'ok' },
      'clinic-two.example/': { status: 200, body: 'ok' },
    });
    const summary = competitorSummary({ url: 'https://greenleaf.example/', language: 'en' }, HOME);
    expect(summary.services).toContain('Services');

    const outcome = await discoverCompetitors(ai, summary, {
      checkAddress: (url) => checkAuditAddress(url, { netDeps: net }),
    });
    expect(budget.used).toBe(1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates).toHaveLength(3);
    expect(outcome.candidates.map((c) => c.url)).toEqual([
      'https://clinic-one.example',
      'https://clinic-two.example',
      'http://10.1.2.3',
    ]);
    expect(outcome.candidates.slice(0, 2).every((c) => c.status === 'ok')).toBe(true);
    expect(outcome.candidates[2]).toMatchObject({ status: 'refused' });
    expect(outcome.candidates[2].refusal).toMatch(/private or local network/);
  });

  it('a name that resolves to a private address is refused too', async () => {
    const answer = JSON.stringify({ competitors: [{ url: 'https://inside.example', reason: 'x' }] });
    const { ai } = await aiAnswering(answer);
    const { net } = fakeNet({}, ['inside.example']);
    const outcome = await discoverCompetitors(
      ai,
      competitorSummary({ url: 'https://a.example/', language: 'en' }, null),
      {
        checkAddress: (url) => checkAuditAddress(url, { netDeps: net }),
      }
    );
    expect(outcome.ok && outcome.candidates[0].status).toBe('refused');
  });

  it('drops the audited site, repeats, non-web schemes and claim words; keeps at most 3', () => {
    const parsed = parseCompetitorAnswer(
      '```json\n' +
        JSON.stringify({
          competitors: [
            { url: 'https://www.audited.example', reason: 'same' },
            { url: 'ftp://files.example', reason: 'x' },
            { url: 'https://a.example', reason: 'A fully compliant clinic' },
            { url: 'https://www.a.example/x', reason: 'repeat' },
            { url: 'https://b.example', reason: 'b' },
            { url: 'https://c.example', reason: 'c' },
            { url: 'https://d.example', reason: 'd' },
          ],
        }) +
        '\n```',
      'https://audited.example/'
    );
    expect(parsed.map((p) => p.host)).toEqual(['a.example', 'b.example', 'c.example']);
    expect(parsed[0].reason).not.toMatch(/compliant/i);
  });

  it('a spent AI Request Budget sends nothing', async () => {
    const budget = auditAiRequestBudget(0);
    let calls = 0;
    const resolved = await resolveAuditAi({
      setup: { provider: 'openrouter' },
      keys: { resolveKey: async () => ({ provider: 'openrouter', apiKey: 'test-only', source: 'keychain' }) },
      budget,
      createProvider: () => ({
        providerType: 'openrouter',
        async generateText() {
          calls++;
          return '{}';
        },
      }),
    });
    if (!resolved.ok) throw new Error('no ai');
    const outcome = await discoverCompetitors(
      resolved.ai,
      competitorSummary({ url: 'https://a.example/', language: 'en' }, null)
    );
    expect(outcome).toEqual({ ok: false, reason: 'budget-spent' });
    expect(calls).toBe(0);
  });
});

/** A homepage whose menu links to `count` key pages. */
function siteWith(host: string, count: number, robots = '') {
  const kinds = ['pricing', 'services', 'products', 'about', 'contact'];
  const links = Array.from(
    { length: count },
    (_, i) => `<a href="/${kinds[i % kinds.length]}-${i}">${kinds[i % kinds.length]}</a>`
  );
  const pages: Record<string, { status: number; body: string; type?: string }> = {
    [`${host}/`]: {
      status: 200,
      body: `<html><head><title>${host}</title></head><body><nav>${links.join('')}<a href="https://elsewhere.example/pricing">Out</a></nav>
        <h1>Welcome</h1><h2>What our clients say</h2><a class="btn" href="/contact-4">Book a visit</a>
        <a href="tel:+911234">Call</a><a href="https://wa.me/911234">WhatsApp</a>
        <form><input type="email"><textarea></textarea></form><script>var s="tawk.to"</script></body></html>`,
    },
    [`${host}/robots.txt`]: { status: robots ? 200 : 404, body: robots, type: 'text/plain' },
  };
  for (let i = 0; i < count; i++) {
    pages[`${host}/${kinds[i % kinds.length]}-${i}`] = { status: 200, body: `<h1>${kinds[i % kinds.length]}</h1>` };
  }
  return pages;
}

const noWait = { minGapMs: 0, sleep: async () => {} };

describe('light crawl', () => {
  it('reads at most 11 pages per site and never leaves the site', async () => {
    const { net, requested } = fakeNet(siteWith('one.example', 20));
    const site = await lightCrawlSite(
      { url: 'https://one.example', host: 'one.example', reason: 'r' },
      { ...noWait, fetch: makeOutboundFetch({ allowPrivate: false, deps: net }) }
    );
    expect(site.status).toBe('read');
    expect(site.pages).toHaveLength(11);
    expect(requested.filter((r) => !r.endsWith('/robots.txt'))).toHaveLength(11);
    expect(requested.every((r) => r.startsWith('one.example/'))).toBe(true);
    // One page of each type comes first.
    expect(site.pages.slice(1, 6).map((p) => p.pageType)).toEqual([
      'pricing',
      'services',
      'product',
      'about',
      'contact',
    ]);
  });

  it('honours robots.txt: a disallowed page is never requested', async () => {
    const { net, requested } = fakeNet(siteWith('two.example', 5, 'User-agent: *\nDisallow: /pricing'));
    const site = await lightCrawlSite(
      { url: 'https://two.example', host: 'two.example', reason: 'r' },
      { ...noWait, fetch: makeOutboundFetch({ allowPrivate: false, deps: net }) }
    );
    expect(requested).not.toContain('two.example/pricing-0');
    expect(site.pages.map((p) => p.urlPath)).not.toContain('/pricing-0');
    expect(site.pages).toHaveLength(5);
  });

  it('a site whose robots.txt refuses everything is "not read" with a reason', async () => {
    const { net, requested } = fakeNet(siteWith('three.example', 3, 'User-agent: *\nDisallow: /'));
    const site = await lightCrawlSite(
      { url: 'https://three.example', host: 'three.example', reason: 'r' },
      { ...noWait, fetch: makeOutboundFetch({ allowPrivate: false, deps: net }) }
    );
    expect(site).toMatchObject({ status: 'not-read', pages: [] });
    expect(site.notReadReason).toMatch(/robots\.txt/);
    expect(requested).toEqual(['three.example/robots.txt']);
  });

  it('a site on a private address is never reached', async () => {
    const { net, requested } = fakeNet(siteWith('lan.example', 3), ['lan.example']);
    const site = await lightCrawlSite(
      { url: 'https://lan.example', host: 'lan.example', reason: 'r' },
      { ...noWait, fetch: makeOutboundFetch({ allowPrivate: false, deps: net }) }
    );
    expect(site.status).toBe('not-read');
    expect(requested).toEqual([]);
  });

  it('the page allowance is shared across sites (the hosted cap)', async () => {
    const { net } = fakeNet({ ...siteWith('a.example', 10), ...siteWith('b.example', 10) });
    const sites = await lightCrawlSites(
      [
        { url: 'https://a.example', host: 'a.example', reason: 'r' },
        { url: 'https://b.example', host: 'b.example', reason: 'r' },
      ],
      { ...noWait, fetch: makeOutboundFetch({ allowPrivate: false, deps: net }), pageAllowance: 14 }
    );
    expect(sites[0].pages).toHaveLength(11);
    expect(sites[1].pages).toHaveLength(3);
    expect(sites.reduce((n, s) => n + s.pages.length, 0)).toBe(14);
  });
});

describe('page facts and comparison', () => {
  it('reads Sections, calls to action, trust signals and contact options from the HTML', () => {
    const html = siteWith('x.example', 5)['x.example/'].body;
    const facts = pageFactsFromHtml(html, '/', 120);
    expect(facts.pageType).toBe('home');
    expect(facts.sections).toEqual(['Welcome', 'What our clients say']);
    expect(facts.ctas).toContain('Book a visit');
    expect(facts.trustSignals).toContain('testimonials');
    expect([...facts.contactOptions].sort()).toEqual(['chat', 'form', 'phone', 'whatsapp']);
    expect(facts.speedMs).toBe(120);
  });

  it('compares per page type, side by side; a site not read shows no page', () => {
    const home = pageFactsFromHtml('<h1>Hi</h1>', '/', 10);
    const pricing = { ...pageFactsFromHtml('<h1>Plans</h1>', '/pricing', 10), pageType: 'pricing' as const };
    const rows = compareSites(
      [home],
      [
        { url: 'https://a.example', host: 'a.example', reason: '', status: 'read', pages: [home, pricing] },
        { url: 'https://b.example', host: 'b.example', reason: '', status: 'not-read', pages: [] },
      ]
    );
    expect(rows.map((r) => r.pageType)).toEqual(['home', 'pricing']);
    expect(rows[1].audited).toBeNull();
    expect(rows[1].competitors).toEqual([
      { host: 'a.example', page: pricing },
      { host: 'b.example', page: null },
    ]);
  });

  it('nothing in the facts is a score', () => {
    const facts = pageFactsFromHtml(siteWith('y.example', 1)['y.example/'].body, '/', 1) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(facts).some((k) => /score|grade|rank/i.test(k))).toBe(false);
    void ({} as AuditResult);
  });
});
