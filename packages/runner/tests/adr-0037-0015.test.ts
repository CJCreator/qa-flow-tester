import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Docs contract for ADR 0037 (REQ-048 AC-7, DEC-001, D-004 / Q-51, D-005 / Q-55) and ADR 0015 (REQ-035, Q-12).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const adrDir = path.join(root, 'docs', 'adr');
const adrName = readdirSync(adrDir).find((f) => /^0037-.*\.md$/.test(f));
const adr = adrName ? readFileSync(path.join(adrDir, adrName), 'utf8') : '';
const adr0015 = readFileSync(path.join(adrDir, '0015-live-site-request-rules.md'), 'utf8');
const auditTypes = readFileSync(path.join(root, 'packages', 'types', 'src', 'website-audit.ts'), 'utf8');

/** Text of one `## Heading` section, up to the next `## `. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + 4);
  return next < 0 ? text.slice(start) : text.slice(start, next);
}

function statusLine(text: string): string {
  return text.split('\n').find((l) => l.startsWith('Status:')) ?? '';
}

const AVOID = [
  'public link', 'permalink', 'share url', 'published report', // Shared Link
  'collaborator', 'team member', // Helper
  'site review', 'teardown', 'scrape', // Website Audit, Page Content
];

function expectNoAvoidWords(text: string): void {
  const lower = text.toLowerCase();
  for (const word of AVOID) {
    expect(new RegExp(`\\b${word}\\b`).test(lower), word).toBe(false);
  }
}

describe('ADR 0037: route access levels, owner / Helper / public, beta policy', () => {
  it('exists as docs/adr/0037-route-access-levels.md with a title', () => {
    expect(adrName).toBe('0037-route-access-levels.md');
    expect(adr).toMatch(/^# 0037: /);
  });

  it('is Accepted with DEC-001 and the D-004 / Q-51 and D-005 / Q-55 answers', () => {
    const status = statusLine(adr);
    expect(status).toMatch(/^Status: Accepted, \d{4}-\d{2}-\d{2}/);
    for (const ref of ['DEC-001', 'D-004', 'Q-51', 'closed-default', 'D-005', 'Q-55', 'allow-helpers', '2026-11-03']) {
      expect(status, ref).toContain(ref);
    }
  });

  it('links ADR 0027, 0033 and 0036', () => {
    expect(adr).toContain('](0027-checkup-session-module-and-route-table.md)');
    expect(adr).toContain('](0033-website-audit-entry-point.md)');
    expect(adr).toContain('](0036-hosted-audit-storage-and-shared-links.md)');
    for (const f of [
      '0027-checkup-session-module-and-route-table.md',
      '0033-website-audit-entry-point.md',
      '0036-hosted-audit-storage-and-shared-links.md',
    ]) {
      expect(readdirSync(adrDir), f).toContain(f);
    }
  });

  it('has the ADR sections: Context, Decision, Consequences, Alternatives', () => {
    for (const h of ['Context', 'Decision', 'Consequences', 'Alternatives considered']) {
      expect(section(adr, h), h).not.toBe('');
    }
  });

  it('lists the six access levels, exactly those of AuditAccess in AUDIT_API (AC-7)', () => {
    const m = auditTypes.match(/export type AuditAccess = ([^;]+);/);
    expect(m).not.toBeNull();
    const levels = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(levels.sort()).toEqual(['edit', 'export', 'owner', 'public', 'sign-in', 'view']);
    const d = section(adr, 'Decision');
    for (const level of levels) {
      expect(d, level).toContain(`\`${level}\``);
    }
    expect(d).toContain('AUDIT_API');
    expect(d).toMatch(/route table/);
  });

  it('records the owner, Helper and public model (AC-7)', () => {
    const d = section(adr, 'Decision');
    expect(d).toMatch(/\*\*Owner\*\* is the tool user/);
    expect(d).toMatch(/access key/);
    expect(d).toMatch(/Helper[^.]*`view`, `edit` and `export` per Website Audit/);
    expect(d).toMatch(/A Helper never passes an `owner` row/);
    expect(d).toContain('REQ-033');
    expect(d).toMatch(/only `public` rows are Shared Links/);
    expect(d).toContain('/s/:linkId');
  });

  it('is closed by default: a route without a declared access level is refused (AC-7)', () => {
    const d = section(adr, 'Decision');
    expect(d).toMatch(/\*\*Closed by default\.\*\*/);
    expect(d).toMatch(/no declared `access`[^.]*is refused at dispatch/);
    expect(d).toContain('matchRoute');
  });

  it('states the beta policy: closed by default, public Shared Links open (D-004) and Helpers allowed (D-005)', () => {
    const d = section(adr, 'Decision');
    expect(d).toContain('RUNNER_BETA=1');
    expect(d).toMatch(/beta visitors reach only `public` Shared Link routes/);
    expect(d).toMatch(/Helper `sign-in` routes/);
    expect(d).toMatch(/valid Helper session[^.]*pass the beta policy/);
    expect(d).toMatch(/Every other audit route stays closed in beta/);
  });

  it('places Helper sign-in here and leaves token verification to the REQ-033 task', () => {
    const d = section(adr, 'Decision');
    expect(d).toMatch(/follow-up 0037 \(Helper sign-in\)/);
    expect(d).toMatch(/Google ID token verification/);
    expect(d).toMatch(/extends this record rather than writing another 0037/);
  });

  it('uses the CONTEXT.md terms and none of their Avoid words', () => {
    for (const term of ['Helper', 'Shared Link', 'Website Audit']) {
      expect(adr, term).toContain(term);
    }
    expectNoAvoidWords(adr);
  });
});

describe('ADR 0015: Accepted for pacing only (Q-12)', () => {
  it('Status is Accepted for pacing, citing Q-12 and ADR 0033', () => {
    const status = statusLine(adr0015);
    expect(status).toMatch(/^Status: Accepted for pacing only, \d{4}-\d{2}-\d{2}/);
    expect(status).toContain('Q-12');
    expect(status).toContain('](0033-website-audit-entry-point.md)');
    expect(status).not.toMatch(/Deferred/);
  });

  it('decides one request at a time per host and honours robots.txt Crawl-delay', () => {
    const d = section(adr0015, 'Decision');
    expect(d).toMatch(/\*\*Pacing \(accepted\)\.\*\*/);
    expect(d).toMatch(/One request at a time per host/);
    expect(d).toMatch(/robots\.txt Crawl-delay is honoured/);
    expect(d).toContain('BE-105');
  });

  it('leaves GraphQL query POSTs and GET/HEAD replay undecided, Safety Filter unchanged', () => {
    const status = statusLine(adr0015);
    expect(status).toMatch(/GraphQL[^.]*GET\/HEAD replay[^.]*undecided/);
    const d = section(adr0015, 'Decision');
    expect(d).toMatch(/\*\*GraphQL query POSTs \(undecided\)\.\*\*/);
    expect(d).toMatch(/\*\*GET\/HEAD replay \(undecided\)\.\*\*/);
    expect(d).toMatch(/Safety Filter rules apply unchanged/);
    expect(section(adr0015, 'Consequences')).toMatch(/Before any POST is allowed on a live site/);
  });

  it('uses the CONTEXT.md terms and none of their Avoid words', () => {
    expect(adr0015).toContain('Website Audit');
    expectNoAvoidWords(adr0015);
  });
});
