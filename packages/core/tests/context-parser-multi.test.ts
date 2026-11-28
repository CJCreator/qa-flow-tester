import { describe, it, expect } from 'vitest';
import { isSupportedContextName } from '@qa/types';
import { ContextParser } from '../src/discovery/context-parser.js';

describe('ContextParser.parseDocuments', () => {
  const docs = [
    {
      name: 'admin-guide.md',
      text: '# Admin\nIntro line\n## Users\n- Admin can create a user\n## Billing\n- Invoices list',
    },
    { name: 'product.txt', text: '# Profile\n- Anyone can edit their name' },
  ];

  it('keeps document and heading path on every hint, ids unique across files', () => {
    const out = new ContextParser().parseDocuments(docs);
    expect(out.requirements.map((r) => r.id)).toEqual(['REQ-1', 'REQ-2', 'REQ-3', 'REQ-4']);
    const users = out.requirements.find((r) => r.name === 'Users');
    expect(users).toMatchObject({
      document: 'admin-guide.md',
      section: 'Admin > Users',
      rules: ['Admin can create a user'],
    });
    expect(out.requirements.find((r) => r.name === 'Billing')?.section).toBe('Admin > Billing');
    expect(out.requirements.find((r) => r.name === 'Profile')).toMatchObject({
      document: 'product.txt',
      section: 'Profile',
    });
    expect(out.rawContent).toContain('# Document: admin-guide.md');
    expect(out.rawContent).toContain('# Document: product.txt');
  });

  it('empty list gives no requirements', () => {
    expect(new ContextParser().parseDocuments([]).requirements).toEqual([]);
  });

  it('parseContent is unchanged: no document or section', () => {
    const r = new ContextParser().parseContent('# A\n- x').requirements[0];
    expect(r.document).toBeUndefined();
    expect(r.section).toBeUndefined();
  });
});

describe('description', () => {
  it('is the first prose line, or empty (parseDocuments and parseContent)', () => {
    const text = '# A\n- a rule\nProse here\n# B\n- only rule';
    const multi = new ContextParser().parseDocuments([{ name: 'x.md', text }]).requirements;
    expect(multi.map((r) => r.description)).toEqual(['Prose here', '']);
    const single = new ContextParser().parseContent(text).requirements;
    expect(single.map((r) => r.description)).toEqual(['Prose here', '']);
  });
});

describe('isSupportedContextName', () => {
  it('accepts md, markdown, txt, docx', () => {
    for (const n of ['a.md', 'B.MD', 'x.markdown', 'notes.txt', 'spec.docx', 'S.DOCX']) {
      expect(isSupportedContextName(n)).toEqual({ ok: true });
    }
  });
  it('rejects pdf and doc with a plain message', () => {
    for (const n of ['a.pdf', 'c.DOC']) {
      expect(isSupportedContextName(n)).toEqual({
        ok: false,
        message: 'PDF and old .doc files are not supported. Save as .docx, .md or .txt.',
      });
    }
  });
  it('rejects other types and no extension', () => {
    expect(isSupportedContextName('a.exe').ok).toBe(false);
    expect(isSupportedContextName('README').ok).toBe(false);
  });
});
