import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AuditFinding,
  AuditMarketing,
  AuditPage,
  PageContent,
  PageCoverage,
  PageHierarchy,
  TechnologyResult,
} from '@qa/types/src/browser.js';
import { FindingsList } from '../src/screens/audit/results/FindingsList';
import { HierarchyView } from '../src/screens/audit/results/HierarchyView';
import { PageContentView } from '../src/screens/audit/results/PageContentView';
import { PageFactsView } from '../src/screens/audit/results/PageFactsView';
import { SkippedPagesView } from '../src/screens/audit/results/SkippedPagesView';

type Signal = AuditMarketing['signals'][number];

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const hierarchy: PageHierarchy = {
  root: {
    urlPath: '/',
    title: 'Home',
    placedBy: 'start',
    children: [
      {
        urlPath: '/services',
        title: 'Services',
        placedBy: 'menu',
        children: [{ urlPath: '/services/repair', title: null, placedBy: 'breadcrumb', children: [] }],
      },
      { urlPath: '/contact', title: 'Contact us', placedBy: 'path', children: [] },
      // A repeated page in the data is listed once.
      { urlPath: '/services', title: 'Services', placedBy: 'path', children: [] },
    ],
  },
  links: [
    { from: '/', to: '/services', region: 'menu', text: 'Services' },
    { from: '/', to: '/contact', region: 'footer', text: 'Contact' },
    { from: '/services/repair', to: '/services', region: 'breadcrumb', text: 'Services' },
    { from: '/services', to: '/contact', region: 'internal', text: 'Talk to us' },
  ],
};

const TAMIL_HEADING = 'எங்கள் சேவைகள்';
const TAMIL_TEXT = 'தமிழ் உரை: வணக்கம்! நாங்கள் கணினி பழுது பார்க்கிறோம்.';
const INTRO = 'Welcome to the shop.\n';
const FOOTER = 'Opening hours 9 to 5.';

const tamilContent: PageContent = {
  urlPath: '/services',
  title: null,
  description: null,
  text: INTRO + TAMIL_TEXT + FOOTER,
  headings: [
    { level: 1, text: 'Services', sectionId: 's1' },
    { level: 2, text: TAMIL_HEADING, sectionId: 's2' },
  ],
  images: [
    { src: '/img/shop.jpg', alt: null },
    { src: '/img/line.png', alt: '' },
    { src: '/img/team.jpg', alt: 'Our team at work' },
  ],
  links: [
    { text: 'Home', to: '/', region: 'menu' },
    { text: 'Privacy', to: '/privacy', region: 'footer' },
    { text: 'Maps', to: 'https://maps.example.org/x', region: 'internal', leavesSite: true },
  ],
  forms: [
    {
      method: 'post',
      action: '/enquiry',
      fields: [
        { type: 'text', label: 'Your name', name: 'name', required: true },
        { type: 'tel', label: 'Phone number', name: 'phone' },
      ],
    },
  ],
  ctas: [
    { text: 'Book a repair', kind: 'link', to: '/book' },
    { text: 'Call now', kind: 'button' },
  ],
  language: { primary: 'ta', others: ['en'], declared: 'en-US' },
  sections: [
    { id: 's1', kind: 'header', start: 0, end: INTRO.length },
    { id: 's2', kind: 'main', heading: TAMIL_HEADING, start: INTRO.length, end: INTRO.length + TAMIL_TEXT.length },
    {
      id: 's3',
      kind: 'footer',
      start: INTRO.length + TAMIL_TEXT.length,
      end: INTRO.length + TAMIL_TEXT.length + FOOTER.length,
    },
  ],
};

const unidentifiedContent: PageContent = {
  ...tamilContent,
  urlPath: '/blank',
  language: { primary: 'not-identified', others: [], declared: null },
  headings: [],
  images: [],
  links: [],
  forms: [],
  ctas: [],
};

const SIGNAL_KEYS: Array<[Signal['key'], string]> = [
  ['on-page-seo', 'On-page SEO'],
  ['schema', 'Schema (structured data)'],
  ['internal-linking', 'Internal linking'],
  ['social-tags', 'Social tags'],
  ['analytics', 'Analytics and tags'],
  ['ctas', 'Calls to action'],
  ['lead-forms', 'Lead forms'],
  ['click-to-call', 'Click-to-call'],
  ['trust-signals', 'Trust signals'],
  ['local-signals', 'Local signals (NAP and map)'],
];

const signals: Signal[] = SIGNAL_KEYS.map(([key, label], i) => ({
  key,
  label,
  status: i % 3 === 0 ? 'found' : i % 3 === 1 ? 'not-found' : 'not-checked',
  pages: i % 3 === 0 ? ['/', '/contact'] : [],
  detail: `Detail for ${label}.`,
  ...(key === 'local-signals'
    ? {
        nap: [
          { urlPath: '/contact', name: 'Kumar Repairs', address: '12 Anna Salai, Chennai', phone: '+91 44 1234 5678' },
        ],
      }
    : {}),
}));

const samplePage: AuditPage = {
  urlPath: '/',
  title: 'Home',
  depth: 0,
  coverage: 'sample',
  language: { primary: 'ta', others: ['en'], declared: 'ta-IN' },
  sections: [{ id: 's1', kind: 'main' }],
  seo: {
    hasTitle: true,
    hasDescription: false,
    h1Count: 2,
    skippedHeadingLevel: true,
    imagesWithoutAlt: 3,
    htmlLang: 'ta-IN',
    findingIds: [],
  },
  accessibility: {
    standard: 'WCAG 2.2',
    level: 'AA',
    method: 'automatic checks only',
    violations: 7,
    findingIds: [],
  },
};

const coveredPage: AuditPage = {
  ...samplePage,
  urlPath: '/about',
  coverage: 'covered',
  sampleUrlPath: '/',
  language: { primary: 'not-identified', others: [], declared: null },
  accessibility: undefined,
  seo: { ...samplePage.seo, htmlLang: null },
};

const identified: TechnologyResult = {
  status: 'identified',
  technologies: [{ name: 'WordPress', kind: 'cms', evidence: ['meta generator'] }],
};

function finding(partial: Partial<AuditFinding> & Pick<AuditFinding, 'id' | 'title'>): AuditFinding {
  return {
    rule: 'missing-alt',
    group: 'content',
    area: 'content',
    detail: 'Seen on the page.',
    suggestion: 'Add alt text.',
    impact: 'medium',
    effort: 'low',
    urlPath: '/',
    sectionId: null,
    source: 'rule',
    ...partial,
  };
}

const findings: AuditFinding[] = [
  finding({
    id: 'AF-001',
    title: 'Two pages share a title',
    rule: 'duplicate-title',
    impact: 'high',
    effort: 'low',
    urlPath: '/services',
    pages: ['/services', '/services/repair'],
  }),
  finding({ id: 'AF-002', title: 'Image has no alt text', sectionId: 's2', impact: 'medium', effort: 'medium' }),
  finding({
    id: 'AF-003',
    title: 'The offer is hard to find',
    source: 'ai',
    advisory: true,
    impact: 'low',
    effort: 'high',
    sectionId: 's1',
  }),
];

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element);
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

function allViews(): Record<string, string> {
  return {
    hierarchy: render(createElement(HierarchyView, { hierarchy })),
    content: render(createElement(PageContentView, { content: tamilContent })),
    contentUnidentified: render(createElement(PageContentView, { content: unidentifiedContent })),
    facts: render(createElement(PageFactsView, { page: samplePage, technology: identified, signals })),
    factsCovered: render(
      createElement(PageFactsView, { page: coveredPage, technology: { status: 'not-identified' }, signals })
    ),
    findings: render(createElement(FindingsList, { findings })),
    findingsEmpty: render(createElement(FindingsList, { findings: [] })),
    skipped: render(
      createElement(SkippedPagesView, {
        coverage: { found: 2, reached: 1, skipped: [{ urlPath: '/a', why: 'payment' }] },
      })
    ),
  };
}

/** Avoid words of CONTEXT.md for Website Audit, Page Content, Section and the Improvement Roadmap. */
const AVOID_WORDS =
  /\b(scan\w*|scrap\w*|page data|page dump|blocks?|components?|regions?|plans?|teardown|site review)\b/i;
/** Claims ADR 0018 and ADR 0033 rule out. */
const BANNED_CLAIMS = /\b(accessible|compliant|compliance|secure|verdict|ready to release)\b/i;

// ---------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------

describe('HierarchyView', () => {
  const html = render(createElement(HierarchyView, { hierarchy }));
  const text = textOf(html);

  it('lists every page exactly once as a nested list with its title or path and how it was placed', () => {
    for (const path of ['/services/repair', '/contact']) {
      expect(text.split(path).length - 1, path).toBeGreaterThanOrEqual(1);
    }
    const tree = html.slice(html.indexOf('<ul aria-label="Page hierarchy">'), html.indexOf('<h3'));
    const items = tree.match(/<li/g) ?? [];
    expect(items).toHaveLength(4);
    expect(textOf(tree).match(/Services/g)).toHaveLength(1);
    expect(tree).toMatch(/<li[^>]*>.*Services.*<ul[^>]*>.*\/services\/repair/);
    expect(textOf(tree)).toContain('Home');
    expect(textOf(tree)).toContain('Start page');
    expect(textOf(tree)).toContain('Placed by the menu');
    expect(textOf(tree)).toContain('Placed by breadcrumbs');
    expect(textOf(tree)).toContain('Placed by its address');
    // A page without a title is listed by its path and says so.
    expect(textOf(tree)).toContain('/services/repair (No title)');
  });

  it('shows the navigation map grouped by where each link sits, with page and target', () => {
    for (const label of ['Menu', 'Footer', 'Breadcrumb', 'Internal link']) {
      expect(html).toContain(`<h4 class="font-bold">${label}</h4>`);
    }
    expect(text).toMatch(/On page Link text Goes to/);
    // The group's heading says where the links sit; no column repeats it on every row.
    expect(text).not.toContain('Where it sits');
    const group = (label: string) => {
      const start = html.indexOf(`<h4 class="font-bold">${label}</h4>`);
      return textOf(html.slice(start, html.indexOf('</table>', start)));
    };
    expect(group('Menu')).toContain('/ Services /services');
    expect(group('Footer')).toContain('/ Contact /contact');
    expect(group('Breadcrumb')).toContain('/services/repair Services /services');
    expect(group('Internal link')).toContain('/services Talk to us /contact');
  });

  it('says so when there are no links', () => {
    const empty = render(createElement(HierarchyView, { hierarchy: { root: hierarchy.root, links: [] } }));
    expect(textOf(empty)).toContain('No internal links were found.');
  });
});

describe('PageContentView', () => {
  const html = render(createElement(PageContentView, { content: tamilContent }));
  const text = textOf(html);

  it('renders the Sections in page order with their heading or kind and their own text', () => {
    const s1 = html.indexOf('Section s1');
    const s2 = html.indexOf('Section s2');
    const s3 = html.indexOf('Section s3');
    expect(s1).toBeGreaterThan(-1);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
    expect(html).toMatch(/<h4 class="font-bold">Header<\/h4>/);
    expect(html).toMatch(/<h4 class="font-bold">Footer<\/h4>/);
    // Each Section shows only its own text.
    const second = html.slice(s2, s3);
    expect(second).toContain(TAMIL_TEXT);
    expect(second).not.toContain('Welcome to the shop');
    expect(second).not.toContain('Opening hours');
    expect(html.slice(s3)).toContain(FOOTER);
  });

  it('keeps Tamil text character for character with lang="ta" on its element', () => {
    expect(html).toContain(`<p class="mt-1 whitespace-pre-wrap text-sm text-ink" lang="ta">${TAMIL_TEXT}</p>`);
    expect(html).toContain(`<h4 class="font-bold" lang="ta">${TAMIL_HEADING}</h4>`);
    expect(html).toContain(`<td lang="ta">${TAMIL_HEADING}</td>`);
    // English text carries no Tamil lang.
    expect(html).not.toMatch(/lang="ta">Welcome/);
  });

  it('shows headings with levels, images with alt text, missing or decorative', () => {
    expect(text).toContain('H1 Services');
    expect(text).toContain(`H2 ${TAMIL_HEADING}`);
    expect(text).toContain('/img/shop.jpg Alt text missing');
    expect(text).toContain('/img/line.png Empty alt (decorative image)');
    expect(text).toContain('/img/team.jpg Our team at work');
  });

  it('shows links with where they sit, forms as read and never sent, and calls to action', () => {
    expect(text).toContain('Home / Menu');
    expect(text).toContain('Privacy /privacy Footer');
    expect(text).toContain('Maps https://maps.example.org/x Leaves the site Internal link');
    expect(text).toContain('Forms are read and never sent');
    expect(text).toContain('Method POST · would send to /enquiry');
    expect(text).toContain('Your name text name Yes');
    expect(text).toContain('Phone number tel phone No');
    expect(text).toContain('Book a repair Button-styled link /book');
    expect(text).toContain('Call now Button No target');
  });

  it('states missing values and the language as detected, others and as written', () => {
    expect(text).toContain('Title No title');
    expect(text).toContain('Description No description');
    expect(text).toContain('Language Tamil');
    expect(text).toContain('Other languages English');
    expect(text).toContain('lang attribute en-US');
    const unknown = textOf(render(createElement(PageContentView, { content: unidentifiedContent })));
    expect(unknown).toContain('Language Not identified');
    expect(unknown).toContain('Other languages None');
    expect(unknown).toContain('lang attribute Not set');
    expect(unknown).toContain('No images were found.');
    expect(unknown).toContain('No forms were found.');
  });
});

describe('PageFactsView', () => {
  const html = render(createElement(PageFactsView, { page: samplePage, technology: identified, signals }));
  const text = textOf(html);

  it('shows SEO basics as facts', () => {
    expect(text).toContain('Title Found');
    expect(text).toContain('Description Not found');
    expect(text).toContain('H1 headings 2');
    expect(text).toContain('Heading levels A level is skipped');
    expect(text).toContain('Images without alt text 3');
    expect(text).toContain('lang attribute ta-IN');
  });

  it('names the standard for accessibility basics with the violation count', () => {
    expect(text).toContain('Standard WCAG 2.2 level AA, automatic checks only');
    expect(text).toContain('Violations found 7');
    const covered = textOf(
      render(createElement(PageFactsView, { page: coveredPage, technology: identified, signals }))
    );
    expect(covered).toContain('Not checked on this page');
    expect(covered).toContain('Sample Page /');
  });

  it('shows the language, the technology, or Not identified', () => {
    expect(text).toContain('Detected language Tamil');
    expect(text).toContain('Other languages English');
    expect(text).toContain('WordPress · Website builder or CMS · shown by meta generator');
    const none = textOf(
      render(createElement(PageFactsView, { page: coveredPage, technology: { status: 'not-identified' }, signals }))
    );
    expect(none).toMatch(/Technology \(whole site\) Not identified/);
    expect(none).toContain('Detected language Not identified');
    expect(none).toContain('lang attribute Not set');
  });

  it('shows all ten marketing signals with found, not found or not checked, pages and NAP', () => {
    const rows = html.match(/<th scope="row"/g) ?? [];
    expect(rows).toHaveLength(10);
    for (const [, label] of SIGNAL_KEYS) expect(text).toContain(label);
    expect(text).toContain('On-page SEO Found /, /contact');
    expect(text).toContain('Schema (structured data) Not found None');
    expect(text).toContain('Internal linking Not checked None');
    expect(text).toContain(
      'Name: Kumar Repairs · Address: 12 Anna Salai, Chennai · Phone: +91 44 1234 5678 (on /contact)'
    );
  });
});

describe('FindingsList', () => {
  const html = render(createElement(FindingsList, { findings }));
  const text = textOf(html);

  it('keeps the given order', () => {
    const order = [...html.matchAll(/data-finding-id="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['AF-001', 'AF-002', 'AF-003']);
    const reversed = render(createElement(FindingsList, { findings: [...findings].reverse() }));
    expect([...reversed.matchAll(/data-finding-id="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'AF-003',
      'AF-002',
      'AF-001',
    ]);
  });

  it('shows title, page, Section or Whole page, every page of a cross-page finding, impact, effort and source', () => {
    expect(text).toContain('Two pages share a title');
    expect(text).toContain('Page /services Section Whole page All pages /services /services/repair');
    expect(text).toContain('Impact: High Effort: Low');
    expect(text).toContain('Source Fixed rule over Page Content');
    expect(text).toContain('Section Section s2');
    expect(text).toContain('Impact: Medium Effort: Medium');
    expect(text).toContain('Impact: Low Effort: High');
    expect(text).toContain('Source AI');
  });

  it('leads each card with title and chips, and keeps Page, Section and Source in a collapsed details', () => {
    const first = html.slice(html.indexOf('data-finding-id="AF-001"'), html.indexOf('data-finding-id="AF-002"'));
    expect(first).toMatch(/<h3[^>]*>[^<]*<\/h3><p[^>]*><span[^>]*>Impact: High/);
    expect(first).toMatch(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*Page[\s\S]*Section[\s\S]*Source[\s\S]*<\/details>/);
    expect(html).not.toContain('text-accent');
    expect(html).toContain('bg-stamp-tint text-stamp');
  });

  it('labels AI findings advisory and only them', () => {
    expect(text.match(/Advisory/g)).toHaveLength(1);
    const third = html.slice(html.indexOf('data-finding-id="AF-003"'));
    expect(third).toContain('Advisory');
  });

  it('shows a lazy screenshot with alt text when the finding has one and an audit id is given', () => {
    const shot = [finding({ id: 'AF-009', title: 'Banner is cut off', screenshotPath: 'shots/home.png' })];
    const withId = render(createElement(FindingsList, { findings: shot, auditId: 'abcd1234', version: 2 }));
    const img = withId.match(/<img\b[^>]*>/)?.[0] ?? '';
    expect(img).toContain('loading="lazy"');
    expect(img).toMatch(/alt="[^"]+"/);
    expect(img).toContain('src="/api/audits/abcd1234/file?path=shots%2Fhome.png&amp;version=2"');
    expect(render(createElement(FindingsList, { findings: shot }))).not.toContain('<img');
    expect(render(createElement(FindingsList, { findings, auditId: 'abcd1234' }))).not.toContain('<img');
  });

  it('says so when there are no findings', () => {
    expect(textOf(render(createElement(FindingsList, { findings: [] })))).toContain('No findings were recorded.');
  });
});

describe('SkippedPagesView (T-88, ADR 0018)', () => {
  const coverage: PageCoverage = {
    found: 10,
    reached: 5,
    skipped: [
      { urlPath: '/error-500', why: 'http-error' },
      { urlPath: '/slow-page', why: 'timeout' },
      { urlPath: '/checkout', why: 'payment' },
      { urlPath: '/admin', why: 'sign-in' },
      { urlPath: '/secret', why: 'robots' },
    ],
  };

  const sampleFindings: AuditFinding[] = [
    {
      id: 'AF-ERR-500',
      rule: 'http-error',
      group: 'content',
      area: 'content',
      title: 'Server answered with 500 error',
      detail: 'The page returned HTTP 500.',
      suggestion: 'Fix server error.',
      impact: 'high',
      effort: 'medium',
      urlPath: '/error-500',
      sectionId: null,
      source: 'checker',
    },
    {
      id: 'AF-TIMEOUT',
      rule: 'timeout',
      group: 'content',
      area: 'speed',
      title: 'Page took over 30s to load',
      detail: 'The page timed out.',
      suggestion: 'Improve page loading speed.',
      impact: 'high',
      effort: 'medium',
      urlPath: '/slow-page',
      sectionId: null,
      source: 'checker',
    },
  ];

  it('groups skipped pages by reason with group headings', () => {
    const html = render(createElement(SkippedPagesView, { coverage, findings: sampleFindings }));
    expect(html).toContain('data-skip-group="http-error"');
    expect(html).toContain('data-skip-group="timeout"');
    expect(html).toContain('data-skip-group="payment"');
    expect(html).toContain('data-skip-group="sign-in"');
    expect(html).toContain('data-skip-group="robots"');

    expect(html).toContain('Website error (HTTP status) (1)');
    expect(html).toContain('Timed out loading (1)');
    expect(html).toContain('Payment page (1)');
    expect(html).toContain('Sign-in required (1)');
    expect(html).toContain('Excluded by robots.txt (1)');
  });

  it('links site-caused skipped pages to their finding', () => {
    const html = render(createElement(SkippedPagesView, { coverage, findings: sampleFindings }));
    expect(html).toContain('href="#AF-ERR-500"');
    expect(html).toContain('Finding: Server answered with 500 error');
    expect(html).toContain('href="#AF-TIMEOUT"');
    expect(html).toContain('Finding: Page took over 30s to load');

    const paymentGroup = html.slice(
      html.indexOf('data-skip-group="payment"'),
      html.indexOf('data-skip-group="sign-in"')
    );
    expect(paymentGroup).not.toContain('href="#');
    expect(paymentGroup).not.toContain('Finding:');
  });

  it('shows empty message when no pages are skipped', () => {
    const emptyCoverage: PageCoverage = { found: 5, reached: 5, skipped: [] };
    const html = render(createElement(SkippedPagesView, { coverage: emptyCoverage, findings: [] }));
    expect(html).toContain('No pages were skipped.');
    expect(html).not.toContain('data-skip-group');
  });

  it('conforms to ADR 0018 wording (no claim words)', () => {
    const html = render(createElement(SkippedPagesView, { coverage, findings: sampleFindings }));
    const CLAIM_WORDS = /\b(compliant|compliance|certified|secure|safe|hack-proof|passes WCAG|fully accessible)\b/i;
    expect(html).not.toMatch(CLAIM_WORDS);
  });
});

describe('wording and markup of every view', () => {
  const views = allViews();

  it('uses no Avoid words of CONTEXT.md', () => {
    for (const [name, html] of Object.entries(views)) {
      expect(html, name).not.toMatch(AVOID_WORDS);
    }
  });

  it('never calls a page or the site accessible, compliant or secure, and shows no release verdict', () => {
    for (const [name, html] of Object.entries(views)) {
      expect(html, name).not.toMatch(BANNED_CLAIMS);
    }
  });

  it('uses the CONTEXT.md terms', () => {
    const all = Object.values(views).map(textOf).join(' ');
    for (const term of ['Page Content', 'Section', 'Sample Page', 'Website Audit']) {
      expect(all).toContain(term);
    }
  });

  it('has headings in order, lists for trees and header cells in every table', () => {
    for (const [name, html] of Object.entries(views)) {
      const levels = [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
      expect(levels[0], name).toBe(2);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i] - levels[i - 1], `${name} heading ${i}`).toBeLessThanOrEqual(1);
      }
      const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
      for (const table of tables) {
        expect(table, name).toMatch(/<thead><tr><th scope="col">/);
      }
    }
    expect(views.hierarchy).toMatch(/<ul aria-label="Page hierarchy"><li[^>]*>[\s\S]*<ul[^>]*><li/);
    expect(views.content).toMatch(/<ol[^>]*><li/);
    expect(views.findings).toMatch(/<ol[^>]*><li/);
  });

  it('imports @qa/types only through @qa/types/src/browser.js', () => {
    for (const file of [
      'HierarchyView.tsx',
      'PageContentView.tsx',
      'PageFactsView.tsx',
      'FindingsList.tsx',
      'SkippedPagesView.tsx',
      'analysis-text.ts',
    ]) {
      const source = readFileSync(new URL(`../src/screens/audit/results/${file}`, import.meta.url), 'utf8');
      const specifiers = [...source.matchAll(/from '(@qa\/types[^']*)'/g)].map((m) => m[1]);
      expect(specifiers.length, file).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(specifier, file).toBe('@qa/types/src/browser.js');
    }
  });
});
