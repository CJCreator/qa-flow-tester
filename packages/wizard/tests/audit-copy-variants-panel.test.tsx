import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditFinding, RewriteState } from '@qa/types/src/browser.js';
import { CopyVariantsView, suggestedSections } from '../src/screens/audit/improved/CopyVariantsPanel';
import { writeDrafts } from '../src/screens/audit/ai/rewrite-api';

function finding(n: number, sectionId: string | null): AuditFinding {
  return {
    id: `AF-00${n}`,
    rule: 'ctas',
    group: 'marketing',
    area: 'marketing',
    title: `F${n}`,
    detail: '',
    suggestion: '',
    impact: 'high',
    effort: 'low',
    urlPath: '/',
    sectionId,
    source: 'rule',
  };
}

describe('copy variants on the Improved version screen', () => {
  it('suggests the Sections the top findings point at, each once', () => {
    const got = suggestedSections([finding(1, 's1'), finding(2, null), finding(3, 's1'), finding(4, 's2')]);
    expect(got).toEqual([
      { urlPath: '/', sectionId: 's1', findingIds: ['AF-001', 'AF-003'] },
      { urlPath: '/', sectionId: 's2', findingIds: ['AF-004'] },
    ]);
  });

  it('shows both drafts of an approved Section and the request count', () => {
    const state: RewriteState = {
      urlPath: '/',
      sectionId: 's1',
      approvedAt: '2026-11-19T10:00:00.000Z',
      acceptedAt: null,
      proposal: {
        text: 'Draft one',
        language: 'en',
        overlaps: [],
        createdAt: '2026-11-19T10:00:00.000Z',
        variants: [
          { text: 'Draft one', overlaps: [] },
          { text: 'Draft two', overlaps: [{ words: 'a b c d e f', wordCount: 6 }] },
        ],
      },
    };
    const html = renderToStaticMarkup(
      createElement(CopyVariantsView, {
        sections: suggestedSections([finding(1, 's1'), finding(2, 's2')]),
        rewrites: new Map([['/\ns1', state]]),
        ticked: new Set(['/\ns2']),
        busy: null,
        message: null,
        aiReady: true,
        onTick: () => {},
        onApprove: () => {},
        onWrite: () => {},
        onAccept: () => {},
      })
    );
    expect(html).toContain('Draft two');
    expect(html).toContain('Accept draft 2');
    expect(html).toContain('reword before accepting');
    expect(html).toContain('Approve these Sections');
    expect(html).toContain('1 approved Section(s): 1 AI request(s).');
  });

  it('writeDrafts posts the Sections as one batch', async () => {
    let sent: unknown;
    const got = await writeDrafts(
      'audit_1',
      { version: 1, sections: [{ urlPath: '/', sectionId: 's1' }] },
      async (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ rewrites: [], failures: [] }), { status: 200 });
      }
    );
    expect(sent).toEqual({ version: 1, sections: [{ urlPath: '/', sectionId: 's1' }] });
    expect(got).toEqual({ ok: true, value: { rewrites: [], failures: [] } });
  });
});
