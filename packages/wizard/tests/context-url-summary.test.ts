import { describe, it, expect } from 'vitest';
import type { Finding, ReleaseReport } from '@qa/types';
import { ContextParser } from '../../core/src/discovery/context-parser';
import { buildProductContext, rejectReason } from '../src/lib/context';
import { normalizeUrl } from '../src/lib/url';
import { summarizeReport } from '../src/lib/summary';

describe('reference materials', () => {
  it('rejects non-text files with a message saying what to do instead', () => {
    expect(rejectReason('prd.pdf', 100)).toBe(
      '“prd.pdf” is a PDF. Only text (.txt) and Markdown (.md) files can be added. Copy its text into the box below instead.'
    );
    expect(rejectReason('spec.docx', 100)).toMatch(/is a Word document/);
    expect(rejectReason('notes', 100)).toMatch(/is not a text file/);
    expect(rejectReason('big.md', 2 * 1024 * 1024)).toMatch(/larger than 1 MB/);
    expect(rejectReason('flows.MD', 100)).toBeNull();
    expect(rejectReason('notes.txt', 100)).toBeNull();
  });

  it('returns nothing to send when no files or notes were added', () => {
    expect(buildProductContext([], '')).toBeUndefined();
    expect(buildProductContext([{ name: 'empty.md', content: '  \n' }], '   ')).toBeUndefined();
  });

  it('joins several files so the context parser still finds requirements from each one', () => {
    const context = buildProductContext(
      [
        { name: 'prd.md', content: '# Checkout\n- Coupon codes are case-insensitive\n\n## Refunds\n- Refunds take 5 days' },
        { name: 'flows.txt', content: 'Users sign in with email\n- Password must be 8+ characters' },
      ],
      'Admins can export invoices'
    )!;

    expect(context).toContain('# Reference file: prd.md');
    expect(context).toContain('# Reference file: flows.txt');
    expect(context).toContain('# Pasted notes');

    const parsed = new ContextParser().parseContent(context);
    const names = parsed.requirements.map((r) => r.name);
    expect(names).toEqual(['Reference file: prd.md', 'Checkout', 'Refunds', 'Reference file: flows.txt', 'Pasted notes']);
    const rules = parsed.requirements.flatMap((r) => r.rules);
    expect(rules).toEqual(['Coupon codes are case-insensitive', 'Refunds take 5 days', 'Password must be 8+ characters']);
    // Prose outside bullet lists isn't a parsed rule, but the discovery prompt includes the raw text in full
    expect(parsed.rawContent).toContain('Users sign in with email');
    expect(parsed.rawContent).toContain('Admins can export invoices');
  });
});

describe('normalizeUrl', () => {
  it.each([
    ['shop.example.com', 'https://shop.example.com/'],
    ['  https://shop.example.com/cart ', 'https://shop.example.com/cart'],
    ['localhost:5173', 'http://localhost:5173/'],
    ['127.0.0.1:8080/app', 'http://127.0.0.1:8080/app'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each(['', 'not a url', 'ftp://files.example.com', 'myshop'])('rejects %j with a reason', (input) => {
    const result = normalizeUrl(input);
    expect(result.ok).toBe(false);
  });
});

describe('summarizeReport', () => {
  const finding = (id: string, severity: Finding['severity'], title: string, checker: Finding['checker'] = 'bug-detection'): Finding => ({
    id,
    severity,
    checker,
    title,
    where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: '' },
    stepsToReproduce: [],
    evidence: {},
    resolution: '',
    verifyCommand: '',
  });
  const report = (findings: Finding[], extra: Partial<ReleaseReport> = {}): ReleaseReport => ({
    runId: 'r',
    productId: 'p',
    targetUrl: 'https://shop.example.com',
    timestamp: '',
    durationMs: 0,
    coverage: { totalTestPoints: 1, passed: 1, failed: 0, blocked: 0, skipped: 0, couldNotVerify: 0, completionRate: 100 },
    results: [],
    findings,
    ...extra,
  });

  it('gives a clearly positive verdict when nothing was found', () => {
    const s = summarizeReport(report([]));
    expect(s).toMatchObject({ ready: true, stamp: 'Ready to release', headline: 'No issues found — looks ready!', total: 0, top: [] });
  });

  it('derives verdict, plain severity words and the top three from the real findings', () => {
    const s = summarizeReport(
      report([
        finding('F-A11Y-1', 'Minor', 'WCAG Violation: Buttons must have discernible text (button-name)', 'ux-quality'),
        finding('F-HTTP-1', 'Blocker', 'HTTP 500 on POST http://shop/api/orders'),
        finding('F-BUG-1', 'Major', 'Console Error in step "Save"'),
        finding('F-UX-1', 'Suggestion', 'Dead End Page: No back button or header navigation detected', 'ux-quality'),
        { ...finding('F-HTTP-2', 'Blocker', 'HTTP 404 on GET /x'), triageStatus: 'False Positive' },
      ])
    );
    expect(s.ready).toBe(false);
    expect(s.stamp).toBe('Not ready yet');
    expect(s.headline).toBe('4 issues found');
    expect(s.counts.map((c) => c.sentence)).toEqual(['1 blocks release', '1 should be fixed before release', '1 minor', '1 suggestion']);
    expect(s.top).toEqual([
      { title: 'A request to your site failed (error 500)', category: 'Something broke', severity: 'Blocker' },
      { title: 'The page reported an error behind the scenes', category: 'Something broke', severity: 'Major' },
      { title: 'Buttons must have discernible text', category: 'Hard for some people to use', severity: 'Minor' },
    ]);
    // No raw severity enum words reach the summary text
    expect(JSON.stringify(s.counts.map((c) => c.sentence))).not.toMatch(/Blocker|Major|Minor|Suggestion/);
  });

  it('flags a read-only scan', () => {
    expect(summarizeReport(report([], { scanMode: 'safe-public' })).readOnly).toBe(true);
    expect(summarizeReport(report([])).readOnly).toBe(false);
  });

  it('keeps unconfirmed AI guesses out of the issues, and counts them separately', () => {
    const guess = { ...finding('F-SPEC-1', 'Suggestion', 'Could not verify: expected the page to say "Saved".'), needsConfirmation: true };
    const s = summarizeReport(report([guess, finding('F-BUG-1', 'Minor', 'Console Error in step "Save"')]));
    expect(s.total).toBe(1);
    expect(s.toConfirm).toBe(1);
    expect(s.top.map((t) => t.title)).not.toContain(guess.title);
  });
});
