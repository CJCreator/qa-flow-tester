import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { RunSummary } from '@qa/types';
import { checkReachable, RunnerError, type AiSetup, type Reachability, type RunnerStatus } from '../api';
import { KeyField } from '../components/KeyField';
import { ErrorMessage, Question, Spinner } from '../components/text';
import { Link, PATHS, useTitle } from '../lib/router';
import { canMarkTestCopy, DEFAULT_MAX_PAGES, fullTesting, type CheckedAddress, type CheckupForm } from '../lib/checkup';
import { rejectReason } from '../lib/context';
import { hostOf, normalizeUrl } from '../lib/url';

/** How long typing pauses before the address is checked. */
const CHECK_DELAY_MS = 600;

type AddressCheck = { kind: 'idle' } | { kind: 'checking' } | { kind: 'failed'; message: string };

function factsFrom(url: string, result: Reachability): CheckedAddress {
  return {
    url,
    host: result.host,
    testCopy: result.testCopy,
    remembered: result.remembered,
    reachable: result.ok,
    problem: result.ok ? undefined : { reason: result.reason, suggestion: result.suggestion },
  };
}

/**
 * `/`: a new check-up. The AI key comes first when there isn't one, then the address, which is
 * checked as it's typed. Everything typed lives in App, so nothing is lost on the way to Settings
 * or back from a plan.
 */
export function NewCheckupScreen({
  ai,
  onKeySaved,
  form,
  setForm,
  onStart,
  startError,
  status,
  recent,
}: {
  ai: AiSetup;
  onKeySaved: (model: string) => void;
  form: CheckupForm;
  setForm: Dispatch<SetStateAction<CheckupForm>>;
  onStart: () => Promise<void>;
  startError: string | null;
  status: RunnerStatus;
  recent: RunSummary[] | null;
}) {
  useTitle('New check-up');
  const [check, setCheck] = useState<AddressCheck>({ kind: 'idle' });
  const [starting, setStarting] = useState(false);
  const latestCheck = useRef(0);
  // Open when something was added already; after that, the person decides.
  const [materialsOpen] = useState(() => !!(form.specs.trim() || form.designNotes.trim() || form.journeys.trim()));

  const normalized = normalizeUrl(form.address);
  const url = normalized.ok ? normalized.url : null;
  const facts = form.facts && form.facts.url === url ? form.facts : undefined;

  /** Keeps what the check found. A site not checked before starts from what was remembered for it. */
  const applyFacts = (checked: CheckedAddress) =>
    setForm((f) => {
      const sameSite = f.facts && hostOf(f.facts.url) === hostOf(checked.url);
      return {
        ...f,
        facts: checked,
        ...(sameSite ? {} : { owner: checked.remembered?.owner ?? false, markedTestCopy: checked.remembered?.markedTestCopy ?? false }),
      };
    });

  const runCheck = async (target: string): Promise<CheckedAddress | null> => {
    const id = ++latestCheck.current;
    setCheck({ kind: 'checking' });
    try {
      const checked = factsFrom(target, await checkReachable(target));
      if (id !== latestCheck.current) return null; // a newer address superseded this one
      applyFacts(checked);
      setCheck({ kind: 'idle' });
      return checked;
    } catch (err) {
      if (id === latestCheck.current) setCheck({ kind: 'failed', message: err instanceof RunnerError ? err.message : 'The address couldn’t be checked. Try again.' });
      return null;
    }
  };

  // The address is checked once typing pauses, unless it was checked already.
  useEffect(() => {
    if (!url) {
      latestCheck.current++;
      setCheck({ kind: 'idle' });
      return;
    }
    if (form.facts?.url === url) return;
    const timer = setTimeout(() => void runCheck(url), CHECK_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const scan = async () => {
    if (!url || starting) return;
    setStarting(true);
    try {
      // Checked again unless it just answered, so a site that's down says so here, not mid-scan.
      const checked = facts?.reachable ? facts : await runCheck(url);
      if (checked?.reachable) await onStart();
    } finally {
      setStarting(false);
    }
  };

  const set = <K extends keyof CheckupForm>(key: K, value: CheckupForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const addressError = form.address.trim() && !normalized.ok ? normalized.reason : null;
  const ready = ai.configured && !!url && check.kind !== 'checking' && !starting;
  const hasMaterials = !!(form.specs.trim() || form.designNotes.trim() || form.journeys.trim());

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 py-10 sm:px-6 sm:py-14">
      <ResumeCard status={status} />

      <Question>Which site do you want to check?</Question>

      {!ai.configured && (
        <section aria-labelledby="key-heading" className="mb-10 rounded-lg border-2 border-edge bg-surface p-5">
          <h2 id="key-heading" className="text-lg font-bold">
            First, connect an AI helper
          </h2>
          <p className="mb-4 mt-1 text-ink-soft">
            The AI explores your site and writes the plan. It runs on OpenRouter’s free models, so it costs nothing. You only do this
            once.
          </p>
          <KeyField autoSave onSaved={onKeySaved} />
        </section>
      )}
      {ai.configured && form.address === '' && !startError && (
        <p className="-mt-2 mb-6 text-sm text-ink-soft">Type the address of the site, or of a copy of it you test on.</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void scan();
        }}
        noValidate
      >
        <label htmlFor="url-input" className="label">
          Site address
        </label>
        <input
          id="url-input"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
          placeholder="shop.example.com or localhost:3050"
          aria-describedby="url-status"
          aria-invalid={!!addressError || (facts ? !facts.reachable : undefined)}
          className="field h-14"
        />

        <div id="url-status" className="mt-2 min-h-[1.6em] text-sm" aria-live="polite">
          {addressError && <p className="text-fail">{addressError}</p>}
          {check.kind === 'checking' && <Spinner label="Checking the address…" />}
          {check.kind === 'failed' && <p className="text-fail">{check.message}</p>}
          {check.kind === 'idle' && facts && !facts.reachable && facts.problem && (
            <p className="text-fail">
              <strong>{facts.problem.reason}</strong> {facts.problem.suggestion}
            </p>
          )}
          {check.kind === 'idle' && facts?.reachable && (
            <p className="text-ink-soft">
              Will check <span className="break-all font-mono text-ink">{facts.url}</span>
            </p>
          )}
        </div>

        {facts?.reachable && <SiteKind form={form} facts={facts} set={set} />}

        <details className="mt-6 rounded-lg border-2 border-edge bg-surface" open={materialsOpen || undefined}>
          <summary className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="font-bold">Add specs, design notes or journeys</span> <span className="text-sm text-ink-soft">(optional)</span>
              <span className="block text-sm text-ink-soft">The AI plans with them, so the tests check what your site should do.</span>
            </span>
            {hasMaterials && (
              <span className="shrink-0 rounded border border-pass px-2 py-0.5 text-xs font-bold text-pass">Added</span>
            )}
          </summary>
          <div className="space-y-5 border-t border-rule p-4">
            <Material
              id="specs"
              label="Specs"
              hint="What the product should do: requirements, user stories, rules. For example, “An invoice needs a client and an amount above zero.”"
              value={form.specs}
              onChange={(v) => set('specs', v)}
            />
            <Material
              id="design-notes"
              label="Design notes"
              hint="Colours, fonts and layout rules the site should follow."
              value={form.designNotes}
              onChange={(v) => set('designNotes', v)}
            />
            <Material
              id="journeys"
              label="Journeys to test"
              hint="Things people do on the site, one per line. For example, “Sign in, open an invoice and download it.”"
              value={form.journeys}
              onChange={(v) => set('journeys', v)}
            />
          </div>
        </details>

        <div className="mt-6 flex flex-wrap items-center gap-2 text-ink">
          <label htmlFor="max-pages">Explore up to</label>
          <input
            id="max-pages"
            type="number"
            min={1}
            max={1000}
            value={form.maxPages}
            onChange={(e) => set('maxPages', Math.min(1000, Math.max(1, Math.floor(Number(e.target.value)) || DEFAULT_MAX_PAGES)))}
            aria-describedby="max-pages-hint"
            className="field w-24 py-1.5"
          />
          <span>pages</span>
          <p id="max-pages-hint" className="w-full text-sm text-ink-soft">
            Pages that share a layout are tested through a few of them, so big sites stay quick.
          </p>
        </div>

        {startError && <ErrorMessage>{startError}</ErrorMessage>}

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="submit" disabled={!ready} className="btn-primary px-8">
            {starting ? <Spinner label="Starting…" /> : 'Scan the site'}
          </button>
          <p className="text-sm text-ink-soft">Nothing is tested until you approve the plan.</p>
        </div>
        {!ai.configured && <p className="mt-3 text-sm text-ink-soft">Connect the AI helper above to scan.</p>}
      </form>

      <RecentCheckups runs={recent} />
    </div>
  );
}

/** What the check-up will do on this site, and the two choices that decide it. */
function SiteKind({
  form,
  facts,
  set,
}: {
  form: CheckupForm;
  facts: CheckedAddress;
  set: <K extends keyof CheckupForm>(key: K, value: CheckupForm[K]) => void;
}) {
  const full = fullTesting(form);
  const offerTestCopy = canMarkTestCopy(facts);
  const testCopy = offerTestCopy ? form.markedTestCopy : !!facts.testCopy;
  return (
    <div className="mt-4 space-y-3">
      <p className={`rounded-md border-l-4 px-4 py-3 ${full ? 'border-pass bg-pass-tint' : 'border-warn bg-warn-tint'}`}>
        <strong className={full ? 'text-pass' : 'text-warn'}>{full ? 'Test copy:' : testCopy ? 'Look-only:' : 'Live site:'}</strong>{' '}
        <span className="text-ink">
          {full
            ? 'forms can be filled in and sent.'
            : testCopy
              ? 'nothing is sent or changed. Tick “I own this site” to test forms too.'
              : 'only looked at, nothing is sent or changed.'}
        </span>
      </p>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-edge bg-surface p-4 hover:border-stamp">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-stamp" checked={form.owner} onChange={(e) => set('owner', e.target.checked)} />
        <span>
          <strong className="block">I own this site</strong>
          <span className="block text-sm text-ink-soft">Or its owner said you can test it. Forms are only sent on a test copy.</span>
        </span>
      </label>

      {offerTestCopy && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-edge bg-surface p-4 hover:border-stamp">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-stamp"
            checked={form.markedTestCopy}
            onChange={(e) => set('markedTestCopy', e.target.checked)}
          />
          <span>
            <strong className="block">This is a test copy</strong>
            <span className="block text-sm text-ink-soft">
              A copy for testing, such as a staging site, where sending a form changes nothing real.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

/** One of the optional texts: typed or pasted, or read from a text or Markdown file. */
function Material({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (value: string) => void }) {
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <div>
      <label htmlFor={id} className="label mb-1">
        {label}
      </label>
      <p id={`${id}-hint`} className="mb-2 text-sm text-ink-soft">
        {hint}
      </p>
      <textarea
        id={id}
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        className="field font-mono text-sm"
      />
      <label className="btn-link mt-1 cursor-pointer rounded text-sm focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-stamp">
        Add a file (.md or .txt)
        <input
          type="file"
          accept=".md,.markdown,.txt"
          className="sr-only"
          onChange={async (e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            input.value = '';
            if (!file) return;
            const reason = rejectReason(file.name, file.size);
            setFileError(reason);
            if (reason) return;
            const text = await file.text().catch(() => null);
            if (text === null) {
              setFileError(`“${file.name}” couldn’t be read. Copy its text into the box instead.`);
              return;
            }
            onChange(value.trim() ? `${value.trim()}\n\n${text}` : text);
          }}
        />
      </label>
      {fileError && <p className="mt-1 text-sm text-fail">{fileError}</p>}
    </div>
  );
}

/** A check-up is in progress: where it is, and a way back to it. Opening the app never jumps there on its own. */
function ResumeCard({ status }: { status: RunnerStatus }) {
  const host = status.targetUrl ? hostOf(status.targetUrl) : 'your site';
  const where =
    status.phase === 'scanning'
      ? { text: `Your check-up of ${host} is scanning the site.`, link: 'Watch the scan', to: PATHS.scan }
      : status.phase === 'awaiting-review'
        ? { text: `Your check-up of ${host} is waiting for your review.`, link: 'Open the plan', to: PATHS.plan }
        : status.phase === 'testing'
          ? { text: `Your check-up of ${host} is being tested.`, link: 'Watch the testing', to: PATHS.testing }
          : null;
  if (!where) return null;
  return (
    <section aria-label="Check-up in progress" className="mb-10 rounded-lg border-2 border-stamp bg-stamp-tint p-5">
      <p className="font-bold text-ink">{where.text}</p>
      <Link to={where.to} className="btn-primary mt-3 px-5">
        {where.link} <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

function RecentCheckups({ runs }: { runs: RunSummary[] | null }) {
  if (!runs || runs.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading" className="mt-14 border-t border-rule pt-8">
      <h2 id="recent-heading" className="mb-3 text-lg font-bold">
        Recent check-ups
      </h2>
      <ul className="space-y-2">
        {runs.slice(0, 5).map((run) => (
          <li key={run.runId}>
            <Link
              to={PATHS.report(run.runId)}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border-2 border-rule bg-surface px-4 py-3 hover:border-edge"
            >
              <span className="min-w-0">
                <strong className="block truncate text-ink">{run.host}</strong>
                <span className="text-sm text-ink-soft">{formatWhen(run.timestamp)}</span>
              </span>
              <span className={`text-sm font-bold ${run.ready ? 'text-pass' : 'text-fail'}`}>{run.stamp}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to={PATHS.reports} className="btn-link mt-2">
        See all past check-ups
      </Link>
    </section>
  );
}

/** "30 September, 14:05": when a check-up finished, in the reader's own format. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
