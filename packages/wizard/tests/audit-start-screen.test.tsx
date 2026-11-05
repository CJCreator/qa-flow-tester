import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkAuditStartForm, initialAuditStartForm } from '../src/screens/audit/start/audit-start-form';
import { auditErrorText } from '../src/screens/audit/start/audit-start-api';
import { AuditFollowUpLink, AuditStartFields, AuditStartScreen } from '../src/screens/audit/start/AuditStartScreen';
import {
  AUDIT_STAGE_LABELS,
  AuditProgress,
  auditStatusText,
  type AuditProgressState,
} from '../src/screens/audit/start/AuditProgress';

const noop = () => {};

function fields(props: Partial<Parameters<typeof AuditStartFields>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(AuditStartFields, {
      form: initialAuditStartForm(),
      errors: {},
      message: null,
      starting: false,
      onChange: noop,
      onSubmit: noop,
      ...props,
    })
  );
}

/** The opening tag of the element with this id. */
function tagWithId(html: string, id: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`));
  expect(match, `element #${id}`).not.toBeNull();
  return match![0];
}

const progress = {
  type: 'progress' as const,
  auditId: 'abcd1234',
  version: 1,
  stage: 'crawling' as const,
  pagesFound: 40,
  pagesRecorded: 31,
  pagesSkipped: 4,
  currentPath: '/blog/<script>',
};

describe('Website Audit start screen: the form (REQ-002)', () => {
  it('renders a labelled address field and the four crawl-limit fields with their defaults', () => {
    const html = renderToStaticMarkup(createElement(AuditStartScreen));
    expect(html).toContain('<h1');
    expect(html).toContain('Start a Website Audit');
    for (const [id, label] of [
      ['audit-url', 'Website address'],
      ['audit-maxPages', 'Most pages to read'],
      ['audit-maxDepth', 'How many links deep'],
      ['audit-includePaths', 'Only read pages under these paths'],
      ['audit-excludePaths', 'Skip pages under these paths'],
    ]) {
      expect(html, label).toContain(`<label for="${id}" class="label text-ink">${label}</label>`);
      expect(tagWithId(html, id), id).toContain(`aria-describedby="${id}-hint"`);
    }
    const pages = tagWithId(html, 'audit-maxPages');
    expect(pages).toContain('type="number"');
    expect(pages).toContain('min="1"');
    expect(pages).toContain('max="1000"');
    expect(pages).toContain('value="200"');
    const depth = tagWithId(html, 'audit-maxDepth');
    expect(depth).toContain('min="0"');
    expect(depth).toContain('max="100"');
    expect(depth).toContain('value="8"');
    expect(html).toContain('From 1 to 1000. 200 unless you set another number.');
    expect(html).toContain('from 0 to 100. 8 unless you set another number.');
    expect(html).toMatch(/<button type="submit"[^>]*>Start the Website Audit<\/button>/);
  });

  it('uses only native, keyboard-operable controls: no positive tabindex, no click-only elements', () => {
    const html = fields();
    expect(html).not.toMatch(/tabindex="[1-9]/);
    expect(html).not.toMatch(/<(div|span)[^>]*onclick/i);
    expect(html.match(/<input /g)).toHaveLength(3);
    expect(html.match(/<textarea /g)).toHaveLength(2);
  });
});

describe('Website Audit start screen: messages next to their fields (REQ-001 AC-3, AC-2)', () => {
  it('shows the validator message for a non-URL next to the address field, linked and announced', () => {
    const check = checkAuditStartForm({ ...initialAuditStartForm(), address: 'not a web address' });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    const html = fields({ form: { ...initialAuditStartForm(), address: 'not a web address' }, errors: check.errors });
    const input = tagWithId(html, 'audit-url');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="audit-url-hint audit-url-error"');
    expect(html).toContain(
      '<p id="audit-url-error" role="alert" class="mt-1 text-sm font-medium text-fail">That is not a web address. Enter the full address, such as https://example.com.</p>'
    );
    expect(tagWithId(html, 'audit-maxPages')).not.toContain('aria-invalid');
  });

  it('shows runner field messages next to their fields and the refusal as a plain sentence', () => {
    const message = auditErrorText('ERR_PRIVATE_ADDRESS');
    const html = fields({
      errors: { maxDepth: 'Max depth must be a whole number from 0 to 100.' },
      message,
    });
    expect(tagWithId(html, 'audit-maxDepth')).toContain('aria-describedby="audit-maxDepth-hint audit-maxDepth-error"');
    expect(html).toContain('id="audit-maxDepth-error" role="alert"');
    expect(html).toContain('Max depth must be a whole number from 0 to 100.');
    expect(html).toMatch(
      /<div id="audit-start-message"><p role="alert"[^>]*>This address cannot be audited: it points to a private/
    );
    expect(html).toContain('aria-describedby="audit-start-message"');
  });

  it('puts the four limits inside a closed "Limits (optional)" disclosure, opened when one has a message', () => {
    const html = fields();
    expect(html).toMatch(/<details class="disclosure[^"]*">/);
    expect(html).not.toMatch(/<details[^>]*open=""/);
    expect(html).toContain('Limits (optional)');
    expect(html).toContain('200 pages · 8 links deep');
    const details = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    for (const id of ['audit-maxPages', 'audit-maxDepth', 'audit-includePaths', 'audit-excludePaths'])
      expect(details).toContain(`id="${id}"`);
    expect(details).not.toContain('id="audit-url"');
    const withError = fields({ errors: { maxDepth: 'Max depth must be a whole number from 0 to 100.' } });
    expect(withError).toMatch(/<details[^>]*open=""/);
  });

  it('shows the starting state on the button while the request is out', () => {
    const html = fields({ starting: true });
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).toContain('Starting…');
  });
});

describe('Website Audit start screen: progress from the stream', () => {
  const render = (state: AuditProgressState, reconnecting = false) =>
    renderToStaticMarkup(createElement(AuditProgress, { address: 'https://example.com/', state, reconnecting }));

  it('shows the stage, pages recorded and Skipped Pages so far', () => {
    const html = render({ status: 'working', progress });
    expect(html).toContain('Website Audit of https://example.com/');
    expect(html).toMatch(/<li[^>]*aria-current="step"[^>]*>.*Reading the pages/);
    expect(html).toMatch(/<dt[^>]*>Pages recorded<\/dt><dd[^>]*>31<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Skipped Pages<\/dt><dd[^>]*>4<\/dd>/);
    expect(html).toMatch(/<dt[^>]*>Pages found<\/dt><dd[^>]*>40<\/dd>/);
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('Reading the pages…');
    // The path comes from the website: it is escaped, never markup.
    expect(html).toContain('/blog/&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('shows done with the final counts, and stopped with the reason as an alert', () => {
    const done = render({ status: 'done', progress });
    expect(done).toContain('The Website Audit is done: 31 pages recorded, 4 Skipped Pages.');
    expect(done).not.toContain('aria-current');

    const stopped = render({ status: 'stopped', progress, message: 'The Website Audit stopped before it finished.' });
    expect(stopped).toMatch(
      /<div role="alert"[^>]*><p[^>]*>The Website Audit stopped\.<\/p><p[^>]*>The Website Audit stopped before it finished\.<\/p>/
    );
  });

  it('shows zero counts while starting and a note while reconnecting', () => {
    const html = render({ status: 'starting' }, true);
    expect(html).toMatch(/<dt[^>]*>Skipped Pages<\/dt><dd[^>]*>0<\/dd>/);
    expect(html).toContain('Starting the Website Audit…');
    expect(html).toContain('The connection dropped. Reconnecting…');
  });

  it('shows a final message, not Reconnecting, when the stream has ended', () => {
    const html = renderToStaticMarkup(
      createElement(AuditProgress, {
        address: 'https://example.com/',
        state: { status: 'working', progress },
        reconnecting: true,
        streamEnded: true,
      })
    );
    expect(html).toContain('The progress stream ended');
    expect(html).toContain('history');
    expect(html).not.toContain('Reconnecting');
  });

  it('links to the audit page: results when done, history otherwise', () => {
    const done = renderToStaticMarkup(createElement(AuditFollowUpLink, { auditId: 'abcd1234', done: true }));
    expect(done).toContain('href="/audits/abcd1234"');
    expect(done).toContain('See the results');
    expect(done).toContain('btn-primary');
    const ended = renderToStaticMarkup(createElement(AuditFollowUpLink, { auditId: 'abcd1234', done: false }));
    expect(ended).toContain('href="/audits/abcd1234"');
    expect(ended).toContain('history');
  });

  it('points the finished follow-up link at the version, not the history', () => {
    const done = renderToStaticMarkup(
      createElement(AuditFollowUpLink, { auditId: 'abcd1234', done: true, version: 3 })
    );
    expect(done).toContain('href="/audits/abcd1234/versions/3"');
    const ended = renderToStaticMarkup(
      createElement(AuditFollowUpLink, { auditId: 'abcd1234', done: false, version: 3 })
    );
    expect(ended).toContain('href="/audits/abcd1234"');
  });

  it('has a label for every stage and a status sentence for every state', () => {
    for (const label of Object.values(AUDIT_STAGE_LABELS)) expect(label).not.toBe('');
    expect(auditStatusText({ status: 'done', progress: null })).toBe('The Website Audit is done.');
    expect(auditStatusText({ status: 'stopped', progress: null, message: 'x' })).toBe('The Website Audit stopped.');
  });
});

describe('Website Audit start screen: wording (CONTEXT.md, ADR 0029, ADR 0033)', () => {
  // Website Audit _Avoid_: scan, run, site review, teardown, project. Skipped Page _Avoid_: ignored page,
  // missing page. No release verdict and no pass or fail on the website.
  const AVOID =
    /\b(scan|scans|scanning|runs?|running|site review|teardown|projects?|ignored pages?|missing pages?|ready to release|not ready|release verdict|pass(es|ed)?|fail(s|ed)?)\b/i;

  it('uses none of the Avoid words in the rendered screen or the sentences it shows', () => {
    const states: AuditProgressState[] = [
      { status: 'starting' },
      { status: 'working', progress: { ...progress, currentPath: undefined } },
      { status: 'done', progress },
      { status: 'stopped', progress, message: auditErrorText('ERR_UNREACHABLE') },
    ];
    const texts = [
      renderToStaticMarkup(createElement(AuditStartScreen)),
      fields({ message: auditErrorText('ERR_INVALID_AUDIT'), starting: true }),
      ...states.map((state) =>
        renderToStaticMarkup(
          createElement(AuditProgress, { address: 'https://example.com/', state, reconnecting: true })
        )
      ),
      ...['ERR_UNREACHABLE', 'ERR_PRIVATE_ADDRESS', 'ERR_INVALID_AUDIT', 'ERR_RUN_IN_PROGRESS'].map((code) =>
        auditErrorText(code)
      ),
      auditErrorText(undefined),
    ];
    for (const html of texts) {
      const visible = html.replace(/<[^>]+>/g, ' ');
      expect(visible).not.toMatch(AVOID);
      expect(visible).toMatch(/Website Audit|address|field/);
    }
  });

  it('reaches @qa/types through browser.js only, never the barrel or another module by path (T-211)', () => {
    const dir = new URL('../src/screens/audit/start/', import.meta.url);
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files.sort()).toEqual([
      'AuditProgress.tsx',
      'AuditStartScreen.tsx',
      'audit-start-api.ts',
      'audit-start-form.ts',
    ]);
    const testFiles = [
      new URL('./audit-start-form.test.ts', import.meta.url),
      new URL('./audit-start-screen.test.tsx', import.meta.url),
    ];
    for (const url of [...files.map((f) => new URL(f, dir)), ...testFiles]) {
      const source = readFileSync(url, 'utf8');
      const specifiers = [...source.matchAll(/from '(@qa\/types[^']*)'/g)].map((m) => m[1]);
      for (const specifier of specifiers) expect(specifier, url.pathname).toBe('@qa/types/src/browser.js');
    }
    // The screen's own files go into the wizard bundle: no Node built-ins.
    for (const file of files) {
      expect(readFileSync(new URL(file, dir), 'utf8'), file).not.toMatch(/from 'node:/);
    }
    for (const file of ['audit-start-api.ts', 'AuditProgress.tsx', 'AuditStartScreen.tsx']) {
      expect(readFileSync(new URL(file, dir), 'utf8'), file).toContain("from '@qa/types/src/browser.js'");
    }
    const formSource = readFileSync(new URL('audit-start-form.ts', dir), 'utf8');
    expect(formSource).toMatch(/import \{[^}]*\bvalidateAuditStartBody\b[^}]*\} from '@qa\/types\/src\/browser\.js'/);
  });
});
