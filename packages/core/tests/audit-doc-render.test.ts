import { describe, it, expect } from 'vitest';
import { DOCUMENT_LANGUAGES } from '@qa/types';
import type { AuditDoc } from '../src/audit/documents/model.js';
import { renderMarkdown, escapeMarkdownInline } from '../src/audit/documents/render-markdown.js';
import { renderHtml, TAMIL_FONT_STACK } from '../src/audit/documents/render-html.js';
import { findClaimWords, CLAIM_WORDS } from '../src/audit/documents/wording.js';
import { en } from '../src/audit/documents/labels/en.js';
import { ta } from '../src/audit/documents/labels/ta.js';
import { hi } from '../src/audit/documents/labels/hi.js';
import {
  flattenLabels,
  formatLabel,
  labelLanguages,
  labelsFor,
  phaseLabel,
} from '../src/audit/documents/labels/index.js';

// 1x1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const sampleDoc = (overrides: Partial<AuditDoc> = {}): AuditDoc => ({
  kind: 'findings',
  title: 'DocTitleAlpha',
  language: 'en',
  blocks: [
    { type: 'heading', level: 1, text: 'HeadingOne' },
    { type: 'paragraph', text: 'ParagraphOne' },
    { type: 'list', items: ['ListItemOne', 'ListItemTwo'] },
    { type: 'list', ordered: true, items: ['OrderedOne'] },
    { type: 'heading', level: 2, text: 'HeadingTwo' },
    {
      type: 'table',
      columns: ['ColumnOne', 'ColumnTwo'],
      rows: [
        ['CellOneOne', 'CellOneTwo'],
        ['CellTwoOne', 'CellTwoTwo'],
      ],
    },
    { type: 'note', text: 'NoteOne' },
    { type: 'pagebreak' },
    { type: 'image', src: PNG, alt: 'ImageAlt', caption: 'ImageCaption' },
    { type: 'paragraph', text: 'ParagraphLast' },
  ],
  ...overrides,
});

const ORDER = [
  'DocTitleAlpha',
  'HeadingOne',
  'ParagraphOne',
  'ListItemOne',
  'ListItemTwo',
  'OrderedOne',
  'HeadingTwo',
  'ColumnOne',
  'ColumnTwo',
  'CellOneOne',
  'CellOneTwo',
  'CellTwoOne',
  'CellTwoTwo',
  'NoteOne',
  'ImageAlt',
  'ImageCaption',
  'ParagraphLast',
];

/** The HTML after the <head>: what a reader sees. */
const htmlBody = (html: string) => html.slice(html.indexOf('<body>'));

function expectInOrder(output: string, markers: string[]) {
  let from = 0;
  for (const marker of markers) {
    const at = output.indexOf(marker, from);
    expect(at, `"${marker}" after position ${from}`).toBeGreaterThanOrEqual(0);
    from = at + marker.length;
  }
}

/** Pipes that are table structure in a GFM row (not escaped with a backslash). */
const structuralPipes = (line: string) => (line.match(/(?<!\\)\|/g) ?? []).length;

describe('Audit Document renderers: content and order', () => {
  it('renders every heading, paragraph, list item and table cell to Markdown in order', () => {
    const md = renderMarkdown(sampleDoc());
    expectInOrder(md, ORDER);
    expect(md).toMatch(/^# DocTitleAlpha$/m);
    expect(md).toMatch(/^## HeadingOne$/m);
    expect(md).toMatch(/^### HeadingTwo$/m);
    expect(md).toMatch(/^- ListItemOne$/m);
    expect(md).toMatch(/^1\. OrderedOne$/m);
    expect(md).toMatch(/^\| ColumnOne \| ColumnTwo \|$/m);
    expect(md).toMatch(/^\| CellTwoOne \| CellTwoTwo \|$/m);
    expect(md).toMatch(/^> NoteOne$/m);
    expect(md).toContain(`![ImageAlt](${PNG})`);
  });

  it('renders every heading, paragraph, list item and table cell to HTML in order', () => {
    const html = renderHtml(sampleDoc());
    expectInOrder(htmlBody(html), ORDER);
    expect(html).toContain('<h1>DocTitleAlpha</h1>');
    expect(html).toContain('<h2>HeadingOne</h2>');
    expect(html).toContain('<h3>HeadingTwo</h3>');
    expect(html).toContain('<li>ListItemOne</li>');
    expect(html).toContain('<ol><li>OrderedOne</li></ol>');
    expect(html).toContain('<th scope="col">ColumnOne</th>');
    expect(html).toContain('<td>CellTwoTwo</td>');
    expect(html).toContain('<div class="pagebreak"></div>');
    expect(html).toContain(`<img src="${PNG}" alt="ImageAlt">`);
    expect(html).toContain('<title>DocTitleAlpha</title>');
  });

  it('pads short table rows and drops extra cells', () => {
    const doc = sampleDoc({ blocks: [{ type: 'table', columns: ['A', 'B'], rows: [['only'], ['x', 'y', 'extra']] }] });
    const md = renderMarkdown(doc);
    for (const line of md.split('\n').filter((l) => l.startsWith('|'))) expect(structuralPipes(line)).toBe(3);
    expect(md).not.toContain('extra');
    expect(renderHtml(doc)).toContain('<tr><td>only</td><td></td></tr>');
  });
});

describe('Audit Document renderers: page text cannot add structure or markup', () => {
  const hostile =
    '# Heading\n| a | b |\n<script>alert(1)</script> **bold** [link](https://evil.example) <img src=x onerror=alert(1)>';
  const hostileDoc = sampleDoc({
    title: '# <script>title</script>',
    blocks: [
      { type: 'heading', level: 1, text: hostile },
      { type: 'paragraph', text: hostile },
      { type: 'list', items: [hostile, '1. not a list', '- nor this', '> nor a quote'] },
      { type: 'table', columns: ['Page | x', 'Text'], rows: [[hostile, 'a|b|c']] },
      { type: 'note', text: hostile },
      { type: 'paragraph', text: '===\n---\n    indented code?\n```\nfence\n~~~' },
      { type: 'image', src: PNG, alt: 'alt](javascript:alert(1)) <b>', caption: hostile },
    ],
  });

  it('escapes Markdown structure and HTML in Markdown output', () => {
    const md = renderMarkdown(hostileDoc);
    expect(md).not.toMatch(/<script/i);
    expect(md).not.toMatch(/<img/i);
    expect(md).not.toMatch(/<b>/);
    expect(md).toContain('&lt;script&gt;');
    // Only the renderer's own headings start a line with '#'.
    const headingLines = md.split('\n').filter((l) => l.startsWith('#'));
    expect(headingLines).toHaveLength(2);
    expect(headingLines[0]).toMatch(/^# \\# /);
    expect(headingLines[1]).toMatch(/^## \\# Heading /);
    // No page line becomes a list, quote, setext underline, indented code or fence.
    const lines = md.split('\n');
    for (const line of lines) {
      expect(line).not.toMatch(/^(={3}|-{3}\S|`{3}|~{3}| {4})/);
    }
    expect(md).toMatch(/^- 1\\\. not a list$/m);
    expect(md).toMatch(/^- \\- nor this$/m);
    expect(md).toMatch(/^- &gt; nor a quote$/m);
    // Emphasis, links and autolinks stay text.
    expect(md).toContain('\\*\\*bold\\*\\*');
    expect(md).toContain('\\[link\\](https\\://evil.example)');
    expect(md).not.toMatch(/(?<!\\)\]\(https?:/);
    expect(md).toContain('![alt\\](javascript:alert(1)) &lt;b&gt;]');
    // Each table row keeps exactly its columns: page pipes are escaped.
    const tableLines = lines.filter((l) => l.startsWith('| '));
    expect(tableLines.length).toBe(3);
    for (const line of tableLines) expect(structuralPipes(line)).toBe(3);
    expect(md).toMatch(/^\|( --- \|){2}$/m);
  });

  it('HTML-escapes all text in HTML output', () => {
    const html = renderHtml(hostileDoc);
    const body = htmlBody(html);
    expect(html).not.toMatch(/<script/i);
    expect(body).not.toMatch(/<img src=x/i);
    expect(body).not.toMatch(/<a\b/i);
    expect(body).not.toContain('<b>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<title># &lt;script&gt;title&lt;/script&gt;</title>');
    expect(body).toContain('alt="alt](javascript:alert(1)) &lt;b&gt;"');
    // Exactly the tags the renderer writes for this document.
    const tags = [...body.matchAll(/<([a-z0-9]+)[\s>]/gi)].map((m) => m[1].toLowerCase());
    expect(new Set(tags)).toEqual(
      new Set([
        'body',
        'main',
        'h1',
        'h2',
        'p',
        'ul',
        'li',
        'table',
        'thead',
        'tr',
        'th',
        'tbody',
        'td',
        'div',
        'figure',
        'img',
        'figcaption',
      ])
    );
  });

  it('does not embed an image that is not a data: URI', () => {
    const doc = sampleDoc({
      blocks: [
        { type: 'image', src: 'https://evil.example/a.png', alt: 'Remote' },
        { type: 'image', src: 'data:image/svg+xml;base64,PHN2Zz4=', alt: 'Svg' },
        { type: 'image', src: `${PNG}")onerror=alert(1)`, alt: 'Broken' },
      ],
    });
    const md = renderMarkdown(doc);
    const html = renderHtml(doc);
    expect(md).not.toContain('](');
    expect(md).toContain('Image not included: Remote');
    expect(html).not.toContain('<img');
    expect(html).toContain('Image not included: Svg');
    expect(html).not.toContain('evil.example');
  });

  it('escapeMarkdownInline keeps plain text and Tamil unchanged', () => {
    expect(escapeMarkdownInline('Plain words, nothing special')).toBe('Plain words, nothing special');
    expect(escapeMarkdownInline('வணக்கம், உலகம்')).toBe('வணக்கம், உலகம்');
  });
});

describe('Audit Document renderers: Tamil', () => {
  const tamil = 'எங்கள் சேவைகள்: இணையதள வடிவமைப்பு மற்றும் பராமரிப்பு. தொடர்பு கொள்ள அழைக்கவும்!';
  const tamilDoc = sampleDoc({
    language: 'ta',
    title: ta.documentTitles.findings,
    blocks: [
      { type: 'heading', level: 1, text: ta.headings.topIssues },
      { type: 'paragraph', text: tamil },
      { type: 'list', items: [tamil] },
      { type: 'table', columns: [ta.columns.page, ta.columns.issue], rows: [['/', tamil]] },
      { type: 'note', text: tamil },
    ],
  });

  it('keeps Tamil text character for character in Markdown', () => {
    const md = renderMarkdown(tamilDoc);
    expect(md.split(tamil).length - 1).toBe(4);
    expect(md).toContain(`# ${ta.documentTitles.findings}`);
    expect(md).toContain(`## ${ta.headings.topIssues}`);
    expect(md).toContain(`| ${ta.columns.page} | ${ta.columns.issue} |`);
  });

  it('keeps Tamil text in HTML and declares lang="ta" and a Tamil-capable font stack', () => {
    const html = renderHtml(tamilDoc);
    expect(html.split(tamil).length - 1).toBe(4);
    expect(html).toContain('<html lang="ta" dir="ltr">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(TAMIL_FONT_STACK).toBe("'Noto Sans Tamil', 'Nirmala UI', 'Latha', 'FreeSerif', sans-serif");
    expect(html).toContain(`font-family: ${TAMIL_FONT_STACK};`);
  });

  it('declares the language actually rendered: Urdu has no table, so it is English and left-to-right', () => {
    expect(renderHtml(sampleDoc())).toContain('<html lang="en" dir="ltr">');
    expect(renderHtml(sampleDoc({ language: 'ur' }))).toContain('<html lang="en" dir="ltr">');
  });
});

describe('Audit Document renderers: beta translation note', () => {
  const hiDoc = sampleDoc({
    language: 'hi',
    title: en.documentTitles.findings,
    blocks: [{ type: 'heading', level: 1, text: en.headings.topIssues }],
  });

  it('a Hindi document renders with English text and the beta note', () => {
    const md = renderMarkdown(hiDoc);
    expect(md).toContain(`# ${en.documentTitles.findings}`);
    expect(md).toContain(`## ${en.headings.topIssues}`);
    expect(md).toContain(`> ${en.status.betaTranslation}`);
    expect(md).not.toContain(hi.status.betaTranslation);
    expect(labelsFor('hi').labels.status.imageNotIncluded).toBe(en.status.imageNotIncluded);
    const html = renderHtml(hiDoc);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain(`<div class="note" role="note"><p>${en.status.betaTranslation}</p></div>`);
    expect(html).not.toContain(hi.status.betaTranslation);
    expect(html).toContain(`<h2>${en.headings.topIssues}</h2>`);
  });

  it('a beta language without a table shows the English note', () => {
    expect(renderMarkdown(sampleDoc({ language: 'te' }))).toContain(`> ${en.status.betaTranslation}\n`);
    expect(renderHtml(sampleDoc({ language: 'te' }))).toContain(`<p>${en.status.betaTranslation}</p>`);
  });

  it('English and Tamil documents carry no beta note', () => {
    for (const language of ['en', 'ta'] as const) {
      const doc = sampleDoc({ language });
      for (const text of [en.status.betaTranslation, ta.status.betaTranslation, hi.status.betaTranslation]) {
        expect(renderMarkdown(doc)).not.toContain(text);
        expect(renderHtml(doc)).not.toContain(text);
      }
    }
  });
});

describe('Audit Document HTML is self-contained (ADR 0021)', () => {
  const doc = sampleDoc({
    blocks: [
      ...sampleDoc().blocks,
      { type: 'paragraph', text: 'Visit https://example.com and http://example.org/page' },
      { type: 'image', src: 'http://example.com/remote.png', alt: 'Remote' },
    ],
  });
  const html = renderHtml(doc);

  it('references no external resource', () => {
    expect(html).not.toMatch(/\b(?:src|href|action|poster|srcset|data)\s*=\s*["']?\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/\bhref\s*=/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/@font-face/i);
    expect(html).not.toMatch(/url\s*\(/i);
    expect(html).not.toMatch(/<(?:link|script|iframe|object|embed|base)\b/i);
    for (const m of html.matchAll(/\bsrc\s*=\s*"([^"]*)"/gi)) expect(m[1]).toMatch(/^data:image\//);
  });

  it('allows only inline styles and data: images through its content security policy', () => {
    expect(html).toContain(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`);
  });

  it('carries A4 print CSS', () => {
    expect(html).toMatch(/@page\s*\{\s*size:\s*A4/);
    expect(html).toContain('@media print');
    expect(html).toContain('page-break-after: always');
  });
});

describe('Document labels', () => {
  const avoidTerms = [
    /\breports?\b/i,
    /\bplans?\b/i,
    /\benhancement plan\b/i,
    /\bthe three audit documents\b/i,
    /\bpitch deck\b/i,
    /\bowner report\b/i,
  ];

  it('English and Tamil have exactly the same keys and no empty value', () => {
    const enEntries = flattenLabels(en);
    const taEntries = flattenLabels(ta);
    expect(enEntries.length).toBeGreaterThan(50);
    expect(taEntries.map(([k]) => k)).toEqual(enEntries.map(([k]) => k));
    for (const [key, value] of [...enEntries, ...taEntries]) expect(value.trim(), key).not.toBe('');
  });

  it('Tamil values are written in Tamil', () => {
    const tamilScript = /[஀-௿]/;
    for (const [key, value] of flattenLabels(ta)) expect(value, key).toMatch(tamilScript);
  });

  it('no label makes an ADR 0018 claim or a release verdict', () => {
    for (const table of [en, ta]) {
      for (const [key, value] of flattenLabels(table)) expect(findClaimWords(value), key).toEqual([]);
    }
  });

  it('no English label uses a CONTEXT.md Avoid term', () => {
    for (const [key, value] of flattenLabels(en)) {
      for (const term of avoidTerms) expect(value, `${key}: ${term}`).not.toMatch(term);
    }
  });

  it('labelsFor returns the English and Tamil tables without fallback; Hindi falls back to English (DEC-005)', () => {
    expect(labelsFor('en')).toEqual({ labels: en, requested: 'en', language: 'en', fallback: false });
    expect(labelsFor('ta')).toEqual({ labels: ta, requested: 'ta', language: 'ta', fallback: false });
    expect(labelsFor('hi')).toEqual({ labels: en, requested: 'hi', language: 'en', fallback: true });
    expect(labelLanguages().sort()).toEqual(['bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te', 'ur']);
    expect(hi.status.betaTranslation).toBeTruthy();
  });

  it('labelsFor falls back to English and reports it for every language that is not document-ready', () => {
    const ready = new Set(['en', 'ta']);
    for (const lang of DOCUMENT_LANGUAGES.filter((l) => !ready.has(l))) {
      const lookup = labelsFor(lang);
      expect(lookup.fallback, lang).toBe(true);
      expect(lookup.requested).toBe(lang);
      expect(lookup.language).toBe('en');
      expect(lookup.labels).toBe(en);
    }
  });

  it('fills placeholders and names the first three phases', () => {
    expect(formatLabel('Phase {n}', { n: 2 })).toBe('Phase 2');
    expect(formatLabel('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(phaseLabel(en, 1)).toBe('Phase 1: Quick fixes');
    expect(phaseLabel(en, 4)).toBe('Phase 4');
    expect(phaseLabel(ta, 2)).toBe('கட்டம் 2: முக்கிய மேம்பாடுகள்');
  });
});

describe('findClaimWords (ADR 0018)', () => {
  it('lists every ADR 0018 word and the release-verdict words', () => {
    for (const word of [
      'compliant',
      'compliance',
      'certified',
      'secure',
      'safe',
      'hack-proof',
      'passes WCAG',
      'fully accessible',
      'Ready to release',
    ]) {
      expect(CLAIM_WORDS).toContain(word);
    }
  });

  it('finds claim words in any case and spacing, as whole words', () => {
    expect(findClaimWords('This site is Secure and SAFE.')).toEqual(['secure', 'safe']);
    expect(findClaimWords('It passes  WCAG and is fully\naccessible')).toEqual(['passes WCAG', 'fully accessible']);
    expect(findClaimWords('WCAG compliance: certified hack-proof')).toEqual(['compliance', 'certified', 'hack-proof']);
    expect(findClaimWords('Verdict: ready to release')).toEqual(['Ready to release']);
    expect(findClaimWords('Not ready yet')).toEqual(['Not ready yet']);
  });

  it('does not flag words that only contain a claim word', () => {
    expect(findClaimWords('insecure forms, safety notes, uncertified, accessible-looking')).toEqual([]);
    expect(findClaimWords('No accessibility problems found by the automatic checks on 12 pages')).toEqual([]);
    expect(findClaimWords('')).toEqual([]);
  });
});
