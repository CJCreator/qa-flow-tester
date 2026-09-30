import { useEffect, useState } from 'react';
import { getAiSetup, RunnerError, type AiSetup } from '../api';
import { KeyField } from '../components/KeyField';
import { ErrorMessage, Lead, Question, Spinner } from '../components/text';
import { useTitle } from '../lib/router';

/** /settings: the AI key. Whether one is saved, the model in use, today's free requests, and a way to replace it. */
export function SettingsScreen({ onKeySaved }: { onKeySaved: (model: string) => void }) {
  useTitle('Settings');
  const [setup, setSetup] = useState<AiSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () =>
    getAiSetup(true)
      .then((s) => {
        setSetup(s);
        setError(null);
      })
      .catch((err) => setError(err instanceof RunnerError ? err.message : 'Your settings couldn’t be read. Reload the page.'));
  useEffect(() => {
    void load();
  }, []);

  const keySaved = (model: string) => {
    onKeySaved(model);
    setReplacing(false);
    setSaved(true);
    void load();
  };

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 py-10 sm:px-6 sm:py-14">
      <Question>Settings</Question>
      <Lead>
        Release check-up uses an AI helper to explore your site and write the plan. It runs on OpenRouter’s free models, so it costs
        nothing. The key is kept on this computer, never in the browser.
      </Lead>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!setup && !error && <Spinner label="Reading your settings…" />}

      {setup && (
        <section aria-labelledby="ai-heading" className="rounded-lg border-2 border-edge bg-surface p-5">
          <h2 id="ai-heading" className="mb-3 text-lg font-bold">
            AI key
          </h2>
          {saved && (
            <p role="status" className="mb-3 font-bold text-pass">
              ✓ Your new key is saved.
            </p>
          )}
          {setup.configured ? (
            <dl className="mb-4 grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_1fr]">
              <dt className="text-ink-soft">Key</dt>
              <dd className="font-bold text-pass">Saved on this computer</dd>
              <dt className="text-ink-soft">AI model</dt>
              <dd className="break-all">{setup.model ?? 'None free right now. Try again later.'}</dd>
              <dt className="text-ink-soft">Free requests left today</dt>
              <dd>
                {setup.requestsLeft !== undefined
                  ? `${setup.requestsLeft}${setup.requestsLimit !== undefined ? ` of ${setup.requestsLimit}` : ''}`
                  : 'OpenRouter didn’t say.'}
              </dd>
            </dl>
          ) : (
            <p className="mb-4 text-ink">No key is saved yet. Add one to start a check-up.</p>
          )}

          {setup.configured && !replacing ? (
            <button type="button" className="btn-quiet px-5" onClick={() => setReplacing(true)}>
              Replace the key
            </button>
          ) : (
            <KeyField
              onSaved={keySaved}
              saveLabel="Save the key"
              onCancel={setup.configured ? () => setReplacing(false) : undefined}
              cancelLabel="Keep my current key"
            />
          )}
        </section>
      )}
    </div>
  );
}
