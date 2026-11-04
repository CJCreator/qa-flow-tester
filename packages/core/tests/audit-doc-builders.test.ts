import { describe, it, expect } from 'vitest';
import { AUDIT_AREAS, sectionText, type DocumentLanguage, type EditOverlay } from '@qa/types';
import {
  buildEditedView,
  emptyOverlay,
  mergeEditsPatch,
  validateAuditEditsPatch,
  type EditedAuditView,
} from '../src/audit/documents/edits.js';
import { buildStructureDocument } from '../src/audit/documents/structure.js';
import { buildContentDocument } from '../src/audit/documents/content.js';
import { buildFindingsDocument } from '../src/audit/documents/findings.js';
import type { AuditDoc, DocBlock } from '../src/audit/documents/model.js';
import { renderMarkdown } from '../src/audit/documents/render-markdown.js';
import { renderHtml } from '../src/audit/documents/render-html.js';
import { findClaimWords } from '../src/audit/documents/wording.js';
import { en } from '../src/audit/documents/labels/en.js';
import { ta } from '../src/audit/documents/labels/ta.js';
import { auditDocContents, auditDocResult, fixtureSectionText, PATHS } from './helpers/audit-doc-fixture.js';

const NOW = '2026-11-03T10:00:00.000Z';

function overlayOf(patch: unknown): EditOverlay {
  const checked = validateAuditEditsPatch(patch);
  if (!checked.ok) throw new Error(`patch refused: ${JSON.stringify(checked.errors)}`);
  return mergeEditsPatch(emptyOverlay(), checked.value, NOW);
}

function viewOf(patch?: unknown, change?: (result: ReturnType<typeof auditDocResult>) => void): EditedAuditView {
  const result = auditDocResult();
  change?.(result);
  return buildEditedView(result, auditDocContents(), patch ? overlayOf(patch) : emptyOverlay());
}

type Builder = (view: EditedAuditView, options?: { language?: DocumentLanguage }) => AuditDoc;
const BUILDERS: Array<[name: string, build: Builder]> = [
  ['Structure', buildStructureDocument],
  ['Content', buildContentDocument],
  ['Findings', buildFindingsDocument],
];

/** Markdown and HTML of one document. */
function outputs(doc: AuditDoc): Array<[format: string, text: string]> {
  return [
    ['md', renderMarkdown(doc)],
    ['html', renderHtml(doc)],
  ];
}

/** The Markdown split at every line starting with `marker` ("## "), keyed by that line's text. */
function chunks(md: string, marker: string): Array<{ head: string; body: string }> {
  const out: Array<{ head: string; body: string }> = [];
  for (const line of md.split('\n')) {
    if (line.startsWith(marker)) out.push({ head: line.slice(marker.length), body: '' });
    else if (out.length > 0) out[out.length - 1].body += `${line}\n`;
  }
  return out;
}

const paragraphs = (doc: AuditDoc): string[] =>
  doc.blocks.filter((b): b is Extract<DocBlock, { type: 'paragraph' }> => b.type === 'paragraph').map((b) => b.text);
const listItems = (doc: AuditDoc): string[] => doc.blocks.flatMap((b) => (b.type === 'list' ? b.items : []));

describe('Findings document: edits (REQ-020 AC-1)', () => {
  it('shows the edited title, detail and suggestion and not the originals', () => {
    const view = viewOf({
      findings: [
        { findingId: 'AF-001', title: 'EditedTitleQ7', detail: 'EditedDetailQ7', suggestion: 'EditedFixQ7' },
        { findingId: 'AF-004', suggestion: 'EditedCtaFixQ7' },
      ],
    });
    for (const [format, text] of outputs(buildFindingsDocument(view))) {
      expect(text, format).toContain('EditedTitleQ7');
      expect(text, format).toContain('EditedDetailQ7');
      expect(text, format).toContain('EditedFixQ7');
      expect(text, format).toContain('EditedCtaFixQ7');
      expect(text, format).not.toContain('Two pages share one title');
      expect(text, format).not.toContain('Give each page its own title');
      expect(text, format).not.toContain('Move ');
      // Fields not edited keep their original text.
      expect(text, format).toContain('The call to action is easy to miss');
    }
  });
});

describe('removed pages (REQ-020 AC-2)', () => {
  it('lists /about/team before it is removed, so the check below means something', () => {
    const view = viewOf();
    for (const [, build] of BUILDERS) {
      for (const [, text] of outputs(build(view))) expect(text).toContain(PATHS.team);
    }
  });

  it('a removed page is in none of the three documents', () => {
    const view = viewOf({ removePages: [PATHS.team] });
    for (const [name, build] of BUILDERS) {
      for (const [format, text] of outputs(build(view))) {
        expect(text, `${name} ${format}`).not.toContain(PATHS.team);
        expect(text, `${name} ${format}`).not.toContain('Meet the people behind the shop');
      }
    }
  });

  it('a removed page with findings that span pages is no longer cited or listed', () => {
    const view = viewOf({ removePages: [PATHS.services] });
    const structure = renderMarkdown(buildStructureDocument(view));
    const content = renderMarkdown(buildContentDocument(view));
    expect(structure).not.toContain(PATHS.services);
    expect(content).not.toContain(PATHS.services);
    expect(content).not.toContain('Home delivery, bulk orders and gift hampers.');
    const findings = buildFindingsDocument(view);
    for (const item of listItems(findings)) expect(item).not.toContain(PATHS.services);
    // AF-003 was only on /services.
    expect(renderMarkdown(findings)).not.toContain('No meta description\n\n- Page: /services');
  });

  it('a removed page’s children move up under its parent in the hierarchy', () => {
    const items = listItems(buildStructureDocument(viewOf({ removePages: [PATHS.about] })));
    expect(items).toContain('↳ /about/team · Our team (Placed by the address path)');
    expect(items.some((i) => i.includes(`${PATHS.about} ·`))).toBe(false);
  });
});

describe('Content document: edited Sections (REQ-020 AC-3)', () => {
  it('shows the edited Section text and not the original', () => {
    const view = viewOf({ sections: [{ urlPath: PATHS.home, sectionId: 's2', text: 'EditedHeroQ7\nSecondLineQ7\n' }] });
    for (const [format, text] of outputs(buildContentDocument(view))) {
      expect(text, format).toContain('EditedHeroQ7');
      expect(text, format).toContain('SecondLineQ7');
      expect(text, format).not.toContain('Order before 6 pm for same-day delivery.');
      // Other Sections of the page are kept.
      expect(text, format).toContain('Call 044 1234 5678');
    }
  });

  it('an emptied Section says it has no text', () => {
    const view = viewOf({ sections: [{ urlPath: PATHS.about, sectionId: 's2', text: '' }] });
    const md = renderMarkdown(buildContentDocument(view));
    expect(md).toContain('This Section has no text.');
    expect(md).not.toContain('A family shop in Chennai since 1998.');
  });
});

describe('Findings document: groups, ranking and citations (REQ-017 AC-2)', () => {
  const result = auditDocResult();
  const md = renderMarkdown(buildFindingsDocument(viewOf()));
  const groups = chunks(md, '## ');

  it('lists technical, marketing and content in that order', () => {
    expect(groups.map((g) => g.head).slice(0, 3)).toEqual([
      en.groups.technical,
      en.groups.marketing,
      en.groups.content,
    ]);
  });

  it('keeps ranking order inside each group and cites each finding’s page and Section', () => {
    const expectedSection: Record<string, string> = {
      'AF-002': 's2 · About us',
      'AF-004': 's2 · Fresh groceries delivered',
      'AF-005': 's2 · புதிய மளிகைப் பொருட்கள்',
    };
    for (const [i, group] of (['technical', 'marketing', 'content'] as const).entries()) {
      const expected = result.findings.filter((f) => f.group === group);
      const found = chunks(groups[i].body, '### ');
      expect(found.map((f) => f.head)).toEqual(expected.map((f) => f.title));
      expected.forEach((f, n) => {
        expect(found[n].body).toContain(`- Page: ${f.urlPath}\n`);
        expect(found[n].body).toContain(`- Section: ${expectedSection[f.id] ?? 'Whole page'}\n`);
        expect(found[n].body).toContain(`- Impact: ${en.scale[f.impact]}\n`);
        expect(found[n].body).toContain(`- Effort: ${en.scale[f.effort]}\n`);
      });
    }
  });

  it('lists every page a finding spans', () => {
    expect(md).toContain('- Pages: /about, /services');
  });

  it('marks AI-written findings as advice and rule findings not', () => {
    const all = groups.slice(0, 3).flatMap((g) => chunks(g.body, '### '));
    const ai = all.find((c) => c.head === 'The call to action is easy to miss')!;
    const rule = all.find((c) => c.head === 'Two pages share one title')!;
    expect(ai.body).toContain(`> ${en.status.aiNote}`);
    expect(rule.body).not.toContain(en.status.aiNote);
  });

  it('showEffort: false leaves effort out everywhere', () => {
    for (const [lang, labels] of [
      ['en', en],
      ['ta', ta],
    ] as const) {
      const doc = buildFindingsDocument(viewOf(), { language: lang, showEffort: false });
      for (const [format, text] of outputs(doc)) {
        expect(text, `${lang} ${format}`).not.toContain(labels.columns.effort);
        expect(text, `${lang} ${format}`).toContain(labels.columns.impact);
      }
    }
  });

  it('an empty group says none found', () => {
    const view = viewOf(undefined, (r) => {
      r.findings = r.findings.filter((f) => f.group !== 'marketing');
    });
    const marketing = chunks(renderMarkdown(buildFindingsDocument(view)), '## ').find(
      (g) => g.head === en.groups.marketing
    )!;
    expect(marketing.body.trim()).toBe(en.status.noneFound);
  });
});

describe('not checked is never a clean result (ADR 0018)', () => {
  it('Skipped Pages are listed with their reason as not checked', () => {
    for (const [lang, labels] of [
      ['en', en],
      ['ta', ta],
    ] as const) {
      const md = renderMarkdown(buildStructureDocument(viewOf(), { language: lang }));
      const section = chunks(md, '## ').find((c) => c.head === labels.headings.pagesNotChecked)!;
      expect(section.body).toContain(`| /checkout | ${labels.skipReasons.payment} | ${labels.status.notChecked} |`);
      expect(section.body).not.toContain(labels.status.noneFound);
    }
  });

  it('areas without a grade show not checked; graded areas show the grade with the AI note as advice', () => {
    for (const [lang, labels] of [
      ['en', en],
      ['ta', ta],
    ] as const) {
      const md = renderMarkdown(buildFindingsDocument(viewOf(), { language: lang }));
      for (const area of AUDIT_AREAS) {
        if (area === 'marketing') {
          expect(md).toContain(`| ${labels.areas.marketing} | C | The offer is clear; the call to action is late. |`);
        } else {
          expect(md).toContain(
            `| ${labels.areas[area]} | ${labels.status.notChecked} | ${labels.aiNotDone['no-ai-key']} |`
          );
        }
      }
      expect(md).toContain(`> ${labels.status.aiNote}`);
    }
  });

  it('an area missing from the version, or done without a grade, is not checked', () => {
    const view = viewOf(undefined, (r) => {
      r.siteAreas = [{ area: 'speed', grade: null, status: 'done', note: 'SpeedNoteQ7', evidence: [] }];
    });
    const md = renderMarkdown(buildFindingsDocument(view));
    for (const area of AUDIT_AREAS) expect(md).toContain(`| ${en.areas[area]} | Not checked |`);
    expect(md).toContain('SpeedNoteQ7');
  });

  it('a technology that was not identified says so', () => {
    const view = viewOf(undefined, (r) => {
      r.technology = { status: 'not-identified' };
    });
    const md = renderMarkdown(buildStructureDocument(view));
    const tech = chunks(md, '## ').find((c) => c.head === en.headings.technology)!;
    expect(tech.body.trim()).toBe(en.status.notIdentified);
  });
});

describe('Structure document', () => {
  const doc = buildStructureDocument(viewOf());

  it('lists the hierarchy in order with how each place was decided', () => {
    expect(doc.blocks.find((b) => b.type === 'list')).toEqual({
      type: 'list',
      items: [
        '/ · Shop Example (Start page)',
        '↳ /about · Shop Example (Placed by the site menu)',
        '↳ ↳ /about/team · Our team (Placed by the address path)',
        '↳ /services · Shop Example (Placed by the site menu)',
        '↳ /ta · கடை உதாரணம் (Placed by the address path)',
      ],
    });
  });

  it('groups navigation links by region and lists links that leave the site and the technology', () => {
    const md = renderMarkdown(doc);
    const headings = chunks(md, '### ').map((c) => c.head);
    expect(headings).toEqual(['Menu', 'Links in the page content']);
    expect(md).toContain('| /about | Our team | /about/team |');
    const leaving = doc.blocks.find((b) => b.type === 'table' && b.columns[0] === en.columns.goesTo);
    expect(leaving).toMatchObject({
      rows: [
        ['https://instagram.com/shopexample', '/, /ta'],
        ['https://maps.example.com/shop', '/about'],
      ],
    });
    expect(listItems(doc)).toContain('WordPress · Website builder or CMS');
  });
});

describe('Content document', () => {
  const doc = buildContentDocument(viewOf());
  const md = renderMarkdown(doc);

  it('lists every page Section by Section with heading and kind', () => {
    for (const page of auditDocResult().pages) expect(md).toContain(`## Page: ${page.urlPath}\n`);
    expect(md).toContain('### s2 · Fresh groceries delivered\n\nKind: Main content');
    expect(md).toContain('### s1 · Header\n\nKind: Header');
  });

  it('shows images with alt text or a missing-alt note, calls to action, and forms as read only', () => {
    const items = listItems(doc);
    expect(items).toContain('/img/hero.jpg · Alt text: Fresh vegetables');
    expect(items).toContain('/img/shop.jpg · Missing alt text');
    expect(items).toContain('Order now · Link → /order');
    expect(items).toContain('Method: POST · Sends to: /enquiry');
    expect(items).toContain('Fields: Name (text, required)');
    expect(items).toContain('Fields: Phone (tel)');
    expect(md).toContain('> Forms were only read: nothing was filled in or sent.');
  });

  it('an empty alt is listed as decorative, not as missing', () => {
    const contents = auditDocContents();
    contents[0].images = [{ src: '/img/line.png', alt: '', sectionId: 's2' }];
    const view = buildEditedView(auditDocResult(), contents, emptyOverlay());
    expect(listItems(buildContentDocument(view))).toContain('/img/line.png · Empty alt text (decorative image)');
  });
});

describe('languages and claim wording', () => {
  it.each(['en', 'ta'] as const)('%s: no ADR 0018 word, release verdict or pass/fail in any output', (lang) => {
    const view = viewOf();
    for (const [name, build] of BUILDERS) {
      for (const [format, text] of outputs(build(view, { language: lang }))) {
        expect(findClaimWords(text), `${name} ${format}`).toEqual([]);
        expect(text, `${name} ${format}`).not.toMatch(/ready to release|verdict|\bpass(ed)?\b|\bfail(ed)?\b/i);
      }
    }
  });

  it('Tamil documents use Tamil fixed wording and no English fixed wording', () => {
    const view = viewOf();
    const english = [
      'Page hierarchy',
      'Placed by',
      'Start page',
      'Not checked',
      'Pages not checked',
      'Built with',
      'Website builder',
      'Kind:',
      'Main content',
      'Missing alt text',
      'Calls to action',
      'Forms were only read',
      'Page title',
      'Technical',
      'Marketing',
      'What was found',
      'Suggested fix',
      'Impact',
      'Effort',
      'Grades by area',
      'Whole page',
      'Website:',
    ];
    const docs = BUILDERS.map(([, build]) => build(view, { language: 'ta' }));
    expect(docs.map((d) => d.title)).toEqual([
      ta.documentTitles.structure,
      ta.documentTitles.content,
      ta.documentTitles.findings,
    ]);
    for (const doc of docs) {
      expect(doc.language).toBe('ta');
      for (const [format, text] of outputs(doc)) {
        for (const word of english) expect(text, `${doc.kind} ${format}: ${word}`).not.toContain(word);
      }
    }
    const [structure, content, findings] = docs.map(renderMarkdown);
    expect(structure).toContain(ta.headings.pageHierarchy);
    expect(content).toContain(`${ta.columns.page}: /ta`);
    expect(findings).toContain(ta.groups.technical);
    expect(findings).toContain(`${ta.columns.suggestedFix}: `);
  });

  it.each(['en', 'ta'] as const)('%s: page text is kept character for character', (lang) => {
    const view = viewOf();
    const doc = buildContentDocument(view, { language: lang });
    const texts = paragraphs(doc);
    for (const content of view.contents) {
      for (const section of content.sections) {
        const original = fixtureSectionText(content.urlPath, section.id);
        expect(sectionText(content, section)).toBe(original);
        expect(texts).toContain(original);
      }
    }
    // Tamil page text survives rendering unchanged, line by line.
    const md = renderMarkdown(doc);
    const html = renderHtml(doc);
    for (const id of ['s1', 's2', 's3']) {
      for (const line of fixtureSectionText(PATHS.tamil, id).split('\n').filter(Boolean)) {
        expect(md).toContain(line);
        expect(html).toContain(line);
      }
    }
    const findingsMd = renderMarkdown(buildFindingsDocument(view, { language: lang }));
    expect(findingsMd).toContain('பக்கத்தில் குறைவான உள்ளடக்கம்');
    expect(findingsMd).toContain('இந்தப் பக்கத்தில் சில வரிகள் மட்டுமே உள்ளன.');
  });

  it('a language without its own table falls back to English wording', () => {
    const doc = buildFindingsDocument(viewOf(), { language: 'te' });
    expect(doc.language).toBe('te');
    expect(doc.title).toBe(en.documentTitles.findings);
  });

  it('a fallback request keeps the requested language so the HTML carries the beta note', () => {
    const doc = buildStructureDocument(viewOf(), { language: 'hi' });
    expect(doc.language).toBe('hi');
    const html = renderHtml(doc);
    expect(html).toContain('lang="en"');
    expect(html).toContain('Beta translation');
  });

  it('building does not change the view', () => {
    const view = viewOf({ removePages: [PATHS.team] });
    const before = structuredClone(view);
    for (const [, build] of BUILDERS) build(view);
    buildFindingsDocument(view, { showEffort: false });
    expect(view).toEqual(before);
  });
});
