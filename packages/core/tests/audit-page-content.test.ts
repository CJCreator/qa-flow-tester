import { describe, it, expect } from 'vitest';
import { sectionText, type SectionKind } from '@qa/types';
import { buildPageContent, DATA_SRC_MAX } from '../src/audit/analysis/page-content.js';
import { createFindingIdAllocator, formatFindingId } from '../src/audit/analysis/finding-ids.js';
import { detectPageLanguage } from '../src/audit/analysis/language.js';
import type { RawPage, RawSectionKind } from '../src/audit/analysis/raw-page.js';

const ORIGIN = 'https://bakery.example';
const OPTIONS = { origin: ORIGIN, maxTextChars: 100_000 };

function rawPage(overrides: Partial<RawPage> = {}): RawPage {
  return {
    url: `${ORIGIN}/`,
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

/** A home page: header menu, main split at two top-level headings, footer. */
function homePage(): RawPage {
  return rawPage({
    url: `${ORIGIN}/?utm_source=x`,
    title: 'Sweet Crumbs Bakery',
    description: 'Fresh bread in Chennai',
    lang: 'en',
    textChunks: [
      { text: 'Home Shop Contact', boundary: { kind: 'header' } }, // 0
      { text: 'Fresh bread every morning', boundary: { kind: 'heading', heading: 'Fresh bread every morning' } }, // 1
      { text: 'Our ovens start at four in the morning so your loaf is still warm at breakfast.' }, // 2
      { text: 'Order online' }, // 3
      { text: 'Enquiries', boundary: { kind: 'heading', heading: 'Enquiries' } }, // 4
      { text: 'Send us a message.' }, // 5
      { text: '© Sweet Crumbs', boundary: { kind: 'footer' } }, // 6
    ],
    headings: [
      { level: 1, text: 'Fresh bread every morning', chunk: 1 },
      { level: 2, text: 'Enquiries', chunk: 4 },
    ],
    images: [
      { src: '/img/loaf.jpg', alt: 'A sourdough loaf', chunk: 2 },
      { src: '/img/divider.png', alt: '', chunk: 2 },
      { src: '/img/oven.jpg', alt: null, chunk: 5 },
    ],
    anchors: [
      { href: '/', text: 'Home', region: 'menu', chunk: 0 },
      { href: '/shop?session=abc123&page=2#top', text: ' Shop ', region: 'menu', chunk: 0 },
      { href: 'https://maps.example.org/place?id=9&token=zzz', text: 'Map', region: 'internal', chunk: 5 },
      { href: 'tel:+914400000000', text: 'Call', region: 'internal', chunk: 3 },
      { href: 'mailto:hello@bakery.example', text: 'Mail', region: 'footer', chunk: 6 },
      { href: 'javascript:void(0)', text: 'Menu', region: 'menu', chunk: 0 },
      { href: '#main', text: 'Skip', region: 'internal', chunk: 0 },
      { href: 'https://bakery.example/about', text: 'About', region: 'footer', chunk: 6 },
    ],
    contactLinks: [{ kind: 'tel', href: 'tel:+914400000000', text: 'Call', chunk: 3 }],
    forms: [
      {
        method: 'post',
        action: '/enquiry',
        chunk: 5,
        fields: [
          { type: 'text', label: 'Name', name: 'name', required: true },
          { type: 'tel', label: 'Phone', name: 'phone', required: false },
          { type: 'email', label: 'Email', name: 'email', required: true },
          { type: 'textarea', label: 'Message', name: null, required: false },
        ],
      },
    ],
    ctaCandidates: [
      { element: 'a', text: 'Order online', href: '/shop', role: null, className: 'wp-block-button__link', chunk: 3 },
      { element: 'a', text: 'Call to order', href: 'tel:+914400000000', role: 'button', className: '', chunk: 3 },
      { element: 'a', text: 'Read more', href: '/blog', role: null, className: 'more-link', chunk: 2 },
      { element: 'button', text: 'Send', href: null, role: null, className: '', chunk: 5 },
      {
        element: 'a',
        text: 'Book',
        href: 'https://booking.example.com/b',
        role: null,
        className: 'Btn-primary',
        chunk: 5,
      },
      { element: 'button', text: '   ', href: null, role: null, className: '', chunk: 5 },
    ],
  });
}

describe('buildPageContent', () => {
  it('REQ-009 AC-1: returns text, headings with levels, images, links, forms, title, description and CTAs', () => {
    const content = buildPageContent(homePage(), OPTIONS);
    expect(content.urlPath).toBe('/?utm_source=x');
    expect(content.title).toBe('Sweet Crumbs Bakery');
    expect(content.description).toBe('Fresh bread in Chennai');
    expect(content.text).toBe(
      [
        'Home Shop Contact',
        'Fresh bread every morning',
        'Our ovens start at four in the morning so your loaf is still warm at breakfast.',
        'Order online',
        'Enquiries',
        'Send us a message.',
        '© Sweet Crumbs',
      ].join('\n')
    );
    expect(content.textTruncated).toBeUndefined();
    expect(content.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Fresh bread every morning'],
      [2, 'Enquiries'],
    ]);
    expect(content.images.map((i) => i.alt)).toEqual(['A sourdough loaf', '', null]);
    expect(content.links.map((l) => l.text)).toEqual(['Home', 'Shop', 'Map', 'About']);
    expect(content.forms).toEqual([
      {
        method: 'POST',
        action: '/enquiry',
        sectionId: 's3',
        fields: [
          { type: 'text', label: 'Name', name: 'name', required: true },
          { type: 'tel', label: 'Phone', name: 'phone', required: false },
          { type: 'email', label: 'Email', name: 'email', required: true },
          { type: 'textarea', label: 'Message', required: false },
        ],
      },
    ]);
    for (const field of content.forms[0].fields) expect(field).not.toHaveProperty('value');
    expect(content.ctas).toEqual([
      { text: 'Order online', kind: 'link', to: '/shop', sectionId: 's2' },
      { text: 'Call to order', kind: 'link', to: 'tel:+914400000000', sectionId: 's2' },
      { text: 'Send', kind: 'button', sectionId: 's3' },
      { text: 'Book', kind: 'link', to: 'https://booking.example.com/b', sectionId: 's3' },
    ]);
  });

  it('REQ-009 AC-2: a missing alt is null, an empty alt stays the empty string', () => {
    const content = buildPageContent(homePage(), OPTIONS);
    expect(content.images[1].alt).toBe('');
    expect(content.images[2].alt).toBeNull();
    expect(content.images[1].alt).not.toBe(content.images[2].alt);
  });

  it('title null when there is no title element, empty string when empty; description null when missing', () => {
    expect(buildPageContent(rawPage({ title: null }), OPTIONS).title).toBeNull();
    expect(buildPageContent(rawPage({ title: '' }), OPTIONS).title).toBe('');
    expect(buildPageContent(rawPage({ description: null }), OPTIONS).description).toBeNull();
    expect(buildPageContent(rawPage({ description: '' }), OPTIONS).description).toBe('');
  });

  it('REQ-008 AC-1: Sections in page order, ids s1..sN, kind, heading and own text', () => {
    const content = buildPageContent(homePage(), OPTIONS);
    expect(content.sections.map((s) => [s.id, s.kind, s.heading])).toEqual([
      ['s1', 'header', undefined],
      ['s2', 'heading', 'Fresh bread every morning'],
      ['s3', 'heading', 'Enquiries'],
      ['s4', 'footer', undefined],
    ]);
    expect(content.sections[0]).not.toHaveProperty('heading');
    expect(content.sections.map((s) => sectionText(content, s))).toEqual([
      'Home Shop Contact\n',
      'Fresh bread every morning\nOur ovens start at four in the morning so your loaf is still warm at breakfast.\nOrder online\n',
      'Enquiries\nSend us a message.\n',
      '© Sweet Crumbs',
    ]);
  });

  it("a page with neither landmarks nor top-level headings is one Section of kind 'page'", () => {
    const content = buildPageContent(rawPage({ textChunks: [{ text: 'Just text' }, { text: 'More' }] }), OPTIONS);
    expect(content.sections).toEqual([{ id: 's1', kind: 'page', start: 0, end: content.text.length }]);
    const empty = buildPageContent(rawPage(), OPTIONS);
    expect(empty.text).toBe('');
    expect(empty.sections).toEqual([{ id: 's1', kind: 'page', start: 0, end: 0 }]);
  });

  it('text before the first landmark joins the first Section; text outside a landmark joins the one before it', () => {
    const content = buildPageContent(
      rawPage({
        textChunks: [
          { text: 'Loose top' },
          { text: 'Main text', boundary: { kind: 'main' } },
          { text: 'Loose after main' },
          { text: 'Foot', boundary: { kind: 'footer' } },
        ],
        images: [{ src: '/a.png', alt: 'a', chunk: -1 }],
        headings: [{ level: 3, text: 'Loose after main', chunk: 2 }],
      }),
      OPTIONS
    );
    expect(content.sections.map((s) => sectionText(content, s))).toEqual([
      'Loose top\nMain text\nLoose after main\n',
      'Foot',
    ]);
    expect(content.images[0].sectionId).toBe('s1');
    expect(content.headings[0].sectionId).toBe('s1');
  });

  it('every heading, image, link, form and CTA carries the sectionId of its Section', () => {
    const content = buildPageContent(homePage(), OPTIONS);
    expect(content.headings.map((h) => h.sectionId)).toEqual(['s2', 's3']);
    expect(content.images.map((i) => i.sectionId)).toEqual(['s2', 's2', 's3']);
    expect(content.links.map((l) => l.sectionId)).toEqual(['s1', 's1', 's3', 's4']);
    expect(content.forms.map((f) => f.sectionId)).toEqual(['s3']);
    expect(content.ctas.every((c) => typeof c.sectionId === 'string')).toBe(true);
  });

  it('an element at the top of a landmark with no text yet lands in that landmark', () => {
    const content = buildPageContent(
      rawPage({
        textChunks: [
          { text: 'Main text', boundary: { kind: 'main' } },
          { text: '', boundary: { kind: 'footer' } },
          { text: 'Footer text' },
        ],
        images: [{ src: '/logo.png', alt: 'Logo', chunk: 1 }],
        anchors: [{ href: '/privacy', text: 'Privacy', region: 'footer', chunk: 99 }],
      }),
      OPTIONS
    );
    expect(content.images[0].sectionId).toBe('s2');
    expect(content.links[0].sectionId).toBe('s2');
    expect(content.sections.map((s) => sectionText(content, s))).toEqual(['Main text', '\nFooter text']);
  });

  it('same-host links are redacted site paths; other hosts keep the full address and leave the site', () => {
    const content = buildPageContent(homePage(), OPTIONS);
    expect(content.links).toEqual([
      { text: 'Home', to: '/', region: 'menu', sectionId: 's1' },
      { text: 'Shop', to: '/shop?session=***&page=2', region: 'menu', sectionId: 's1' },
      {
        text: 'Map',
        to: 'https://maps.example.org/place?id=9&token=***',
        region: 'internal',
        leavesSite: true,
        sectionId: 's3',
      },
      { text: 'About', to: '/about', region: 'footer', sectionId: 's4' },
    ]);
    const tos = content.links.map((l) => l.to).join(' ');
    expect(tos).not.toContain('abc123');
    expect(tos).not.toContain('zzz');
  });

  it('tel:, mailto:, javascript:, fragment-only and empty links are not ContentLinks', () => {
    const content = buildPageContent(
      rawPage({
        url: `${ORIGIN}/blog/post`,
        anchors: [
          { href: 'tel:123', text: 't', region: 'internal', chunk: 0 },
          { href: 'MAILTO:a@b.c', text: 'm', region: 'internal', chunk: 0 },
          { href: 'JavaScript:alert(1)', text: 'j', region: 'internal', chunk: 0 },
          { href: '#comments', text: 'f', region: 'internal', chunk: 0 },
          { href: '', text: 'e', region: 'internal', chunk: 0 },
          { href: 'next', text: 'relative', region: 'internal', chunk: 0 },
        ],
      }),
      OPTIONS
    );
    expect(content.links.map((l) => [l.text, l.to])).toEqual([['relative', '/blog/next']]);
  });

  it('Q-33: CTAs are buttons and button-styled links only', () => {
    const content = buildPageContent(homePage(), OPTIONS);
    expect(content.ctas.map((c) => c.text)).not.toContain('Read more');
    expect(content.ctas.filter((c) => c.kind === 'button').every((c) => c.to === undefined)).toBe(true);
  });

  it('text longer than maxTextChars is cut at the limit and textTruncated is set; Sections stay within it', () => {
    const content = buildPageContent(homePage(), { origin: ORIGIN, maxTextChars: 30 });
    expect(content.text).toBe('Home Shop Contact\nFresh bread ');
    expect(content.text.length).toBe(30);
    expect(content.textTruncated).toBe(true);
    expect(content.sections[0].start).toBe(0);
    expect(content.sections.at(-1)!.end).toBe(30);
    for (const s of content.sections) expect(s.end).toBeLessThanOrEqual(30);
    // Elements past the cut still name a listed Section.
    const ids = new Set(content.sections.map((s) => s.id));
    expect(content.forms.every((f) => ids.has(f.sectionId!))).toBe(true);
  });

  it('cutting never splits a surrogate pair', () => {
    const content = buildPageContent(rawPage({ textChunks: [{ text: 'ab😀cd' }] }), {
      origin: ORIGIN,
      maxTextChars: 3,
    });
    expect(content.text).toBe('ab');
    expect(content.textTruncated).toBe(true);
  });

  it('Tamil text round-trips character for character and language comes from detectPageLanguage', () => {
    const tamil = 'தமிழ்நாட்டின் சிறந்த உணவகம் எங்கள் சுவையான உணவுகளை இன்றே முயற்சி செய்யுங்கள்';
    const raw = rawPage({ lang: 'ta-IN', textChunks: [{ text: tamil, boundary: { kind: 'main' } }] });
    const content = buildPageContent(raw, OPTIONS);
    expect(content.text).toBe(tamil);
    expect([...content.text]).toEqual([...tamil]);
    expect(sectionText(content, content.sections[0])).toBe(tamil);
    expect(content.language).toEqual(detectPageLanguage(tamil, 'ta-IN'));
    expect(content.language.primary).toBe('ta');
    expect(content.language.declared).toBe('ta-IN');
    expect(buildPageContent(homePage(), OPTIONS).language.primary).toBe('en');
  });

  it('a long data: image address is shortened; heading levels stay within 1-6', () => {
    const data = `data:image/png;base64,${'A'.repeat(500)}`;
    const content = buildPageContent(
      rawPage({
        images: [{ src: data, alt: null, chunk: 0 }],
        headings: [
          { level: 0, text: 'x', chunk: 0 },
          { level: 9, text: 'y', chunk: 0 },
        ],
      }),
      OPTIONS
    );
    expect(content.images[0].src.length).toBe(DATA_SRC_MAX + 1);
    expect(content.headings.map((h) => h.level)).toEqual([1, 6]);
  });

  it('a form without method is GET and without action has no action', () => {
    const content = buildPageContent(
      rawPage({ forms: [{ method: null, action: null, fields: [], chunk: 0 }] }),
      OPTIONS
    );
    expect(content.forms[0]).toEqual({ method: 'GET', fields: [], sectionId: 's1' });
  });

  it('REQ-008 AC-2 (property): Sections are contiguous, start at 0, end at text.length, never overlap', () => {
    let seed = 0x2545f491;
    const rand = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const kinds: RawSectionKind[] = ['header', 'nav', 'main', 'aside', 'footer', 'region', 'heading'];
    const words = ['', ' ', 'a', 'Bread', 'தமிழ்', '😀', 'line\nbreak', 'x'.repeat(40)];

    for (let run = 0; run < 400; run++) {
      const chunkCount = rand(12);
      const textChunks = Array.from({ length: chunkCount }, () => {
        const text = Array.from({ length: rand(4) }, () => words[rand(words.length)]).join('');
        const boundary = rand(3) === 0 ? { kind: kinds[rand(kinds.length)], heading: 'H' } : undefined;
        return boundary ? { text, boundary } : { text };
      });
      const anchors = Array.from({ length: rand(5) }, () => ({
        href: '/p',
        text: 'p',
        region: 'internal' as const,
        chunk: rand(chunkCount + 3) - 1,
      }));
      const maxTextChars = rand(4) === 0 ? rand(60) : 100_000;
      const content = buildPageContent(rawPage({ textChunks, anchors }), { origin: ORIGIN, maxTextChars });

      const { sections, text } = content;
      expect(sections.length).toBeGreaterThan(0);
      expect(sections[0].start).toBe(0);
      expect(sections.at(-1)!.end).toBe(text.length);
      sections.forEach((s, i) => {
        expect(s.id).toBe(`s${i + 1}`);
        expect(s.start).toBeLessThanOrEqual(s.end);
        if (i > 0) expect(s.start).toBe(sections[i - 1].end);
      });
      expect(sections.map((s) => sectionText(content, s)).join('')).toBe(text);
      const boundaries = textChunks.filter((c) => c.boundary).length;
      expect(sections.length).toBe(Math.max(1, boundaries));
      if (boundaries === 0) expect(sections[0].kind).toBe<SectionKind>('page');
      const ids = new Set(sections.map((s) => s.id));
      for (const l of content.links) expect(ids.has(l.sectionId!)).toBe(true);
      expect(text.length).toBeLessThanOrEqual(maxTextChars);
    }
  });
});

describe('createFindingIdAllocator', () => {
  it('hands out AF-001, AF-002... in call order and reports the next free number', () => {
    const ids = createFindingIdAllocator();
    expect(ids.nextNumber).toBe(1);
    expect([ids.next(), ids.next(), ids.next()]).toEqual(['AF-001', 'AF-002', 'AF-003']);
    expect(ids.nextNumber).toBe(4);
  });

  it('can start from a given number', () => {
    const ids = createFindingIdAllocator(41);
    expect(ids.next()).toBe('AF-041');
    expect(ids.nextNumber).toBe(42);
    expect(formatFindingId(1000)).toBe('AF-1000');
  });

  it('rejects a start below 1 or not a whole number', () => {
    expect(() => createFindingIdAllocator(0)).toThrow(RangeError);
    expect(() => createFindingIdAllocator(1.5)).toThrow(RangeError);
  });
});
