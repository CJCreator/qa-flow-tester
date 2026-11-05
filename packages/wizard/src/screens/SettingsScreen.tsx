import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
  SCHEDULES_OWNER_ONLY,
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
import { useConfirm } from '../components/ConfirmDialog';
import { KeyField } from '../components/KeyField';
import { ErrorMessage, Notice, Spinner } from '../components/text';
import { Badge, Disclosure, EmptyState, LoadError, Page, PageHeader, Section } from '../components/ui';
import { formatWhen, scrollBehavior } from '../lib/format';
import { keySourceText } from '../lib/key-source';
import { Link, PATHS } from '../lib/router';
import { PRESET_META, presetOf, type GatePreset } from '../lib/release-rule';
import { applyTheme, readTheme, saveTheme, type Theme } from '../lib/theme';
import { useDocumentTitle } from '../lib/title';

const PROVIDERS: Array<{ id: AiProviderId; name: string; hint: string }> = [
  { id: 'openrouter', name: 'OpenRouter’s free models', hint: 'Costs nothing. Free models allow 50 requests a day.' },
  { id: 'anthropic', name: 'Anthropic (Claude)', hint: 'Paid: your Anthropic account is charged for each request.' },
  { id: 'openai', name: 'OpenAI', hint: 'Paid: your OpenAI account is charged for each request.' },
  {
    id: 'gemini',
    name: 'Google Gemini',
    hint: 'Paid or free, depending on your Google account. A free key may be used for training.',
  },
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

/** The places on this screen, in order: the index links to them. */
const SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'ai', label: 'AI' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'defaults', label: 'Check-up defaults' },
  { id: 'release-rule', label: 'Release rule' },
  { id: 'schedules', label: 'Scheduled check-ups' },
  { id: 'sites', label: 'Sites' },
  { id: 'website-audit', label: 'Website Audit' },
];

/** What a control that saved tells the person: "Saved" or the error, right next to the control. */
type Result = { ok: boolean; text: string } | null;

function Feedback({ result }: { result: Result }) {
  if (result && !result.ok) {
    return (
      <span role="alert" className="text-sm font-semibold text-fail">
        {result.text}
      </span>
    );
  }
  return (
    <span role="status" className="text-sm font-semibold text-pass">
      {result?.text ?? ''}
    </span>
  );
}

/** Rows of the final height while something loads, so nothing below jumps when it arrives. */
function Skeleton({ rows, rowClass = 'h-11', label }: { rows: number; rowClass?: string; label: string }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`${rowClass} rounded-control bg-panel`} />
        ))}
      </div>
    </div>
  );
}

/**
 * Settings: the AI (service, key, model, and a test of it), the colour theme, the screen sizes a check-up
 * starts with, the release rule, scheduled check-ups, and what's remembered for each site.
 */
export function SettingsScreen({ onKeySaved }: { onKeySaved: (model: string) => void }) {
  useDocumentTitle('Settings');
  const [setup, setSetup] = useState<AiSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [keySaved, setKeySaved] = useState<Result>(null);

  const load = useCallback(() => {
    getAiSetup()
      .then((s) => {
        setSetup(s);
        setError(null);
      })
      .catch((err) => setError(err instanceof RunnerError ? err.message : 'The settings couldn’t be read.'));
  }, []);
  useEffect(load, [load]);

  const provider = setup?.provider ?? 'openrouter';
  const [choosing, setChoosing] = useState<AiProviderId | null>(null);
  const shown = choosing ?? provider;

  const goTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    // Focus follows, so the next Tab continues inside the chosen section.
    const heading = document.getElementById(`${id}-title`) ?? document.getElementById(id);
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  };

  return (
    <Page width="workspace">
      <PageHeader title="Settings" />
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="Settings sections" className="mb-8 lg:sticky lg:top-24 lg:mb-0 lg:self-start">
          <ul className="flex flex-wrap gap-x-5 gap-y-0 lg:grid lg:gap-0">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} onClick={goTo(s.id)} className="btn-link min-h-[44px] min-w-[44px] items-center">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 max-w-form">
          <Section
            id="ai"
            className="scroll-mt-24"
            title="AI"
            description="The AI writes each check-up’s Plan and looks over the screens afterwards. Keys are kept on this computer, never in the browser."
          >
            {error && <LoadError title={error} onRetry={load} />}
            {!setup && !error && <Skeleton rows={4} rowClass="h-[72px]" label="Reading the settings…" />}

            {setup && (
              <>
                {setup.configured && keySourceText(setup.keySource) && (
                  <dl className="mb-5 grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
                    <dt className="text-ink-soft">Where the key is kept</dt>
                    <dd className="font-bold">{keySourceText(setup.keySource)}</dd>
                  </dl>
                )}
                {setup.configured && setup.keySource === 'byok_file' && (
                  <div className="mb-5">
                    <Notice tone="warn" title="The system keychain couldn’t be reached">
                      <p>The key is kept in an encrypted file on this computer instead.</p>
                      <div className="mt-2">
                        <Disclosure summary="Details for developers">
                          To keep the key across a new container or machine, set the QA_KEYS_ENCRYPTION_KEY environment
                          variable to a secret of 32 or more characters.
                        </Disclosure>
                      </div>
                    </Notice>
                  </div>
                )}
                <fieldset className="mb-5">
                  <legend className="label">Which AI to use</legend>
                  <div className="space-y-2">
                    {PROVIDERS.map((p) => (
                      <label
                        key={p.id}
                        className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-control border border-edge px-3 py-2 hover:border-ink"
                      >
                        <input
                          type="radio"
                          name="ai-provider"
                          className="mt-1.5 h-5 w-5 shrink-0 accent-stamp"
                          checked={shown === p.id}
                          onChange={() => {
                            setChoosing(p.id === provider ? null : p.id);
                            setKeySaved(null);
                          }}
                        />
                        <span>
                          <span className="flex flex-wrap items-center gap-2 font-bold">
                            {p.name}
                            {p.id === provider && <Badge tone="pass">In use</Badge>}
                          </span>
                          <span className="block text-sm text-ink-soft">{p.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {FREE_KEY_PRIVACY[shown] && (
                  <div className="mb-5">
                    <Notice
                      tone="warn"
                      title={
                        shown === 'openrouter'
                          ? 'Free models can learn from what you send'
                          : 'A free Gemini key can be used for training'
                      }
                    >
                      {FREE_KEY_PRIVACY[shown]}
                    </Notice>
                  </div>
                )}

                {shown === 'openrouter' ? (
                  <OpenRouterKey
                    setup={choosing ? { ...setup, configured: false, provider: 'openrouter' } : setup}
                    replacing={replacing}
                    setReplacing={setReplacing}
                    saved={keySaved}
                    onSaved={(model) => {
                      setReplacing(false);
                      setChoosing(null);
                      setKeySaved({ ok: true, text: 'Saved. The new key works.' });
                      onKeySaved(model);
                      load();
                    }}
                  />
                ) : (
                  <PaidKey
                    provider={shown}
                    configured={!choosing && setup.configured}
                    saved={keySaved}
                    onSaved={(next) => {
                      setChoosing(null);
                      setKeySaved({ ok: true, text: 'Saved. Check-ups now use it.' });
                      if (next.configured && next.model) onKeySaved(next.model);
                      load();
                    }}
                  />
                )}

                {!choosing && setup.configured && <ModelChoice setup={setup} onSaved={load} />}
                {!choosing && setup.configured && provider === 'openrouter' && <Usage />}
              </>
            )}
          </Section>

          <AppearanceSection />
          <Defaults />
          <ReleaseGates />
          <CheckupSchedules />
          <Sites />

          <Section
            id="website-audit"
            className="scroll-mt-24"
            title="Website Audit"
            description="The Website Audit has settings of its own, apart from the ones on this screen."
          >
            <Link to={PATHS.auditSettings} className="btn-link min-h-[44px]">
              Website Audit settings
            </Link>
          </Section>
        </div>
      </div>
    </Page>
  );
}

/** The colour theme: applied and remembered the moment it is chosen. */
function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [result, setResult] = useState<Result>(null);
  const choose = (next: Theme) => {
    setTheme(next);
    applyTheme(next, document.documentElement);
    saveTheme(next);
    setResult({ ok: true, text: 'Saved' });
  };
  const OPTIONS: Array<{ id: Theme; label: string }> = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  return (
    <Section id="appearance" className="scroll-mt-24" title="Appearance" description="System follows your device.">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Colour theme" className="segmented">
          {OPTIONS.map((o) => (
            <button key={o.id} type="button" aria-pressed={theme === o.id} onClick={() => choose(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <Feedback result={result} />
      </div>
    </Section>
  );
}

function OpenRouterKey({
  setup,
  replacing,
  setReplacing,
  saved,
  onSaved,
}: {
  setup: AiSetup;
  replacing: boolean;
  setReplacing: (on: boolean) => void;
  saved: Result;
  onSaved: (model: string) => void;
}) {
  return (
    <>
      <dl className="mb-5 grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-soft">Key</dt>
        <dd className={`font-bold ${setup.configured ? 'text-pass' : 'text-ink-soft'}`}>
          {setup.configured ? '✓ Saved' : 'No key yet'}
        </dd>
      </dl>
      {setup.configured && !replacing ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-quiet" onClick={() => setReplacing(true)}>
            Replace the key
          </button>
          <Feedback result={saved} />
        </div>
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
function PaidKey({
  provider,
  configured,
  saved,
  onSaved,
}: {
  provider: AiProviderId;
  configured: boolean;
  saved: Result;
  onSaved: (setup: AiSetup) => void;
}) {
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
          setError(err instanceof RunnerError ? err.message : 'The key couldn’t be saved. Check it and save again.');
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
      <div className="flex flex-wrap items-center gap-3">
        {/* The first key is the one thing to do; once a key exists the model choice is the primary. */}
        <button type="submit" className={configured ? 'btn-quiet' : 'btn-primary'} disabled={saving || !key.trim()}>
          {saving ? <Spinner label="Saving…" announce={false} /> : configured ? 'Save the new key' : `Use ${name}`}
        </button>
        <Feedback result={error ? { ok: false, text: error } : saved} />
      </div>
    </form>
  );
}

/** The model the plan is written with (and the one that looks at screens), and a test that it answers. */
function ModelChoice({ setup, onSaved }: { setup: AiSetup; onSaved: () => void }) {
  const openRouter = (setup.provider ?? 'openrouter') === 'openrouter';
  const [models, setModels] = useState<FreeModel[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [text, setText] = useState<string>(setup.chosenBy === 'person' ? (setup.model ?? '') : '');
  const [vision, setVision] = useState<string>(setup.chosenBy === 'person' ? (setup.visionModel ?? '') : '');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [test, setTest] = useState<{
    running: boolean;
    result?: { ok: boolean; ms: number; reason?: string; model?: string };
    error?: string;
  }>({ running: false });

  const loadModels = useCallback(() => {
    setListError(null);
    listFreeModels()
      .then(setModels)
      .catch((err) => setListError(err instanceof RunnerError ? err.message : 'The model list couldn’t be read.'));
  }, []);
  useEffect(() => {
    if (!openRouter || !setup.configured) return;
    loadModels();
  }, [openRouter, setup.configured, loadModels]);

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      await saveAiSettings({
        provider: setup.provider ?? 'openrouter',
        model: text || null,
        visionModel: vision || null,
      });
      setResult({ ok: true, text: 'Saved' });
      onSaved();
    } catch (err) {
      setResult({ ok: false, text: err instanceof RunnerError ? err.message : 'The model couldn’t be saved.' });
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
      <h3 className="mb-1 text-lg font-bold">Model</h3>
      <p className="mb-3 text-sm text-ink-soft">
        In use: <span className="break-all font-mono text-ink">{setup.model ?? 'None free right now'}</span>
        {setup.chosenBy === 'person' ? ' (your choice)' : ' (chosen automatically)'}
      </p>

      {openRouter ? (
        <>
          <label htmlFor="text-model" className="label">
            Writes the plan
          </label>
          {listError && <LoadError title={listError} onRetry={loadModels} />}
          <select
            id="text-model"
            className="field mb-4"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!models}
          >
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
          <select
            id="vision-model"
            className="field mb-4"
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            disabled={!models}
          >
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

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner label="Saving…" announce={false} /> : 'Save the model choice'}
        </button>
        <Feedback result={result} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-quiet"
          disabled={test.running}
          onClick={() => void runTest()}
          aria-describedby="test-model-hint"
        >
          {test.running ? <Spinner label="Asking the model…" announce={false} /> : 'Test this model'}
        </button>
        <div role="status" className="text-sm">
          {test.result?.ok && test.result.ms != null && (
            <span className="font-semibold text-pass">It answered in {(test.result.ms / 1000).toFixed(1)} s.</span>
          )}
          {test.result && !test.result.ok && <span className="font-semibold text-fail">{test.result.reason}</span>}
          {test.error && <span className="font-semibold text-fail">{test.error}</span>}
        </div>
      </div>
      <p id="test-model-hint" className="mt-2 text-sm text-ink-soft">
        Sends one short request{openRouter ? ', which counts toward today’s free requests' : ''}.
      </p>
    </div>
  );
}

/** Today's free requests: read after the rest of Settings, since it asks OpenRouter. */
function Usage() {
  const [usage, setUsage] = useState<{ requestsLeft: number | null; requestsLimit: number | null } | null | 'failed'>(
    null
  );
  useEffect(() => {
    getAiUsage()
      .then(setUsage)
      .catch(() => setUsage('failed'));
  }, []);
  return (
    <dl className="mt-6 grid gap-x-4 gap-y-2 border-t border-rule pt-5 sm:grid-cols-[12rem_1fr]">
      <dt className="text-ink-soft">Free requests left today</dt>
      <dd className="min-h-[44px] text-ink">
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
  const [result, setResult] = useState<Result>(null);
  useEffect(() => {
    getDefaults()
      .then((d) => setSizes(d.screenSizes))
      .catch(() => setSizes(['375px', '768px', '1440px']));
  }, []);
  const toggle = async (size: ScreenSize, on: boolean) => {
    if (!sizes) return;
    const next = on
      ? SIZES.map((s) => s.id).filter((s) => s === size || sizes.includes(s))
      : sizes.filter((s) => s !== size);
    try {
      setSizes((await saveDefaults({ screenSizes: next })).screenSizes);
      setResult({ ok: true, text: 'Saved' });
    } catch (err) {
      setResult({ ok: false, text: err instanceof RunnerError ? err.message : 'That couldn’t be saved.' });
    }
  };
  return (
    <Section
      id="defaults"
      className="scroll-mt-24"
      title="Check-up defaults"
      description="The screen sizes a new check-up starts with. You can still change them in each Plan."
    >
      {!sizes ? (
        <Skeleton rows={1} label="Reading the defaults…" />
      ) : (
        <fieldset>
          <legend className="sr-only">Screen sizes</legend>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {SIZES.map((s) => (
              <label key={s.id} className="flex min-h-[44px] cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-stamp"
                  checked={sizes.includes(s.id)}
                  disabled={sizes.length === 1 && sizes.includes(s.id)}
                  onChange={(e) => void toggle(s.id, e.target.checked)}
                />
                {s.label}
              </label>
            ))}
            <Feedback result={result} />
          </div>
        </fieldset>
      )}
    </Section>
  );
}

/** One limit on the release rule. A limit that isn't set reads "No limit", not 0. */
function LimitField({
  id,
  label,
  hint,
  value,
  max,
  unlimitedWhenUnset,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number | undefined;
  max: number;
  unlimitedWhenUnset: boolean;
  onChange: (n: number) => void;
}) {
  const unlimited = unlimitedWhenUnset && value === undefined;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="number"
          min="0"
          max={max}
          value={unlimited ? '' : (value ?? 0)}
          placeholder={unlimited ? '–' : undefined}
          onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
          className="field w-28"
        />
        {unlimited && <span className="text-sm font-semibold text-ink">No limit</span>}
      </div>
      <p className="hint mt-1">{hint}</p>
    </div>
  );
}

/** The one release rule: the three named rules from verdict.ts, or a custom one. The stamp always uses Standard. */
function ReleaseGates() {
  const [gate, setGate] = useState<ReleaseGateCriteria>(() => getStoredReleaseGates());
  const [preset, setPreset] = useState<GatePreset | 'custom'>(() => presetOf(getStoredReleaseGates()));
  const [presetResult, setPresetResult] = useState<Result>(null);
  const [limitResult, setLimitResult] = useState<Result>(null);

  const applyPreset = (key: GatePreset) => {
    const next = { ...DEFAULT_RELEASE_GATES[key] };
    setPreset(key);
    setGate(next);
    saveStoredReleaseGates(next);
    setLimitResult(null);
    setPresetResult({ ok: true, text: `Saved. Your release rule is now ${PRESET_META[key].name}.` });
  };

  const updateGate = <K extends keyof ReleaseGateCriteria>(key: K, val: ReleaseGateCriteria[K]) => {
    setPreset('custom');
    const next: ReleaseGateCriteria = {
      ...gate,
      [key]: val,
    };
    setGate(next);
    saveStoredReleaseGates(next);
    setPresetResult(null);
    setLimitResult({ ok: true, text: 'Saved. Your own release rule is in use.' });
  };

  return (
    <Section
      id="release-rule"
      className="scroll-mt-24"
      title="Release rule"
      description={
        <>
          Your release rule is kept in this browser. The stamp on every report always uses the Standard rule. Your rule
          is shown beside the stamp and never changes it.
        </>
      }
    >
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(['strict', 'standard', 'lenient'] as const).map((key) => {
          const p = DEFAULT_RELEASE_GATES[key];
          const meta = PRESET_META[key];
          const isSelected = preset === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => applyPreset(key)}
              className={`min-h-[44px] rounded-card border p-3 text-left text-sm transition-colors duration-fast ease-standard ${
                isSelected ? 'border-ink bg-surface' : 'border-edge bg-panel hover:border-ink'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-bold text-ink">{meta.name}</span>
                {isSelected && <Badge tone="stamp">In use</Badge>}
              </span>
              <span className="mt-1 block text-ink-soft">{meta.description}</span>
              <span className="mt-2 block space-y-0.5 text-ink-soft">
                <span className="block">Must-fix problems allowed: {p.maxBlockers ?? 0}</span>
                <span className="block">Should-fix problems allowed: {p.maxMajors ?? 'no limit'}</span>
                <span className="block">
                  {p.minAreaGrade ? `Lowest area grade: ${p.minAreaGrade}` : 'Area grades: not checked'}
                </span>
                {p.strictAccessibility && <span className="block">Accessibility: grade A required</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mb-6 min-h-[20px]">
        <Feedback result={presetResult} />
      </div>

      <div className="border-t border-rule pt-5">
        <h3 className="mb-4 text-lg font-bold">Limits {preset === 'custom' && '(your own)'}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LimitField
            id="gate-max-blockers"
            label="Most must-fix problems allowed"
            hint="Problems that stop people finishing key tasks."
            value={gate.maxBlockers}
            max={20}
            unlimitedWhenUnset={false}
            onChange={(n) => updateGate('maxBlockers', n)}
          />
          <LimitField
            id="gate-max-majors"
            label="Most should-fix problems allowed"
            hint="Big problems that have a workaround."
            value={gate.maxMajors}
            max={50}
            unlimitedWhenUnset
            onChange={(n) => updateGate('maxMajors', n)}
          />
          <LimitField
            id="gate-max-minors"
            label="Most minor problems allowed"
            hint="Small looks, typos and layout shifts that don’t block anyone."
            value={gate.maxMinors}
            max={100}
            unlimitedWhenUnset
            onChange={(n) => updateGate('maxMinors', n)}
          />
          <div className="flex items-start">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 font-semibold text-ink sm:mt-6">
              <input
                type="checkbox"
                className="h-5 w-5 accent-stamp"
                checked={gate.strictAccessibility ?? false}
                onChange={(e) => updateGate('strictAccessibility', e.target.checked)}
              />
              Every accessibility check must pass (WCAG AA)
            </label>
          </div>
        </div>
        <div className="mt-3 min-h-[20px]">
          <Feedback result={limitResult} />
        </div>
      </div>
    </Section>
  );
}

/** Check-ups that start on their own and save a report. */
function CheckupSchedules() {
  const [schedules, setSchedules] = useState<CheckupSchedule[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const { confirm, dialog } = useConfirm();

  // Form states
  const [targetUrl, setTargetUrl] = useState('');
  const [cadence, setCadence] = useState<'hourly' | 'daily' | 'weekly'>('daily');
  const [hour, setHour] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [preset, setPreset] = useState<'full' | 'quick'>('full');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ownerOnly, setOwnerOnly] = useState(false);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listSchedules();
      setSchedules(items);
      setLoadError(null);
      setOwnerOnly(false);
    } catch (err) {
      if (err instanceof RunnerError && err.code === 'ERR_FORBIDDEN') {
        setOwnerOnly(true);
        setShowAddForm(false);
        return;
      }
      setLoadError(err instanceof RunnerError ? err.message : 'The scheduled check-ups couldn’t be read.');
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
    setActionError(null);
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
      setNotice('Schedule added');
      await loadSchedules();
    } catch (err) {
      setActionError(err instanceof RunnerError ? err.message : 'The schedule couldn’t be added. Check the address.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (schedule: CheckupSchedule) => {
    setNotice(null);
    setActionError(null);
    try {
      await toggleSchedule(schedule.id, !schedule.enabled);
      await loadSchedules();
      setNotice(schedule.enabled ? 'Schedule paused' : 'Schedule resumed');
    } catch (err) {
      setActionError(err instanceof RunnerError ? err.message : 'The schedule couldn’t be updated.');
    }
  };

  const handleDelete = async (s: CheckupSchedule) => {
    const ok = await confirm({
      title: 'Delete this schedule?',
      body: `Check-ups of ${s.targetUrl} will stop starting on their own. Reports they already saved stay.`,
      confirmLabel: 'Delete the schedule',
      danger: true,
    });
    if (!ok) return;
    setNotice(null);
    setActionError(null);
    try {
      await deleteSchedule(s.id);
      await loadSchedules();
      setNotice('Schedule deleted');
    } catch (err) {
      setActionError(err instanceof RunnerError ? err.message : 'The schedule couldn’t be deleted.');
    }
  };

  return (
    <Section
      id="schedules"
      className="scroll-mt-24"
      title="Scheduled check-ups"
      description="Check-ups that start on their own and save a full report. Times follow the server’s clock (UTC on the shared copy)."
      actions={
        !ownerOnly && !showAddForm ? (
          <button type="button" onClick={() => setShowAddForm(true)} className="btn-quiet min-h-[44px]">
            Add a schedule
          </button>
        ) : undefined
      }
    >
      {dialog}
      {ownerOnly && <Notice tone="warn" title={SCHEDULES_OWNER_ONLY} />}
      {loadError && <LoadError title={loadError} onRetry={() => void loadSchedules()} />}
      {actionError && <ErrorMessage>{actionError}</ErrorMessage>}

      {showAddForm && (
        <form onSubmit={handleAdd} className="mb-6 space-y-4 rounded-card border border-rule bg-surface p-4">
          <h3 className="text-lg font-bold">New scheduled check-up</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="sched-url" className="label">
                Site address
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
                How often
              </label>
              <select
                id="sched-cadence"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as 'hourly' | 'daily' | 'weekly')}
                className="field"
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="hourly">Every hour</option>
              </select>
            </div>

            {cadence !== 'hourly' && (
              <div>
                <label htmlFor="sched-hour" className="label">
                  Time of day (UTC)
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
                  Day of the week
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
                How thorough
              </label>
              <select
                id="sched-preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value as 'full' | 'quick')}
                className="field"
              >
                <option value="full">Full check-up</option>
                <option value="quick">Shorter check-up (faster)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving || !targetUrl.trim()} className="btn-quiet min-h-[44px]">
              {saving ? <Spinner label="Saving…" announce={false} /> : 'Save the schedule'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="btn-link min-h-[44px]">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && !schedules && !ownerOnly && (
        <Skeleton rows={1} rowClass="h-16" label="Reading the scheduled check-ups…" />
      )}

      {schedules && schedules.length === 0 && !showAddForm && (
        <p className="py-2 text-ink-soft">
          No scheduled check-ups yet. Choose “Add a schedule” to have a site checked on its own.
        </p>
      )}

      {schedules && schedules.length > 0 && (
        <ul className="divide-y divide-rule">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-sm font-bold text-ink">{s.targetUrl}</span>
                  <Badge>{s.cadence === 'daily' ? 'Daily' : s.cadence === 'weekly' ? 'Weekly' : 'Hourly'}</Badge>
                  {!s.enabled && <Badge tone="warn">Paused</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink-soft">
                  <span>Next check-up: {formatWhen(s.nextRunAt)}</span>
                  {s.lastRunAt && <span>Last check-up: {formatWhen(s.lastRunAt)}</span>}
                  {s.preset && <span>{s.preset === 'quick' ? 'Shorter check-up' : 'Full check-up'}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void handleToggle(s)} className="btn-quiet btn-sm min-h-[44px]">
                  {s.enabled ? 'Pause' : 'Resume'}
                </button>
                <button type="button" onClick={() => void handleDelete(s)} className="btn-link min-h-[44px] text-fail">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 min-h-[20px]">
        <Feedback result={notice ? { ok: true, text: notice } : null} />
      </div>
    </Section>
  );
}

/** One labelled text field of the sign-in form. */
function SignInField({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-bold">{label}</span>
      {hint && <span className="mb-1 block text-xs text-ink-soft">{hint}</span>}
      {children}
    </label>
  );
}

/** Adds a test account to a site: it signs in first, and only keeps the details when that works. */
function AddSignIn({ host, onSaved }: { host: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginPath, setLoginPath] = useState('');
  const [usernameSelector, setUsernameSelector] = useState('');
  const [passwordSelector, setPasswordSelector] = useState('');
  const [submitSelector, setSubmitSelector] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="btn-link mt-1 min-h-[44px] text-sm" onClick={() => setOpen(true)}>
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
      const r = await addSiteSignIn(host, {
        role: role.trim() || 'member',
        username: username.trim(),
        password,
        loginPath: loginPath.trim() || undefined,
        usernameSelector: usernameSelector.trim() || undefined,
        passwordSelector: passwordSelector.trim() || undefined,
        submitSelector: submitSelector.trim() || undefined,
      });
      setNote(r.note ?? 'Signed in and saved' + (r.landingPath ? ' (lands on ' + r.landingPath + ')' : '') + '.');
      setRole('');
      setUsername('');
      setPassword('');
      setLoginPath('');
      setUsernameSelector('');
      setPasswordSelector('');
      setSubmitSelector('');
      setShowAdvanced(false);
      onSaved();
    } catch (err) {
      setError(err instanceof RunnerError ? err.message : 'That couldn’t be saved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className="mt-3 grid gap-3 rounded-card border border-rule bg-surface p-4 sm:grid-cols-2"
      aria-label={'Add a sign-in for ' + host}
    >
      <p className="text-sm text-ink-soft sm:col-span-2">
        Use a test sign-in, not a real person’s. It signs in once to check the details work, then keeps the password in
        this computer’s keychain.
      </p>
      <SignInField label="Who it is (e.g. admin, member)">
        <input className="field" value={role} placeholder="member" onChange={(e) => setRole(e.target.value)} />
      </SignInField>
      <SignInField label="Sign-in page" hint="Where the sign-in form is, for example /login">
        <input
          className="field font-mono"
          value={loginPath}
          placeholder="/login"
          onChange={(e) => setLoginPath(e.target.value)}
        />
      </SignInField>
      <SignInField label="Username or email">
        <input
          className="field"
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </SignInField>
      <SignInField label="Password">
        <input
          className="field"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </SignInField>
      <div className="sm:col-span-2">
        <button
          type="button"
          className="btn-link min-h-[44px] text-sm"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? 'Hide advanced settings' : 'Advanced (custom form selectors)'}
        </button>
        {showAdvanced ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <SignInField label="Username selector">
              <input
                className="field font-mono"
                placeholder='input[name="user"]'
                value={usernameSelector}
                onChange={(e) => setUsernameSelector(e.target.value)}
              />
            </SignInField>
            <SignInField label="Password selector">
              <input
                className="field font-mono"
                placeholder='input[type="password"]'
                value={passwordSelector}
                onChange={(e) => setPasswordSelector(e.target.value)}
              />
            </SignInField>
            <SignInField label="Submit button selector">
              <input
                className="field font-mono"
                placeholder='button[type="submit"]'
                value={submitSelector}
                onChange={(e) => setSubmitSelector(e.target.value)}
              />
            </SignInField>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn-quiet min-h-[44px]" disabled={busy || !username.trim() || !password}>
          {busy ? 'Signing in…' : 'Test and save'}
        </button>
        <button type="button" className="btn-link min-h-[44px] text-sm" onClick={() => setOpen(false)}>
          Close
        </button>
        {error && (
          <span role="alert" className="text-sm font-semibold text-fail">
            {error}
          </span>
        )}
        {note && (
          <span role="status" className="text-sm text-ink-soft">
            {note}
          </span>
        )}
      </div>
    </form>
  );
}

/** What's remembered per site: whether search is checked, and saved sign-ins, each of which can be forgotten. */
function Sites() {
  const [sites, setSites] = useState<RememberedSite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Result>(null);
  const { confirm, dialog } = useConfirm();
  const load = useCallback(() => {
    setError(null);
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
      setTested((t) => ({
        ...t,
        [key]: {
          ok: r.verified,
          text: r.verified
            ? 'Works' + (r.landingPath ? ' (lands on ' + r.landingPath + ')' : '')
            : r.error || 'Didn’t work',
        },
      }));
    } catch (err) {
      setTested((t) => ({
        ...t,
        [key]: { ok: false, text: err instanceof RunnerError ? err.message : 'Couldn’t test it.' },
      }));
    }
  };
  const change = async (
    host: string,
    update: { searchChecks?: boolean | null; forgetSignIn?: string },
    done: string
  ) => {
    setNotice(null);
    try {
      await updateSite(host, update);
      setNotice({ ok: true, text: done });
      load();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof RunnerError ? err.message : 'That couldn’t be saved.' });
    }
  };
  const forget = async (host: string, role: string) => {
    const ok = await confirm({
      title: `Forget the ${role} sign-in for ${host}?`,
      body: 'The saved password is removed from this computer’s keychain. Check-ups of this site won’t sign in as this account until you add it again.',
      confirmLabel: 'Forget the sign-in',
      danger: true,
    });
    if (ok) await change(host, { forgetSignIn: role }, 'Sign-in forgotten');
  };
  return (
    <Section
      id="sites"
      className="scroll-mt-24"
      title="Sites"
      description="What’s remembered for each site you’ve checked. Saved passwords stay in this computer’s keychain."
    >
      {dialog}
      {error && <LoadError title={error} onRetry={load} />}
      {!sites && !error && <Skeleton rows={2} rowClass="h-24" label="Reading the sites…" />}
      {sites && sites.length === 0 && (
        <EmptyState title="No sites yet">Sites appear here after their first check-up.</EmptyState>
      )}
      {sites && sites.length > 0 && (
        <ul className="divide-y divide-rule">
          {sites.map((site) => (
            <li key={site.host} className="py-3">
              <p className="break-all font-mono font-bold">{site.host}</p>
              <p className="text-sm text-ink-soft">
                {site.markedTestCopy ? 'A test copy' : site.owner ? 'Yours' : 'Only looked at'}
              </p>
              <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                Check how search engines see it:
                <select
                  className="field w-auto min-w-0 max-w-full"
                  value={site.searchChecks === undefined ? 'default' : site.searchChecks ? 'on' : 'off'}
                  onChange={(e) =>
                    void change(
                      site.host,
                      { searchChecks: e.target.value === 'default' ? null : e.target.value === 'on' },
                      'Saved'
                    )
                  }
                >
                  <option value="default">As usual (live site: yes, test copy: no)</option>
                  <option value="on">Yes</option>
                  <option value="off">No</option>
                </select>
              </label>
              {site.signIns.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {site.signIns.map((s) => {
                    const t = tested[site.host + '|' + s.role];
                    return (
                      <li key={s.role} className="flex flex-wrap items-center gap-x-3">
                        <span>
                          Signs in as <span className="font-bold">{s.role}</span> ({s.username})
                        </span>
                        <button
                          type="button"
                          className="btn-link min-h-[44px] text-sm"
                          onClick={() => void test(site.host, s.role)}
                        >
                          Test it
                        </button>
                        <button
                          type="button"
                          className="btn-link min-h-[44px] text-sm text-fail"
                          onClick={() => void forget(site.host, s.role)}
                        >
                          Forget
                        </button>
                        {t && (
                          <span
                            role={t.ok ? 'status' : 'alert'}
                            className={t.ok ? 'text-ink-soft' : 'font-semibold text-fail'}
                          >
                            {t.text}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <AddSignIn host={site.host} onSaved={load} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 min-h-[20px]">
        <Feedback result={notice} />
      </div>
    </Section>
  );
}
