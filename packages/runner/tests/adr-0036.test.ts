import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Docs contract for ADR 0036 (REQ-050, DEC-003, D-003 / Q-50, Q-30).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const adrDir = path.join(root, 'docs', 'adr');
const adrName = readdirSync(adrDir).find((f) => /^0036-.*\.md$/.test(f));
const adr = adrName ? readFileSync(path.join(adrDir, adrName), 'utf8') : '';
const adr0032 = readFileSync(path.join(adrDir, '0032-google-cloud-only-hosting.md'), 'utf8');

/** Text of one `## Heading` section, up to the next `## `. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + 4);
  return next < 0 ? text.slice(start) : text.slice(start, next);
}

describe('ADR 0036: hosted Website Audit storage and Shared Links', () => {
  it('exists as docs/adr/0036-*.md with a title', () => {
    expect(adrName).toBe('0036-hosted-audit-storage-and-shared-links.md');
    expect(adr).toMatch(/^# 0036: /);
  });

  it('is Accepted with the D-003 answer and its date (AC-1)', () => {
    const status = adr.split('\n').find((l) => l.startsWith('Status:')) ?? '';
    expect(status).toMatch(/^Status: Accepted, \d{4}-\d{2}-\d{2}/);
    expect(status).toContain('D-003');
    expect(status).toContain('Q-50');
    expect(status).toMatch(/adopt/i);
    expect(status).toContain('2026-11-03');
  });

  it('has the ADR sections: Context, Decision, Consequences, Alternatives', () => {
    for (const h of ['Context', 'Decision', 'Consequences', 'Alternatives considered']) {
      expect(section(adr, h), h).not.toBe('');
    }
  });

  it('states where hosted Website Audit data lives and who can reach it (AC-1)', () => {
    const d = section(adr, 'Decision');
    expect(d).toMatch(/Cloud Storage/);
    expect(d).toMatch(/always-free/);
    expect(d).toMatch(/one folder per Website Audit/);
    expect(d).toMatch(/Local runs/);
    expect(d).toMatch(/data folder/);
    expect(d).toMatch(/service account/);
    expect(d).toMatch(/public access prevention/i);
    expect(d).toContain('AUDIT_STORE_BUCKET');
  });

  it('keeps data until the tool user deletes the Website Audit, and deletion removes everything (AC-3, Q-30)', () => {
    const d = section(adr, 'Decision');
    expect(d).toMatch(/kept until the tool user deletes (that|the) Website Audit/);
    expect(d).toMatch(/Deleting a Website Audit removes all its data/);
    for (const part of [
      'every version',
      'every edit',
      'every file',
      'Shortlist entry',
      'every Shared Link',
      'every Helper grant',
    ]) {
      expect(d, part).toContain(part);
    }
    expect(d).toMatch(/soft delete off/);
  });

  it('Shared Links expire after 30 days and can be revoked (AC-3, Q-30)', () => {
    const d = section(adr, 'Decision');
    expect(d).toMatch(/expires 30 days after/);
    expect(d).toMatch(/revoke/);
    expect(d).toMatch(/unguessable/);
  });

  it('states how /s/:linkId is served (AC-1)', () => {
    const d = section(adr, 'Decision');
    expect(d).toContain('/s/:linkId');
    expect(d).toMatch(/runner serves it/);
    expect(d).toMatch(/route table/);
    expect(d).toContain('BE-102');
    expect(d).toMatch(/access level `public`/);
    expect(d).toMatch(/noindex/);
    expect(d).toMatch(/Content-Security-Policy/);
    expect(d).toMatch(/default-src 'none'/);
    expect(d).toMatch(/410/);
    expect(d).toMatch(/expired or revoked/);
    expect(d).toMatch(/reads only the shared snapshot/);
  });

  it('records the $0 hosting trade-off against /tmp data loss (AR-09) and the Q-39 tension (Q-50)', () => {
    expect(adr).toMatch(/\$0 hosting/);
    expect(adr).toContain('/tmp');
    expect(adr).toContain('AR-09');
    expect(adr).toContain('Q-39');
    expect(adr).toContain('Q-50');
    expect(section(adr, 'Consequences')).toMatch(/scale to zero/);
  });

  it('names ADR 0032 as amended, and ADR 0032 links back', () => {
    const status = adr.split('\n').find((l) => l.startsWith('Status:')) ?? '';
    expect(status).toMatch(/Amends \[0032\]\(0032-google-cloud-only-hosting\.md\)/);
    expect(adr0032).toMatch(/Amended by \[0036\]\(0036-hosted-audit-storage-and-shared-links\.md\)/);
  });

  it('uses the CONTEXT.md terms and none of their Avoid words', () => {
    for (const term of ['Website Audit', 'Shared Link', 'Helper', 'Shortlist']) {
      expect(adr, term).toContain(term);
    }
    const avoid = [
      'public link',
      'permalink',
      'share url',
      'published report', // Shared Link
      'leads',
      'pipeline',
      'crm',
      'prospect list', // Shortlist
      'collaborator',
      'team member', // Helper
      'site review',
      'teardown',
      'scrape', // Website Audit, Page Content
    ];
    const lower = adr.toLowerCase();
    for (const word of avoid) {
      expect(new RegExp(`\\b${word}\\b`).test(lower), word).toBe(false);
    }
  });
});
