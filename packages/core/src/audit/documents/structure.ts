/**
 * The Structure Audit Document (REQ-018, Q-02): the page hierarchy with how each place was decided, the
 * navigation links by region, the links that leave the site, the Skipped Pages (listed as not checked,
 * never as a clean result) and what the site is built with.
 *
 * Built from the edited view only (REQ-020), so removed pages never show. No release verdict and no
 * site-wide pass or fail (ADR 0018, ADR 0029).
 */

import type { DocumentLanguage, HierarchyNode, LinkRegion, TechnologyKind } from '@qa/types';
import type { EditedAuditView } from './edits.js';
import { formatLabel, labelsFor } from './labels/index.js';
import type { AuditDoc, DocBlock } from './model.js';

/** Fixed wording only this document uses. Same keys per language; a language without a table uses English. */
interface StructureWording {
  website: string;
  pagesInDocument: string;
  placedBy: Record<HierarchyNode['placedBy'], string>;
  regions: Record<LinkRegion, string>;
  technologyKinds: Record<TechnologyKind, string>;
  onPages: string;
  status: string;
  skippedNote: string;
}

const EN: StructureWording = {
  website: 'Website',
  pagesInDocument: 'Pages in this document: {n}',
  placedBy: {
    start: 'Start page',
    menu: 'Placed by the site menu',
    breadcrumb: 'Placed by breadcrumbs',
    path: 'Placed by the address path',
  },
  regions: {
    menu: 'Menu',
    breadcrumb: 'Breadcrumbs',
    footer: 'Footer',
    internal: 'Links in the page content',
  },
  technologyKinds: {
    cms: 'Website builder or CMS',
    framework: 'Framework',
    'static-site-generator': 'Static site generator',
  },
  onPages: 'On pages',
  status: 'Status',
  skippedNote: 'These pages were found but not recorded, so nothing on them was checked.',
};

const TA: StructureWording = {
  website: 'இணையதளம்',
  pagesInDocument: 'இந்த ஆவணத்தில் உள்ள பக்கங்கள்: {n}',
  placedBy: {
    start: 'தொடக்கப் பக்கம்',
    menu: 'தள மெனுவின்படி வைக்கப்பட்டது',
    breadcrumb: 'பிரெட்க்ரம்ப் இணைப்புகளின்படி வைக்கப்பட்டது',
    path: 'முகவரிப் பாதையின்படி வைக்கப்பட்டது',
  },
  regions: {
    menu: 'மெனு',
    breadcrumb: 'பிரெட்க்ரம்ப்',
    footer: 'அடிப்பகுதி',
    internal: 'பக்க உள்ளடக்கத்தில் உள்ள இணைப்புகள்',
  },
  technologyKinds: {
    cms: 'இணையதள உருவாக்கி அல்லது CMS',
    framework: 'ஃபிரேம்வொர்க்',
    'static-site-generator': 'நிலையான தள உருவாக்கி',
  },
  onPages: 'உள்ள பக்கங்கள்',
  status: 'நிலை',
  skippedNote: 'இந்தப் பக்கங்கள் கண்டறியப்பட்டன, ஆனால் பதிவு செய்யப்படவில்லை; அவற்றில் எதுவும் சரிபார்க்கப்படவில்லை.',
};

const WORDING: Partial<Record<DocumentLanguage, StructureWording>> = { en: EN, ta: TA };

/** This document's own wording for `language` (English when the language has no table yet). */
export function structureWording(language: DocumentLanguage): StructureWording {
  return WORDING[language] ?? EN;
}

/** The order navigation regions are listed in. */
const REGION_ORDER: readonly LinkRegion[] = ['menu', 'breadcrumb', 'footer', 'internal'];

export interface StructureDocumentOptions {
  /** The language of the fixed wording; defaults to the version's language. */
  language?: DocumentLanguage;
}

/** One hierarchy line: depth marker, path, page title when it has one, and how its place was decided. */
function hierarchyItems(node: HierarchyNode, depth: number, words: StructureWording, out: string[]): void {
  // The block model has flat lists only: depth is shown with one marker per level.
  const marker = '↳ '.repeat(depth);
  const title = node.title && node.title.trim() !== '' ? ` · ${node.title}` : '';
  out.push(`${marker}${node.urlPath}${title} (${words.placedBy[node.placedBy]})`);
  for (const child of node.children) hierarchyItems(child, depth + 1, words, out);
}

/** The Structure document for one edited version (REQ-018, REQ-020). */
export function buildStructureDocument(view: EditedAuditView, options: StructureDocumentOptions = {}): AuditDoc {
  const lookup = labelsFor(options.language ?? view.result.language);
  const { labels } = lookup;
  const words = structureWording(lookup.language);
  const { result } = view;
  const blocks: DocBlock[] = [];

  blocks.push({
    type: 'paragraph',
    text: `${words.website}: ${result.url}\n${formatLabel(words.pagesInDocument, { n: result.pages.length })}`,
  });

  // Page hierarchy, start page first, children indented under their parent.
  const items: string[] = [];
  hierarchyItems(result.hierarchy.root, 0, words, items);
  blocks.push({ type: 'heading', level: 1, text: labels.headings.pageHierarchy });
  blocks.push({ type: 'list', items });

  // Navigation links, one table per region.
  blocks.push({ type: 'heading', level: 1, text: labels.headings.navigationLinks });
  const regions = REGION_ORDER.map((region) => ({
    region,
    links: result.hierarchy.links.filter((l) => l.region === region),
  })).filter((r) => r.links.length > 0);
  if (regions.length === 0) blocks.push({ type: 'paragraph', text: labels.status.noneFound });
  for (const { region, links } of regions) {
    blocks.push({ type: 'heading', level: 2, text: words.regions[region] });
    blocks.push({
      type: 'table',
      columns: [labels.columns.page, labels.columns.linkText, labels.columns.goesTo],
      rows: links.map((l) => [l.from, l.text, l.to]),
    });
  }

  // Links that leave the site: listed, never followed.
  blocks.push({ type: 'heading', level: 1, text: labels.headings.leavingSite });
  if (result.leavingSite.length === 0) {
    blocks.push({ type: 'paragraph', text: labels.status.noneFound });
  } else {
    blocks.push({
      type: 'table',
      columns: [labels.columns.goesTo, words.onPages],
      rows: result.leavingSite.map((l) => [l.to, l.from.join(', ')]),
    });
  }

  // Skipped Pages: not checked, never a clean result.
  blocks.push({ type: 'heading', level: 1, text: labels.headings.pagesNotChecked });
  if (result.coverage.skipped.length === 0) {
    blocks.push({ type: 'paragraph', text: labels.status.noneFound });
  } else {
    blocks.push({ type: 'paragraph', text: words.skippedNote });
    blocks.push({
      type: 'table',
      columns: [labels.columns.page, labels.columns.reason, words.status],
      rows: result.coverage.skipped.map((s) => [
        s.urlPath,
        labels.skipReasons[s.why] ?? s.why,
        labels.status.notChecked,
      ]),
    });
  }

  // What the site is built with: named, or "not identified", never left blank (REQ-010 AC-2).
  blocks.push({ type: 'heading', level: 1, text: labels.headings.technology });
  if (result.technology.status === 'identified' && result.technology.technologies.length > 0) {
    blocks.push({
      type: 'list',
      items: result.technology.technologies.map((t) => `${t.name} · ${words.technologyKinds[t.kind] ?? t.kind}`),
    });
  } else {
    blocks.push({ type: 'paragraph', text: labels.status.notIdentified });
  }

  return {
    kind: 'structure',
    title: labels.documentTitles.structure,
    language: lookup.requested,
    blocks,
  };
}
