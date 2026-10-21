/** T-48: a Rejects item in a run is judged on every path: probe-only, a permanent alert, a late alert, a novalidate form. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { promises as fs } from 'fs';
import path from 'path';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import type { TestCase } from '@qa/types';

const outputDir = path.join(process.cwd(), '.tmp-T-48-refusal-run-report');

const SOURCE_SENTENCE = 'Please enter your email address';
const pages: Record<string, string> = {
  // The Pre-flight check opens the start URL; a 404 there is "unreachable", so the root must answer.
  '/': '<html><body><h1>Home</h1></body></html>',
  // Accepts the empty value, and a permanent alert sits on the page before the submit.
  '/permanent-alert':
    '<html><body><h1>Join</h1><div role="alert">Heads up: maintenance on Sunday</div>' +
    '<form onsubmit="event.preventDefault()"><input id="e" name="e"><button type="submit">Save</button></form></body></html>',
  // Accepts the empty value and shows nothing.
  '/lenient':
    '<html><body><h1>Join</h1><form onsubmit="event.preventDefault()">' +
    '<input id="e" name="e"><button type="submit">Save</button></form></body></html>',
  // Refuses with a native required field: nothing is sent.
  '/native':
    '<html><body><h1>Join</h1><form onsubmit="event.preventDefault()">' +
    '<input id="e" name="e" type="email" required><button type="submit">Save</button></form></body></html>',
  // Refuses by adding an alert after the submit.
  '/late-alert':
    '<html><body><h1>Join</h1><form onsubmit="event.preventDefault();' +
    "var a=document.createElement('div');a.setAttribute('role','alert');a.textContent='Email is required';document.body.appendChild(a)\">" +
    '<input id="e" name="e"><button type="submit">Save</button></form></body></html>',
  // novalidate form that shows the Source's sentence in an alert after the submit.
  '/novalidate-source':
    '<html><body><h1>Join</h1><form novalidate onsubmit="event.preventDefault();' +
    `document.getElementById('msg').textContent='${SOURCE_SENTENCE}'">` +
    '<input id="e" name="e" type="email" required><button type="submit">Save</button>' +
    '<div id="msg" role="alert"></div></form></body></html>',
};

const server = http.createServer((req, res) => {
  const html = pages[(req.url ?? '/').split('?')[0]!];
  if (!html) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});

let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
});

function rejectsCase(
  startPage: string,
  over: { probeOnly?: boolean; message?: string; withSubmit?: boolean } = {}
): TestCase {
  const submit = 'button[type="submit"]';
  const steps: TestCase['steps'] = [
    { action: 'fill', selector: '#e', value: '', name: 'Leave email empty' },
    over.withSubmit === false
      ? { action: 'wait', name: 'Look at the form without sending it' }
      : { action: 'click', selector: submit, name: 'Press Save' },
  ];
  return {
    id: 'TC-T48-RUN',
    flowId: 'rejects',
    name: 'Empty email',
    role: 'anonymous',
    startPage,
    steps,
    expectations: {
      refusal: {
        formPath: startPage,
        submitSelector: submit,
        ...(over.probeOnly ? { probeOnly: true } : {}),
        ...(over.message ? { message: over.message } : {}),
      },
    },
    kind: 'page-test',
    intent: 'rejects',
  };
}

async function run(testCase: TestCase) {
  return new FlowTestOrchestrator().run({
    targetUrl: base,
    productId: 'T-48-refusal-run',
    specTestCases: [testCase],
    outputDir,
    // One width, so one result per Test case (the default runs three).
    breakpoints: ['1440px'],
    enableA11y: false,
    enableSecurity: false,
    enablePerformance: false,
    enableSeo: false,
    recordVideo: false,
    onEvent: () => {},
  });
}

const titlesOf = (report: Awaited<ReturnType<typeof run>>) =>
  report.results.flatMap((r) => r.findings.map((f) => f.title));

describe('T-48 Rejects in a run', () => {
  it('a probe-only Rejects item on a lenient form produces a finding, never silence', async () => {
    const report = await run(rejectsCase('/lenient', { probeOnly: true, withSubmit: false }));
    expect(report.results).toHaveLength(1);
    expect(titlesOf(report).some((t) => /accepted a value it should refuse/.test(t))).toBe(true);
  }, 60000);

  it('a probe-only Rejects item on a native-required form passes (no finding)', async () => {
    const report = await run(rejectsCase('/native', { probeOnly: true, withSubmit: false }));
    expect(report.results).toHaveLength(1);
    expect(titlesOf(report).some((t) => /accepted a value it should refuse/.test(t))).toBe(false);
  }, 60000);

  it('a form that accepts the value with a permanent role=alert on the page is a finding, not a pass', async () => {
    const report = await run(rejectsCase('/permanent-alert'));
    expect(titlesOf(report).some((t) => /accepted a value it should refuse/.test(t))).toBe(true);
  }, 60000);

  it('an alert that appears after the submit counts as a refusal', async () => {
    const report = await run(rejectsCase('/late-alert'));
    expect(titlesOf(report).some((t) => /accepted a value it should refuse/.test(t))).toBe(false);
  }, 60000);

  it('a novalidate form showing the Source sentence in an alert is not a different-wording finding', async () => {
    const report = await run(rejectsCase('/novalidate-source', { message: SOURCE_SENTENCE }));
    expect(titlesOf(report).some((t) => /different wording/.test(t))).toBe(false);
  }, 60000);
});
