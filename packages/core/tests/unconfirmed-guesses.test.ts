import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { TestCase } from '@qa/types';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { expandValidationTestCases } from '../src/validator-expander.js';

// A sign-in form that shows its own wording for an empty field (like saucedemo), and an
// invoice form that accepts anything (like the fixture app).
const LOGIN = `<!doctype html><html lang="en"><head><title>Sign in</title></head><body><nav><a href="/login">Home</a></nav><main>
  <h1>Sign in</h1>
  <input id="user-name" placeholder="Username"><input id="password" type="password" placeholder="Password">
  <button id="login-button">Login</button><div id="errors"></div>
  <script>
    document.getElementById('login-button').onclick = () => {
      if (!document.getElementById('user-name').value) {
        document.getElementById('errors').innerHTML = '<h3 data-test="error">Epic sadface: Username is required</h3>';
      } else { location.href = '/inventory'; }
    };
  </script></main></body></html>`;

const INVOICE = `<!doctype html><html lang="en"><head><title>Create Invoice</title></head><body><nav><a href="/login">Home</a></nav><main>
  <h1>Create invoice</h1>
  <form action="/saved" method="get">
    <label for="amount">Amount</label><input id="amount" name="amount" value="1200">
    <button id="save">Save</button>
  </form></main></body></html>`;

const PAGES: Record<string, string> = {
  '/login': LOGIN,
  '/invoices/new': INVOICE,
  '/saved': '<!doctype html><html lang="en"><head><title>Saved</title></head><body><nav><a href="/login">Home</a></nav><main><h1>Invoice saved</h1></main></body></html>',
  '/inventory': '<!doctype html><html lang="en"><head><title>Inventory</title></head><body><nav><a href="/login">Home</a></nav><main><h1>Products</h1></main></body></html>',
};

const loginCase: TestCase = {
  id: 'TC-LOGIN',
  flowId: 'FLOW-LOGIN',
  role: 'visitor',
  startPage: '/login',
  steps: [
    { action: 'fill', selector: '#user-name', value: 'standard_user', name: 'Enter username' },
    { action: 'fill', selector: '#password', value: 'secret', name: 'Enter password' },
    { action: 'click', selector: '#login-button', name: 'Log in' },
  ],
  expectations: { origin: 'ai-guess', url: { pattern: '/inventory' } },
  validationRules: [{ field: 'user-name', selector: '#user-name', min: 0, max: 50, expectedError: 'Field is empty', origin: 'ai-guess' }],
};

const invoiceCase: TestCase = {
  id: 'TC-INVOICE',
  flowId: 'FLOW-INVOICE',
  role: 'visitor',
  startPage: '/invoices/new',
  steps: [
    { action: 'fill', selector: '#amount', value: '1200', name: 'Enter amount' },
    { action: 'click', selector: '#save', name: 'Save' },
  ],
  // The AI guessed the wrong page and wording.
  expectations: { origin: 'ai-guess', url: { pattern: '^/invoices/new$' }, text: { contains: 'Invoice created' } },
  validationRules: [{ field: 'amount', selector: '#amount', min: 1, expectedError: 'Amount must be greater than zero', origin: 'ai-guess' }],
};

describe('Validation expander with guessed rules', () => {
  it('turns a guessed rule into one behaviour check, with no invented limits or wording', () => {
    const expanded = expandValidationTestCases([loginCase]);
    expect(expanded.map((tc) => tc.id)).toEqual(['TC-LOGIN', 'TC-LOGIN-val-user-name-empty']);
    const empty = expanded[1];
    expect(empty.steps[0].value).toBe('');
    expect(empty.expectations).toEqual({
      origin: 'ai-guess',
      validationError: { field: 'user-name', selector: '#user-name', description: 'An error appears when "user-name" is left empty' },
    });
  });

  it('skips a guessed rule for a field the flow never fills', () => {
    const expanded = expandValidationTestCases([
      { ...loginCase, validationRules: [{ field: 'coupon', selector: '#coupon', expectedError: 'Invalid coupon', origin: 'ai-guess' }] },
    ]);
    expect(expanded).toHaveLength(1);
  });
});

describe('Unconfirmed guesses never fail a site', () => {
  const PORT = 3503;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-unconfirmed-guesses');
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const page = PAGES[new URL(req.url || '/', baseUrl).pathname];
      res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html' });
      res.end(page || 'Not found');
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('passes when the site shows an error in its own words, and records what it said', async () => {
    const report = await new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'guesses',
      specTestCases: [loginCase],
      outputDir: path.join(outputDir, 'login'),
      breakpoints: ['1440px'],
      enableA11y: false,
      recordVideo: false,
    });

    const empty = report.results.find((r) => r.testCaseId === 'TC-LOGIN-val-user-name-empty');
    expect(empty?.status, JSON.stringify(empty?.findings.map((f) => f.title))).toBe('Passed');
    expect(empty?.observations).toEqual(['Leaving "user-name" empty shows: "Epic sadface: Username is required"']);
    expect(report.findings.some((f) => f.title.includes('Field is empty'))).toBe(false);
  }, 60000);

  it('reports wrong guesses as "Could not verify", never as defects', async () => {
    const report = await new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'guesses',
      specTestCases: [invoiceCase],
      outputDir: path.join(outputDir, 'invoice'),
      breakpoints: ['1440px'],
      enableA11y: false,
      recordVideo: false,
    });

    expect(
      report.findings.every((f) => f.needsConfirmation && f.severity === 'Suggestion'),
      JSON.stringify(report.findings.map((f) => `${f.severity} ${f.title}`))
    ).toBe(true);
    expect(report.results.map((r) => r.status)).toEqual(['Could not verify', 'Could not verify']);
    expect(report.findings.map((f) => f.title)).toEqual([
      'Could not verify: expected to end on a page matching "^/invoices/new$", but ended on "/saved".',
      'Could not verify: expected the page to say "Invoice created".',
      'Could not verify: no error appeared after leaving "amount" empty. Confirm whether it should be required.',
    ]);
    expect(report.coverage.couldNotVerify).toBe(2);

    const md = await fs.readFile(path.join(outputDir, 'invoice', 'report.md'), 'utf8');
    expect(md).toContain('READY FOR RELEASE');
    expect(md).toContain('❓ Could not verify (AI guesses that need your confirmation)');
  }, 60000);

  it('still fails the site when a confirmed expectation is not met', async () => {
    const report = await new FlowTestOrchestrator().run({
      targetUrl: baseUrl,
      productId: 'guesses',
      specTestCases: [{ ...invoiceCase, validationRules: undefined, expectations: { text: { contains: 'Invoice created' } } }],
      outputDir: path.join(outputDir, 'confirmed'),
      breakpoints: ['1440px'],
      enableA11y: false,
      recordVideo: false,
    });

    expect(report.results[0].status).toBe('Failed');
    expect(report.findings[0]).toMatchObject({ severity: 'Major', title: 'Expected text not found: "Invoice created"' });
    expect(report.findings[0].needsConfirmation).toBeUndefined();
  }, 60000);
});
