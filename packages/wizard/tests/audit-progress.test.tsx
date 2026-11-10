import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuditPageState, AuditProgressEvent } from '@qa/types/src/browser.js';
import {
  AUDIT_STAGE_LABELS,
  AuditProgress,
  applyAuditEvent,
  type AuditProgressState,
} from '../src/screens/audit/start/AuditProgress';
import { AuditStatusChips, aiStatusText, speedStatusText } from '../src/screens/audit/start/AuditStatusChips';
import { LivePageList } from '../src/screens/audit/start/LivePageList';
import { auditStoppedText, stopAudit, STOP_DID_NOTHING } from '../src/screens/audit/start/audit-start-api';

describe('Website Audit progress stepper (ADR 0042)', () => {
  it('includes Write documents and Ready in AUDIT_STAGE_LABELS', () => {
    expect(AUDIT_STAGE_LABELS['writing-documents']).toBe('Writing documents');
    expect(AUDIT_STAGE_LABELS.ready).toBe('Ready');
  });

  it('renders all nine steps in order in the progress component', () => {
    const html = renderToStaticMarkup(
      createElement(AuditProgress, {
        address: 'https://example.com/',
        state: { status: 'starting' },
      })
    );
    expect(html).toContain('Checking the address');
    expect(html).toContain('Reading the pages');
    expect(html).toContain('Checking the Sample Pages');
    expect(html).toContain('Measuring speed');
    expect(html).toContain('Writing notes on each area');
    expect(html).toContain('Ranking what to repair first');
    expect(html).toContain('Writing documents');
    expect(html).toContain('Saving the results');
    expect(html).toContain('Ready');
  });

  it('marks writing-documents as current step when in that stage', () => {
    const html = renderToStaticMarkup(
      createElement(AuditProgress, {
        address: 'https://example.com/',
        state: {
          status: 'working',
          progress: {
            type: 'progress',
            auditId: 'test1',
            version: 1,
            stage: 'writing-documents',
            pagesFound: 10,
            pagesRecorded: 10,
            pagesSkipped: 0,
          },
        },
      })
    );
    expect(html).toMatch(/<li[^>]*aria-current="step"[^>]*>.*Writing documents/);
  });
});

describe('Website Audit status chips (REQ-002, ADR 0042)', () => {
  it('formats AI status texts accurately according to spec', () => {
    expect(aiStatusText('ready')).toBe('AI: ready');
    expect(aiStatusText('key-expired')).toBe('AI: key expired: update in Audit settings');
    expect(aiStatusText('no-key')).toBe('AI: no key: template text');
  });

  it('formats speed status texts accurately according to spec', () => {
    expect(speedStatusText('pagespeed-insights')).toBe('Speed: PageSpeed Insights');
    expect(speedStatusText('this-tool')).toBe('Speed: measured by this tool');
    expect(speedStatusText('not-measured')).toBe('Speed: not measured');
  });

  it('renders chips for AI and speed when set', () => {
    const html = renderToStaticMarkup(createElement(AuditStatusChips, { ai: 'ready', speed: 'pagespeed-insights' }));
    expect(html).toContain('AI: ready');
    expect(html).toContain('Speed: PageSpeed Insights');
  });

  it('renders nothing when neither AI nor speed is set', () => {
    const html = renderToStaticMarkup(createElement(AuditStatusChips, {}));
    expect(html).toBe('');
  });
});

describe('LivePageList component', () => {
  const samplePages: AuditPageState[] = [
    { path: '/', state: 'recorded', ai: 'done' },
    { path: '/blog', state: 'loading', ai: 'waiting' },
    { path: '/about', state: 'queued' },
    { path: '/contact', state: 'retrying' },
    { path: '/pay', state: 'skipped', reason: 'payment' },
    { path: '/admin', state: 'skipped', reason: 'excluded' },
  ];

  it('shows each page state with plain-words skip reasons and AI state', () => {
    const html = renderToStaticMarkup(
      createElement(LivePageList, {
        pages: samplePages,
        elapsedMs: 15000,
      })
    );

    expect(html).toContain('/');
    expect(html).toContain('Recorded');
    expect(html).toContain('AI done');

    expect(html).toContain('/blog');
    expect(html).toContain('Loading');
    expect(html).toContain('AI waiting');

    expect(html).toContain('/about');
    expect(html).toContain('Queued');

    expect(html).toContain('/contact');
    expect(html).toContain('Retrying');

    expect(html).toContain('/pay');
    expect(html).toContain('Skipped');
    expect(html).toContain('a payment page: nothing on it is clicked or sent');

    expect(html).toContain('/admin');
    expect(html).toContain('left out by the include or exclude paths');
    expect(html).not.toContain('text-fail">(');

    expect(html).toContain('Elapsed: 15 s');
    expect(html).toContain('Stop');
  });

  it('calls onStop callback when Stop button is clicked', async () => {
    const onStop = vi.fn();
    const html = renderToStaticMarkup(
      createElement(LivePageList, {
        pages: samplePages,
        elapsedMs: 5000,
        onStop,
      })
    );
    expect(html).toContain('data-testid="audit-stop-button"');
    expect(html).toContain('Stop');
  });

  it('hides Stop button when stopped is true', () => {
    const html = renderToStaticMarkup(
      createElement(LivePageList, {
        pages: samplePages,
        elapsedMs: 30000,
        stopped: true,
      })
    );
    expect(html).not.toContain('data-testid="audit-stop-button"');
  });

  it('displays empty message when no pages are queued yet', () => {
    const html = renderToStaticMarkup(
      createElement(LivePageList, {
        pages: [],
        elapsedMs: 0,
      })
    );
    expect(html).toContain('No pages queued yet.');
  });
});

describe('AuditProgress: scripted reducer sequence and live updates', () => {
  it('rebuilds from a scripted sequence: snapshot -> page -> status -> done', () => {
    let state: AuditProgressState = { status: 'starting' };

    // 1. Initial snapshot on connect
    const snapshot: AuditProgressEvent = {
      type: 'snapshot',
      auditId: 'audit-seq-1',
      version: 1,
      stage: 'crawling',
      counts: { pagesFound: 3, pagesRecorded: 1, pagesSkipped: 1 },
      pages: [
        { path: '/', state: 'recorded', ai: 'done' },
        { path: '/blog', state: 'queued' },
        { path: '/admin', state: 'skipped', reason: 'excluded' },
      ],
      ai: 'ready',
      speed: 'pagespeed-insights',
    };
    state = applyAuditEvent(state, snapshot, auditStoppedText);

    let html = renderToStaticMarkup(
      createElement(AuditProgress, {
        address: 'https://example.com/',
        state,
        elapsedMs: 12000,
      })
    );

    // Verify stepper, counters, chips, and live page list from snapshot
    expect(html).toMatch(/<dt[^>]*>Pages found<\/dt><dd[^>]*>3<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Pages recorded<\/dt><dd[^>]*>1<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Skipped Pages<\/dt><dd[^>]*>1<\/dd>/);
    expect(html).toContain('AI: ready');
    expect(html).toContain('Speed: PageSpeed Insights');
    expect(html).toContain('Keep this tab open until the audit finishes.');
    expect(html).toContain('left out by the include or exclude paths');
    expect(html).toContain('Elapsed: 12 s');

    // 2. Incremental page update
    const pageUpdate: AuditProgressEvent = {
      type: 'page',
      auditId: 'audit-seq-1',
      version: 1,
      path: '/blog',
      state: 'loading',
    };
    state = applyAuditEvent(state, pageUpdate, auditStoppedText);

    html = renderToStaticMarkup(
      createElement(AuditProgress, {
        address: 'https://example.com/',
        state,
        elapsedMs: 18000,
      })
    );
    expect(html).toContain('Reading /blog');

    // 3. Status update
    const statusUpdate: AuditProgressEvent = {
      type: 'status',
      auditId: 'audit-seq-1',
      version: 1,
      ai: 'key-expired',
      speed: 'this-tool',
    };
    state = applyAuditEvent(state, statusUpdate, auditStoppedText);

    html = renderToStaticMarkup(
      createElement(AuditProgress, {
        address: 'https://example.com/',
        state,
        elapsedMs: 20000,
      })
    );
    expect(html).toContain('AI: key expired: update in Audit settings');
    expect(html).toContain('Speed: measured by this tool');

    // 4. Audit done
    const doneEvent: AuditProgressEvent = {
      type: 'done',
      auditId: 'audit-seq-1',
      version: 1,
    };
    state = applyAuditEvent(state, doneEvent, auditStoppedText);

    html = renderToStaticMarkup(
      createElement(AuditProgress, {
        address: 'https://example.com/',
        state,
        elapsedMs: 25000,
      })
    );
    expect(html).toContain('The Website Audit is done: 1 page recorded, 1 Skipped Page.');
    expect(html).not.toContain('Keep this tab open until the audit finishes.');
    expect(html).not.toContain('data-testid="audit-stop-button"');
  });

  it('uses no Avoid words in progress components (ADR 0018)', () => {
    const AVOID =
      /\b(scan|scans|scanning|runs?|running|site review|teardown|projects?|ignored pages?|missing pages?|ready to release|not ready|release verdict|pass(es|ed)?|fail(s|ed)?)\b/i;

    const snapshot: AuditProgressEvent = {
      type: 'snapshot',
      auditId: 'audit-seq-2',
      version: 1,
      stage: 'crawling',
      counts: { pagesFound: 2, pagesRecorded: 1, pagesSkipped: 1 },
      pages: [
        { path: '/', state: 'recorded', ai: 'done' },
        { path: '/skip', state: 'skipped', reason: 'page-limit' },
      ],
      ai: 'ready',
      speed: 'this-tool',
    };
    const state = applyAuditEvent({ status: 'starting' }, snapshot, auditStoppedText);
    const html = renderToStaticMarkup(
      createElement(AuditProgress, {
        address: 'https://example.com/',
        state,
        elapsedMs: 5000,
      })
    );
    const visible = html.replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(AVOID);
  });
});

describe('stopAudit', () => {
  const reply = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('is ok only when the runner stopped something', async () => {
    expect(await stopAudit(reply(200, { aborted: true }))).toEqual({ ok: true });
  });
  it('says so when the runner stopped nothing', async () => {
    expect(await stopAudit(reply(200, { aborted: false, message: 'No run currently active' }))).toEqual({
      ok: false,
      message: STOP_DID_NOTHING,
    });
  });
  it('says so on a refusal', async () => {
    expect(await stopAudit(reply(403, { error: 'no' }))).toEqual({ ok: false, message: STOP_DID_NOTHING });
  });
});
