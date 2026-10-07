import { useEffect, useRef, useState } from 'react';
import { RunnerError, saveKey, validateKey } from '../api';
import { ErrorMessage, Spinner } from './text';

type KeyStatus = { kind: 'empty' } | { kind: 'checking' } | { kind: 'valid' } | { kind: 'invalid'; reason: string };

const VALIDATE_DELAY_MS = 500;

export const NO_FREE_MODELS_MESSAGE = 'No free AI models are available right now. Please try again later.';

/**
 * The OpenRouter key: checked as it's typed or pasted, then saved on this computer by the QA Tool,
 * which picks a free model. Used on the new check-up screen the first time, and in Settings.
 */
export function KeyField({
  onSaved,
  saveLabel = 'Save the key',
  onCancel,
  cancelLabel,
}: {
  onSaved: (model: string) => void;
  saveLabel?: string;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<KeyStatus>({ kind: 'empty' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestCheck = useRef(0);

  useEffect(() => {
    const trimmed = key.trim();
    setError(null);
    if (!trimmed) {
      setStatus({ kind: 'empty' });
      return;
    }
    setStatus({ kind: 'checking' });
    const checkId = ++latestCheck.current;
    const timer = setTimeout(async () => {
      try {
        const result = await validateKey(trimmed);
        if (checkId !== latestCheck.current) return; // a newer paste superseded this one
        setStatus(result.valid ? { kind: 'valid' } : { kind: 'invalid', reason: result.reason });
      } catch (err) {
        if (checkId !== latestCheck.current) return;
        setStatus({
          kind: 'invalid',
          reason: err instanceof RunnerError ? err.message : 'The key couldn’t be checked. Try again.',
        });
      }
    }, VALIDATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { model } = await saveKey(key.trim());
      if (!model) {
        setError(NO_FREE_MODELS_MESSAGE);
        return;
      }
      setKey('');
      onSaved(model);
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'The key couldn’t be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label htmlFor="ai-key" className="label">
        OpenRouter key
      </label>
      <p id="ai-key-hint" className="hint mb-3 text-sm">
        Don’t have one?{' '}
        <a
          className="inline-flex min-h-[44px] items-center font-bold text-stamp underline underline-offset-4 hover:text-stamp-dark"
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
        >
          Get a free key from OpenRouter
        </a>{' '}
        (opens in a new tab).
      </p>
      <div className="flex gap-2">
        <input
          id="ai-key"
          className="field font-mono"
          type={reveal ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && status.kind === 'valid' && !saving) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="sk-or-…"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="ai-key-hint ai-key-status"
          aria-invalid={status.kind === 'invalid'}
        />
        <button
          type="button"
          className="btn-quiet shrink-0 px-4"
          onClick={() => setReveal((r) => !r)}
          aria-pressed={reveal}
        >
          {reveal ? 'Hide' : 'Show'}
        </button>
      </div>

      <p id="ai-key-status" role="status" className="mt-2 min-h-[1.6em] text-sm">
        {status.kind === 'checking' && <Spinner label="Checking the key…" />}
        {status.kind === 'valid' && <span className="font-bold text-pass">✓ The key works</span>}
        {status.kind === 'invalid' && (
          <span className="font-bold text-fail">✗ The key doesn’t work, or it’s out of credit. {status.reason}</span>
        )}
      </p>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="btn-primary"
          disabled={status.kind !== 'valid' || saving}
          onClick={() => void save()}
        >
          {saving ? <Spinner label="Saving your key…" /> : saveLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-link" onClick={onCancel}>
            {cancelLabel ?? 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}
