/**
 * BE-400: the audit AI contract (REQ-039, REQ-011, Q-29, RISK-005). One model setting per audit AI stage,
 * a validator for the settings body, owner-only routes, and an abort signal on every AI call.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  AI_STAGES,
  AUDIT_AI_API,
  AUDIT_AI_MODEL_ID_MAX,
  AUDIT_AI_STAGES,
  validateAuditAiModelsUpdate,
  type AICompletionOptions,
  type AuditAiModelsReply,
} from '../src/ai.js';

describe('AICompletionOptions', () => {
  it('accepts signal and timeoutMs next to the existing options', () => {
    const controller = new AbortController();
    const options: AICompletionOptions = {
      temperature: 0,
      stage: 'assessment',
      signal: controller.signal,
      timeoutMs: 30_000,
    };
    expect(options.signal?.aborted).toBe(false);
    controller.abort();
    expect(options.signal?.aborted).toBe(true);
    const legacy: AICompletionOptions = { maxTokens: 100, model: 'm' };
    expect(legacy.signal).toBeUndefined();
  });
});

describe('AUDIT_AI_STAGES', () => {
  it('lists exactly assessment, documents, preview and rewrite', () => {
    expect([...AUDIT_AI_STAGES]).toEqual(['assessment', 'documents', 'preview', 'rewrite']);
  });

  it('every audit stage is an AI stage', () => {
    for (const stage of AUDIT_AI_STAGES) expect(AI_STAGES).toContain(stage);
  });

  it('the reply type has an effective model per stage', () => {
    const reply: AuditAiModelsReply = {
      models: { preview: 'p' },
      defaults: { text: 't', vision: null },
      effective: { assessment: null, documents: 't', preview: 'p', rewrite: 't' },
    };
    expect(Object.keys(reply.effective).sort()).toEqual([...AUDIT_AI_STAGES].sort());
  });
});

describe('validateAuditAiModelsUpdate', () => {
  it('accepts a model id or null per stage', () => {
    const check = validateAuditAiModelsUpdate({
      models: { assessment: 'google/gemini-2.5-flash', documents: null, preview: 'gpt-4o', rewrite: 'claude' },
    });
    expect(check).toEqual({
      ok: true,
      value: {
        models: { assessment: 'google/gemini-2.5-flash', documents: null, preview: 'gpt-4o', rewrite: 'claude' },
      },
    });
  });

  it('accepts an empty update', () => {
    expect(validateAuditAiModelsUpdate({ models: {} })).toEqual({ ok: true, value: { models: {} } });
  });

  it('accepts an id of exactly the maximum length and refuses one character more', () => {
    const max = 'a'.repeat(AUDIT_AI_MODEL_ID_MAX);
    expect(AUDIT_AI_MODEL_ID_MAX).toBe(200);
    expect(validateAuditAiModelsUpdate({ models: { preview: max } }).ok).toBe(true);
    const check = validateAuditAiModelsUpdate({ models: { preview: max + 'a' } });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors.preview).toMatch(/200/);
  });

  it('refuses unknown stages, empty strings, non-strings and control characters, one message per field', () => {
    const check = validateAuditAiModelsUpdate({
      models: { planning: 'x', assessment: '', documents: '   ', preview: 'bad\nid', rewrite: 42 },
    });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(Object.keys(check.errors).sort()).toEqual(['assessment', 'documents', 'planning', 'preview', 'rewrite']);
    for (const message of Object.values(check.errors)) expect(typeof message).toBe('string');
    expect(check.errors.planning).toMatch(/Unknown AI stage/);
    expect(check.errors.preview).toMatch(/control characters/);
  });

  it('refuses DEL and C1 control characters', () => {
    expect(validateAuditAiModelsUpdate({ models: { rewrite: 'a\u007fb' } }).ok).toBe(false);
    expect(validateAuditAiModelsUpdate({ models: { rewrite: 'a\u0085b' } }).ok).toBe(false);
  });

  it('refuses a malformed body', () => {
    for (const body of [null, undefined, 'x', [], {}, { models: null }, { models: [] }, { models: 'x' }]) {
      const check = validateAuditAiModelsUpdate(body);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.errors.models).toBeTypeOf('string');
    }
  });

  it('a __proto__ key is refused as an unknown stage without touching the prototype', () => {
    const check = validateAuditAiModelsUpdate(JSON.parse('{"models":{"__proto__":{"polluted":true}}}'));
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(Object.prototype.hasOwnProperty.call(check.errors, '__proto__')).toBe(true);
      expect(Object.getPrototypeOf(check.errors)).toBe(Object.prototype);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('AUDIT_AI_API', () => {
  it('both routes are owner only and under /api/audit-ai/', () => {
    expect(AUDIT_AI_API.getModels).toEqual({
      method: 'GET',
      path: '/api/audit-ai/models',
      replies: 'json',
      access: 'owner',
    });
    expect(AUDIT_AI_API.putModels).toEqual({
      method: 'PUT',
      path: '/api/audit-ai/models',
      replies: 'json',
      access: 'owner',
    });
  });
});

describe('ai.ts stays Node-free', () => {
  it('imports only relative modules, and website-audit only as a type', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/ai.ts', import.meta.url)), 'utf8');
    const specifiers = [...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const specifier of specifiers) expect(specifier.startsWith('./')).toBe(true);
    expect(source).toMatch(/import type \{ AuditEndpoint \} from '\.\/website-audit\.js'/);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
