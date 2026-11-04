import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INTENT_HINTS, INTENT_LABELS } from '../src/lib/intent-view';

const BANNED = /negative test|positive test|happy path|categor(y|ies)/i;

const CLAIM_WORDS = /\b(compliant|compliance|certified|secure|safe|hack-proof|passes WCAG|fully accessible)\b/i;

const AUDIT_UI_FILES = [
  'audit/results/AuditSummary.tsx',
  'audit/results/SiteAreasView.tsx',
  'audit/results/RoadmapView.tsx',
  'audit/results/analysis-text.ts',
  'audit/results/FindingsList.tsx',
  'audit/documents/ExportDocumentsScreen.tsx',
  'audit/documents/ReviewDocumentsScreen.tsx',
  'audit/documents/DocumentSettingsScreen.tsx',
  'audit/BetaAuditNotice.tsx',
];

describe('Claim wording in the Website Audit screens (ADR 0018)', () => {
  it('uses no claim words', () => {
    for (const file of AUDIT_UI_FILES) {
      const source = readFileSync(new URL(`../src/screens/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(CLAIM_WORDS);
    }
  });
});

describe('Intent wording', () => {
  it('uses no banned terms in labels, hints or the Plan Review sources', () => {
    for (const text of [...Object.values(INTENT_LABELS), ...Object.values(INTENT_HINTS)]) {
      expect(text).not.toMatch(BANNED);
    }
    for (const file of ['../src/lib/intent-view.ts', '../src/components/plan/PlanDocument.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(BANNED);
    }
  });
});
