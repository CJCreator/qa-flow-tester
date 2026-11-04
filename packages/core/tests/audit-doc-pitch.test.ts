import { describe, it, expect } from 'vitest';
import type { AuditFinding, DocumentLanguage, EditOverlay } from '@qa/types';
import { buildEditedView, emptyOverlay, mergeEditsPatch, validateAuditEditsPatch, type EditedAuditView } from '../src/audit/documents/edits.js';
import {
  buildPitchGlimpse,
  clampText,
  pitchGlimpseDoc,
  pitchLimits,
  pitchWording,
  PITCH_TOP_FINDINGS,
} from '../src/audit/documents/pitch.js';
import type { DocBlock } from '../src/audit/documents/model.js';
import { findClaimWords } from '../src/audit/documents/wording.js';
import { en } from '../src/audit/documents/labels/en.js';
import { ta } from '../src/audit/documents/labels/ta.js';
import { OPT_OUT_TEXT_EN, OPT_OUT_TEXT_TA } from '../src/audit/documents/templates/opt-out.js';
import { auditDocContents, auditDocResult, FIXTURE_URL } from './helpers/audit-doc-fixture.js';

const NOW = '2026-11-03T10:00:00.000Z';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQ==';

type Result = ReturnType<typeof auditDocResult>;

function overlayOf(patch: unknown): EditOverlay {
  const checked = validateAuditEditsPatch(patch);
  if (!checked.ok) throw new Error(`patch refused: ${JSON.stringify(checked.errors)}`);
  return mergeEditsPatch(emptyOverlay(), checked.value, NOW);
}

function viewOf(change?: (result: Result) => void, patch?: unknown): EditedAuditView {
  const result = auditDocResult();
  change?.(result);
  return buildEditedView(result, auditDocContents(), patch ? overlayOf(patch) : emptyOverlay());
}

/** Gives the first `n` findings a screenshot path, `shots/AF-001.png`… */
function withScreenshots(n: number) {
  return (result: Result) => {
    result.findings.slice(0, n).forEach((f) => (f.screenshotPath = `shots/${f.id}.png`));
  };
}

const SCREENSHOTS: Record<string, string> = {
  'shots/AF-001.png': PNG,
  'shots/AF-002.png': JPEG,
  'shots/AF-003.png': PNG,
};

const headings = (blocks: DocBlock[], level: number): string[] =>
  blocks.flatMap((b) => (b.type === 'heading' && b.level === level ? [b.text] : []));

/** The visible text of the HTML body, tags removed and entities decoded enough for wording checks. */
function visibleText(html: string): string {
  const body = html.slice(html.indexOf('<body>'));
  return body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('Pitch Glimpse: top 3 findings (REQ-019 AC-1)', () => {
  it('shows exactly the first three findings in ranking order, each citing its page', () => {
    const view = viewOf(withScreenshots(3));
    const doc = pitchGlimpseDoc(view, { language: 'en', screenshots: SCREENSHOTS });
    const top = view.result.findings.slice(0, 3);
    expect(PITCH_TOP_FINDINGS).toBe(3);
    expect(headings(doc.blocks, 2)).toEqual(top.map((f, i) => `${i + 1}. ${f.title}`));

    const html = buildPitchGlimpse(view, { language: 'en', screenshots: SCREENSHOTS });
    let at = -1;
    for (const f of top) {
      const next = html.indexOf(f.title, at + 1);
      expect(next, f.title).toBeGreaterThan(at);
      at = next;
    }
    // Ranked lower: not on the page.
    expect(html).not.toContain('The call to action is easy to miss');
    expect(html).toContain('Page: /about, /services');
    expect(html).toContain('Page: /services');
    // The rest is pointed to, not listed.
    expect(html).toContain('3 more issues are listed in the full audit.');
  });

  it('shows fewer when fewer findings exist, and says so plainly when there are none', () => {
    const two = pitchGlimpseDoc(viewOf((r) => (r.findings = r.findings.slice(0, 2))), { language: 'en' });
    expect(headings(two.blocks, 2)).toHaveLength(2);

    const none = pitchGlimpseDoc(viewOf((r) => (r.findings = [])), { language: 'en' });
    expect(headings(none.blocks, 2)).toHaveLength(0);
    const text = none.blocks.flatMap((b) => (b.type === 'paragraph' ? [b.text] : []));
    expect(text).toContain(pitchWording('en').noFindings);
  });

  it('embeds one screenshot per finding as a data URI', () => {
    const html = buildPitchGlimpse(viewOf(withScreenshots(3)), { language: 'en', screenshots: SCREENSHOTS });
    const imgs = html.match(/<img [^>]*>/g) ?? [];
    expect(imgs).toHaveLength(3);
    for (const img of imgs) expect(img).toMatch(/src="data:image\/(png|jpeg);base64,/);
    expect(html).not.toContain(pitchWording('en').noScreenshot);
  });

  it('shows a no-screenshot note for a finding without one, or whose image is not a data URI', () => {
    const screenshots = { 'shots/AF-001.png': PNG, 'shots/AF-002.png': 'https://evil.example/x.png' };
    const html = buildPitchGlimpse(viewOf(withScreenshots(2)), { language: 'en', screenshots });
    expect(html.match(/<img [^>]*>/g) ?? []).toHaveLength(1);
    expect(html.split(pitchWording('en').noScreenshot).length - 1).toBe(2);
    expect(html).not.toContain('evil.example');
  });

  it('ignores screenshot keys inherited from Object.prototype', () => {
    const html = buildPitchGlimpse(
      viewOf((r) => (r.findings[0].screenshotPath = 'constructor')),
      { language: 'en', screenshots: {} },
    );
    expect(html.match(/<img [^>]*>/g) ?? []).toHaveLength(0);
  });

  it('uses the edited finding text (REQ-020)', () => {
    const view = viewOf(undefined, {
      findings: [{ findingId: 'AF-001', title: 'Edited title for the owner', detail: 'Edited detail.' }],
    });
    const html = buildPitchGlimpse(view, { language: 'en' });
    expect(html).toContain('1. Edited title for the owner');
    expect(html).toContain('Edited detail.');
    expect(html).not.toContain('Two pages share one title');
  });

  it('carries the site address and what was checked and what was not', () => {
    const html = buildPitchGlimpse(viewOf(), { language: 'en' });
    const text = visibleText(html);
    expect(text).toContain(`Website: ${FIXTURE_URL}`);
    expect(text).toContain('What was checked');
    expect(text).toMatch(/Pages read: 5 of \d+ found\./);
    expect(text).toContain('Areas graded by fixed checks: Marketing.');
    expect(text).toContain(en.headings.whatThisDidNotCheck);
    expect(text).toContain('Pages not read: 1 (Payment page).');
    expect(text).toContain('Areas not graded: Search ranking, Ease of use, Content, Accessibility, Speed.');
    expect(text).toContain(pitchWording('en').limits);
  });

  it('never shows effort', () => {
    const text = visibleText(buildPitchGlimpse(viewOf(), { language: 'en' }));
    expect(text).not.toContain(en.columns.effort);
  });
});

describe('Pitch Glimpse: language (REQ-019 AC-2, AC-3)', () => {
  it('English: English fixed text, the English default opt-out and lang="en"', () => {
    const html = buildPitchGlimpse(viewOf(), { language: 'en' });
    expect(html).toMatch(/<html lang="en"/);
    for (const s of [en.documentTitles['pitch-glimpse'], en.headings.topIssues, en.headings.optOut, OPT_OUT_TEXT_EN]) {
      expect(html).toContain(s);
    }
    expect(html).not.toContain(OPT_OUT_TEXT_TA);
  });

  it('Tamil: Tamil fixed text, the Tamil default opt-out and lang="ta"', () => {
    const html = buildPitchGlimpse(viewOf(), { language: 'ta' });
    expect(html).toMatch(/<html lang="ta"/);
    const words = pitchWording('ta');
    for (const s of [
      ta.documentTitles['pitch-glimpse'],
      ta.headings.topIssues,
      ta.headings.optOut,
      ta.headings.whatThisDidNotCheck,
      `${ta.columns.page}: /about, /services`,
      words.whatWasChecked,
      OPT_OUT_TEXT_TA,
    ]) {
      expect(html).toContain(s);
    }
    const english = pitchWording('en');
    for (const s of [
      en.documentTitles['pitch-glimpse'],
      en.headings.topIssues,
      en.headings.optOut,
      `${en.columns.page}:`,
      `${en.columns.found}:`,
      `${en.columns.suggestedFix}:`,
      english.whatWasChecked,
      english.limits,
      OPT_OUT_TEXT_EN,
    ]) {
      expect(html, s).not.toContain(s);
    }
  });

  it('a language without a table uses English throughout', () => {
    const html = buildPitchGlimpse(viewOf(), { language: 'te' as DocumentLanguage });
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toContain(OPT_OUT_TEXT_EN);
    expect(html).toContain('Beta translation');
    expect(pitchGlimpseDoc(viewOf(), { language: 'te' as DocumentLanguage }).language).toBe('te');
  });
});

describe('Pitch Glimpse: opt-out text (REQ-019, BE-504)', () => {
  it('uses the saved text for the language instead of the default', () => {
    const saved = { en: 'Reply STOP and we will not write again.', ta: 'நிறுத்து என்று பதில் அனுப்புங்கள்.' };
    const enHtml = buildPitchGlimpse(viewOf(), { language: 'en', optOutText: saved });
    expect(enHtml).toContain(saved.en);
    expect(enHtml).not.toContain(OPT_OUT_TEXT_EN);
    expect(enHtml).not.toContain(saved.ta);

    const taHtml = buildPitchGlimpse(viewOf(), { language: 'ta', optOutText: saved });
    expect(taHtml).toContain(saved.ta);
    expect(taHtml).not.toContain(OPT_OUT_TEXT_TA);
  });

  it('uses the default when only another language has saved text, or the saved text is blank', () => {
    expect(buildPitchGlimpse(viewOf(), { language: 'ta', optOutText: { en: 'English only.' } })).toContain(OPT_OUT_TEXT_TA);
    expect(buildPitchGlimpse(viewOf(), { language: 'en', optOutText: { en: '   ' } })).toContain(OPT_OUT_TEXT_EN);
  });

  it('puts the opt-out text last, under its heading', () => {
    const doc = pitchGlimpseDoc(viewOf(), { language: 'en' });
    expect(doc.blocks.at(-2)).toEqual({ type: 'heading', level: 1, text: en.headings.optOut });
    expect(doc.blocks.at(-1)).toEqual({ type: 'paragraph', text: OPT_OUT_TEXT_EN });
  });
});

describe('Pitch Glimpse: no send action, nothing loads (supports REQ-019 AC-4, ADR 0021)', () => {
  const hostile = (r: Result) => {
    r.findings[0].title = '<form action="https://x.example"><input name=a></form>';
    r.findings[0].detail = '<a href="mailto:owner@example.in">mail</a> <a href="tel:+919876543210">call</a>';
    r.findings[1].suggestion = '<script>alert(1)</script><img src="https://x.example/p.gif"><link rel=stylesheet href=//x>';
    r.findings[2].screenshotPath = 'shots/AF-003.png';
  };

  for (const language of ['en', 'ta'] as const) {
    it(`${language}: no form, mailto:, tel:, script or external resource, even from page text`, () => {
      const html = buildPitchGlimpse(viewOf(hostile), {
        language,
        screenshots: SCREENSHOTS,
        optOutText: { [language]: 'Write to <a href="mailto:me@x.in">me</a>.' },
      });
      expect(html).not.toMatch(/<form\b/i);
      expect(html).not.toMatch(/<input\b/i);
      expect(html).not.toMatch(/<button\b/i);
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/<link\b/i);
      expect(html).not.toMatch(/<iframe\b/i);
      expect(html).not.toMatch(/<a\b/i);
      // Page text is escaped, so every "<" left is a real tag: none of them carries an href or action.
      expect(html).not.toMatch(/<[a-z][^>]*\s(href|action|formaction)\s*=/i);
      expect(html).not.toMatch(/="\s*(mailto|tel):/i);
      expect(html).not.toMatch(/@import|url\(/i);
      // Every src is an embedded image.
      for (const [, src] of html.matchAll(/\bsrc="([^"]*)"/g)) expect(src).toMatch(/^data:image\//);
      // The CSP forbids loading anything but data: images and inline styles.
      expect(html).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    });
  }
});

describe('Pitch Glimpse: fits one A4 page (text clamped in both languages)', () => {
  const long = (word: string, n: number) => Array.from({ length: n }, () => word).join(' ');
  const huge = (r: Result) => {
    r.url = `https://shop.example.in/${'x'.repeat(400)}`;
    r.findings.slice(0, 3).forEach((f: AuditFinding) => {
      f.title = long('title', 200);
      f.detail = long('detail', 1000);
      f.suggestion = long('suggestion', 1000);
      f.pages = Array.from({ length: 50 }, (_, i) => `/page-${i}`);
    });
  };

  for (const language of ['en', 'ta'] as const) {
    it(`${language}: every finding field and the address stay within the limits`, () => {
      const limits = pitchLimits(language);
      const labels = language === 'ta' ? ta : en;
      const doc = pitchGlimpseDoc(viewOf(huge), { language });
      const len = (s: string) => Array.from(s).length;
      for (const b of doc.blocks) {
        if (b.type === 'heading' && b.level === 2) expect(len(b.text)).toBeLessThanOrEqual(limits.title + 3);
        if (b.type !== 'paragraph') continue;
        if (b.text.startsWith(`${labels.columns.found}: `)) {
          expect(len(b.text)).toBeLessThanOrEqual(len(labels.columns.found) + 2 + limits.detail);
        }
        if (b.text.startsWith(`${labels.columns.suggestedFix}: `)) {
          expect(len(b.text)).toBeLessThanOrEqual(len(labels.columns.suggestedFix) + 2 + limits.suggestion);
        }
        if (b.text.startsWith(`${labels.columns.page}: `)) {
          expect(len(b.text)).toBeLessThanOrEqual(len(labels.columns.page) + 2 + limits.pages);
        }
      }
      expect(headings(doc.blocks, 2)).toHaveLength(3);
      // Tamil runs wider, so its limits are lower.
      if (language === 'ta') expect(limits.detail).toBeLessThan(pitchLimits('en').detail);
    });
  }

  it('lays the page out on A4 with a fixed screenshot height', () => {
    const html = buildPitchGlimpse(viewOf(), { language: 'en' });
    expect(html).toMatch(/@page \{ size: A4;/);
    expect(html).toMatch(/figure img \{[^}]*max-height: 40mm/);
    expect(html.indexOf('figure img { display: block')).toBeLessThan(html.indexOf('</head>'));
  });

  it('clampText cuts at a word boundary with an ellipsis and leaves short text alone', () => {
    expect(clampText('Short text.', 50)).toBe('Short text.');
    expect(clampText('one\n two   three', 50)).toBe('one two three');
    const cut = clampText('alpha beta gamma delta epsilon', 14);
    expect(cut).toBe('alpha beta…');
    expect(Array.from(cut).length).toBeLessThanOrEqual(14);
    const tamil = clampText('பக்கத்தில் குறைவான உள்ளடக்கம் உள்ளது', 20);
    expect(Array.from(tamil).length).toBeLessThanOrEqual(20);
    expect(tamil.endsWith('…')).toBe(true);
  });
});

describe('Pitch Glimpse: claim wording (ADR 0018, ADR 0029)', () => {
  for (const language of ['en', 'ta'] as const) {
    it(`${language}: no ADR 0018 word, no "Ready to release", no verdict`, () => {
      const text = visibleText(
        buildPitchGlimpse(viewOf(withScreenshots(1)), { language, screenshots: SCREENSHOTS }),
      );
      expect(findClaimWords(text)).toEqual([]);
      expect(text).not.toContain('Ready to release');
      expect(text).not.toMatch(/verdict/i);
    });
  }

  it('the fixed Pitch Glimpse wording makes no claim in either language', () => {
    for (const language of ['en', 'ta'] as const) {
      for (const value of Object.values(pitchWording(language))) expect(findClaimWords(value), value).toEqual([]);
    }
  });
});
