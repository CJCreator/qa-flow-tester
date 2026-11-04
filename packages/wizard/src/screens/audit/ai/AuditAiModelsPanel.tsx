import { useEffect, useState } from 'react';
import { ErrorMessage, Spinner } from '../../../components/text';
import {
  AUDIT_AI_STAGES,
  STAGE_TEXT,
  afterSave,
  defaultModel,
  draftFrom,
  isUpdateEmpty,
  loadModels,
  modelsUpdate,
  saveModels,
  type Fetch,
  type ModelsDraft,
  type ModelsState,
} from './stage-models-api';

const NO_DEFAULT = 'none set for your AI Provider';

export interface AuditAiModelsViewProps extends ModelsState {
  saving: boolean;
  onDraft: (draft: ModelsDraft) => void;
  onSave: () => void;
  onDiscard: () => void;
}

/** The AI model per Website Audit task without state: one labelled field per task, its default and its message. */
export function AuditAiModelsView({
  reply,
  draft,
  errors,
  message,
  saving,
  onDraft,
  onSave,
  onDiscard,
}: AuditAiModelsViewProps) {
  const pending = !isUpdateEmpty(modelsUpdate(reply, draft));
  // A message the runner gave for no shown field (the body as a whole) is shown with the save.
  const otherErrors = Object.entries(errors).filter(
    ([field]) => !(AUDIT_AI_STAGES as readonly string[]).includes(field)
  );
  return (
    <section aria-labelledby="audit-ai-models-title" className="space-y-3">
      <h2 id="audit-ai-models-title" className="text-xl font-bold">
        AI models
      </h2>
      <p className="max-w-prose text-sm text-ink-soft">
        Each AI task of a Website Audit can use its own model from your AI Provider. Leave a field empty to use the
        default model.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {AUDIT_AI_STAGES.map((stage) => {
          const id = `audit-ai-model-${stage}`;
          const error = errors[stage];
          const fallback = defaultModel(reply, stage);
          const inUse = reply.effective[stage];
          return (
            <div key={stage} className="rounded border border-rule p-3" data-stage={stage}>
              <label htmlFor={id} className="label text-ink">
                {STAGE_TEXT[stage].label}
              </label>
              <p id={`${id}-hint`} className="text-sm text-ink-soft">
                {STAGE_TEXT[stage].hint}
              </p>
              <input
                id={id}
                type="text"
                className="field mt-2 w-full font-mono text-sm"
                value={draft[stage]}
                placeholder={fallback ?? undefined}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-hint ${id}-default${error ? ` ${id}-error` : ''}`}
                onChange={(e) => onDraft({ ...draft, [stage]: e.target.value })}
              />
              <p id={`${id}-default`} className="mt-1 text-sm text-ink-soft">
                {`Default when empty: ${fallback ?? NO_DEFAULT}. In use now: ${inUse ?? NO_DEFAULT}.`}
              </p>
              {error && (
                <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-fail">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary px-6 font-bold" disabled={!pending || saving} onClick={onSave}>
          {saving ? <Spinner label="Saving…" /> : 'Save AI models'}
        </button>
        <button type="button" className="btn-quiet" disabled={!pending || saving} onClick={onDiscard}>
          Discard unsaved changes
        </button>
        <p className="text-sm text-ink-soft" aria-live="polite">
          {pending ? 'You have changes that are not saved yet.' : 'Every change is saved.'}
        </p>
      </div>
      {otherErrors.map(([field, text]) => (
        <p key={field} className="text-sm font-semibold text-fail">
          {text}
        </p>
      ))}
      {message &&
        (message.tone === 'fail' ? (
          <ErrorMessage>{message.text}</ErrorMessage>
        ) : (
          <p role="status" className="text-sm font-semibold text-pass">
            {message.text}
          </p>
        ))}
    </section>
  );
}

export interface AuditAiModelsPanelProps {
  /** For tests: the requests. */
  fetchImpl?: Fetch;
}

type Loaded = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; state: ModelsState };

/** Choose the model of each Website Audit AI task (REQ-039). Mounted in the audit settings screen. */
export function AuditAiModelsPanel({ fetchImpl }: AuditAiModelsPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void loadModels(fetchImpl).then((outcome) => {
      if (!live) return;
      if (outcome.ok) {
        setLoaded({
          status: 'loaded',
          state: { reply: outcome.value, draft: draftFrom(outcome.value), errors: {}, message: null },
        });
      } else {
        setLoaded({ status: 'failed', message: outcome.message });
      }
    });
    return () => {
      live = false;
    };
  }, [fetchImpl]);

  if (loaded.status === 'loading') return <Spinner label="Loading the AI models…" />;
  if (loaded.status === 'failed') return <ErrorMessage>{loaded.message}</ErrorMessage>;
  const state = loaded.state;

  const update = (next: ModelsState) => setLoaded({ status: 'loaded', state: next });

  const save = async () => {
    const before = state;
    setSaving(true);
    const outcome = await saveModels(modelsUpdate(before.reply, before.draft), fetchImpl);
    setLoaded((current) =>
      current.status === 'loaded' ? { status: 'loaded', state: afterSave(current.state, outcome) } : current
    );
    setSaving(false);
  };

  return (
    <AuditAiModelsView
      {...state}
      saving={saving}
      onDraft={(draft) => update({ ...state, draft, message: null })}
      onSave={() => void save()}
      onDiscard={() => update({ ...state, draft: draftFrom(state.reply), errors: {}, message: null })}
    />
  );
}
