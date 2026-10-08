/**
 * The export of the approved Plan as a Playwright project: pure string output from plan.testCases,
 * the zip around it, and the safety rules (read-only, Sensitive Actions, secrets, host).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DiscoveryDraft, ReviewPlan, TestCase } from '@qa/types';
import { planToPlaywrightProject, EXPORT_PLAYWRIGHT_RANGE } from '../src/plan/playwright-export.js';
import { zipFiles, crc32 } from '../src/plan/zip.js';
import { expandPlan } from '../src/plan/expand.js';

const tc = (extra: Partial<TestCase> = {}): TestCase => ({
  id: 'TC-001',
  flowId: 'journey',
  name: 'Open the shop',
  role: 'visitor',
  startPage: '/',
  steps: [{ action: 'wait', name: 'Look' }],
  expectations: {},
  kind: 'journey',
  ...extra,
});

const planOf = (testCases: TestCase[], extra: Partial<ReviewPlan> = {}): ReviewPlan => ({
  runId: 'run-1',
  targetUrl: 'https://shop.example/',
  discoveredAt: '2026-10-01T00:00:00Z',
  pages: [],
  flows: [],
  questions: [],
  testCases,
  ...extra,
});

type Files = Array<{ path: string; content: string }>;
const all = (files: Files) => files.map((f) => f.content).join('\n');
const file = (files: Files, path: string) => files.find((f) => f.path === path)?.content ?? '';

describe('playwright export', () => {
  it('export returns package.json, playwright.config.ts, tests/*.spec.ts and README.md', () => {
    const files = planToPlaywrightProject(planOf([tc(), tc({ id: 'TC-002', name: 'Visit /', kind: 'page' })]));
    const paths = files.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('playwright.config.ts');
    expect(paths).toContain('README.md');
    expect(paths).toContain('tests/visitor/journeys.spec.ts');
    expect(paths).toContain('tests/visitor/pages.spec.ts');
    expect(paths).toEqual([...paths].sort());
    expect(JSON.parse(file(files, 'package.json')).devDependencies['@playwright/test']).toBe(EXPORT_PLAYWRIGHT_RANGE);
  });

  it('export pins the same Playwright range as core', () => {
    const core = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(core.dependencies.playwright).toBe(EXPORT_PLAYWRIGHT_RANGE);
  });

  it('export is byte-identical for the same Plan', () => {
    const plan = planOf([tc(), tc({ id: 'TC-002', name: 'Second' })]);
    const a = planToPlaywrightProject(plan);
    const b = planToPlaywrightProject(plan);
    expect(a).toEqual(b);
    expect(zipFiles(a).equals(zipFiles(b))).toBe(true);
  });

  it('export zip has a valid central directory and correct crc32 per file', () => {
    const files = planToPlaywrightProject(planOf([tc()]));
    const zip = zipFiles(files);
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(files.length);
    let p = zip.readUInt32LE(eocd + 16);
    expect(p + zip.readUInt32LE(eocd + 12)).toBe(eocd);
    for (const f of files) {
      expect(zip.readUInt32LE(p)).toBe(0x02014b50);
      const crc = zip.readUInt32LE(p + 16);
      const size = zip.readUInt32LE(p + 20);
      const nameLen = zip.readUInt16LE(p + 28);
      const local = zip.readUInt32LE(p + 42);
      expect(zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')).toBe(f.path);
      expect(size).toBe(Buffer.byteLength(f.content));
      expect(crc).toBe(crc32(Buffer.from(f.content)));
      expect(zip.readUInt32LE(local)).toBe(0x04034b50);
      const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      expect(zip.subarray(dataStart, dataStart + size).toString('utf8')).toBe(f.content);
      p += 46 + nameLen;
    }
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('export maps click, fill, select, navigate, wait and check-link to Playwright calls', () => {
    const files = planToPlaywrightProject(
      planOf([
        tc({
          steps: [
            { action: 'click', selector: '#go', name: 'Go' },
            { action: 'click', selector: '#maybe', name: 'Maybe', optional: true },
            { action: 'fill', selector: '#name', value: 'Ada', name: 'Name' },
            { action: 'select', selector: '#size', value: 'L', name: 'Size' },
            { action: 'navigate', value: '/about', name: 'About' },
            { action: 'wait', name: 'Wait' },
            { action: 'check-link', value: 'https://partner.example/offer', name: 'Partner' },
          ],
        }),
      ])
    );
    const spec = file(files, 'tests/visitor/journeys.spec.ts');
    expect(spec).toContain('await page.goto("/");');
    expect(spec).toContain('(await sel(page, "#go")).click();');
    expect(spec).toContain('if (await el.isVisible()) await el.click();');
    expect(spec).toContain('(await sel(page, "#name")).fill("Ada");');
    expect(spec).toContain('(await sel(page, "#size")).selectOption("L");');
    expect(spec).toContain('await page.goto("/about");');
    expect(spec).toContain("await page.waitForLoadState('load');");
    expect(spec).toContain('await expectLinkOk(request, "https://partner.example/offer");');
    expect(file(files, 'support/helpers.ts')).toContain('maxRedirects: 10');
  });

  it('export marks a step it cannot map as test.fixme with a reason', () => {
    const files = planToPlaywrightProject(
      planOf([
        tc({ name: 'Prose', steps: [{ action: 'click', selector: 'the big blue button', name: 'Press it' }] }),
        tc({ id: 'TC-002', name: 'Missing', steps: [{ action: 'fill', name: 'No selector' }] }),
        tc({ id: 'TC-003', name: 'Unknown', steps: [{ action: 'check', selector: '#agree', name: 'Agree' }] }),
      ])
    );
    const spec = file(files, 'tests/visitor/journeys.spec.ts');
    expect(spec.match(/test\.fixme\(true,/g)).toHaveLength(3);
    expect(spec).not.toContain('the big blue button');
    expect(spec).not.toContain('#agree');
  });

  it('export drops steps whose onlyAt does not match the size and wraps non-desktop tests in a viewport', () => {
    const files = planToPlaywrightProject(
      planOf([
        tc({
          kind: 'navigation',
          name: 'About',
          breakpoints: ['375px'],
          steps: [
            { action: 'click', selector: '#menu', name: 'Open menu', onlyAt: ['375px'] },
            { action: 'click', selector: '#wide-only', name: 'Wide', onlyAt: ['1440px'] },
            { action: 'click', selector: '#about', name: 'About' },
          ],
        }),
      ])
    );
    const spec = file(files, 'tests/visitor/navigation.spec.ts');
    expect(spec).toContain('"#menu"');
    expect(spec).not.toContain('#wide-only');
    expect(spec).toContain('test.use({ viewport: { width: 375, height: 667 } });');
  });

  it('export writes AI-guess expectations as comments, not assertions', () => {
    const files = planToPlaywrightProject(
      planOf([
        tc({ expectations: { origin: 'ai-guess', text: { contains: 'Welcome' }, url: { pattern: '/done' } } }),
        tc({ id: 'TC-002', name: 'Observed', expectations: { text: { contains: 'Hello' }, url: { pattern: '/a/*' } } }),
      ])
    );
    const spec = file(files, 'tests/visitor/journeys.spec.ts');
    expect(spec).not.toContain('toContainText("Welcome")');
    expect(spec).not.toContain('expectUrl(page, "/done")');
    expect(spec).toContain('// Not checked (AI guess)');
    expect(spec).toContain('toContainText("Hello")');
    expect(spec).toContain('await expectUrl(page, "/a/*");');
  });

  it('export strings are quoted safely', () => {
    const nasty = 'a\'b"c`${x}*/\nd';
    const files = planToPlaywrightProject(
      planOf([tc({ name: nasty, steps: [{ action: 'click', selector: "#x[title='y']", name: nasty }] })])
    );
    const spec = file(files, 'tests/visitor/journeys.spec.ts');
    expect(spec).toContain(JSON.stringify(nasty));
    for (const line of spec.split('\n')) if (line.trim().startsWith('//')) expect(line).not.toContain('*/');
  });

  it('export uses one Playwright project per role with a storageState path and no secret', () => {
    const files = planToPlaywrightProject(
      planOf(
        [
          tc({ role: 'visitor' }),
          tc({
            id: 'TC-002',
            name: 'Admin signs in ?token=s3cr3t-FAKE-tok',
            role: 'admin',
            startPage: '/login?token=s3cr3t-FAKE-tok',
            steps: [
              { action: 'fill', selector: '#password', value: 's3cr3t-FAKE-pw', name: 'Fill password' },
              { action: 'fill', selector: '#user', value: '{{username}}', name: 'Fill user' },
            ],
          }),
        ],
        { roles: ['visitor', 'admin'] }
      )
    );
    const config = file(files, 'playwright.config.ts');
    expect(config).toContain("name: 'visitor'");
    expect(config).toContain("name: 'admin'");
    expect(config).toContain("storageState: 'auth/admin.json'");
    expect(config.match(/storageState/g)).toHaveLength(1);
    const text = all(files);
    expect(text).not.toContain('s3cr3t-FAKE-pw');
    expect(text).not.toContain('s3cr3t-FAKE-tok');
    const admin = file(files, 'tests/admin/journeys.spec.ts');
    expect(admin).toContain('process.env["QA_ADMIN_PASSWORD"]!');
    expect(admin).toContain('process.env["QA_ADMIN_USERNAME"]!');
    expect(text).not.toMatch(/"cookies"|"origins"|"password":/);
  });

  it('export adds .gitignore for auth and a README on creating sign-in state', () => {
    const files = planToPlaywrightProject(planOf([tc({ role: 'admin' })], { roles: ['visitor', 'admin'] }));
    expect(file(files, '.gitignore')).toContain('auth/');
    const readme = file(files, 'README.md');
    expect(readme).toContain('auth/<role>.json');
    expect(readme).toContain('QA_ADMIN_USERNAME');
    expect(readme).toContain('Limits');
    expect(file(files, 'global-setup.ts')).toContain('storageState({ path: file })');
  });

  const sendPlan = (readOnly: boolean): ReviewPlan =>
    planOf(
      [
        tc({
          kind: 'page-test',
          name: 'Send the form',
          startPage: '/contact',
          steps: [{ action: 'click', selector: '#send', name: 'Send' }],
        }),
      ],
      {
        readOnly,
        readOnlyReason: 'The site is live, not a test copy.',
        pages: [
          {
            urlPath: '/contact',
            title: 'Contact',
            interactiveElementsCount: 1,
            formsCount: 1,
            elements: [
              {
                role: 'button',
                name: 'Send',
                selector: '#send',
                tagName: 'button',
                visible: true,
                enabled: true,
                insideForm: true,
                inputType: 'submit',
              },
            ],
          },
        ],
      }
    );

  it('export leaves out a form submit and says why when the Plan is read-only', () => {
    const files = planToPlaywrightProject(sendPlan(true));
    expect(all(files)).not.toContain('#send');
    const spec = file(files, 'tests/visitor/page-tests.spec.ts');
    expect(spec).toContain('test.skip("Send the form"');
    expect(spec).toContain('The site is live, not a test copy.');
    expect(file(files, 'README.md')).toContain('The site is live, not a test copy.');
    expect(file(files, 'support/test.ts')).toContain('const READ_ONLY = true;');
    expect(file(files, 'support/test.ts')).toContain('route.abort');
  });

  it('export includes the same submit when the Plan is not read-only', () => {
    const files = planToPlaywrightProject(sendPlan(false));
    expect(file(files, 'tests/visitor/page-tests.spec.ts')).toContain('"#send"');
    expect(file(files, 'support/test.ts')).toContain('const READ_ONLY = false;');
  });

  it('export never clicks a Sensitive Action, read-only or not', () => {
    for (const readOnly of [true, false]) {
      const text = all(
        planToPlaywrightProject(
          planOf(
            [
              tc({ steps: [{ action: 'click', selector: '#delete-account', name: 'Delete account' }] }),
              tc({ id: 'TC-002', name: 'Fine', steps: [{ action: 'click', selector: '#fine', name: 'Fine' }] }),
            ],
            { readOnly }
          )
        )
      );
      expect(text).not.toContain('#delete-account');
      expect(text).toContain('"#fine"');
    }
  });

  it('export skips a read-only submit even when testCases were edited by hand', () => {
    const plan = sendPlan(true);
    plan.testCases = [
      tc({
        id: 'TC-HAND',
        name: 'Hand made',
        flowId: 'custom',
        kind: undefined,
        startPage: '/contact',
        steps: [{ action: 'click', selector: '#send', name: 'Go' }],
      }),
      tc({ id: 'TC-OK', name: 'Stays', steps: [{ action: 'wait', name: 'Look' }] }),
    ];
    const text = all(planToPlaywrightProject(plan));
    expect(text).not.toContain('#send');
    expect(text).toContain('test.skip("Hand made"');
    expect(text).toContain('"Stays"');
  });

  it('export has no switched-off Plan Item and no Scope Exclusion', () => {
    const draft = {
      version: '1.0',
      productId: 'shop',
      targetUrl: 'https://shop.example/',
      timestamp: '2026-10-01T00:00:00Z',
      pages: [],
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
      plan: {
        pages: [
          {
            id: 'P1',
            urlPath: '/',
            title: 'Home',
            coverage: 'tested',
            reachedBy: ['visitor'],
            tests: [],
            source: 'ai',
          },
          {
            id: 'P2',
            urlPath: '/switched-off-page',
            title: 'Off',
            coverage: 'tested',
            reachedBy: ['visitor'],
            tests: [],
            source: 'ai',
            skipped: true,
          },
        ],
        navigation: [
          {
            id: 'N1',
            name: 'Switched off link',
            startPage: '/',
            linkName: 'Off',
            selector: '#off-link',
            to: '/off',
            roles: ['visitor'],
            source: 'ai',
            skipped: true,
          },
        ],
        layoutGroups: [],
        otherHosts: [],
      },
    } as unknown as DiscoveryDraft;
    const { testCases } = expandPlan(draft, { readOnly: false, screenSizes: ['1440px'] });
    const text = all(planToPlaywrightProject(planOf(testCases)));
    expect(text).toContain('Visit /');
    expect(text).not.toContain('switched-off-page');
    expect(text).not.toContain('#off-link');
    expect(text).not.toContain('Switched off link');
  });

  it('export checks a link that leaves the site with a request, never a navigation', () => {
    const files = planToPlaywrightProject(
      planOf([
        tc({
          kind: 'link',
          name: 'Partner',
          breakpoints: ['1440px'],
          steps: [
            { action: 'check-link', value: 'https://partner.example/offer', name: 'Check' },
            { action: 'navigate', value: 'https://other.example/x', name: 'Away' },
            { action: 'navigate', value: 'https://shop.example/about?x=1', name: 'Same site' },
          ],
        }),
      ])
    );
    const spec = file(files, 'tests/visitor/links.spec.ts');
    expect(spec).toContain('expectLinkOk(request, "https://partner.example/offer")');
    expect(spec).toContain('expectLinkOk(request, "https://other.example/x")');
    expect(spec).not.toContain('page.goto("https://');
    expect(spec).toContain('page.goto("/about?x=1")');
    expect(file(files, 'playwright.config.ts')).toContain('baseURL: "https://shop.example/"');
  });

  it('export refuses a Plan with no tests', () => {
    expect(() => planToPlaywrightProject(planOf([]))).toThrow('The Plan has no tests to export');
    expect(() => planToPlaywrightProject({ ...planOf([]), testCases: undefined })).toThrow(
      'The Plan has no tests to export'
    );
  });
});
