import { describe, it, expect } from 'vitest';
import type { Finding, ReleaseReport } from '@qa/types';
import { ContextParser } from '../../core/src/discovery/context-parser';
import { buildProductContext, rejectReason } from '../src/lib/context';
import { normalizeUrl } from '../src/lib/url';
import { bucketOf, bugReportMarkdown, groupProblems, playwrightFromSteps, summarizeReport } from '../src/lib/summary';

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
  // A bare address on this computer or a private network gets http://, anything else https://, and
  // an address typed with its scheme keeps it (Task 1.5).
  it.each([
    ['shop.example.com', 'https://shop.example.com/'],
    ['  https://shop.example.com/cart ', 'https://shop.example.com/cart'],
    ['http://shop.example.com', 'http://shop.example.com/'],
    ['localhost:3050', 'http://localhost:3050/'],
    ['localhost:5173', 'http://localhost:5173/'],
    ['127.0.0.1:8080/app', 'http://127.0.0.1:8080/app'],
    ['192.168.1.5', 'http://192.168.1.5/'],
    ['10.0.0.7:3000', 'http://10.0.0.7:3000/'],
    ['printer.local', 'http://printer.local/'],
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
    expect(s).toMatchObject({
      ready: true,
      stamp: 'Ready to release',
      reason: 'No problems found.',
      headline: 'No problems found — looks ready!',
      total: 0,
      top: [],
    });
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
    expect(s.reason).toBe('2 problems must be fixed first.');
    expect(s.headline).toBe('4 problems found');
    expect(s.counts.map((c) => c.sentence)).toEqual(['1 blocks release', '1 should be fixed before release', '1 minor', '1 suggestion']);
    expect(s.top).toEqual([
      { title: 'A request to your site failed (error 500)', category: 'Something broke', severity: 'Blocker' },
      { title: 'The page reported an error behind the scenes', category: 'Something broke', severity: 'Major' },
      { title: 'A button is missing a visible or spoken label', category: 'Hard for some people to use', severity: 'Minor' },

    ]);
    // No raw severity enum words reach the summary text
    expect(JSON.stringify(s.counts.map((c) => c.sentence))).not.toMatch(/Blocker|Major|Minor|Suggestion/);
  });

  it('says small problems don’t block release', () => {
    const s = summarizeReport(report([finding('F-UX-1', 'Minor', 'Touch target too small', 'ux-quality')]));
    expect(s).toMatchObject({ ready: true, stamp: 'Ready to release', headline: '1 small problem found' });
    expect(s.reason).toBe('Nothing blocks release. 1 smaller problem is worth fixing.');
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

describe('the report’s problems', () => {
  const finding = (id: string, severity: Finding['severity'], title: string, urlPath = '/', checker: Finding['checker'] = 'bug-detection'): Finding => ({
    id,
    severity,
    checker,
    title,
    where: { urlPath, role: 'visitor', breakpoint: '1440px', cssSelector: 'form > button.save' },
    expectedVsActual: { expected: 'The invoice is saved', actual: 'The page showed an error' },
    stepsToReproduce: ['Open /invoices/new', 'Click “Save”'],
    evidence: { consoleLogs: [{ type: 'error', text: 'TypeError: amount is undefined', timestamp: '' } as never] },
    resolution: 'Check the amount before saving.',
    verifyCommand: `qa-test verify ${id}`,
  });

  it('puts Blockers and Majors under Must fix, Minors under Should fix, the rest under Suggestions', () => {
    expect(bucketOf({ severity: 'Blocker' })).toBe('must-fix');
    expect(bucketOf({ severity: 'Major' })).toBe('must-fix');
    expect(bucketOf({ severity: 'Minor' })).toBe('should-fix');
    expect(bucketOf({ severity: 'Suggestion' })).toBe('suggestion');
    expect(bucketOf({ severity: 'Blocker', needsConfirmation: true })).toBe('to-confirm');
  });

  it('groups the same problem on several pages into one entry, with a plain title, leaving out what was marked intended', () => {
    const groups = groupProblems([
      finding('F-1', 'Major', 'Uncaught Exception: boom', '/cart'),
      finding('F-2', 'Major', 'Uncaught Exception: boom', '/checkout'),
      finding('F-3', 'Minor', 'Touch target too small', '/', 'ux-quality'),
      { ...finding('F-4', 'Blocker', 'HTTP 500'), triageStatus: 'Intended' },
    ]);
    expect(groups['must-fix']).toHaveLength(1);
    expect(groups['must-fix'][0]).toMatchObject({ title: 'The page crashed while it was running', pages: ['/cart', '/checkout'], aspect: 'Works' });
    expect(groups['must-fix'][0].findings.map((f) => f.id)).toEqual(['F-1', 'F-2']);
    expect(groups['should-fix'].map((g) => g.title)).toEqual(['A button is too small to tap easily on a phone']);
    expect(groups.suggestion).toEqual([]);
  });

  it('writes a bug report and a Playwright test a developer can paste', () => {
    const f = finding('F-9', 'Major', 'Step failed: "Save"', '/invoices/new');
    const markdown = bugReportMarkdown(f, 'http://localhost:3050');
    expect(markdown).toContain('### Couldn’t complete “Save”');
    expect(markdown).toContain('`/invoices/new`');
    expect(markdown).toContain('**Expected:** The invoice is saved');
    expect(markdown).toContain('1. Open /invoices/new');
    expect(markdown).toContain('TypeError: amount is undefined');
    expect(markdown).toContain('`qa-test verify F-9`');
    expect(markdown).not.toMatch(/\n\n\n/);

    const test = playwrightFromSteps(f, 'http://localhost:3050');
    expect(test).toContain("import { test, expect } from '@playwright/test';");
    expect(test).toContain("new URL('/invoices/new', 'http://localhost:3050')");
    expect(test).toContain('// Click “Save”');
  });
});
