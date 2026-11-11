import {
  AUDIT_API,
  auditPath,
  type AuditErrorCode,
  type AuditErrorReply,
  type AuditProgressEvent,
  type AuditStartBody,
  type AuditStartErrors,
  type AuditStartReply,
} from '@qa/types/src/browser.js';
import { isAuditErrorCode, NOT_ANSWERING } from '../audit-call';
import { checkAuditStartForm, type AuditStartForm } from './audit-start-form';

/**
 * The Website Audit start screen's calls to the runner: `POST /api/audits` and the progress stream on
 * `/api/audits/:id/stream`. Every refusal becomes a plain sentence safe to show as-is; status codes and
 * raw errors never reach the screen.
 */

/** Plain sentences for the refusals the start screen expects (REQ-001 AC-2, ADR 0042). */
const START_REFUSALS: Partial<Record<AuditErrorCode, string>> = {
  ERR_UNREACHABLE:
    'This address cannot be audited: the website did not answer, or answered with an error. Check the address and that the website is online, then try again.',
  ERR_SITE_BLOCKED:
    'This website blocks automated visitors. A Website Audit cannot read sites behind a challenge or bot screen.',
  ERR_DNS: 'The website address could not be found. Check the domain name and try again.',
  ERR_BROWSER_LAUNCH: 'The browser could not start for this Website Audit. Try again in a moment.',
  ERR_PIPELINE: 'The Website Audit could not finish saving its results. Try again.',
  ERR_PRIVATE_ADDRESS:
    'This address cannot be audited: it points to a private or local network. A Website Audit only reads public websites.',
  ERR_INVALID_AUDIT: 'Some fields need a change. See the message next to each one.',
  ERR_RUN_IN_PROGRESS:
    'Another Check-up, benchmark or Website Audit is in progress. Start this Website Audit when it has finished.',
};

export type RunningInfo = { kind: 'checkup' | 'audit'; href: string };

/** The sentence for a refusal: ours for the expected codes, else the runner's own message (already plain). */
export function auditErrorText(
  code: unknown,
  error?: unknown,
  fallback = 'The Website Audit could not start. Try again.',
  running?: RunningInfo
): string {
  if (code === 'ERR_RUN_IN_PROGRESS' && running) {
    const kind = running.kind === 'checkup' ? 'A Check-up' : 'A Website Audit';
    return `${kind} is in progress. Start this Website Audit when it has finished.`;
  }
  if (isAuditErrorCode(code) && START_REFUSALS[code]) return START_REFUSALS[code]!;
  if (typeof error === 'string' && error.trim() !== '') return error.trim();
  return fallback;
}

export type AuditStartOutcome =
  | { kind: 'started'; reply: AuditStartReply }
  /** Refused before any request: the form's own check. */
  | { kind: 'invalid'; errors: AuditStartErrors }
  /** Refused by the runner, or the runner did not answer. */
  | {
      kind: 'refused';
      message: string;
      code?: AuditErrorCode;
      errors?: AuditStartErrors;
      running?: RunningInfo;
    };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function asErrorReply(body: unknown): Partial<AuditErrorReply> {
  return body !== null && typeof body === 'object' ? (body as Partial<AuditErrorReply>) : {};
}

function asFieldErrors(fields: unknown): AuditStartErrors | undefined {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const errors: AuditStartErrors = {};
  for (const [field, message] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof message === 'string' && message !== '') errors[field as keyof AuditStartErrors] = message;
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

/** `POST /api/audits` with a body that already passed the form check. */
export async function startAudit(body: AuditStartBody, fetchImpl: Fetch = fetch): Promise<AuditStartOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(AUDIT_API.start.path, {
      method: AUDIT_API.start.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'refused', message: NOT_ANSWERING };
  }
  let reply: unknown;
  try {
    reply = await res.json();
  } catch {
    reply = undefined;
  }
  if (res.ok) {
    const started = reply as Partial<AuditStartReply> | undefined;
    if (
      started &&
      typeof started.auditId === 'string' &&
      started.auditId !== '' &&
      typeof started.version === 'number'
    ) {
      return { kind: 'started', reply: { auditId: started.auditId, version: started.version } };
    }
    return { kind: 'refused', message: NOT_ANSWERING };
  }
  const refusal = asErrorReply(reply);
  const code = isAuditErrorCode(refusal.code) ? refusal.code : undefined;
  const running = refusal.running;
  return {
    kind: 'refused',
    message: auditErrorText(code, refusal.error, undefined, running),
    code,
    errors: code === 'ERR_INVALID_AUDIT' ? asFieldErrors(refusal.fields) : undefined,
    running,
  };
}

/** Shown when the runner answered but stopped nothing. */
export const STOP_DID_NOTHING = 'The Website Audit could not be stopped from here. It will finish on its own.';

/** Stops the active Website Audit by calling `POST /api/runner/stop`. `ok` is true only when it was stopped. */
export async function stopAudit(fetchImpl: Fetch = fetch): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetchImpl('/api/runner/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { ok: false, message: STOP_DID_NOTHING };
    const body = (await res.json().catch(() => null)) as { aborted?: unknown } | null;
    return body?.aborted === true ? { ok: true } : { ok: false, message: STOP_DID_NOTHING };
  } catch {
    return { ok: false, message: NOT_ANSWERING };
  }
}

/** Checks the form, then starts the Website Audit. A form that fails the check sends nothing (REQ-001 AC-3). */
export async function submitAuditStart(form: AuditStartForm, fetchImpl: Fetch = fetch): Promise<AuditStartOutcome> {
  const check = checkAuditStartForm(form);
  if (!check.ok) return { kind: 'invalid', errors: check.errors };
  return startAudit(check.body, fetchImpl);
}

/** The stream's events, checked before use: anything else on the stream is ignored. */
export function parseAuditEvent(data: string): AuditProgressEvent | null {
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    return null;
  }
  if (event === null || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  if (typeof e.auditId !== 'string') return null;
  if (e.type === 'progress') {
    const counts = [e.pagesFound, e.pagesRecorded, e.pagesSkipped];
    if (typeof e.stage !== 'string' || !counts.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return event as AuditProgressEvent;
  }
  if (e.type === 'snapshot') {
    const counts = e.counts as Record<string, unknown> | undefined;
    const hasCounts =
      counts &&
      typeof counts === 'object' &&
      [counts.pagesFound, counts.pagesRecorded, counts.pagesSkipped].every(
        (n) => typeof n === 'number' && Number.isFinite(n)
      );
    if (typeof e.stage !== 'string' || !hasCounts || !Array.isArray(e.pages)) return null;
    return event as AuditProgressEvent;
  }
  if (e.type === 'page') {
    if (typeof e.path !== 'string' || typeof e.state !== 'string') return null;
    return event as AuditProgressEvent;
  }
  if (e.type === 'status') {
    if (typeof e.ai !== 'string' || typeof e.speed !== 'string') return null;
    return event as AuditProgressEvent;
  }
  if (e.type === 'done') return event as AuditProgressEvent;
  if (e.type === 'failed') return event as AuditProgressEvent;
  return null;
}

/** The smallest part of EventSource this screen uses, so tests can pass their own. */
export interface AuditEventSource {
  onmessage: ((message: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onopen?: ((event: unknown) => void) | null;
  /** 2 when the browser has closed the stream for good. */
  readonly readyState?: number;
  close(): void;
}

const EVENT_SOURCE_CLOSED = 2;

export type AuditEventSourceFactory = (url: string) => AuditEventSource;

const browserEventSource: AuditEventSourceFactory = (url) => new EventSource(url) as unknown as AuditEventSource;

export interface AuditStreamHandlers {
  onEvent: (event: AuditProgressEvent) => void;
  /** The connection dropped; the browser reconnects by itself. */
  onDrop?: () => void;
  /** The stream is closed for good and will not reconnect. */
  onEnd?: () => void;
  /** The connection is back (or open for the first time). */
  onOpen?: () => void;
}

/**
 * Follows one Website Audit on its stream until it is done or has stopped. Events for another audit or
 * version are ignored. Returns a function that closes the stream.
 */
export function watchAudit(
  reply: AuditStartReply,
  handlers: AuditStreamHandlers,
  openSource: AuditEventSourceFactory = browserEventSource
): () => void {
  const source = openSource(auditPath(AUDIT_API.stream.path, { id: reply.auditId }));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  source.onopen = () => handlers.onOpen?.();
  source.onmessage = (message) => {
    if (closed) return;
    const event = parseAuditEvent(message.data);
    if (!event || event.auditId !== reply.auditId || event.version !== reply.version) return;
    handlers.onOpen?.();
    handlers.onEvent(event);
    if (event.type === 'done' || event.type === 'failed') close();
  };
  source.onerror = () => {
    if (closed) return;
    // A CLOSED source (for example a 404 after a runner restart) never reconnects: that is final.
    if (source.readyState === EVENT_SOURCE_CLOSED) {
      close();
      handlers.onEnd?.();
      return;
    }
    handlers.onDrop?.();
  };
  return close;
}

/** Why a Website Audit stopped, in plain words, from a `failed` event. */
export function auditStoppedText(event: Extract<AuditProgressEvent, { type: 'failed' }>): string {
  return auditErrorText(event.code, event.error, 'The Website Audit stopped before it finished.');
}
