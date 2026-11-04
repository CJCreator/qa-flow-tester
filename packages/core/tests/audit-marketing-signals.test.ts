import { describe, it, expect } from 'vitest';
import { MARKETING_SIGNALS } from '@qa/types';
import type { AuditFinding, ContentForm, InternalLinking, MarketingSignal, MarketingSignalKey } from '@qa/types';
import { buildPageContent } from '../src/audit/analysis/page-content.js';
import {
  auditMarketing,
  isLeadForm,
  marketingSignals,
  type MarketingPage,
} from '../src/audit/analysis/marketing-signals.js';
import { firstTelPhone, napFromAddressText, napFromJsonLd, napFromPage } from '../src/audit/analysis/nap.js';
import type { RawForm, RawPage } from '../src/audit/analysis/raw-page.js';

const ORIGIN = 'https://bakery.example';

function rawPage(urlPath: string, overrides: Partial<RawPage> = {}): RawPage {
  return {
    url: `${ORIGIN}${urlPath}`,
    title: null,
    description: null,
    lang: null,
    textChunks: [],
    headings: [],
    images: [],
    anchors: [],
    contactLinks: [],
    forms: [],
    ctaCandidates: [],
    metaGenerator: null,
    scripts: [],
    stylesheets: [],
    iframes: [],
    jsonLd: [],
    socialMetaKeys: [],
    frameworkMarkers: [],
    addresses: [],
    menu: [],
    breadcrumb: [],
    ...overrides,
  };
}

function page(urlPath: string, overrides: Partial<RawPage> = {}): MarketingPage {
  const raw = rawPage(urlPath, overrides);
  return { raw, content: buildPageContent(raw, { origin: ORIGIN, maxTextChars: 100_000 }) };
}

function text(...chunks: string[]) {
  return chunks.map((t) => ({ text: t }));
}

function form(fields: Array<[type: string, label: string, name?: string]>, action: string | null = null): RawForm {
  return {
    chunk: -1,
    method: 'post',
    action,
    fields: fields.map(([type, label, name]) => ({ type, label, name: name ?? null, required: false })),
  };
}

const NO_LINKING: InternalLinking = { inboundCounts: {}, unlinkedPages: [] };

function finding(id: string, rule: string, urlPath: string): AuditFinding {
  return {
    id,
    rule,
    group: 'content',
    area: 'search-ranking',
    title: rule,
    detail: rule,
    suggestion: rule,
    impact: 'medium',
    effort: 'low',
    urlPath,
    sectionId: null,
    source: 'rule',
  };
}

function signal(signals: MarketingSignal[], key: MarketingSignalKey): MarketingSignal {
  const found = signals.find((s) => s.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
}

function run(pages: MarketingPage[], linking: InternalLinking = NO_LINKING, findings: AuditFinding[] = []) {
  return marketingSignals({ pages, internalLinking: linking, findings });
}

/** ADR 0018: details say what was seen, never that it is good. */
const CLAIM = /\b(?:compliant|compliance|accessible|secure|safe|passes|certified)\b/i;

describe('marketingSignals: shape (REQ-015 AC-1)', () => {
  it('gives exactly ten entries, one per MARKETING_SIGNALS key in order with its label', () => {
    const signals = run([page('/')]);
    expect(signals).toHaveLength(10);
    expect(signals.map((s) => [s.key, s.label])).toEqual(MARKETING_SIGNALS.map((s) => [s.key, s.label]));
    for (const s of signals) {
      expect(['found', 'not-found']).toContain(s.status);
      expect(s.detail.length).toBeGreaterThan(0);
      expect(s.detail).toMatch(/^Not found: /);
      expect(s.pages).toEqual([]);
    }
  });

  it("is 'not-checked' on every entry only when no page was read", () => {
    const signals = run([]);
    expect(signals.map((s) => s.key)).toEqual(MARKETING_SIGNALS.map((s) => s.key));
    for (const s of signals) {
      expect(s.status).toBe('not-checked');
      expect(s.pages).toEqual([]);
      expect(s.detail).toBe('Not checked: no page was read.');
    }
  });

  it('is deterministic and leaves its input unchanged', () => {
    const pages = [
      page('/', { scripts: ['https://www.googletagmanager.com/gtm.js?id=GTM-1'], forms: [form([['email', 'Email']])] }),
    ];
    const before = JSON.stringify(pages);
    expect(run(pages)).toEqual(run(pages));
    expect(JSON.stringify(pages)).toBe(before);
  });

  it('counts a page read twice once', () => {
    const signals = run([
      page('/call', { contactLinks: [{ kind: 'tel', href: 'tel:+914412345678', text: 'Call', chunk: -1 }] }),
      page('/call'),
    ]);
    expect(signal(signals, 'click-to-call').pages).toEqual(['/call']);
  });
});

describe('click-to-call (REQ-015 AC-2)', () => {
  it("is 'found' with the page of a tel: link", () => {
    const signals = run([
      page('/'),
      page('/contact', { contactLinks: [{ kind: 'tel', href: 'tel:+91-44-1234-5678', text: 'Call us', chunk: 0 }] }),
    ]);
    const s = signal(signals, 'click-to-call');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/contact']);
    expect(s.detail).toBe('Found: 1 tel: link on 1 page: /contact.');
  });

  it('counts a tel: anchor the reader did not list as a contact link', () => {
    const s = signal(
      run([page('/', { anchors: [{ href: 'tel:044123456', text: 'Call', region: 'internal', chunk: -1 }] })]),
      'click-to-call'
    );
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/']);
  });

  it("is 'not-found' without a tel: link", () => {
    const s = signal(
      run([page('/', { contactLinks: [{ kind: 'mailto', href: 'mailto:a@b.example', text: 'Mail', chunk: -1 }] })]),
      'click-to-call'
    );
    expect(s.status).toBe('not-found');
    expect(s.detail).toBe('Not found: no tel: link on the 1 page read.');
  });
});

describe('lead forms (REQ-015 AC-3)', () => {
  it("is 'found' with the page of a form asking for a name, email or phone", () => {
    const signals = run([
      page('/'),
      page('/contact', {
        forms: [
          form([
            ['text', 'Your name', 'name'],
            ['email', 'Email'],
            ['textarea', 'Message'],
            ['submit', 'Send'],
          ]),
        ],
      }),
    ]);
    const s = signal(signals, 'lead-forms');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/contact']);
    expect(s.detail).toContain('/contact');
  });

  it('a sign-in form with a password field is not a lead form', () => {
    const signals = run([
      page('/login', {
        forms: [
          form([
            ['email', 'Email'],
            ['password', 'Password'],
          ]),
        ],
      }),
    ]);
    expect(signal(signals, 'lead-forms').status).toBe('not-found');
  });

  it('a search form is not a lead form', () => {
    const signals = run([
      page('/', { forms: [form([['search', 'Search the site', 'q']])] }),
      page('/shop', { forms: [form([['text', 'Search products', 'q']], '/search')] }),
      page('/blog', { forms: [form([['text', 'Search', 's']])] }),
    ]);
    expect(signal(signals, 'lead-forms').status).toBe('not-found');
  });

  it('recognises phone-only and name-only forms; a form without such fields is not one', () => {
    expect(isLeadForm({ fields: [{ type: 'tel', label: 'Mobile' }] })).toBe(true);
    expect(isLeadForm({ fields: [{ type: 'text', label: 'Full name' }] })).toBe(true);
    expect(isLeadForm({ fields: [{ type: 'text', label: 'Phone number' }] })).toBe(true);
    expect(
      isLeadForm({
        fields: [
          { type: 'number', label: 'Quantity' },
          { type: 'hidden', label: '', name: 'email' },
        ],
      })
    ).toBe(false);
    expect(
      isLeadForm({
        fields: [
          { type: 'text', label: 'Username', name: 'username' },
          { type: 'password', label: 'Password' },
        ],
      })
    ).toBe(false);
  });

  it('never submits anything: it reads the form facts and leaves them unchanged', () => {
    const contact: ContentForm = {
      method: 'POST',
      action: 'https://bakery.example/send',
      fields: [{ type: 'email', label: 'Email' }],
    };
    const frozen = Object.freeze({ ...contact, fields: Object.freeze([...contact.fields]) }) as ContentForm;
    expect(isLeadForm(frozen)).toBe(true);
    expect(frozen).toEqual(contact);
  });
});

describe('local signals and NAP (REQ-015 AC-4)', () => {
  const localBusiness = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Bakery',
    name: 'Sunrise Bakery',
    telephone: '+91 44 1234 5678',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '12 Market Street',
      addressLocality: 'Chennai',
      postalCode: '600001',
      addressCountry: 'IN',
    },
  });

  it('lists the NAP from LocalBusiness JSON-LD with its page and names the schema', () => {
    const signals = run([
      page('/'),
      page('/about', { jsonLd: [{ types: ['Bakery', 'PostalAddress'], raw: localBusiness }] }),
    ]);
    const s = signal(signals, 'local-signals');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/about']);
    expect(s.nap).toEqual([
      {
        urlPath: '/about',
        name: 'Sunrise Bakery',
        address: '12 Market Street, Chennai, 600001, IN',
        phone: '+91 44 1234 5678',
      },
    ]);
    expect(s.detail).toContain('LocalBusiness schema');
    expect(s.detail).toContain('NAP');
  });

  it('lists the NAP from an address element with its page, and names a map embed', () => {
    const signals = run([
      page('/contact', {
        addresses: ['Sunrise Bakery\n12 Market Street\nChennai 600001\nPhone: +91 44 1234 5678'],
        iframes: ['https://www.google.com/maps/embed?pb=abc'],
      }),
    ]);
    const s = signal(signals, 'local-signals');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/contact']);
    expect(s.nap).toEqual([
      {
        urlPath: '/contact',
        name: 'Sunrise Bakery',
        address: '12 Market Street, Chennai 600001',
        phone: '+91 44 1234 5678',
      },
    ]);
    expect(s.detail).toContain('map embed on 1 page: /contact');
  });

  it("is 'not-found' without NAP, map or LocalBusiness schema", () => {
    const s = signal(
      run([page('/', { jsonLd: [{ types: ['Organization'], raw: '{"@type":"Organization"}' }] })]),
      'local-signals'
    );
    expect(s.status).toBe('not-found');
    expect(s.nap).toBeUndefined();
  });
});

describe('nap.ts', () => {
  it('takes the phone from the first tel: link when the address element has none', () => {
    const raw = rawPage('/c', {
      addresses: ['Sunrise Bakery\n12 Market Street, Chennai'],
      contactLinks: [{ kind: 'tel', href: 'tel:%2B91%2044%201234', text: 'Call', chunk: -1 }],
    });
    expect(napFromPage(raw, '/c')).toEqual([
      { urlPath: '/c', name: 'Sunrise Bakery', address: '12 Market Street, Chennai', phone: '+91 44 1234' },
    ]);
  });

  it('reads a labelled phone inside an address line and keeps a one-line address as the address', () => {
    expect(napFromAddressText('12 Market Street, Chennai. Ph: 98400 12345', '/x')).toEqual({
      urlPath: '/x',
      address: '12 Market Street, Chennai. Ph: 98400 12345',
      phone: '98400 12345',
    });
  });

  it('drops email lines and empty address elements', () => {
    expect(napFromAddressText('hello@bakery.example', '/x')).toBeNull();
    expect(napFromAddressText('   ', '/x')).toBeNull();
  });

  it('reads LocalBusiness in an @graph and skips blocks that do not parse or are not LocalBusiness', () => {
    const graph = JSON.stringify({
      '@graph': [
        { '@type': 'WebSite' },
        { '@type': ['Restaurant'], name: 'Dosa Corner', address: 'Anna Nagar, Chennai' },
      ],
    });
    expect(napFromJsonLd({ types: ['WebSite', 'Restaurant'], raw: graph }, '/')).toEqual([
      { urlPath: '/', name: 'Dosa Corner', address: 'Anna Nagar, Chennai' },
    ]);
    expect(napFromJsonLd({ types: ['LocalBusiness'], raw: '{"@type":"LocalBus' }, '/')).toEqual([]);
    expect(napFromJsonLd({ types: ['Organization'], raw: '{"@type":"Organization","address":"x"}' }, '/')).toEqual([]);
  });

  it('drops a duplicate NAP on the same page', () => {
    const raw = rawPage('/', { addresses: ['12 Market Street', '12 Market Street'] });
    expect(napFromPage(raw, '/')).toHaveLength(1);
  });

  it('firstTelPhone ignores non-tel links', () => {
    expect(
      firstTelPhone({ contactLinks: [], anchors: [{ href: '/tel:123', text: '', region: 'internal', chunk: -1 }] })
    ).toBeUndefined();
  });
});

describe('trust signals (Q-27)', () => {
  it('finds reviews or ratings from markup or text, testimonials and certifications, with their pages', () => {
    const signals = run([
      page('/', { jsonLd: [{ types: ['Product', 'AggregateRating'], raw: '{}' }] }),
      page('/about', { textChunks: text('What our customers say', '"Best cakes in town" - Priya') }),
      page('/quality', { textChunks: text('ISO 22000 food safety certification since 2015.') }),
      page('/reviews', { textChunks: text('Rated 4.8 out of 5 from 120 reviews') }),
      page('/plain', { textChunks: text('We bake bread every morning.') }),
    ]);
    const s = signal(signals, 'trust-signals');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/', '/about', '/quality', '/reviews']);
    expect(s.detail).toContain('reviews or ratings on 2 pages: /, /reviews');
    expect(s.detail).toContain('testimonials on 1 page: /about');
    expect(s.detail).toContain('certifications on 1 page: /quality');
  });

  it("is 'not-found' on plain text", () => {
    expect(signal(run([page('/', { textChunks: text('Fresh bread daily.') })]), 'trust-signals').status).toBe(
      'not-found'
    );
  });
});

describe('the other signals report the pages they were found on', () => {
  const pages = [
    page('/', {
      title: 'Sunrise Bakery',
      description: 'Fresh bread in Chennai',
      textChunks: text('Welcome'),
      headings: [{ level: 1, text: 'Sunrise Bakery', chunk: 0 }],
      jsonLd: [{ types: ['Organization', 'WebSite'], raw: '{}' }],
      socialMetaKeys: ['og:title', 'og:image'],
      scripts: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC', '/assets/app.js'],
      anchors: [
        { href: '/menu', text: 'Menu', region: 'menu', chunk: 0 },
        { href: 'https://instagram.com/bakery', text: 'Instagram', region: 'footer', chunk: 0 },
      ],
      ctaCandidates: [{ element: 'button', text: 'Order now', href: null, role: null, className: '', chunk: 0 }],
    }),
    page('/menu', {
      title: '',
      socialMetaKeys: ['twitter:card'],
      scripts: [
        'https://connect.facebook.net/en_US/fbevents.js',
        'https://www.clarity.ms/tag/xyz',
        'https://static.hotjar.com/c/hotjar-1.js',
      ],
      iframes: [],
    }),
    page('/blank'),
  ];
  const linking: InternalLinking = { inboundCounts: { '/': 0, '/menu': 1, '/blank': 0 }, unlinkedPages: ['/blank'] };
  const findings = [
    finding('AF-001', 'missing-title', '/menu'),
    finding('AF-002', 'broken-link', '/'),
    finding('AF-003', 'no-h1', '/menu'),
  ];
  const signals = run(pages, linking, findings);

  it('on-page SEO: pages with a title, description or H1, citing the content findings', () => {
    const s = signal(signals, 'on-page-seo');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/']);
    expect(s.findingIds).toEqual(['AF-001', 'AF-003']);
    expect(s.detail).toBe(
      'Found: title on 1 of 3 pages, meta description on 1, H1 on 1; 2 title, description or heading findings.'
    );
  });

  it('schema: JSON-LD types with pages', () => {
    const s = signal(signals, 'schema');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/']);
    expect(s.detail).toBe('Found: JSON-LD types Organization, WebSite on 1 page: /.');
  });

  it('internal linking: pages with internal links, and pages nothing links to', () => {
    const s = signal(signals, 'internal-linking');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/']);
    expect(s.detail).toContain('internal links on 1 of 3 pages');
    expect(s.detail).toContain('1 of 3 pages reached by a link from another read page');
    expect(s.detail).toContain('no other read page links to 1 page: /blank');
  });

  it('social tags: og: and twitter: pages', () => {
    const s = signal(signals, 'social-tags');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/', '/menu']);
    expect(s.detail).toBe('Found: Open Graph (og:) tags on 1 page: /; Twitter card (twitter:) tags on 1 page: /menu.');
  });

  it('analytics: known tag tools by host, with pages', () => {
    const s = signal(signals, 'analytics');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/', '/menu']);
    expect(s.detail).toBe('Found: Google Tag Manager, Meta Pixel, Microsoft Clarity, Hotjar on 2 pages: /, /menu.');
  });

  it('analytics: a look-alike host is not a tag tool', () => {
    const s = signal(
      run([
        page('/', { scripts: ['https://evilgoogletagmanager.com/gtm.js', 'https://clarity.ms.evil.example/x.js'] }),
      ]),
      'analytics'
    );
    expect(s.status).toBe('not-found');
  });

  it('CTAs: pages with calls to action', () => {
    const s = signal(signals, 'ctas');
    expect(s.status).toBe('found');
    expect(s.pages).toEqual(['/']);
    expect(s.detail).toContain('1 call to action');
  });
});

describe('auditMarketing', () => {
  it('returns readPages, no checks and the ten signals', () => {
    const signals = run([page('/')]);
    const marketing = auditMarketing(['/'], signals);
    expect(marketing.readPages).toEqual(['/']);
    expect(marketing.checks).toEqual([]);
    expect(marketing.signals).toEqual(signals);
    expect(marketing.signals).toHaveLength(10);
  });

  it('findingIds reference only ids present in the given findings', () => {
    const findings = [
      finding('AF-010', 'missing-description', '/'),
      finding('AF-011', 'duplicate-title', '/elsewhere'),
    ];
    const signals = run([page('/')], NO_LINKING, findings);
    const ids = new Set(findings.map((f) => f.id));
    const cited = signals.flatMap((s) => s.findingIds ?? []);
    expect(cited).toEqual(['AF-010']);
    for (const id of cited) expect(ids.has(id)).toBe(true);
  });
});

describe('wording (ADR 0018)', () => {
  it('no detail claims the site is good', () => {
    const rich = page('/', {
      title: 'T',
      textChunks: text('Testimonials', 'ISO 9001 certification', 'Rated 5 out of 5'),
      jsonLd: [
        {
          types: ['LocalBusiness'],
          raw: '{"@type":"LocalBusiness","name":"N","address":"A","telephone":"044 1234 567"}',
        },
      ],
      contactLinks: [{ kind: 'tel', href: 'tel:0441234567', text: 'Call', chunk: 0 }],
      forms: [form([['email', 'Email']])],
      scripts: ['https://www.googletagmanager.com/gtag/js?id=G-1'],
      socialMetaKeys: ['og:title'],
      iframes: ['https://maps.google.com/maps?q=x'],
      anchors: [{ href: '/a', text: 'A', region: 'internal', chunk: 0 }],
      ctaCandidates: [{ element: 'button', text: 'Go', href: null, role: null, className: '', chunk: 0 }],
    });
    const all = [...run([rich]), ...run([page('/')]), ...run([])];
    for (const s of all) expect(s.detail).not.toMatch(CLAIM);
    expect(run([rich]).every((s) => s.status === 'found')).toBe(true);
  });
});
