import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { AUDIT_AI_MODEL_ID_MAX } from '@qa/types';
import { AuditAiModelsStore, AUDIT_AI_MODELS_FILE } from '../src/audit/ai/stage-models-store.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-ai-models-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('AuditAiModelsStore', () => {
  it('is empty when nothing is saved', async () => {
    expect(await new AuditAiModelsStore(dir).read()).toEqual({});
  });

  it('keeps saved models across a reload', async () => {
    const saved = await new AuditAiModelsStore(dir).update({
      models: { assessment: 'vendor/model-a', rewrite: ' vendor/model-b ' },
    });
    expect(saved).toEqual({ ok: true, models: { assessment: 'vendor/model-a', rewrite: 'vendor/model-b' } });

    const reloaded = new AuditAiModelsStore(dir);
    expect(await reloaded.read()).toEqual({ assessment: 'vendor/model-a', rewrite: 'vendor/model-b' });
    expect(reloaded.file).toBe(path.join(dir, AUDIT_AI_MODELS_FILE));
  });

  it('null puts a stage back on its default and leaves the others', async () => {
    const store = new AuditAiModelsStore(dir);
    await store.update({ models: { assessment: 'a', documents: 'd' } });
    const saved = await store.update({ models: { assessment: null } });
    expect(saved).toEqual({ ok: true, models: { documents: 'd' } });
    expect(await new AuditAiModelsStore(dir).read()).toEqual({ documents: 'd' });
  });

  it.each([
    [{ models: { unknown: 'x' } }, 'unknown', 'Unknown AI stage'],
    [{ models: { rewrite: '' } }, 'rewrite', 'Enter a model id'],
    [{ models: { rewrite: 42 } }, 'rewrite', 'Enter a model id'],
    [{ models: { rewrite: 'x'.repeat(AUDIT_AI_MODEL_ID_MAX + 1) } }, 'rewrite', 'at most'],
    [{ models: { rewrite: 'a\u0007b' } }, 'rewrite', 'control characters'],
    [{ models: [] }, 'models', 'Send the models'],
    [null, 'models', 'Send the models'],
  ])('refuses %j with the validator message and changes nothing', async (body, field, message) => {
    const store = new AuditAiModelsStore(dir);
    await store.update({ models: { rewrite: 'kept' } });
    const result = await store.update(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[field]).toContain(message);
    expect(await store.read()).toEqual({ rewrite: 'kept' });
  });

  it('accepts a model id of exactly the maximum length', async () => {
    const id = 'x'.repeat(AUDIT_AI_MODEL_ID_MAX);
    expect(await new AuditAiModelsStore(dir).update({ models: { preview: id } })).toEqual({
      ok: true,
      models: { preview: id },
    });
  });

  it('writes no key or extra field into the file', async () => {
    const store = new AuditAiModelsStore(dir);
    // An extra top-level field is ignored, never stored.
    const saved = await store.update({ models: { rewrite: 'm' }, apiKey: 'sk-test-not-a-real-key' } as unknown);
    expect(saved.ok).toBe(true);
    const refusedStage = await store.update({ models: { apiKey: 'sk-test-not-a-real-key' } });
    expect(refusedStage.ok).toBe(false);
    const raw = await fs.readFile(store.file, 'utf8');
    expect(raw).not.toContain('sk-test');
    expect(raw).not.toMatch(/apiKey/i);
    expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, models: { rewrite: 'm' } });
  });

  it('ignores a hand-edited file with bad or unknown entries', async () => {
    await fs.writeFile(
      path.join(dir, AUDIT_AI_MODELS_FILE),
      JSON.stringify({ schemaVersion: 1, models: { assessment: 'ok', rewrite: 7, apiKey: 'x', preview: '' } }),
      'utf8'
    );
    expect(await new AuditAiModelsStore(dir).read()).toEqual({ assessment: 'ok' });
  });

  it('reads a corrupt file as empty', async () => {
    await fs.writeFile(path.join(dir, AUDIT_AI_MODELS_FILE), '{not json', 'utf8');
    expect(await new AuditAiModelsStore(dir).read()).toEqual({});
  });

  it('keeps every change when saves overlap', async () => {
    const store = new AuditAiModelsStore(dir);
    await Promise.all([
      store.update({ models: { assessment: 'a' } }),
      store.update({ models: { documents: 'd' } }),
      store.update({ models: { preview: 'p' } }),
    ]);
    expect(await store.read()).toEqual({ assessment: 'a', documents: 'd', preview: 'p' });
  });
});
