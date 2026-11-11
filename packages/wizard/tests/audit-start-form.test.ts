import { describe, expect, it, vi } from 'vitest';
import { validateAuditStartBody, type AuditProgressEvent } from '@qa/types/src/browser.js';
import {
  AUDIT_FIELD_HINTS,
  AUDIT_LIMIT_BOUNDS,
  checkAuditStartForm,
  estimateAiRequests,
  firstErrorField,
  initialAuditStartForm,
  pathLines,
  toAuditStartBody,
} from '../src/screens/audit/start/audit-start-form';
import {
  auditErrorText,
  auditStoppedText,
  parseAuditEvent,
  startAudit,
  stopAudit,
  submitAuditStart,
  watchAudit,
  type AuditEventSource,
} from '../src/screens/audit/start/audit-start-api';
import { applyAuditEvent, type AuditProgressState } from '../src/screens/audit/start/AuditProgress';

function reply(status: number, body: unknown): Response {
  return new Response(body === undefined ? 'not json' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const form = (patch: Partial<ReturnType<typeof initialAuditStartForm>> = {}) => ({
  ...initialAuditStartForm(),
  address: 'https://example.com',
  ...patch,
});

describe('Website Audit start form: defaults and bounds (REQ-002)', () => {
  it('starts with the shared check defaults: 50 pages, depth 5, no paths', () => {
    expect(initialAuditStartForm()).toEqual({
      address: '',
      maxPages: '50',
      maxDepth: '5',
      includePaths: '',
      excludePaths: '',
    });
    const bare = validateAuditStartBody({ url: 'https://example.com' });
    expect(bare.ok && bare.value.limits).toEqual({ maxPages: 50, maxDepth: 5, includePaths: [], excludePaths: [] });
    expect(AUDIT_LIMIT_BOUNDS.defaultPages).toBe(50);
    expect(AUDIT_LIMIT_BOUNDS.defaultDepth).toBe(5);
  });

  it('keeps its local bounds equal to validateAuditStartBody: pages 1-1000, depth 0-100, 50 paths', () => {
    const ok = (body: Record<string, unknown>) => validateAuditStartBody({ url: 'https://example.com', ...body }).ok;
    const b = AUDIT_LIMIT_BOUNDS;
    expect([b.minPages, b.maxPages, b.minDepth, b.maxDepth, b.maxPathPrefixes]).toEqual([1, 1000, 0, 100, 50]);

    expect(ok({ maxPages: b.minPages })).toBe(true);
    expect(ok({ maxPages: b.maxPages })).toBe(true);
    expect(ok({ maxPages: b.minPages - 1 })).toBe(false);
    expect(ok({ maxPages: b.maxPages + 1 })).toBe(false);

    expect(ok({ maxDepth: b.minDepth })).toBe(true);
    expect(ok({ maxDepth: b.maxDepth })).toBe(true);
    expect(ok({ maxDepth: b.minDepth - 1 })).toBe(false);
    expect(ok({ maxDepth: b.maxDepth + 1 })).toBe(false);

    const paths = (n: number) => Array.from({ length: n }, (_, i) => `/p${i}`);
    expect(ok({ includePaths: paths(b.maxPathPrefixes) })).toBe(true);
    expect(ok({ includePaths: paths(b.maxPathPrefixes + 1) })).toBe(false);
  });

  it('shows the bounds in the hints', () => {
    expect(AUDIT_FIELD_HINTS.maxPages).toContain('From 1 to 1000');
    expect(AUDIT_FIELD_HINTS.maxPages).toContain('50');
    expect(AUDIT_FIELD_HINTS.maxDepth).toContain('from 0 to 100');
    expect(AUDIT_FIELD_HINTS.maxDepth).toContain('5');
    expect(AUDIT_FIELD_HINTS.includePaths).toContain('up to 50');
  });

  it('reads one path per line and drops blank lines', () => {
    expect(pathLines(' /blog \r\n\n/news\n')).toEqual(['/blog', '/news']);
    expect(pathLines('')).toEqual([]);
  });

  it('turns the typed form into a start body', () => {
    expect(
      toAuditStartBody(form({ address: '  https://example.com/  ', maxPages: ' 50 ', includePaths: '/a\n/b' }))
    ).toEqual({
      url: 'https://example.com/',
      maxPages: 50,
      maxDepth: 5,
      includePaths: ['/a', '/b'],
      excludePaths: [],
    });
  });

  it('estimates AI requests as pages + 1', () => {
    expect(estimateAiRequests(50)).toBe(51);
    expect(estimateAiRequests('10')).toBe(11);
    expect(estimateAiRequests('')).toBe(51);
    expect(estimateAiRequests('invalid')).toBe(51);
  });
});

describe('Website Audit start form: the client-side check (REQ-001 AC-3)', () => {
  it('refuses input that is not a URL with the validator message', () => {
    const check = checkAuditStartForm(form({ address: 'not a web address' }));
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.errors.url).toBe('That is not a web address. Enter the full address, such as https://example.com.');
    expect(firstErrorField(check.errors)).toBe('url');
  });

  it('refuses an empty address, another scheme and limits outside the bounds', () => {
    const empty = checkAuditStartForm(form({ address: '' }));
    expect(empty.ok || empty.errors.url).toMatch(/Enter the website address/);
    const ftp = checkAuditStartForm(form({ address: 'ftp://example.com' }));
    expect(ftp.ok || ftp.errors.url).toMatch(/http:\/\/ or https:\/\//);

    for (const [maxPages, ok] of [
      ['0', false],
      ['1', true],
      ['1000', true],
      ['1001', false],
      ['', false],
      ['2.5', false],
    ] as const) {
      const check = checkAuditStartForm(form({ maxPages }));
      expect(check.ok, `maxPages ${maxPages}`).toBe(ok);
      if (!check.ok) expect(check.errors.maxPages).toBe('Max pages must be a whole number from 1 to 1000.');
    }
    for (const [maxDepth, ok] of [
      ['-1', false],
      ['0', true],
      ['100', true],
      ['101', false],
    ] as const) {
      const check = checkAuditStartForm(form({ maxDepth }));
      expect(check.ok, `maxDepth ${maxDepth}`).toBe(ok);
      if (!check.ok) expect(check.errors.maxDepth).toBe('Max depth must be a whole number from 0 to 100.');
    }
  });

  it('refuses malformed paths with a message per field', () => {
    const check = checkAuditStartForm(form({ includePaths: 'blog', excludePaths: 'https://example.com/x' }));
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.errors.includePaths).toBe('Include path 1 must start with /, such as /blog.');
    expect(check.errors.excludePaths).toBe('Exclude path 1 must be a path such as /blog, not a full address.');
    expect(firstErrorField(check.errors)).toBe('includePaths');
  });

  it('accepts a valid form and sends the normalised address and de-duplicated paths', () => {
    const check = checkAuditStartForm(form({ address: 'https://example.com#top', includePaths: '/blog\n/blog' }));
    expect(check).toEqual({
      ok: true,
      body: { url: 'https://example.com/', maxPages: 50, maxDepth: 5, includePaths: ['/blog'], excludePaths: [] },
    });
  });

  it('sends no request when the form fails the check', async () => {
    const fetchImpl = vi.fn();
    const outcome = await submitAuditStart(form({ address: 'example dot com' }), fetchImpl);
    expect(outcome.kind).toBe('invalid');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Website Audit start request: POST /api/audits (REQ-001 AC-2)', () => {
  it('posts the checked body as JSON and returns the audit id on 202', async () => {
    const fetchImpl = vi.fn(async () => reply(202, { auditId: 'abcd1234', version: 1 }));
    const outcome = await submitAuditStart(form({ maxPages: '10' }), fetchImpl);
    expect(outcome).toEqual({ kind: 'started', reply: { auditId: 'abcd1234', version: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/audits');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://example.com/',
      maxPages: 10,
      maxDepth: 5,
      includePaths: [],
      excludePaths: [],
    });
  });

  it('says why an unreachable address cannot be audited (422 ERR_UNREACHABLE)', async () => {
    const outcome = await startAudit(toAuditStartBody(form()), async () =>
      reply(422, { error: 'ECONNREFUSED 10.0.0.1:443', code: 'ERR_UNREACHABLE' })
    );
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.code).toBe('ERR_UNREACHABLE');
    expect(outcome.message).toMatch(/^This address cannot be audited: the website did not answer/);
    expect(outcome.message).not.toContain('ECONNREFUSED');
  });

  it('says why a private address cannot be audited (400 ERR_PRIVATE_ADDRESS)', async () => {
    const outcome = await startAudit(toAuditStartBody(form()), async () =>
      reply(400, { error: 'private', code: 'ERR_PRIVATE_ADDRESS' })
    );
    expect(outcome.kind === 'refused' && outcome.message).toMatch(
      /^This address cannot be audited: it points to a private or local network/
    );
  });

  it('puts ERR_INVALID_AUDIT field messages on their fields', async () => {
    const outcome = await startAudit(toAuditStartBody(form()), async () =>
      reply(400, {
        error: 'bad',
        code: 'ERR_INVALID_AUDIT',
        fields: { maxPages: 'Max pages must be a whole number from 1 to 1000.', excludePaths: 7 },
      })
    );
    expect(outcome).toEqual({
      kind: 'refused',
      code: 'ERR_INVALID_AUDIT',
      message: 'Some fields need a change. See the message next to each one.',
      errors: { maxPages: 'Max pages must be a whole number from 1 to 1000.' },
    });
  });

  it('says another run is in progress (409 ERR_RUN_IN_PROGRESS)', async () => {
    const outcome = await startAudit(toAuditStartBody(form()), async () =>
      reply(409, { error: 'busy', code: 'ERR_RUN_IN_PROGRESS' })
    );
    expect(outcome.kind === 'refused' && outcome.message).toBe(
      'Another Check-up, benchmark or Website Audit is in progress. Start this Website Audit when it has finished.'
    );
  });

  it('refuses blocked sites, DNS failures, browser launch failures, and pipeline errors', async () => {
    const blocked = await startAudit(toAuditStartBody(form()), async () =>
      reply(422, { error: 'challenge page', code: 'ERR_SITE_BLOCKED' })
    );
    expect(blocked.kind === 'refused' && blocked.message).toMatch(/^This website blocks automated visitors/);

    const dns = await startAudit(toAuditStartBody(form()), async () =>
      reply(422, { error: 'ENOTFOUND', code: 'ERR_DNS' })
    );
    expect(dns.kind === 'refused' && dns.message).toMatch(/domain name and try again/);

    const launch = await startAudit(toAuditStartBody(form()), async () =>
      reply(500, { error: 'browser launch failed', code: 'ERR_BROWSER_LAUNCH' })
    );
    expect(launch.kind === 'refused' && launch.message).toMatch(/browser could not start/);

    const pipeline = await startAudit(toAuditStartBody(form()), async () =>
      reply(500, { error: 'pipeline failed', code: 'ERR_PIPELINE' })
    );
    expect(pipeline.kind === 'refused' && pipeline.message).toMatch(/could not finish saving/);
  });

  it('includes running info and specific message on 409 ERR_RUN_IN_PROGRESS', async () => {
    const checkupBusy = await startAudit(toAuditStartBody(form()), async () =>
      reply(409, { error: 'busy', code: 'ERR_RUN_IN_PROGRESS', running: { kind: 'checkup', href: '/check' } })
    );
    expect(checkupBusy.kind).toBe('refused');
    if (checkupBusy.kind !== 'refused') return;
    expect(checkupBusy.message).toBe('A Check-up is in progress. Start this Website Audit when it has finished.');
    expect(checkupBusy.running).toEqual({ kind: 'checkup', href: '/check' });

    const auditBusy = await startAudit(toAuditStartBody(form()), async () =>
      reply(409, { error: 'busy', code: 'ERR_RUN_IN_PROGRESS', running: { kind: 'audit', href: '/audits/123' } })
    );
    expect(auditBusy.kind === 'refused' && auditBusy.message).toBe(
      'A Website Audit is in progress. Start this Website Audit when it has finished.'
    );
  });

  it('stops a running audit via stopAudit (POST /api/runner/stop)', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { aborted: true }));
    const result = await stopAudit(fetchImpl);
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('/api/runner/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('keeps the runner message for other codes, and a plain sentence when nothing answers', async () => {
    const other = await startAudit(toAuditStartBody(form()), async () =>
      reply(429, { error: 'The shared copy limit is reached for today.', code: 'ERR_BETA_LIMIT' })
    );
    expect(other.kind === 'refused' && other.message).toBe('The shared copy limit is reached for today.');

    const down = await startAudit(toAuditStartBody(form()), async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(down.kind === 'refused' && down.message).toMatch(/^The tool is not answering/);

    const garbled = await startAudit(toAuditStartBody(form()), async () => reply(202, undefined));
    expect(garbled.kind === 'refused' && garbled.message).toMatch(/^The tool is not answering/);
    expect(auditErrorText('NOPE', '')).toBe('The Website Audit could not start. Try again.');
  });
});

class FakeSource implements AuditEventSource {
  static last: FakeSource | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onopen: ((event: unknown) => void) | null = null;
  closed = false;
  readyState = 0;
  constructor(public url: string) {
    FakeSource.last = this;
  }
  close() {
    this.closed = true;
  }
  send(event: unknown) {
    this.onmessage?.({ data: typeof event === 'string' ? event : JSON.stringify(event) });
  }
}

const progressEvent = (patch: Partial<Extract<AuditProgressEvent, { type: 'progress' }>> = {}) => ({
  type: 'progress' as const,
  auditId: 'abcd1234',
  version: 1,
  stage: 'crawling' as const,
  pagesFound: 12,
  pagesRecorded: 5,
  pagesSkipped: 2,
  ...patch,
});

describe('Website Audit progress stream: /api/audits/:id/stream', () => {
  it('opens the stream for the audit and passes on its events until done', () => {
    const events: AuditProgressEvent[] = [];
    const onDrop = vi.fn();
    const onOpen = vi.fn();
    const close = watchAudit(
      { auditId: 'abcd1234', version: 1 },
      { onEvent: (e) => events.push(e), onDrop, onOpen },
      (url) => new FakeSource(url)
    );
    const source = FakeSource.last!;
    expect(source.url).toBe('/api/audits/abcd1234/stream');

    source.send('not json');
    source.send({ ...progressEvent(), auditId: 'other1234' });
    source.send({ ...progressEvent(), version: 2 });
    source.send({ type: 'progress', auditId: 'abcd1234', version: 1, stage: 'crawling' });
    expect(events).toEqual([]);

    source.send(progressEvent());
    source.onerror?.({});
    expect(onDrop).toHaveBeenCalledTimes(1);
    source.send({ type: 'done', auditId: 'abcd1234', version: 1 });
    expect(events.map((e) => e.type)).toEqual(['progress', 'done']);
    expect(onOpen).toHaveBeenCalled();
    expect(source.closed).toBe(true);

    source.send(progressEvent());
    expect(events).toHaveLength(2);
    close();
  });

  it('treats a closed stream as final: onEnd, no onDrop, and the source is closed', () => {
    const onDrop = vi.fn();
    const onEnd = vi.fn();
    watchAudit({ auditId: 'abcd1234', version: 1 }, { onEvent: () => {}, onDrop, onEnd }, (url) => new FakeSource(url));
    const source = FakeSource.last!;
    source.readyState = 2;
    source.onerror?.({});
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();
    expect(source.closed).toBe(true);
  });

  it('closes on a failed event and on the returned close function', () => {
    const events: AuditProgressEvent[] = [];
    watchAudit({ auditId: 'abcd1234', version: 1 }, { onEvent: (e) => events.push(e) }, (url) => new FakeSource(url));
    const source = FakeSource.last!;
    source.send({ type: 'failed', auditId: 'abcd1234', version: 1, error: 'gone', code: 'ERR_UNREACHABLE' });
    expect(source.closed).toBe(true);

    const close = watchAudit({ auditId: 'abcd1234', version: 1 }, { onEvent: () => {} }, (url) => new FakeSource(url));
    const second = FakeSource.last!;
    close();
    expect(second.closed).toBe(true);
  });

  it('parses only well-formed events including snapshot, page, and status', () => {
    expect(parseAuditEvent(JSON.stringify(progressEvent()))).toEqual(progressEvent());
    expect(parseAuditEvent('{"type":"connected","auditId":"abcd1234"}')).toBeNull();
    expect(parseAuditEvent('null')).toBeNull();

    const snapshot = {
      type: 'snapshot' as const,
      auditId: 'abcd1234',
      version: 1,
      stage: 'crawling' as const,
      counts: { pagesFound: 10, pagesRecorded: 3, pagesSkipped: 1 },
      pages: [{ path: '/about', state: 'recorded' as const }],
      ai: 'ready' as const,
      speed: 'pagespeed-insights' as const,
    };
    expect(parseAuditEvent(JSON.stringify(snapshot))).toEqual(snapshot);

    const page = {
      type: 'page' as const,
      auditId: 'abcd1234',
      version: 1,
      path: '/contact',
      state: 'queued' as const,
    };
    expect(parseAuditEvent(JSON.stringify(page))).toEqual(page);

    const status = {
      type: 'status' as const,
      auditId: 'abcd1234',
      version: 1,
      ai: 'key-expired' as const,
      speed: 'this-tool' as const,
    };
    expect(parseAuditEvent(JSON.stringify(status))).toEqual(status);
  });

  it('moves the state from starting to working to done or stopped', () => {
    let state: AuditProgressState = { status: 'starting' };
    state = applyAuditEvent(state, progressEvent(), auditStoppedText);
    expect(state).toEqual({ status: 'working', progress: progressEvent() });
    const done = applyAuditEvent(state, { type: 'done', auditId: 'abcd1234', version: 1 }, auditStoppedText);
    expect(done).toEqual({ status: 'done', progress: progressEvent() });
    expect(applyAuditEvent(done, progressEvent({ pagesRecorded: 99 }), auditStoppedText)).toBe(done);

    const stopped = applyAuditEvent(
      state,
      { type: 'failed', auditId: 'abcd1234', version: 1, error: '', code: 'ERR_AUDIT_RUNNING' },
      auditStoppedText
    );
    expect(stopped).toEqual({
      status: 'stopped',
      progress: progressEvent(),
      message: 'The Website Audit stopped before it finished.',
    });
  });

  it('handles snapshot, page, and status in applyAuditEvent', () => {
    let state: AuditProgressState = { status: 'starting' };

    // snapshot event initialises progress, pages, ai and speed
    const snapshotEvent: AuditProgressEvent = {
      type: 'snapshot',
      auditId: 'abcd1234',
      version: 1,
      stage: 'crawling',
      counts: { pagesFound: 5, pagesRecorded: 2, pagesSkipped: 1 },
      pages: [
        { path: '/', state: 'recorded' },
        { path: '/blog', state: 'loading' },
      ],
      ai: 'ready',
      speed: 'pagespeed-insights',
    };
    state = applyAuditEvent(state, snapshotEvent, auditStoppedText);
    expect(state.status).toBe('working');
    if (state.status !== 'working') return;
    expect(state.progress.pagesFound).toBe(5);
    expect(state.pages).toHaveLength(2);
    expect(state.ai).toBe('ready');
    expect(state.speed).toBe('pagespeed-insights');

    // page event updates existing page or appends new
    const pageUpdate: AuditProgressEvent = {
      type: 'page',
      auditId: 'abcd1234',
      version: 1,
      path: '/blog',
      state: 'recorded',
      ai: 'done',
    };
    state = applyAuditEvent(state, pageUpdate, auditStoppedText);
    expect(state.pages?.find((p) => p.path === '/blog')).toEqual({
      path: '/blog',
      state: 'recorded',
      reason: undefined,
      ai: 'done',
    });

    // page event with skip reason
    const skippedPage: AuditProgressEvent = {
      type: 'page',
      auditId: 'abcd1234',
      version: 1,
      path: '/admin',
      state: 'skipped',
      reason: 'excluded',
    };
    state = applyAuditEvent(state, skippedPage, auditStoppedText);
    expect(state.pages?.find((p) => p.path === '/admin')).toEqual({
      path: '/admin',
      state: 'skipped',
      reason: 'excluded',
      ai: undefined,
    });

    // status event updates ai and speed
    const statusUpdate: AuditProgressEvent = {
      type: 'status',
      auditId: 'abcd1234',
      version: 1,
      ai: 'key-expired',
      speed: 'this-tool',
    };
    state = applyAuditEvent(state, statusUpdate, auditStoppedText);
    expect(state.ai).toBe('key-expired');
    expect(state.speed).toBe('this-tool');
  });
});
