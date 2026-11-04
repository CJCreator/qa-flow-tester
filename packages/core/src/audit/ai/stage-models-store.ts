/**
 * The model the tool user chose per audit AI stage (REQ-039), kept in `audit-ai-models.json` in the state
 * folder. Only validated model ids are written: never a key, never a field the validator did not pass.
 */
import path from 'path';
import { AUDIT_AI_STAGES, validateAuditAiModelsUpdate, type AuditAiModels, type AuditAiModelsErrors } from '@qa/types';
import { readJsonSafe, writeJsonAtomic } from '../../atomic-write.js';

export const AUDIT_AI_MODELS_FILE = 'audit-ai-models.json';
const SCHEMA_VERSION = 1;

interface StoredFile {
  schemaVersion: number;
  models: AuditAiModels;
}

export type AuditAiModelsSave = { ok: true; models: AuditAiModels } | { ok: false; errors: AuditAiModelsErrors };

/** Keeps only the stages whose stored id the validator still accepts. */
function cleanModels(raw: unknown): AuditAiModels {
  const out: AuditAiModels = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const stage of AUDIT_AI_STAGES) {
    if (!Object.prototype.hasOwnProperty.call(raw, stage)) continue;
    const one = validateAuditAiModelsUpdate({ models: { [stage]: (raw as Record<string, unknown>)[stage] } });
    const id = one.ok ? one.value.models[stage] : null;
    if (typeof id === 'string') out[stage] = id;
  }
  return out;
}

export class AuditAiModelsStore {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(stateDir: string) {
    this.file = path.join(stateDir, AUDIT_AI_MODELS_FILE);
  }

  /** The saved models; empty when nothing is saved or the file is unreadable. */
  async read(): Promise<AuditAiModels> {
    const { data } = await readJsonSafe<Partial<StoredFile>>(this.file, { currentVersion: SCHEMA_VERSION });
    return cleanModels(data?.models);
  }

  /**
   * Applies a `PUT /api/audit-ai/models` body: a model id sets a stage, null puts it back on its default.
   * Refused bodies change nothing and return the validator's messages. Saves run one at a time.
   */
  update(body: unknown): Promise<AuditAiModelsSave> {
    const checked = validateAuditAiModelsUpdate(body);
    if (!checked.ok) return Promise.resolve({ ok: false, errors: checked.errors });
    const run = this.queue.then(async (): Promise<AuditAiModelsSave> => {
      const models = await this.read();
      for (const stage of AUDIT_AI_STAGES) {
        if (!Object.prototype.hasOwnProperty.call(checked.value.models, stage)) continue;
        const id = checked.value.models[stage];
        if (typeof id === 'string') models[stage] = id;
        else delete models[stage];
      }
      const stored: StoredFile = { schemaVersion: SCHEMA_VERSION, models };
      await writeJsonAtomic(this.file, stored);
      return { ok: true, models };
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
