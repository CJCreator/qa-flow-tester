import { useCallback, useEffect, useState } from 'react';
import {
  addSchedule,
  addSiteSignIn,
  deleteSchedule,
  getAiSetup,
  getAiUsage,
  getDefaults,
  getStoredReleaseGates,
  listFreeModels,
  listSchedules,
  listSites,
  RunnerError,
  saveAiSettings,
  saveDefaults,
  saveStoredReleaseGates,
  testModel,
  testSiteSignIn,
  toggleSchedule,
  updateSite,
  type AiProviderId,
  type AiSetup,
  type CheckupSchedule,
  type FreeModel,
  type RememberedSite,
  type ScreenSize,
} from '../api';
import { DEFAULT_RELEASE_GATES, type ReleaseGateCriteria } from '@qa/types';
import { KeyField } from '../components/KeyField';
import { ErrorMessage, Notice, Question, Spinner } from '../components/text';
import { formatWhen } from '../lib/format';
import { useDocumentTitle } from '../lib/title';

const PROVIDERS: Array<{ id: AiProviderId; name: string; hint: string }> = [
  { id: 'openrouter', name: 'OpenRouter’s free models', hint: 'Costs nothing. Free models allow 50 requests a day.' },
  { id: 'anthropic', name: 'Anthropic (Claude)', hint: 'Paid: your Anthropic account is charged for each request.' },
  { id: 'openai', name: 'OpenAI', hint: 'Paid: your OpenAI account is charged for each request.' },
  { id: 'gemini', name: 'Google Gemini', hint: 'Paid or free, depending on your Google account. A free key may be used for training.' },
];

/**
 * What a free key means for the privacy of what is sent to it. The AI is sent page text and
 * addresses from the site being checked, so this is shown before a free key is used.
 */
const FREE_KEY_PRIVACY: Partial<Record<AiProviderId, string>> = {
  openrouter:
    'Free models are run by providers that may keep and learn from what is sent to them. Do not check a site whose pages hold private or customer data.',
  gemini:
    'Google may use inputs sent with a free-tier API key to train its models. Use a paid key, or a billing-enabled project, for anything private.',
};

const SIZES: Array<{ id: ScreenSize; label: string }> = [
  { id: '375px', label: 'Phone (375px)' },
  { id: '768px', label: 'Tablet (768px)' },
  { id: '1440px', label: 'Desktop (1440px)' },
];

/**
 * Settings: the AI (service, key, model, and a test of it), the free requests left today (read
 * after the rest, since it asks OpenRouter), the screen sizes a check-up starts with, and what's
 * remembered for each site.
 */
export function SettingsScreen({ onKeySaved }: { onKeySaved: (model: string) => void }) {
  useDocumentTitle('Settings');
  const [setup, setSetup] = useState<AiSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    getAiSetup()
      .then((s) => {
        setSetup(s);
        setError(null);
      })
      .catch((err) => setError(err instanceof RunnerError ? err.message : 'The settings couldn’t be read. Try again.'));
  }, []);
  useEffect(load, [load]);

  const provider = setup?.provider ?? 'openrouter';
  const [choosing, setChoosing] = useState<AiProviderId | null>(null);
  const shown = choosing ?? provider;

  return (
    <div className="mx-auto max-w-prose px-4 py-10 sm:px-6 sm:py-14">
      <Question>Settings</Question>

      <section aria-labelledby="ai-title" className="rounded-lg border-2 border-edge bg-surface p-5">
        <h2 id="ai-title" className="mb-1 text-xl font-bold">
          AI
        </h2>
        <p className="mb-4 text-sm text-ink-soft">
          The AI writes each check-up’s test plan and looks over the screens afterwards. Keys are kept on this computer, never in the
          browser.
        </p>

        {error && <ErrorMessage>{error}</ErrorMessage>}
        {!setup && !error && <Spinner label="Reading the settings…" />}
        {saved && (
          <div className="mb-4">
            <Notice tone="pass" title={saved} />
          </div>
        )}

        {setup && (
          <>
            <fieldset className="mb-5">
              <legend className="label">Which AI to use</legend>
              <div className="space-y-2">
                {PROVIDERS.map((p) => (
                  <label key={p.id} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border-2 border-edge px-3 py-2 hover:border-stamp">
                    <input
                      type="radio"
                      name="ai-provider"
                      className="mt-1.5 h-5 w-5 shrink-0 accent-[#6C9BF2]"
                      checked={shown === p.id}
                      onChange={() => {
                        setChoosing(p.id === provider ? null : p.id);
                        setSaved(null);
                      }}
                    />
                    <span>
                      <span className="block font-bold">
                        {p.name}
                        {p.id === provider && <span className="ml-2 text-sm font-normal text-pass">In use</span>}
                      </span>
                      <span className="block text-sm text-ink-soft">{p.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {FREE_KEY_PRIVACY[shown] && (
              <div className="mb-5">
                <Notice tone="warn" title={shown === 'openrouter' ? 'Free models can learn from what you send' : 'A free Gemini key can be used for training'}>
                  {FREE_KEY_PRIVACY[shown]}
                </Notice>
              </div>
            )}

            {shown === 'openrouter' ? (
              <OpenRouterKey
                setup={choosing ? { ...setup, configured: false, provider: 'openrouter' } : setup}
                replacing={replacing}
                setReplacing={setReplacing}
                onSaved={(model) => {
                  setReplacing(false);
                  setChoosing(null);
                  setSaved('The new key is saved and works.');
                  onKeySaved(model);
                  load();
                }}
              />
            ) : (
              <PaidKey
                provider={shown}
                configured={!choosing && setup.configured}
                onSaved={(next) => {
                  setChoosing(null);
                  setSaved('The key is saved. Check-ups now use it.');
                  if (next.configured && next.model) onKeySaved(next.model);
                  load();
                }}
              />
            )}

            {!choosing && setup.configured && (
              <ModelChoice
                setup={setup}
                onSaved={() => {
                  setSaved('The model choice is saved.');
                  load();
                }}
              />
            )}
            {!choosing && setup.configured && provider === 'openrouter' && <Usage />}
          </>
        )}
      </section>

      <Defaults />
      <ReleaseGates />
      <CheckupSchedules />
      <Sites />
    </div>
  );
}

function OpenRouterKey({
  setup,
  replacing,
  setReplacing,
  onSaved,
}: {
  setup: AiSetup;
  replacing: boolean;
  setReplacing: (on: boolean) => void;
  onSaved: (model: string) => void;
}) {
  return (
    <>
      <dl className="mb-5 grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-soft">Key</dt>
        <dd className={`font-bold ${setup.configured ? 'text-pass' : 'text-fail'}`}>{setup.configured ? '✓ Saved' : 'No key yet'}</dd>
      </dl>
      {setup.configured && !replacing ? (
        <button type="button" className="btn-quiet" onClick={() => setReplacing(true)}>
          Replace the key
        </button>
      ) : (
        <KeyField
          saveLabel={setup.configured ? 'Save the new key' : 'Save the key'}
          onSaved={onSaved}
          // "Keep my current key" only when there is one to keep.
          onCancel={setup.configured ? () => setReplacing(false) : undefined}
          cancelLabel="Keep my current key"
        />
      )}
    </>
  );
}

/** A key for a paid service: saved as it is (the service checks it on the first request). */
function PaidKey({ provider, configured, onSaved }: { provider: AiProviderId; configured: boolean; onSaved: (setup: AiSetup) => void }) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = PROVIDERS.find((p) => p.id === provider)?.name ?? provider;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          onSaved(await saveAiSettings({ provider, apiKey: key.trim() || undefined }));
          setKey('');
        } catch (err) {
          setError(err instanceof RunnerError ? err.message : 'The key couldn’t be saved. Try again.');
        } finally {
          setSaving(false);
        }
      }}
    >
      <label htmlFor="paid-key" className="label">
        {name} key {configured && <span className="font-normal text-pass">✓ Saved</span>}
      </label>
      <input
        id="paid-key"
        className="field font-mono"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={configured ? 'Paste a new key to replace it' : 'Paste your key'}
      />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <button type="submit" className="btn-primary" disabled={saving || !key.trim()}>
        {saving ? <Spinner label="Saving…" /> : configured ? 'Save the new key' : `Use ${name}`}
      </button>
    </form>
  );
}

/** The model the plan is written with (and the one that looks at screens), and a test that it answers. */
function ModelChoice({ setup, onSaved }: { setup: AiSetup; onSaved: () => void }) {
  const openRouter = (setup.provider ?? 'openrouter') === 'openrouter';
  const [models, setModels] = useState<FreeModel[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [text, setText] = useState<string>(setup.chosenBy === 'person' ? setup.model ?? '' : '');
  const [vision, setVision] = useState<string>(setup.chosenBy === 'person' ? setup.visionModel ?? '' : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ running: boolean; result?: { ok: boolean; ms: number; reason?: string; model?: string }; error?: string }>({ running: false });

  useEffect(() => {
    if (!openRouter || !setup.configured) return;
    listFreeModels()
      .then(setModels)
      .catch((err) => setListError(err instanceof RunnerError ? err.message : 'The model list couldn’t be read.'));
  }, [openRouter, setup.configured]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAiSettings({ provider: setup.provider ?? 'openrouter', model: text || null, visionModel: vision || null });
      onSaved();
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'The model couldn’t be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };
  const runTest = async () => {
    setTest({ running: true });
    try {
      setTest({ running: false, result: await testModel(text || setup.model || undefined) });
    } catch (err) {
      setTest({ running: false, error: err instanceof RunnerError ? err.message : 'The model couldn’t be tested.' });
    }
  };
  const describe = (m: FreeModel) =>
    `${m.name}${m.unreliable ? ' — keeps stopping before it answers here' : m.thinks ? ' — thinks first (slower, may run out)' : ''}`;

  return (
    <div className="mt-6 border-t border-rule pt-5">
      <h3 className="mb-1 font-bold">Model</h3>
      <p className="mb-3 text-sm text-ink-soft">
        In use: <span className="break-all font-mono text-ink">{setup.model ?? 'None free right now'}</span>
        {setup.chosenBy === 'person' ? ' (your choice)' : ' (chosen automatically)'}
      </p>

      {openRouter ? (
        <>
          <label htmlFor="text-model" className="label">
            Writes the plan
          </label>
          {listError && <p className="mb-2 text-sm text-fail">{listError}</p>}
          <select id="text-model" className="field mb-4" value={text} onChange={(e) => setText(e.target.value)} disabled={!models}>
            <option value="">Choose automatically (recommended)</option>
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {describe(m)}
              </option>
            ))}
          </select>
          <label htmlFor="vision-model" className="label">
            Looks over the screens
          </label>
          <select id="vision-model" className="field mb-4" value={vision} onChange={(e) => setVision(e.target.value)} disabled={!models}>
            <option value="">Choose automatically (recommended)</option>
            {(models ?? [])
              .filter((m) => m.supportsImages)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {describe(m)}
                </option>
              ))}
          </select>
        </>
      ) : (
        <>
          <label htmlFor="text-model" className="label">
            Model name
          </label>
          <input
            id="text-model"
            className="field mb-4 font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={setup.model ?? ''}
            spellCheck={false}
          />
        </>
      )}

      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner label="Saving…" /> : 'Save the model choice'}
        </button>
        <button type="button" className="btn-quiet" disabled={test.running} onClick={() => void runTest()} aria-describedby="test-model-hint">
          {test.running ? <Spinner label="Asking the model…" /> : 'Test this model'}
        </button>
      </div>
      <p id="test-model-hint" className="mt-2 text-sm text-ink-soft">
        Sends one short request{openRouter ? ', which counts toward today’s free requests' : ''}.
      </p>
      <div role="status" className="mt-2 text-sm">
        {test.result?.ok && (
          <span className="font-bold text-pass">
            ✓ It answered in {(test.result.ms / 1000).toFixed(1)} s.
          </span>
        )}
        {test.result && !test.result.ok && <span className="font-bold text-fail">✗ {test.result.reason}</span>}
        {test.error && <span className="font-bold text-fail">✗ {test.error}</span>}
      </div>
    </div>
  );
}

/** Today's free requests: read after the rest of Settings, since it asks OpenRouter. */
function Usage() {
  const [usage, setUsage] = useState<{ requestsLeft: number | null; requestsLimit: number | null } | null | 'failed'>(null);
  useEffect(() => {
    getAiUsage()
      .then(setUsage)
      .catch(() => setUsage('failed'));
  }, []);
  return (
    <dl className="mt-6 grid gap-x-4 gap-y-2 border-t border-rule pt-5 sm:grid-cols-[12rem_1fr]">
      <dt className="text-ink-soft">Free requests left today</dt>
      <dd className="text-ink">
        {usage === null ? (
          <Spinner label="Asking OpenRouter…" />
        ) : usage === 'failed' || usage.requestsLeft === null ? (
          'OpenRouter didn’t say. The key may have stopped working: replace it if check-ups fail.'
        ) : (
          `${usage.requestsLeft}${usage.requestsLimit !== null ? ` of ${usage.requestsLimit}` : ''}`
        )}
      </dd>
    </dl>
  );
}

/** The screen sizes a new check-up starts with. The plan can still change them. */
function Defaults() {
  const [sizes, setSizes] = useState<ScreenSize[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    getDefaults()
      .then((d) => setSizes(d.screenSizes))
      .catch(() => setSizes(['375px', '768px', '1440px']));
  }, []);
  const toggle = async (size: ScreenSize, on: boolean) => {
    if (!sizes) return;
    const next = on ? SIZES.map((s) => s.id).filter((s) => s === size || sizes.includes(s)) : sizes.filter((s) => s !== size);
    try {
      setSizes((await saveDefaults({ screenSizes: next })).screenSizes);
      setMessage({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof RunnerError ? err.message : 'That couldn’t be saved.' });
    }
  };
  return (
    <section aria-labelledby="defaults-title" className="mt-8 rounded-lg border-2 border-edge bg-surface p-5">
      <h2 id="defaults-title" className="mb-1 text-xl font-bold">
        Check-up defaults
      </h2>
      <p className="mb-4 text-sm text-ink-soft">The screen sizes a new check-up tests at. You can still change them in each plan.</p>
      {!sizes ? (
        <Spinner label="Reading the defaults…" />
      ) : (
        <fieldset>
          <legend className="sr-only">Screen sizes</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {SIZES.map((s) => (
              <label key={s.id} className="flex min-h-[44px] cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[#6C9BF2]"
                  checked={sizes.includes(s.id)}
                  disabled={sizes.length === 1 && sizes.includes(s.id)}
                  onChange={(e) => void toggle(s.id, e.target.checked)}
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {message && (
        <p role="status" className={`mt-2 text-sm ${message.ok ? 'text-pass' : 'text-fail'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

const PRESET_META: Record<'strict' | 'standard' | 'lenient', { name: string; description: string }> = {
  strict: { name: 'Strict', description: 'Zero tolerance: 0 blockers, 0 majors, strict accessibility' },
  standard: { name: 'Standard', description: 'Balanced release bar: 0 blockers, up to 2 majors' },
  lenient: { name: 'Lenient', description: 'Permissive dev/staging bar: up to 1 blocker, up to 5 majors' },
};

/** Release readiness criteria: configure thresholds for blockers, major defects, WCAG compliance, and test coverage. */
function ReleaseGates() {
  const [gate, setGate] = useState<ReleaseGateCriteria>(() => getStoredReleaseGates());
  const [preset, setPreset] = useState<'strict' | 'standard' | 'lenient' | 'custom'>(() => {
    const current = getStoredReleaseGates();
    if (current.strictAccessibility && current.maxBlockers === 0 && current.maxMajors === 0) return 'strict';
    if (!current.strictAccessibility && current.maxBlockers === 0 && current.maxMajors === 2) return 'standard';
    if (!current.strictAccessibility && current.maxBlockers === 1 && current.maxMajors === 5) return 'lenient';
    return 'custom';
  });
  const [message, setMessage] = useState<string | null>(null);

  const applyPreset = (key: 'strict' | 'standard' | 'lenient') => {
    const next = { ...DEFAULT_RELEASE_GATES[key] };
    setPreset(key);
    setGate(next);
    saveStoredReleaseGates(next);
    setMessage(`Quality gate set to ${PRESET_META[key].name} (${PRESET_META[key].description}).`);
  };

  const updateGate = <K extends keyof ReleaseGateCriteria>(key: K, val: ReleaseGateCriteria[K]) => {
    setPreset('custom');
    const next: ReleaseGateCriteria = {
      ...gate,
      [key]: val,
    };
    setGate(next);
    saveStoredReleaseGates(next);
    setMessage('Custom release gate thresholds saved.');
  };

  return (
    <section aria-labelledby="gates-title" className="mt-8 rounded-lg border-2 border-edge bg-surface p-5">
      <h2 id="gates-title" className="mb-1 text-xl font-bold">
        Release Readiness Gates
      </h2>
      <p className="mb-4 text-sm text-ink-soft">
        Configure the quality standards that decide whether a build or website passes as READY FOR RELEASE.
      </p>

      {/* Preset cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {(['strict', 'standard', 'lenient'] as const).map((key) => {
          const p = DEFAULT_RELEASE_GATES[key];
          const meta = PRESET_META[key];
          const isSelected = preset === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className={`rounded-card border p-3 text-left transition-all ${
                isSelected
                  ? 'border-stamp bg-stamp/10 shadow-level-1 ring-1 ring-stamp'
                  : 'border-edge/70 bg-panel hover:border-ink-soft/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink">{meta.name}</span>
                {isSelected && <span className="font-bold text-xs text-stamp-dark">Active</span>}
              </div>
              <p className="text-xs text-ink-soft mt-1">{meta.description}</p>
              <div className="mt-2 text-[11px] font-mono text-ink-soft space-y-0.5">
                <div>Max blockers: {p.maxBlockers}</div>
                <div>Max majors: {p.maxMajors}</div>
                {p.strictAccessibility && <div>A11y: Required</div>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Threshold sliders / inputs */}
      <div className="border-t border-rule pt-4 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-ink-soft">
          Gate Criteria {preset === 'custom' && '(Custom)'}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="gate-max-blockers" className="label">
              Max Blockers Permitted
            </label>
            <input
              id="gate-max-blockers"
              type="number"
              min="0"
              max="20"
              value={gate.maxBlockers ?? 0}
              onChange={(e) => updateGate('maxBlockers', Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="field"
            />
            <p className="mt-1 text-xs text-ink-soft">Critical failures that prevent key user tasks.</p>
          </div>

          <div>
            <label htmlFor="gate-max-majors" className="label">
              Max Major Defects Permitted
            </label>
            <input
              id="gate-max-majors"
              type="number"
              min="0"
              max="50"
              value={gate.maxMajors ?? 0}
              onChange={(e) => updateGate('maxMajors', Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="field"
            />
            <p className="mt-1 text-xs text-ink-soft">High-impact issues with functional workarounds.</p>
          </div>

          <div>
            <label htmlFor="gate-max-minors" className="label">
              Max Minor Defects Permitted
            </label>
            <input
              id="gate-max-minors"
              type="number"
              min="0"
              max="100"
              value={gate.maxMinors ?? 10}
              onChange={(e) => updateGate('maxMinors', Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="field"
            />
            <p className="mt-1 text-xs text-ink-soft">Minor cosmetics, typos, and non-blocking layout shifts.</p>
          </div>

          <div className="flex items-center pt-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-ink">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[#6C9BF2]"
                checked={gate.strictAccessibility ?? false}
                onChange={(e) => updateGate('strictAccessibility', e.target.checked)}
              />
              Require Zero WCAG AA Violations
            </label>
          </div>
        </div>
      </div>

      {message && (
        <p role="status" className="mt-3 text-sm text-pass font-bold">
          ✓ {message}
        </p>
      )}
    </section>
  );
}

/** Automated and recurring check-up scheduler. */
function CheckupSchedules() {
  const [schedules, setSchedules] = useState<CheckupSchedule[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form states
  const [targetUrl, setTargetUrl] = useState('');
  const [cadence, setCadence] = useState<'hourly' | 'daily' | 'weekly'>('daily');
  const [hour, setHour] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [preset, setPreset] = useState<'full' | 'quick'>('full');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listSchedules();
      setSchedules(items);
      setError(null);
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'Could not load recurring schedules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      await addSchedule({
        targetUrl: targetUrl.trim(),
        cadence,
        hour: cadence !== 'hourly' ? hour : undefined,
        dayOfWeek: cadence === 'weekly' ? dayOfWeek : undefined,
        preset,
      });
      setShowAddForm(false);
      setTargetUrl('');
      setNotice('New automated check-up schedule activated.');
      await loadSchedules();
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'Failed to create schedule.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (schedule: CheckupSchedule) => {
    try {
      await toggleSchedule(schedule.id, !schedule.enabled);
      await loadSchedules();
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'Failed to update schedule status.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this automated check-up schedule?')) return;
    try {
      await deleteSchedule(id);
      await loadSchedules();
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'Failed to delete schedule.');
    }
  };

  return (
    <section aria-labelledby="schedules-title" className="mt-8 rounded-lg border-2 border-edge bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 id="schedules-title" className="text-xl font-bold">
          Scheduled Check-ups
        </h2>
        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="btn-primary rounded-control px-3 py-1.5 text-xs font-bold shadow-level-1"
        >
          {showAddForm ? 'Cancel' : '+ New Schedule'}
        </button>
      </div>
      <p className="mb-4 text-sm text-ink-soft">
        Automate recurring release check-ups. The runner executes them in the background and saves full reports.
      </p>

      {notice && (
        <p role="status" className="mb-3 text-sm text-pass font-bold">
          ✓ {notice}
        </p>
      )}

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {/* Add Schedule Form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="mb-6 rounded-card border border-stamp/40 bg-panel p-4 space-y-4">
          <h3 className="font-bold text-sm text-ink">Schedule a New Check-up</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="sched-url" className="label">
                Target Website URL
              </label>
              <input
                id="sched-url"
                type="text"
                required
                placeholder="https://yourapp.com"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                className="field"
              />
            </div>

            <div>
              <label htmlFor="sched-cadence" className="label">
                Recurrence Cadence
              </label>
              <select
                id="sched-cadence"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as any)}
                className="field"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="hourly">Hourly</option>
              </select>
            </div>

            {cadence !== 'hourly' && (
              <div>
                <label htmlFor="sched-hour" className="label">
                  Time of Day (UTC 24h)
                </label>
                <select
                  id="sched-hour"
                  value={hour}
                  onChange={(e) => setHour(parseInt(e.target.value, 10))}
                  className="field"
                >
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>
                      {h.toString().padStart(2, '0')}:00 UTC
                    </option>
                  ))}
                </select>
              </div>
            )}

            {cadence === 'weekly' && (
              <div>
                <label htmlFor="sched-dow" className="label">
                  Day of Week
                </label>
                <select
                  id="sched-dow"
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))}
                  className="field"
                >
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                  <option value={0}>Sunday</option>
                </select>
              </div>
            )}

            <div>
              <label htmlFor="sched-preset" className="label">
                Run Preset
              </label>
              <select
                id="sched-preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value as any)}
                className="field"
              >
                <option value="full">Full check-up (standard breadth)</option>
                <option value="quick">Quick smoke scan (faster)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !targetUrl.trim()}
              className="btn-primary rounded-control px-4 py-2 text-sm font-bold shadow-level-1"
            >
              {saving ? <Spinner label="Saving…" /> : 'Activate Schedule'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="btn-quiet rounded-control px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && !schedules && <Spinner label="Reading automated schedules…" />}

      {schedules && schedules.length === 0 && !showAddForm && (
        <p className="text-sm text-ink-soft py-2">
          No automated schedules configured yet. Click "+ New Schedule" to set up recurring test runs.
        </p>
      )}

      {schedules && schedules.length > 0 && (
        <ul className="divide-y divide-rule">
          {schedules.map((s) => (
            <li key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      s.enabled ? 'bg-pass' : 'bg-ink-soft/40'
                    }`}
                  />
                  <span className="font-bold text-ink text-sm break-all">{s.targetUrl}</span>
                  <span className="rounded bg-panel px-2 py-0.5 font-mono text-xs uppercase text-ink-soft border border-rule">
                    {s.cadence}
                  </span>
                </div>
                <div className="mt-1 text-xs text-ink-soft flex flex-wrap gap-x-3">
                  <span>Next run: {formatWhen(s.nextRunAt)}</span>
                  {s.lastRunAt && <span>Last run: {formatWhen(s.lastRunAt)}</span>}
                  {s.preset && <span>Preset: {s.preset}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggle(s)}
                  className="btn-quiet rounded-control px-2.5 py-1 text-xs font-bold"
                >
                  {s.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(s.id)}
                  className="btn-quiet rounded-control border border-fail/40 px-2.5 py-1 text-xs font-bold text-fail hover:bg-fail/10"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Adds a test account to a site: it signs in first, and only keeps the details when that works. */
function AddSignIn({ host, onSaved }: { host: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginPath, setLoginPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="btn-link mt-2 text-sm" onClick={() => setOpen(true)}>
        Add a sign-in
      </button>
    );
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await addSiteSignIn(host, { role: role.trim() || 'member', username: username.trim(), password, loginPath: loginPath.trim() || undefined });
      setNote(r.note ?? 'Signed in and saved' + (r.landingPath ? ' (lands on ' + r.landingPath + ')' : '') + '.');
      setRole('');
      setUsername('');
      setPassword('');
      setLoginPath('');
      onSaved();
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'That couldn’t be saved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-card border border-edge p-3 sm:grid-cols-2" aria-label={'Add a sign-in for ' + host}>
      <p className="text-sm text-ink-soft sm:col-span-2">Use a test account, not a real person’s. It signs in once to check the details work, then keeps the password in this computer’s keychain.</p>
      <label className="text-sm">
        <span className="mb-1 block font-bold">Who it is (e.g. admin, member)</span>
        <input className="field py-2 text-sm" value={role} placeholder="member" onChange={(e) => setRole(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-bold">Sign-in page</span>
        <input className="field py-2 text-sm" value={loginPath} placeholder="/login" onChange={(e) => setLoginPath(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-bold">Username or email</span>
        <input className="field py-2 text-sm" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-bold">Password</span>
        <input className="field py-2 text-sm" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn-primary min-h-[44px] px-4 text-sm" disabled={busy || !username.trim() || !password}>
          {busy ? 'Signing in…' : 'Test and save'}
        </button>
        <button type="button" className="btn-link text-sm" onClick={() => setOpen(false)}>
          Close
        </button>
        {error && <span role="alert" className="text-sm font-bold">{error}</span>}
        {note && <span role="status" className="text-sm text-ink-soft">{note}</span>}
      </div>
    </form>
  );
}

/** What's remembered per site: whether search is checked, and saved sign-ins, each of which can be forgotten. */
function Sites() {
  const [sites, setSites] = useState<RememberedSite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    listSites()
      .then(setSites)
      .catch((err) => setError(err instanceof RunnerError ? err.message : 'The sites couldn’t be read.'));
  }, []);
  useEffect(load, [load]);
  const [tested, setTested] = useState<Record<string, { ok: boolean; text: string }>>({});
  const test = async (host: string, role: string) => {
    const key = host + '|' + role;
    setTested((t) => ({ ...t, [key]: { ok: true, text: 'Signing in…' } }));
    try {
      const r = await testSiteSignIn(host, role);
      setTested((t) => ({ ...t, [key]: { ok: r.verified, text: r.verified ? 'Works' + (r.landingPath ? ' (lands on ' + r.landingPath + ')' : '') : r.error || 'Didn’t work' } }));
    } catch (err) {
      setTested((t) => ({ ...t, [key]: { ok: false, text: err instanceof RunnerError ? err.message : 'Couldn’t test it.' } }));
    }
  };
  const change = async (host: string, update: { searchChecks?: boolean | null; forgetSignIn?: string }) => {
    try {
      await updateSite(host, update);
      load();
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'That couldn’t be saved.');
    }
  };
  return (
    <section aria-labelledby="sites-title" className="mt-8 rounded-lg border-2 border-edge bg-surface p-5">
      <h2 id="sites-title" className="mb-1 text-xl font-bold">
        Sites
      </h2>
      <p className="mb-4 text-sm text-ink-soft">What’s remembered for each site you’ve checked. Saved passwords stay in this computer’s keychain.</p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!sites && !error && <Spinner label="Reading the sites…" />}
      {sites && sites.length === 0 && <p className="text-ink-soft">No sites yet.</p>}
      {sites && sites.length > 0 && (
        <ul className="divide-y divide-rule">
          {sites.map((site) => (
            <li key={site.host} className="py-3">
              <p className="break-all font-bold">{site.host}</p>
              <p className="text-sm text-ink-soft">
                {site.markedTestCopy ? 'A test copy' : site.owner ? 'Yours' : 'Only looked at'}
              </p>
              <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                Check how search engines see it:
                <select
                  className="field w-auto py-1.5 text-sm"
                  value={site.searchChecks === undefined ? 'default' : site.searchChecks ? 'on' : 'off'}
                  onChange={(e) => void change(site.host, { searchChecks: e.target.value === 'default' ? null : e.target.value === 'on' })}
                >
                  <option value="default">As usual (live site: yes, test copy: no)</option>
                  <option value="on">Yes</option>
                  <option value="off">No</option>
                </select>
              </label>
              {site.signIns.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {site.signIns.map((s) => (
                    <li key={s.role} className="flex flex-wrap items-center gap-x-3">
                      <span>
                        Signs in as <span className="font-bold">{s.role}</span> ({s.username})
                      </span>
                      <button type="button" className="btn-link text-sm" onClick={() => void test(site.host, s.role)}>
                        Test it
                      </button>
                      <button type="button" className="btn-link text-sm" onClick={() => void change(site.host, { forgetSignIn: s.role })}>
                        Forget
                      </button>
                      {tested[site.host + '|' + s.role] && (
                        <span role="status" className={tested[site.host + '|' + s.role].ok ? 'text-ink-soft' : 'font-bold text-ink'}>
                          {tested[site.host + '|' + s.role].text}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <AddSignIn host={site.host} onSaved={load} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
