import { describe, it, expect } from 'vitest';
import * as auditAi from '../src/audit/ai/index.js';
import * as core from '../src/index.js';
import { AITimeoutError } from '../src/ai/timeout.js';
import { RewriteStore } from '../src/audit/ai/rewrite-store.js';
import { AuditAiModelsStore } from '../src/audit/ai/stage-models-store.js';

const FUNCTIONS = [
  'resolveAuditAi',
  'auditAiRequestBudget',
  'findClaimWords',
  'hasClaimWords',
  'defaultImpactEffort',
  'scoreFindings',
  'rankFindings',
  'rankFindingsWithIdMap',
  'checkCitations',
  'measurePageSpeed',
  'measureSampleSpeeds',
  'mapPsiResponse',
  'isQuotaAnswer',
  'psiRequestUrl',
  'assessPages',
  'assessSite',
  'recommendPages',
  'recommendationFor',
  'ruleRecommendation',
  'findOverlaps',
  'overlapThreshold',
  'overlapWords',
  'writeRewrite',
  'rewriteMessages',
] as const;

const CLASSES = ['AuditAiModelsStore', 'RewriteStore', 'AITimeoutError'] as const;

const VALUES = [
  'AUDIT_AI_MODELS_FILE',
  'IMPACT_EFFORT_BY_RULE',
  'IMPACT_EFFORT_BY_SEVERITY',
  'DEFAULT_IMPACT_EFFORT',
  'WHOLE_PAGE_RULES',
  'PSI_ENDPOINT',
  'PSI_TIMEOUT_MS',
  'PSI_MAX_BYTES',
  'REDESIGN_MIN_HIGH_IMPACT',
  'REDESIGN_MIN_GROUPS',
  'REDESIGN_LOW_AREAS',
  'NO_FINDINGS_REASON',
  'REWRITES_FILE',
] as const;

describe('audit AI barrel', () => {
  it.each(FUNCTIONS)('exports function %s', (name) => {
    expect(typeof (auditAi as Record<string, unknown>)[name]).toBe('function');
  });

  it.each(CLASSES)('exports class %s', (name) => {
    expect(typeof (auditAi as Record<string, unknown>)[name]).toBe('function');
  });

  it.each(VALUES)('exports value %s', (name) => {
    expect((auditAi as Record<string, unknown>)[name]).toBeDefined();
  });

  it('re-exports the same objects as the source modules', () => {
    expect(auditAi.AITimeoutError).toBe(AITimeoutError);
    expect(auditAi.RewriteStore).toBe(RewriteStore);
    expect(auditAi.AuditAiModelsStore).toBe(AuditAiModelsStore);
    const err = new auditAi.AITimeoutError('timed out', 5);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AITimeoutError');
    expect(err.timeoutMs).toBe(5);
  });

  it('has no runtime export that collides with the core barrel', () => {
    const coreExports = core as Record<string, unknown>;
    const names = Object.keys(auditAi);
    // Before BE-190 wires `export * from './audit/ai/index.js'` into the core barrel, no name may exist there.
    // After it, every name must reach the core barrel as the very same object: a clashing `export *` name is
    // silently dropped (ambiguous) or shadowed by a local export, and both show up here.
    const wired = 'resolveAuditAi' in coreExports;
    const collisions = names.filter((name) =>
      wired ? coreExports[name] !== (auditAi as Record<string, unknown>)[name] : name in coreExports,
    );
    expect(collisions).toEqual([]);
  });
});
