import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuditStartErrors, AuditStartReply } from '@qa/types/src/browser.js';
import { ErrorMessage, Spinner } from '../../../components/text';
import { Disclosure, Page, PageHeader } from '../../../components/ui';
import { count } from '../../../lib/format';
import { Link, PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import {
  AUDIT_FIELD_HINTS,
  AUDIT_LIMIT_BOUNDS,
  estimateAiRequests,
  errorId,
  fieldId,
  firstErrorField,
  hintId,
  initialAuditStartForm,
  pathLines,
  type AuditFormField,
  type AuditStartForm,
} from './audit-start-form';
import {
  auditStoppedText,
  submitAuditStart,
  watchAudit,
  type AuditEventSourceFactory,
  type AuditStartOutcome,
  type RunningInfo,
} from './audit-start-api';
import { applyAuditEvent, AuditProgress, type AuditProgressState } from './AuditProgress';

/** The fields inside "Limits (optional)": the disclosure opens when one of them has a message. */
const LIMIT_FIELDS: readonly AuditFormField[] = ['maxPages', 'maxDepth', 'includePaths', 'excludePaths'];

/** The current limits in words, beside the closed disclosure: "200 pages · 8 links deep". */
function limitsHint(form: AuditStartForm): string {
  const parts = [`${form.maxPages.trim() || '?'} pages`, `${form.maxDepth.trim() || '?'} links deep`];
  const only = pathLines(form.includePaths).length;
  const skip = pathLines(form.excludePaths).length;
  if (only > 0) parts.push(`only ${count(only, 'path', 'paths')}`);
  if (skip > 0) parts.push(`${count(skip, 'path', 'paths')} skipped`);
  return parts.join(' · ');
}

/** `aria-describedby` for a field: its hint, then its error when it has one. */
function describedBy(field: AuditFormField, errors: AuditStartErrors): string {
  return errors[field] ? `${hintId(field)} ${errorId(field)}` : hintId(field);
}

function FieldError({ field, errors }: { field: AuditFormField; errors: AuditStartErrors }) {
  const message = errors[field];
  if (!message) return null;
  return (
    <p id={errorId(field)} role="alert" className="mt-1 text-sm font-medium text-fail">
      {message}
    </p>
  );
}

function Field({
  field,
  label,
  errors,
  children,
}: {
  field: AuditFormField;
  label: string;
  errors: AuditStartErrors;
  children: ReactNode;
}) {
  return (
    <div className="mt-5">
      <label htmlFor={fieldId(field)} className="label text-ink">
        {label}
      </label>
      {children}
      <p id={hintId(field)} className="mt-1 text-sm text-ink-soft">
        {AUDIT_FIELD_HINTS[field]}
      </p>
      <FieldError field={field} errors={errors} />
    </div>
  );
}

/**
 * The Website Audit start form (REQ-001, REQ-002): the address and the crawl limits. Every field has a
 * label and a hint, and its message, when it has one, is linked to it and read out.
 */
export function AuditStartFields({
  form,
  errors,
  message,
  busyRun,
  starting,
  onChange,
  onSubmit,
}: {
  form: AuditStartForm;
  errors: AuditStartErrors;
  /** A refusal for the whole form, in plain words. */
  message: string | null;
  /** Info on another active check-up or audit refusing this start. */
  busyRun?: RunningInfo | null;
  starting: boolean;
  onChange: (form: AuditStartForm) => void;
  onSubmit: () => void;
}) {
  const set = (key: keyof AuditStartForm) => (e: { target: { value: string } }) =>
    onChange({ ...form, [key]: e.target.value });
  const b = AUDIT_LIMIT_BOUNDS;

  return (
    <form
      noValidate
      aria-label="Start a Website Audit"
      onSubmit={(e) => {
        e.preventDefault();
        if (!starting) onSubmit();
      }}
    >
      <Field field="url" label="Website address" errors={errors}>
        <input
          id={fieldId('url')}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          required
          className="field h-14 text-lg font-mono placeholder:font-sans"
          placeholder="https://example.com"
          value={form.address}
          onChange={set('address')}
          aria-invalid={errors.url ? true : undefined}
          aria-describedby={describedBy('url', errors)}
        />
      </Field>

      <Disclosure
        summary="Limits (optional)"
        hint={limitsHint(form)}
        defaultOpen={LIMIT_FIELDS.some((field) => errors[field])}
        className="mt-8"
      >
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Field field="maxPages" label="Most pages to read" errors={errors}>
            <input
              id={fieldId('maxPages')}
              name="maxPages"
              type="number"
              inputMode="numeric"
              min={b.minPages}
              max={b.maxPages}
              step={1}
              className="field w-32"
              value={form.maxPages}
              onChange={set('maxPages')}
              aria-invalid={errors.maxPages ? true : undefined}
              aria-describedby={describedBy('maxPages', errors)}
            />
          </Field>
          <Field field="maxDepth" label="How many links deep" errors={errors}>
            <input
              id={fieldId('maxDepth')}
              name="maxDepth"
              type="number"
              inputMode="numeric"
              min={b.minDepth}
              max={b.maxDepth}
              step={1}
              className="field w-32"
              value={form.maxDepth}
              onChange={set('maxDepth')}
              aria-invalid={errors.maxDepth ? true : undefined}
              aria-describedby={describedBy('maxDepth', errors)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Field field="includePaths" label="Only read pages under these paths" errors={errors}>
            <textarea
              id={fieldId('includePaths')}
              name="includePaths"
              rows={3}
              spellCheck={false}
              className="field w-full font-mono text-sm"
              placeholder="/blog"
              value={form.includePaths}
              onChange={set('includePaths')}
              aria-invalid={errors.includePaths ? true : undefined}
              aria-describedby={describedBy('includePaths', errors)}
            />
          </Field>
          <Field field="excludePaths" label="Skip pages under these paths" errors={errors}>
            <textarea
              id={fieldId('excludePaths')}
              name="excludePaths"
              rows={3}
              spellCheck={false}
              className="field w-full font-mono text-sm"
              placeholder="/admin"
              value={form.excludePaths}
              onChange={set('excludePaths')}
              aria-invalid={errors.excludePaths ? true : undefined}
              aria-describedby={describedBy('excludePaths', errors)}
            />
          </Field>
        </div>

        <p className="mt-4 text-sm text-ink-soft">
          This audit will make about {estimateAiRequests(form.maxPages)} AI requests.
        </p>
      </Disclosure>

      {message && (
        <div id="audit-start-message">
          <ErrorMessage>
            {message}
            {busyRun && (
              <span className="mt-2 block">
                <Link to={busyRun.href} className="font-semibold underline">
                  {busyRun.kind === 'checkup' ? 'Open the Check-up' : 'Open the Website Audit'}
                </Link>
              </span>
            )}
          </ErrorMessage>
        </div>
      )}

      <div className="mt-8">
        <button
          type="submit"
          className="btn-primary w-full px-8 sm:w-auto"
          disabled={starting}
          aria-describedby={message ? 'audit-start-message' : undefined}
        >
          {starting ? <Spinner label="Starting…" /> : 'Start the Website Audit'}
        </button>
      </div>
    </form>
  );
}

/**
 * The next step once the audit ends, as the screen's one primary action: the results of `version` when it is
 * done, its history otherwise.
 */
export function AuditFollowUpLink({ auditId, done, version }: { auditId: string; done: boolean; version?: number }) {
  const to = done && version !== undefined ? PATHS.auditVersion(auditId, version) : PATHS.audit(auditId);
  return (
    <Link to={to} className="btn-primary btn-sm">
      {done ? 'See the results' : "Open this Website Audit's history"}
    </Link>
  );
}

export interface AuditStartScreenProps {
  /** Overrides for tests: the request and the stream. */
  submit?: (form: AuditStartForm) => Promise<AuditStartOutcome>;
  openSource?: AuditEventSourceFactory;
}

/**
 * The Website Audit start screen: the form, then the audit's progress from its stream. English only
 * (ADR 0033). A Website Audit has no release verdict, so nothing here judges the website.
 */
export function AuditStartScreen({ submit = submitAuditStart, openSource }: AuditStartScreenProps = {}) {
  const [form, setForm] = useState<AuditStartForm>(initialAuditStartForm);
  const [errors, setErrors] = useState<AuditStartErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busyRun, setBusyRun] = useState<RunningInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<{ reply: AuditStartReply; address: string } | null>(null);
  const [progress, setProgress] = useState<AuditProgressState>({ status: 'starting' });
  const [reconnecting, setReconnecting] = useState(false);
  const [streamEnded, setStreamEnded] = useState(false);
  const [doneVersion, setDoneVersion] = useState<number | null>(null);
  useDocumentTitle('New Website Audit');
  const focusAfterRefusal = useRef<AuditFormField | null>(null);

  useEffect(() => {
    const field = focusAfterRefusal.current;
    if (!field) return;
    focusAfterRefusal.current = null;
    const input = document.getElementById(fieldId(field));
    // A limit field sits inside "Limits (optional)": open it first, so the field can take focus.
    const details = input?.closest('details');
    if (details) details.open = true;
    input?.focus();
  }, [errors]);

  useEffect(() => {
    if (!started) return;
    return watchAudit(
      started.reply,
      {
        onEvent: (event) => {
          if (event.type === 'done') setDoneVersion(event.version);
          setProgress((state) => applyAuditEvent(state, event, auditStoppedText));
        },
        onDrop: () => setReconnecting(true),
        onOpen: () => setReconnecting(false),
        onEnd: () => {
          setReconnecting(false);
          setStreamEnded(true);
        },
      },
      openSource
    );
  }, [started, openSource]);

  const onSubmit = async () => {
    setStarting(true);
    setMessage(null);
    setBusyRun(null);
    const outcome = await submit(form);
    setStarting(false);
    if (outcome.kind === 'started') {
      setErrors({});
      setProgress({ status: 'starting' });
      setDoneVersion(null);
      setStarted({ reply: outcome.reply, address: form.address.trim() });
      return;
    }
    const fieldErrors = outcome.errors ?? {};
    focusAfterRefusal.current = firstErrorField(fieldErrors);
    setErrors(fieldErrors);
    if (outcome.kind === 'refused') {
      setMessage(outcome.message);
      setBusyRun(outcome.running ?? null);
    }
  };

  const finished = progress.status === 'done' || progress.status === 'stopped';

  return (
    <Page width="form">
      <PageHeader
        back={{ to: PATHS.audits, label: 'All Website Audits' }}
        title="Start a Website Audit"
        lede="A Website Audit reads a public website, page by page, to find what could be repaired or redesigned. It never signs in, fills in or sends a form. Pages it finds but does not record are listed as Skipped Pages."
      />

      {started ? (
        <>
          <AuditProgress
            address={started.address}
            state={progress}
            reconnecting={reconnecting}
            streamEnded={streamEnded}
          />
          {(finished || streamEnded) && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <AuditFollowUpLink
                auditId={started.reply.auditId}
                done={progress.status === 'done'}
                version={doneVersion ?? started.reply.version}
              />
              <button
                type="button"
                className="btn-quiet btn-sm"
                onClick={() => {
                  setStarted(null);
                  setProgress({ status: 'starting' });
                  setReconnecting(false);
                  setStreamEnded(false);
                }}
              >
                Start another Website Audit
              </button>
            </div>
          )}
        </>
      ) : (
        <AuditStartFields
          form={form}
          errors={errors}
          message={message}
          busyRun={busyRun}
          starting={starting}
          onChange={setForm}
          onSubmit={() => void onSubmit()}
        />
      )}
    </Page>
  );
}
