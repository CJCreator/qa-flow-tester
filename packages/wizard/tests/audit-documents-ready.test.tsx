import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditVersion, StoredAuditDocument } from '@qa/types/src/browser.js';
import {
  ALL_STORED_DOCUMENT_KINDS,
  DOCUMENT_TITLES,
  DocumentsReady,
} from '../src/screens/audit/results/DocumentsReady';

const AUDIT_ID = 'audit_ready_123';
const VERSION_NUM = 2;

const READY_DOCUMENTS: StoredAuditDocument[] = [
  {
    kind: 'structure',
    status: 'ready',
    title: 'Structure',
    formats: ['markdown', 'html'],
    updatedAt: '2026-11-01T10:05:00.000Z',
  },
  {
    kind: 'content',
    status: 'ready',
    title: 'Content',
    formats: ['markdown', 'html'],
    updatedAt: '2026-11-01T10:05:00.000Z',
  },
  {
    kind: 'findings',
    status: 'ready',
    title: 'Findings',
    formats: ['markdown', 'html'],
    updatedAt: '2026-11-01T10:05:00.000Z',
  },
  {
    kind: 'roadmap',
    status: 'ready',
    title: 'Improvement Roadmap',
    formats: ['markdown', 'html'],
    updatedAt: '2026-11-01T10:05:00.000Z',
  },
  {
    kind: 'proposal',
    status: 'not-written',
    title: 'Proposal',
    reason: 'Proposal template not configured in Settings.',
  },
  {
    kind: 'pitch-glimpse',
    status: 'ready',
    title: 'Pitch Glimpse',
    formats: ['markdown', 'html'],
    updatedAt: '2026-11-01T10:05:00.000Z',
  },
  {
    kind: 'owner-audit',
    status: 'ready',
    title: 'Website Audit',
    formats: ['markdown', 'html'],
    updatedAt: '2026-11-01T10:05:00.000Z',
  },
];

function sampleVersion(documents?: StoredAuditDocument[]): AuditVersion {
  return {
    auditId: AUDIT_ID,
    version: VERSION_NUM,
    url: 'https://example.com/',
    limits: { maxPages: 50, maxDepth: 5, includePaths: [], excludePaths: [] },
    language: 'en',
    status: 'done',
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:05:00.000Z',
    documents,
  };
}

function renderDocs(version: AuditVersion) {
  return renderToStaticMarkup(createElement(DocumentsReady, { version, auditId: version.auditId }));
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

describe('DocumentsReady component (T-88, ADR 0042)', () => {
  it('renders the section title with id="audit-documents-title"', () => {
    const html = renderDocs(sampleVersion(READY_DOCUMENTS));
    expect(html).toContain('id="audit-documents-title"');
    expect(textOf(html)).toContain('Audit Documents ready');
    expect(textOf(html)).toContain('The 5 Audit Documents, the Pitch Glimpse and the Owner Audit');
    expect(textOf(html)).not.toContain('The 7 documents');
  });

  it('lists all 7 document kinds', () => {
    const html = renderDocs(sampleVersion(READY_DOCUMENTS));
    for (const kind of ALL_STORED_DOCUMENT_KINDS) {
      expect(html).toContain(`data-document-kind="${kind}"`);
    }
    const text = textOf(html);
    expect(text).toContain('Structure');
    expect(text).toContain('Content');
    expect(text).toContain('Findings');
    expect(text).toContain('Improvement Roadmap');
    expect(text).toContain('Proposal');
    expect(text).toContain('Pitch Glimpse');
    expect(text).toContain('Website Audit');
  });

  it('displays state and Open link for ready documents', () => {
    const html = renderDocs(sampleVersion(READY_DOCUMENTS));
    expect(html).toContain('data-document-status="ready"');
    const text = textOf(html);
    expect(text).toContain('Ready');
    expect(html).toContain(`/audits/${AUDIT_ID}/versions/${VERSION_NUM}/review`);
    expect(text).toContain('Open');
  });

  it('displays state and reason for not-written documents', () => {
    const html = renderDocs(sampleVersion(READY_DOCUMENTS));
    expect(html).toContain('data-document-status="not-written"');
    const text = textOf(html);
    expect(text).toContain('Not written');
    expect(text).toContain('Proposal template not configured in Settings.');
  });

  it('provides a Download all link to the download tab export', () => {
    const html = renderDocs(sampleVersion(READY_DOCUMENTS));
    expect(html).toContain(`/audits/${AUDIT_ID}/versions/${VERSION_NUM}/export`);
    expect(textOf(html)).toContain('Download all');
  });

  it('handles version with undefined documents gracefully', () => {
    const html = renderDocs(sampleVersion(undefined));
    const text = textOf(html);
    expect(text).toContain('Audit Documents ready');
    for (const kind of ALL_STORED_DOCUMENT_KINDS) {
      expect(html).toContain(`data-document-kind="${kind}"`);
      expect(text).toContain(DOCUMENT_TITLES[kind]);
    }
    expect(text).toContain('Not written');
  });

  it('conforms to ADR 0018 claim wording (never compliant, never secure)', () => {
    const source = readFileSync(new URL('../src/screens/audit/results/DocumentsReady.tsx', import.meta.url), 'utf8');
    const CLAIM_WORDS = /\b(compliant|compliance|certified|secure|safe|hack-proof|passes WCAG|fully accessible)\b/i;
    expect(source).not.toMatch(CLAIM_WORDS);

    const rendered = textOf(renderDocs(sampleVersion(READY_DOCUMENTS)));
    expect(rendered).not.toMatch(CLAIM_WORDS);
  });

  it('imports @qa/types only through @qa/types/src/browser.js', () => {
    for (const file of ['../src/screens/audit/results/DocumentsReady.tsx', './audit-documents-ready.test.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const specifiers = [...source.matchAll(/from '(@qa\/types[^']*)'/g)].map((m) => m[1]);
      expect(specifiers.length, file).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(specifier, file).toBe('@qa/types/src/browser.js');
      }
    }
  });
});
