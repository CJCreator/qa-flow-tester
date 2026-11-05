import type { GeminiModelList } from '../api';
import { LoadError } from './ui';
import { Notice } from './text';

/** A saved Gemini model name that only Google AI Studio knows, so the API rejects it. */
export function isLatestAlias(model: string | null | undefined): boolean {
  return !!model && model.endsWith('-latest');
}

/**
 * The Gemini model choice: "Choose automatically" (value '') first, then the models the saved key can
 * use. Shows a warning for a `-latest` name and any note the runner gave when it could pick no model.
 */
export function GeminiModelSelect({
  list,
  value,
  onChange,
  savedModel,
  note,
  error,
  onRetry,
}: {
  list: GeminiModelList | null;
  value: string;
  onChange: (model: string) => void;
  savedModel: string | null;
  note?: string | null;
  error?: string | null;
  onRetry?: () => void;
}) {
  const models = list?.models ?? [];
  return (
    <>
      {isLatestAlias(savedModel) && (
        <div className="mb-3">
          <Notice tone="warn" title={`“${savedModel}” may not work`}>
            This name only works on Google AI Studio. Choose “Choose automatically” below and save.
          </Notice>
        </div>
      )}
      {note && (
        <div className="mb-3">
          <Notice tone="warn" title="No model was picked">
            {note}
          </Notice>
        </div>
      )}
      <label htmlFor="text-model" className="label">
        Model
      </label>
      {error && <LoadError title={error} onRetry={onRetry ?? (() => undefined)} />}
      <select id="text-model" className="field mb-4" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose automatically (recommended)</option>
        {value && !models.some((m) => m.id === value) && <option value={value}>{value}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.recommended ? `${m.id} (recommended)` : m.id}
          </option>
        ))}
      </select>
      <p className="-mt-2 mb-4 text-sm text-ink-soft">
        To use Google sign-in instead of a key, save <span className="font-mono">adc</span> as the key. It uses the
        application-default credentials from gcloud.
      </p>
    </>
  );
}
