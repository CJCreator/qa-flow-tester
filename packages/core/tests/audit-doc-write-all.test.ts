import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { AuditRequest, AuditSettings } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend, auditDocPath, STORED_DOCUMENT_KINDS } from '../src/audit/store/index.js';
import {
  writeAllDocuments,
  emptyAuditSettings,
  renderHtml,
  renderMarkdown,
  type StoredDocumentKind,
} from '../src/audit/documents/index.js';
import { auditDocContents, auditDocResult } from './helpers/audit-doc-fixture.js';

let dir: string;
let backend: LocalAuditStoreBackend;
let store: AuditStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-write-all-'));
  backend = new LocalAuditStoreBackend(dir);
  store = new AuditStore(backend);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('writeAllDocuments (T-83, ADR 0042)', () => {
  it('writes all 7 Audit Documents in Markdown and HTML from the fixture', async () => {
    const fixtureResult = auditDocResult();
    const contents = auditDocContents();
    const settings = emptyAuditSettings();

    // Create the audit version in store
    const request: AuditRequest = {
      url: fixtureResult.url,
      limits: fixtureResult.limits,
      language: fixtureResult.language,
    };
    const v1 = await store.createAudit(request);
    const result = { ...fixtureResult, auditId: v1.auditId, version: 1 };

    const docs = await writeAllDocuments(result, settings, store, { contents });

    // Returns all 7 documents in fixed order
    expect(docs).toHaveLength(7);
    expect(docs.map((d) => d.kind)).toEqual([
      'structure',
      'content',
      'findings',
      'roadmap',
      'proposal',
      'pitch-glimpse',
      'owner-audit',
    ]);

    // All documents are ready with markdown and html formats
    for (const doc of docs) {
      expect(doc.status).toBe('ready');
      if (doc.status === 'ready') {
        expect(doc.formats).toEqual(['markdown', 'html']);
        expect(doc.title).toBeTruthy();
        expect(typeof doc.updatedAt).toBe('string');
        expect(Number.isNaN(Date.parse(doc.updatedAt))).toBe(false);
      }
    }

    // Check titles
    const titles = Object.fromEntries(docs.map((d) => [d.kind, d.title]));
    expect(titles.structure).toBe('Structure');
    expect(titles.content).toBe('Content');
    expect(titles.findings).toBe('Findings');
    expect(titles.roadmap).toBe('Improvement Roadmap');
    expect(titles.proposal).toBe('Website proposal for https://shop.example.in/');
    expect(titles['pitch-glimpse']).toBe('Top issues found on your website');
    expect(titles['owner-audit']).toBe('Website Audit');

    // Verify each document is stored and readable from store backend
    for (const kind of STORED_DOCUMENT_KINDS) {
      const md = await store.readAuditDocument(v1.auditId, 1, kind, 'markdown');
      expect(typeof md, `${kind} markdown`).toBe('string');
      expect(md!.length, `${kind} markdown length`).toBeGreaterThan(10);
      expect(md!, `${kind} starts with heading`).toMatch(/^# /);

      const html = await store.readAuditDocument(v1.auditId, 1, kind, 'html');
      expect(typeof html, `${kind} html`).toBe('string');
      expect(html!.length, `${kind} html length`).toBeGreaterThan(50);
      expect(html!, `${kind} is doctype html`).toContain('<!DOCTYPE html>');
    }

    // Verify PDF and Word are NOT written (stay on export only)
    const storedKeys = await backend.list('');
    for (const key of storedKeys) {
      expect(key).not.toMatch(/\.pdf$/);
      expect(key).not.toMatch(/\.docx$/);
    }

    // Verify documents metadata was recorded on the version in store
    const versionRecord = await store.getVersion(v1.auditId, 1);
    expect(versionRecord?.documents).toHaveLength(7);
    expect(versionRecord?.documents?.[0]).toMatchObject({ kind: 'structure', status: 'ready' });
  });

  it('marks a document as not-written when its HTML renderer fails, leaving other documents written', async () => {
    const fixtureResult = auditDocResult();
    const contents = auditDocContents();
    const settings = emptyAuditSettings();

    const request: AuditRequest = {
      url: fixtureResult.url,
      limits: fixtureResult.limits,
      language: fixtureResult.language,
    };
    const v1 = await store.createAudit(request);
    const result = { ...fixtureResult, auditId: v1.auditId, version: 1 };

    // Inject a failure only for findings HTML
    const docs = await writeAllDocuments(result, settings, store, {
      contents,
      renderHtml: (doc) => {
        if (doc.kind === 'findings') throw new Error('Findings HTML render exploded');
        return renderHtml(doc);
      },
    });

    expect(docs).toHaveLength(7);

    // Findings is marked not-written with the error reason
    const findingsDoc = docs.find((d) => d.kind === 'findings')!;
    expect(findingsDoc).toMatchObject({
      kind: 'findings',
      status: 'not-written',
      title: 'Findings',
      reason: 'Findings HTML render exploded',
    });

    // The other 6 documents were written successfully
    const otherDocs = docs.filter((d) => d.kind !== 'findings');
    expect(otherDocs).toHaveLength(6);
    for (const doc of otherDocs) {
      expect(doc.status).toBe('ready');
      if (doc.status === 'ready') {
        expect(doc.formats).toEqual(['markdown', 'html']);
      }
    }

    // The other 6 documents are present in store
    for (const doc of otherDocs) {
      const md = await store.readAuditDocument(v1.auditId, 1, doc.kind, 'markdown');
      const html = await store.readAuditDocument(v1.auditId, 1, doc.kind, 'html');
      expect(md).toBeTruthy();
      expect(html).toBeTruthy();
    }

    // Findings HTML was not written to store
    const findingsHtml = await store.readAuditDocument(v1.auditId, 1, 'findings', 'html');
    expect(findingsHtml).toBeNull();
  });

  it('marks a document as not-written when its Markdown renderer fails, leaving other documents written', async () => {
    const fixtureResult = auditDocResult();
    const contents = auditDocContents();
    const settings = emptyAuditSettings();

    const request: AuditRequest = {
      url: fixtureResult.url,
      limits: fixtureResult.limits,
      language: fixtureResult.language,
    };
    const v1 = await store.createAudit(request);
    const result = { ...fixtureResult, auditId: v1.auditId, version: 1 };

    // Inject a failure only for proposal Markdown
    const docs = await writeAllDocuments(result, settings, store, {
      contents,
      renderMarkdown: (doc) => {
        if (doc.kind === 'proposal') throw new Error('Proposal Markdown render failed');
        return renderMarkdown(doc);
      },
    });

    const proposalDoc = docs.find((d) => d.kind === 'proposal')!;
    expect(proposalDoc).toMatchObject({
      kind: 'proposal',
      status: 'not-written',
      title: 'Website proposal for https://shop.example.in/',
      reason: 'Proposal Markdown render failed',
    });

    const others = docs.filter((d) => d.kind !== 'proposal');
    for (const doc of others) {
      expect(doc.status).toBe('ready');
    }
  });

  it('performs store save and read round trips on the local backend', async () => {
    const request: AuditRequest = {
      url: 'https://example.com/',
      limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
      language: 'en',
    };
    const v1 = await store.createAudit(request);
    const auditId = v1.auditId;

    const mdContent = '# My Structure\n\nContent here.';
    const htmlContent = '<!DOCTYPE html><html><body><h1>My Structure</h1></body></html>';

    await store.saveAuditDocument(auditId, 1, 'structure', 'markdown', mdContent);
    await store.saveAuditDocument(auditId, 1, 'structure', 'html', htmlContent);

    expect(await store.readAuditDocument(auditId, 1, 'structure', 'markdown')).toBe(mdContent);
    expect(await store.readAuditDocument(auditId, 1, 'structure', 'html')).toBe(htmlContent);

    // Reading an unwritten document returns null
    expect(await store.readAuditDocument(auditId, 1, 'proposal', 'markdown')).toBeNull();
    expect(await store.readAuditDocument(auditId, 1, 'proposal', 'html')).toBeNull();

    // Round trip preserves Tamil Unicode text
    const tamilMd = '# இணையதளத் தணிக்கை\n\nவிவரங்கள் இங்கே.';
    await store.saveAuditDocument(auditId, 1, 'owner-audit', 'markdown', tamilMd);
    expect(await store.readAuditDocument(auditId, 1, 'owner-audit', 'markdown')).toBe(tamilMd);

    // Path key verification
    expect(auditDocPath(auditId, 1, 'owner-audit', 'markdown')).toBe(`audits/${auditId}/v1/docs/owner-audit.md`);
    expect(auditDocPath(auditId, 1, 'owner-audit', 'html')).toBe(`audits/${auditId}/v1/docs/owner-audit.html`);
  });

  it('writes documents in Tamil when requested', async () => {
    const fixtureResult = auditDocResult();
    const contents = auditDocContents();
    const settings = emptyAuditSettings();

    const request: AuditRequest = {
      url: fixtureResult.url,
      limits: fixtureResult.limits,
      language: 'ta',
    };
    const v1 = await store.createAudit(request);
    const result = { ...fixtureResult, auditId: v1.auditId, version: 1, language: 'ta' as const };

    const docs = await writeAllDocuments(result, settings, store, { contents, language: 'ta' });

    expect(docs).toHaveLength(7);
    for (const doc of docs) {
      expect(doc.status).toBe('ready');
    }

    const structureHtml = await store.readAuditDocument(v1.auditId, 1, 'structure', 'html');
    expect(structureHtml).toContain('lang="ta"');

    const structureMd = await store.readAuditDocument(v1.auditId, 1, 'structure', 'markdown');
    expect(structureMd).toContain('கட்டமைப்பு');
  });

  it('reads contents and edits from the store when not passed directly in options', async () => {
    const fixtureResult = auditDocResult();
    const contents = auditDocContents();
    const settings = emptyAuditSettings();

    const request: AuditRequest = {
      url: fixtureResult.url,
      limits: fixtureResult.limits,
      language: fixtureResult.language,
    };
    const v1 = await store.createAudit(request);
    const result = { ...fixtureResult, auditId: v1.auditId, version: 1 };

    // Save one page content in store
    await store.writeVersionJson(v1.auditId, 1, 'pages/home-3b2d135d', contents[0]);

    // Call without contents option: loads what is in store and handles the rest gracefully
    const docs = await writeAllDocuments(result, settings, store);

    expect(docs).toHaveLength(7);
    for (const doc of docs) {
      expect(doc.status).toBe('ready');
    }
  });

  it('deleting the audit removes all stored documents', async () => {
    const fixtureResult = auditDocResult();
    const contents = auditDocContents();
    const settings = emptyAuditSettings();

    const v1 = await store.createAudit({
      url: fixtureResult.url,
      limits: fixtureResult.limits,
      language: fixtureResult.language,
    });
    const result = { ...fixtureResult, auditId: v1.auditId, version: 1 };

    await writeAllDocuments(result, settings, store, { contents });

    // Documents exist
    expect(await store.readAuditDocument(v1.auditId, 1, 'structure', 'markdown')).toBeTruthy();

    // Delete audit
    await store.deleteAudit(v1.auditId);

    // Documents are gone
    expect(await store.readAuditDocument(v1.auditId, 1, 'structure', 'markdown')).toBeNull();
  });
});
