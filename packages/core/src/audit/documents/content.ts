/**
 * The Content Audit Document (REQ-018, Q-02): every page's Page Content, Section by Section: its heading,
 * kind and text, then the images (with their alt text or a note that it is missing), calls to action and
 * forms (read, never sent) in that Section.
 *
 * Built from the edited view only (REQ-020): edited Section text is shown, removed pages never are. Page
 * text is passed through character for character; the renderers escape it.
 */

import {
  sectionText,
  type ContentCta,
  type ContentForm,
  type ContentImage,
  type DocumentLanguage,
  type PageContent,
  type SectionKind,
  type SectionSummary,
} from '@qa/types';
import type { EditedAuditView } from './edits.js';
import { labelsFor } from './labels/index.js';
import type { AuditDoc, DocBlock } from './model.js';

/** Fixed wording only the Content document (and the Section citations of the Findings document) uses. */
interface ContentWording {
  website: string;
  sectionKinds: Record<SectionKind, string>;
  kind: string;
  pageTitle: string;
  description: string;
  noTitle: string;
  noDescription: string;
  images: string;
  altText: string;
  missingAlt: string;
  emptyAlt: string;
  ctas: string;
  ctaKinds: Record<ContentCta['kind'], string>;
  forms: string;
  formsReadOnly: string;
  method: string;
  sendsTo: string;
  fields: string;
  required: string;
  emptySection: string;
  textCut: string;
  noContent: string;
  elsewhereOnPage: string;
}

const EN: ContentWording = {
  website: 'Website',
  sectionKinds: {
    header: 'Header',
    nav: 'Navigation',
    main: 'Main content',
    aside: 'Side content',
    footer: 'Footer',
    region: 'Labelled part',
    heading: 'Heading',
    page: 'Whole page',
  },
  kind: 'Kind',
  pageTitle: 'Page title',
  description: 'Description',
  noTitle: 'No title',
  noDescription: 'No description',
  images: 'Images',
  altText: 'Alt text',
  missingAlt: 'Missing alt text',
  emptyAlt: 'Empty alt text (decorative image)',
  ctas: 'Calls to action',
  ctaKinds: { button: 'Button', link: 'Link' },
  forms: 'Forms',
  formsReadOnly: 'Forms were only read: nothing was filled in or sent.',
  method: 'Method',
  sendsTo: 'Sends to',
  fields: 'Fields',
  required: 'required',
  emptySection: 'This Section has no text.',
  textCut: 'The text of this page was cut at the per-page limit.',
  noContent: 'The Page Content of this page was not stored.',
  elsewhereOnPage: 'Elsewhere on the page',
};

const TA: ContentWording = {
  website: 'இணையதளம்',
  sectionKinds: {
    header: 'தலைப்புப் பகுதி',
    nav: 'வழிசெலுத்தல்',
    main: 'முதன்மை உள்ளடக்கம்',
    aside: 'பக்கவாட்டு உள்ளடக்கம்',
    footer: 'அடிப்பகுதி',
    region: 'பெயரிடப்பட்ட பகுதி',
    heading: 'தலைப்பு',
    page: 'முழுப் பக்கம்',
  },
  kind: 'வகை',
  pageTitle: 'பக்கத் தலைப்பு',
  description: 'விளக்கம்',
  noTitle: 'தலைப்பு இல்லை',
  noDescription: 'விளக்கம் இல்லை',
  images: 'படங்கள்',
  altText: 'மாற்று உரை',
  missingAlt: 'மாற்று உரை இல்லை',
  emptyAlt: 'வெற்று மாற்று உரை (அலங்காரப் படம்)',
  ctas: 'செயலுக்கான அழைப்புகள்',
  ctaKinds: { button: 'பொத்தான்', link: 'இணைப்பு' },
  forms: 'படிவங்கள்',
  formsReadOnly: 'படிவங்கள் படிக்கப்பட்டன மட்டுமே: எதுவும் நிரப்பப்படவில்லை, அனுப்பப்படவில்லை.',
  method: 'முறை',
  sendsTo: 'அனுப்பும் இடம்',
  fields: 'புலங்கள்',
  required: 'கட்டாயம்',
  emptySection: 'இந்தப் பகுதியில் உரை இல்லை.',
  textCut: 'இந்தப் பக்கத்தின் உரை ஒரு பக்க வரம்பில் துண்டிக்கப்பட்டது.',
  noContent: 'இந்தப் பக்கத்தின் உள்ளடக்கம் சேமிக்கப்படவில்லை.',
  elsewhereOnPage: 'பக்கத்தின் பிற இடங்களில்',
};

const WORDING: Partial<Record<DocumentLanguage, ContentWording>> = { en: EN, ta: TA };

/** This document's own wording for `language` (English when the language has no table yet). */
export function contentWording(language: DocumentLanguage): ContentWording {
  return WORDING[language] ?? EN;
}

/** How a document names a Section: "s2 · About us", or its kind when it has no heading ("s1 · Header"). */
export function sectionLabel(language: DocumentLanguage, section: SectionSummary): string {
  const heading = section.heading && section.heading.trim() !== '' ? section.heading : undefined;
  return `${section.id} · ${heading ?? contentWording(language).sectionKinds[section.kind] ?? section.kind}`;
}

export interface ContentDocumentOptions {
  /** The language of the fixed wording; defaults to the version's language. */
  language?: DocumentLanguage;
}

function imageItem(image: ContentImage, words: ContentWording): string {
  if (image.alt === null) return `${image.src} · ${words.missingAlt}`;
  if (image.alt === '') return `${image.src} · ${words.emptyAlt}`;
  return `${image.src} · ${words.altText}: ${image.alt}`;
}

function ctaItem(cta: ContentCta, words: ContentWording): string {
  return `${cta.text} · ${words.ctaKinds[cta.kind] ?? cta.kind}${cta.to ? ` → ${cta.to}` : ''}`;
}

function formItems(form: ContentForm, words: ContentWording): string[] {
  const head = `${words.method}: ${form.method}${form.action ? ` · ${words.sendsTo}: ${form.action}` : ''}`;
  const fields = form.fields.map(
    (f) => `${words.fields}: ${f.label} (${f.type}${f.required ? `, ${words.required}` : ''})`
  );
  return [head, ...fields];
}

/** The images, calls to action and forms in one place of a page, as headed lists. */
function elementBlocks(
  images: ContentImage[],
  ctas: ContentCta[],
  forms: ContentForm[],
  words: ContentWording
): DocBlock[] {
  const blocks: DocBlock[] = [];
  const level = 3;
  if (images.length > 0) {
    blocks.push({ type: 'heading', level, text: words.images });
    blocks.push({ type: 'list', items: images.map((i) => imageItem(i, words)) });
  }
  if (ctas.length > 0) {
    blocks.push({ type: 'heading', level, text: words.ctas });
    blocks.push({ type: 'list', items: ctas.map((c) => ctaItem(c, words)) });
  }
  if (forms.length > 0) {
    blocks.push({ type: 'heading', level, text: words.forms });
    blocks.push({ type: 'note', text: words.formsReadOnly });
    for (const form of forms) blocks.push({ type: 'list', items: formItems(form, words) });
  }
  return blocks;
}

function pageBlocks(content: PageContent, language: DocumentLanguage, words: ContentWording): DocBlock[] {
  const blocks: DocBlock[] = [];
  const title = content.title && content.title.trim() !== '' ? content.title : words.noTitle;
  const description =
    content.description && content.description.trim() !== '' ? content.description : words.noDescription;
  blocks.push({ type: 'list', items: [`${words.pageTitle}: ${title}`, `${words.description}: ${description}`] });
  if (content.textTruncated) blocks.push({ type: 'note', text: words.textCut });

  const ids = new Set(content.sections.map((s) => s.id));
  for (const section of content.sections) {
    blocks.push({ type: 'heading', level: 2, text: sectionLabel(language, section) });
    blocks.push({ type: 'paragraph', text: `${words.kind}: ${words.sectionKinds[section.kind] ?? section.kind}` });
    // The Section's text exactly as it is (or as edited): never trimmed or reworded.
    const text = sectionText(content, section);
    blocks.push(text.trim() === '' ? { type: 'note', text: words.emptySection } : { type: 'paragraph', text });
    const inSection = <T extends { sectionId?: string }>(items: T[]) => items.filter((x) => x.sectionId === section.id);
    blocks.push(...elementBlocks(inSection(content.images), inSection(content.ctas), inSection(content.forms), words));
  }

  // Elements not tied to a Section of this page.
  const loose = <T extends { sectionId?: string }>(items: T[]) =>
    items.filter((x) => x.sectionId === undefined || !ids.has(x.sectionId));
  const rest = elementBlocks(loose(content.images), loose(content.ctas), loose(content.forms), words);
  if (rest.length > 0) {
    blocks.push({ type: 'heading', level: 2, text: words.elsewhereOnPage });
    blocks.push(...rest);
  }
  return blocks;
}

/** The Content document for one edited version (REQ-018, REQ-020): pages in the version's page order. */
export function buildContentDocument(view: EditedAuditView, options: ContentDocumentOptions = {}): AuditDoc {
  const lookup = labelsFor(options.language ?? view.result.language);
  const { labels } = lookup;
  const words = contentWording(lookup.language);
  const blocks: DocBlock[] = [{ type: 'paragraph', text: `${words.website}: ${view.result.url}` }];

  const byPath = new Map(view.contents.map((c) => [c.urlPath, c]));
  for (const page of view.result.pages) {
    blocks.push({ type: 'heading', level: 1, text: `${labels.columns.page}: ${page.urlPath}` });
    const content = byPath.get(page.urlPath);
    if (!content) {
      blocks.push({ type: 'note', text: words.noContent });
      continue;
    }
    blocks.push(...pageBlocks(content, lookup.language, words));
  }

  return {
    kind: 'content',
    title: labels.documentTitles.content,
    language: lookup.requested ?? lookup.language,
    blocks,
  };
}
