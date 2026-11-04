/**
 * The Audit Documents barrel: the public API for edits, the Improvement Roadmap, document generation and
 * export, the Pitch Glimpse, the Owner Audit, the audit settings and the renderers. Re-exported from the core
 * barrel (BE-190).
 *
 * Node-only: the export path uses `node:zlib` (zip, Word) and Playwright (PDF). The wizard never imports it.
 *
 * `wording.ts` is not re-exported: its claim-word list has the same names as `audit/ai/claim-words.ts`,
 * which the core barrel already owns. Import it directly when needed.
 */

export * from './model.js';
export * from './edits.js';
export * from './roadmap.js';
export * from './settings.js';
export * from './labels/index.js';
export * from './structure.js';
export * from './content.js';
export * from './findings.js';
export * from './roadmap-document.js';
export * from './proposal.js';
export * from './pitch.js';
export * from './owner-audit.js';
export * from './generate.js';
export * from './site-json.js';
export * from './bundle.js';
export * from './render-markdown.js';
export * from './render-html.js';
export * from './render-docx.js';
export * from './render-pdf.js';
export * from './zip.js';
