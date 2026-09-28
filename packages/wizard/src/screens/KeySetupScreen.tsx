import { useEffect, useRef, useState } from 'react';
import { RunnerError, saveKey, validateKey } from '../api';
import { ErrorMessage, Lead, Question, Spinner } from '../components/Shell';

type KeyStatus =
  | { kind: 'empty' }
  | { kind: 'checking' }
  | { kind: 'valid' }
  | { kind: 'invalid'; reason: string };

const VALIDATE_DELAY_MS = 500;

export const NO_FREE_MODELS_MESSAGE = 'No free AI models are available right now — please try again later.';

/**
 * One-time AI setup. The key is checked as it's typed or pasted; once it works it is saved on
 * this computer by the QA Tool and a free model is chosen automatically.
 */
export function KeySetupScreen({ onDone, onCancel }: { onDone: (model: string) => void; onCancel?: () => void }) {
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
        setStatus({ kind: 'invalid', reason: err instanceof RunnerError ? err.message : 'The key couldn’t be checked. Try again.' });
      }
    }, VALIDATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      // The QA Tool keeps the key and chooses the free model, so every browser gets the same setup.
      const { model } = await saveKey(key.trim());
      if (!model) {
        setError(NO_FREE_MODELS_MESSAGE);
        return;
      }
      onDone(model);
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'The key couldn’t be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="max-w-prose">
      <Question>Connect an AI helper</Question>
      <Lead>
        The check-up uses AI to explore your product and decide what to test. It runs on OpenRouter’s free AI models, so
        it costs nothing. Paste your OpenRouter key once and you won’t be asked again.
      </Lead>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (status.kind === 'valid' && !saving) finish();
        }}
      >
        <label htmlFor="ai-key" className="label">
          OpenRouter key
        </label>
        <p id="ai-key-hint" className="hint mb-3">
          Don’t have one?{' '}
          <a className="btn-link" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            Get a free key from OpenRouter
          </a>
        </p>
        <div className="flex gap-2">
          <input
            id="ai-key"
            className="field font-mono"
            type={reveal ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-or-…"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="ai-key-hint ai-key-status"
            aria-invalid={status.kind === 'invalid'}
          />
          <button type="button" className="btn-quiet shrink-0 px-4" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>

        <p id="ai-key-status" role="status" className="mt-3 min-h-[1.6em]">
          {status.kind === 'checking' && <Spinner label="Checking the key…" />}
          {status.kind === 'valid' && <span className="font-bold text-pass">✓ Key is active</span>}
          {status.kind === 'invalid' && <span className="font-bold text-fail">✗ Key invalid or out of credit. {status.reason}</span>}
        </p>

        {error && <ErrorMessage>{error}</ErrorMessage>}

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button type="submit" className="btn-primary" disabled={status.kind !== 'valid' || saving}>
            {saving ? <Spinner label="Saving your key…" /> : 'Save key and continue'}
          </button>
          {onCancel && (
            <button type="button" className="btn-link" onClick={onCancel}>
              Keep my current key
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
