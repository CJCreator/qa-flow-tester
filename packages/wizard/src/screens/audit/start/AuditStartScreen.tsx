import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuditStartErrors, AuditStartReply } from '@qa/types/src/browser.js';
import { FocusHeading, Spinner } from '../../../components/text';
import { Link, PATHS } from '../../../lib/router';
import {
  AUDIT_FIELD_HINTS,
  AUDIT_LIMIT_BOUNDS,
  errorId,
  fieldId,
  firstErrorField,
  hintId,
  initialAuditStartForm,
  type AuditFormField,
  type AuditStartForm,
} from './audit-start-form';
import {
  auditStoppedText,
  submitAuditStart,
  watchAudit,
  type AuditEventSourceFactory,
  type AuditStartOutcome,
} from './audit-start-api';
import { applyAuditEvent, AuditProgress, type AuditProgressState } from './AuditProgress';

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
  starting,
  onChange,
  onSubmit,
}: {
  form: AuditStartForm;
  errors: AuditStartErrors;
  /** A refusal for the whole form, in plain words. */
  message: string | null;
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

      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <Field field="maxPages" label="Max pages" errors={errors}>
          <input
            id={fieldId('maxPages')}
            name="maxPages"
            type="number"
            inputMode="numeric"
            min={b.minPages}
            max={b.maxPages}
            step={1}
            className="field w-32 py-1.5"
            value={form.maxPages}
            onChange={set('maxPages')}
            aria-invalid={errors.maxPages ? true : undefined}
            aria-describedby={describedBy('maxPages', errors)}
          />
        </Field>
        <Field field="maxDepth" label="Max depth" errors={errors}>
          <input
            id={fieldId('maxDepth')}
            name="maxDepth"
            type="number"
            inputMode="numeric"
            min={b.minDepth}
            max={b.maxDepth}
            step={1}
            className="field w-32 py-1.5"
            value={form.maxDepth}
            onChange={set('maxDepth')}
            aria-invalid={errors.maxDepth ? true : undefined}
            aria-describedby={describedBy('maxDepth', errors)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <Field field="includePaths" label="Include paths" errors={errors}>
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
        <Field field="excludePaths" label="Exclude paths" errors={errors}>
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

      {message && (
        <p
          id="audit-start-message"
          role="alert"
          className="mt-6 max-w-prose rounded-md border-l-4 border-fail bg-fail-tint px-4 py-3 text-fail"
        >
          {message}
        </p>
      )}

      <div className="mt-8">
        <button
          type="submit"
          className="btn-primary min-h-[50px] px-8 font-bold"
          disabled={starting}
          aria-describedby={message ? 'audit-start-message' : undefined}
        >
          {starting ? <Spinner label="Starting…" /> : 'Start the Website Audit'}
        </button>
      </div>
    </form>
  );
}

/** A link to the audit's own page: its results when it is done, its history otherwise. */
export function AuditFollowUpLink({ auditId, done }: { auditId: string; done: boolean }) {
  return (
    <Link to={PATHS.audit(auditId)} className="font-semibold text-stamp underline">
      {done ? 'Open the results of this Website Audit' : "Open this Website Audit's history"}
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
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<{ reply: AuditStartReply; address: string } | null>(null);
  const [progress, setProgress] = useState<AuditProgressState>({ status: 'starting' });
  const [reconnecting, setReconnecting] = useState(false);
  const [streamEnded, setStreamEnded] = useState(false);
  const focusAfterRefusal = useRef<AuditFormField | null>(null);

  useEffect(() => {
    const field = focusAfterRefusal.current;
    if (!field) return;
    focusAfterRefusal.current = null;
    document.getElementById(fieldId(field))?.focus();
  }, [errors]);

  useEffect(() => {
    if (!started) return;
    return watchAudit(
      started.reply,
      {
        onEvent: (event) => setProgress((state) => applyAuditEvent(state, event, auditStoppedText)),
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
    const outcome = await submit(form);
    setStarting(false);
    if (outcome.kind === 'started') {
      setErrors({});
      setProgress({ status: 'starting' });
      setStarted({ reply: outcome.reply, address: form.address.trim() });
      return;
    }
    const fieldErrors = outcome.errors ?? {};
    focusAfterRefusal.current = firstErrorField(fieldErrors);
    setErrors(fieldErrors);
    if (outcome.kind === 'refused') setMessage(outcome.message);
  };

  const finished = progress.status === 'done' || progress.status === 'stopped';

  return (
    <div className="mx-auto max-w-[44rem] px-4 py-10 sm:px-6 sm:py-14">
      <FocusHeading className="mb-2 break-words text-question font-bold">Start a Website Audit</FocusHeading>
      <p className="mb-6 max-w-prose text-ink-soft">
        A Website Audit reads a public website, page by page, to find what could be repaired or redesigned. It never
        signs in, fills in or sends a form. Pages it finds but does not record are listed as Skipped Pages.
      </p>

      {started ? (
        <>
          <AuditProgress
            address={started.address}
            state={progress}
            reconnecting={reconnecting}
            streamEnded={streamEnded}
          />
          {(finished || streamEnded) && (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <AuditFollowUpLink auditId={started.reply.auditId} done={progress.status === 'done'} />
              <button
                type="button"
                className="btn-primary"
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
          starting={starting}
          onChange={setForm}
          onSubmit={() => void onSubmit()}
        />
      )}
    </div>
  );
}
