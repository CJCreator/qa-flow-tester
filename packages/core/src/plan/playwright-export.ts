import type { Breakpoint, ReviewPlan, TestCase, TestCaseExpectations, TestCaseStep } from '@qa/types';
import { SafetyFilter } from '../discovery/safety-filter.js';
import { needsTestCopy } from '../live-site.js';
import { redactUrl } from '../redact.js';

export interface ExportFile {
  path: string;
  content: string;
}

/** Same range as core's `playwright` dependency (packages/core/package.json). Free to update. */
export const EXPORT_PLAYWRIGHT_RANGE = '^1.49.1';

// Copied from browser.ts on purpose: that module imports playwright, which the exporter must not.
const VIEWPORTS: Record<Breakpoint, { width: number; height: number }> = {
  '375px': { width: 375, height: 667 },
  '768px': { width: 768, height: 1024 },
  '1440px': { width: 1440, height: 900 },
};

export const EXPORT_LIMITS: string[] = [
  'Checkers and findings (accessibility, security, SEO, performance, design) are not exported; only steps and expectations.',
  'The fuzzy and quoted-text selector fallback of the Check-up is not reproduced; selectors are used as written in the Plan.',
  'A select step picks the exact value; the closest-option fallback is not reproduced.',
  'Clean Flow Retry, Entity Namespacing, per-step retries and budgets are not reproduced.',
  'Each test runs at one screen size; steps for another size are dropped, and menu steps only appear through their size.',
  'Expectations that are an AI guess, or that need judging (error messages, success messages, moving away from a page, API calls), are written as comments, not checked.',
  'URL expectations support the * wildcard only, not regular expressions.',
  'No screenshots, evidence or visual baselines.',
];

const SECRET_NAME = /pass(word)?|secret|token|otp|card|cvv/i;
const DESTRUCTIVE_METHODS = "['POST', 'PUT', 'PATCH', 'DELETE']";

/** A string literal. Everything that comes from the Plan goes through here, redacted. */
function q(text: string): string {
  return JSON.stringify(redactUrl(text));
}

/** Text for a `//` comment: one line, nothing that could end a block comment. */
function comment(text: string): string {
  return redactUrl(text).replace(/\s+/g, ' ').replace(/\*\//g, '* /').trim();
}

function slugOf(role: string): string {
  return (
    role
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'role'
  );
}

function envOf(role: string): string {
  return (
    role
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'ROLE'
  );
}

function effectiveSize(tc: TestCase): Breakpoint {
  const sizes = tc.breakpoints;
  if (!sizes || sizes.length === 0 || sizes.includes('1440px')) return '1440px';
  return sizes[0]!;
}

function sameHost(target: string, address: string): boolean {
  try {
    return new URL(address).host === new URL(target).host;
  } catch {
    return false;
  }
}

function isAbsolute(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

type Where = { kind: 'goto'; path: string } | { kind: 'request'; url: string };

function whereIs(target: string, value: string): Where {
  if (!isAbsolute(value)) return { kind: 'goto', path: value };
  if (sameHost(target, value)) {
    const u = new URL(value);
    return { kind: 'goto', path: `${u.pathname}${u.search}${u.hash}` };
  }
  return { kind: 'request', url: value };
}

function proseSelector(selector: string): boolean {
  return /\s/.test(selector) && !/[[#.>=:(]/.test(selector);
}

class Unmappable extends Error {}

function mapStep(step: TestCaseStep, role: string, target: string): string[] {
  const label = `// ${comment(step.name)}`;
  const needSelector = (): string => {
    if (!step.selector) throw new Unmappable(`The step "${comment(step.name)}" has no selector in the Plan.`);
    if (proseSelector(step.selector))
      throw new Unmappable(`The step "${comment(step.name)}" names its target in words, not as a selector.`);
    return step.selector;
  };
  switch (step.action) {
    case 'click': {
      const selector = needSelector();
      if (step.optional)
        return [
          label,
          `{`,
          `  const el = await sel(page, ${q(selector)});`,
          `  if (await el.isVisible()) await el.click();`,
          `}`,
        ];
      return [label, `await (await sel(page, ${q(selector)})).click();`];
    }
    case 'fill': {
      const selector = needSelector();
      const value = step.value ?? '';
      let expr: string;
      if (/\{\{\s*username\s*\}\}/i.test(value)) expr = `process.env[${JSON.stringify(`QA_${envOf(role)}_USERNAME`)}]!`;
      else if (/\{\{\s*password\s*\}\}/i.test(value) || SECRET_NAME.test(selector) || SECRET_NAME.test(step.name))
        expr = `process.env[${JSON.stringify(`QA_${envOf(role)}_PASSWORD`)}]!`;
      else expr = q(value);
      return [label, `await (await sel(page, ${q(selector)})).fill(${expr});`];
    }
    case 'select': {
      const selector = needSelector();
      return [label, `await (await sel(page, ${q(selector)})).selectOption(${q(step.value ?? '')});`];
    }
    case 'navigate': {
      if (!step.value) throw new Unmappable(`The step "${comment(step.name)}" has no address in the Plan.`);
      const where = whereIs(target, step.value);
      if (where.kind === 'goto') return [label, `await page.goto(${q(where.path)});`];
      return [label, `await expectLinkOk(request, ${q(where.url)});`];
    }
    case 'wait':
      return [label, `await page.waitForLoadState('load');`];
    case 'check-link':
      if (!step.value) throw new Unmappable(`The step "${comment(step.name)}" has no address in the Plan.`);
      return [label, `await expectLinkOk(request, ${q(step.value)});`];
    default:
      throw new Unmappable(
        `The step "${comment(step.name)}" uses an action (${comment(String(step.action))}) the export can't map.`
      );
  }
}

function expectationLines(e: TestCaseExpectations | undefined): string[] {
  if (!e) return [];
  const out: string[] = [];
  const guess = e.origin === 'ai-guess';
  const note = (what: string) => out.push(`// Not checked${guess ? ' (AI guess)' : ''}: ${comment(what)}`);
  if (e.url) {
    if (guess) note(`ends on ${e.url.pattern}`);
    else out.push(`await expectUrl(page, ${q(e.url.pattern)});`);
  }
  if (e.text?.contains) {
    if (guess) note(`the page says ${e.text.contains}`);
    else out.push(`await expect(page.locator('body')).toContainText(${q(e.text.contains)});`);
  }
  if (e.text?.notContains) {
    if (guess) note(`the page does not say ${e.text.notContains}`);
    else out.push(`await expect(page.locator('body')).not.toContainText(${q(e.text.notContains)});`);
  }
  if (e.elementState) {
    const s = e.elementState;
    if (guess) note(`${s.selector} state`);
    else {
      const loc = `(await sel(page, ${q(s.selector)}))`;
      if (s.visible === true) out.push(`await expect(${loc}).toBeVisible();`);
      if (s.visible === false) out.push(`await expect(${loc}).toBeHidden();`);
      if (s.disabled === true) out.push(`await expect(${loc}).toBeDisabled();`);
      if (s.disabled === false) out.push(`await expect(${loc}).toBeEnabled();`);
    }
  }
  if (e.pageWorks) {
    if (guess) note('the page opens and works');
    else out.push(`expect(response?.status() ?? 200).toBeLessThan(400);`);
  }
  if (e.validationError) note(`an error about ${e.validationError.field}`);
  if (e.successMessage) note('a success message shows');
  if (e.navigatesAway) note(`moves on from ${e.navigatesAway.fromPath}`);
  if (e.apiCall) note(`${e.apiCall.method} ${e.apiCall.path} answers ${e.apiCall.status}`);
  return out;
}

interface Emitted {
  /** Spec file kind: where the test goes. */
  group: 'pages' | 'page-tests' | 'navigation' | 'journeys' | 'links';
  code: string[];
  note?: string;
}

function groupOf(tc: TestCase): Emitted['group'] {
  switch (tc.kind) {
    case 'page':
      return 'pages';
    case 'page-test':
      return 'page-tests';
    case 'navigation':
      return 'navigation';
    case 'link':
      return 'links';
    default:
      return 'journeys';
  }
}

function indent(lines: string[], by = 2): string[] {
  const pad = ' '.repeat(by);
  return lines.map((l) => (l ? pad + l : l));
}

function emitTest(plan: ReviewPlan, tc: TestCase, title: string): Emitted {
  const group = groupOf(tc);
  const size = effectiveSize(tc);
  const steps = tc.steps.filter((s) => !s.onlyAt || s.onlyAt.length === 0 || s.onlyAt.includes(size));
  const safety = new SafetyFilter();

  const skip = (why: string): Emitted => ({
    group,
    note: `${title}: ${why}`,
    code: [`// Left out: ${comment(why)}`, `test.skip(${q(title)}, async () => {});`],
  });

  // Sensitive Actions are never exported, read-only or not.
  for (const s of steps) {
    if (s.action === 'click' && safety.isSensitive(s.name, s.selector ?? '')) {
      return skip('it presses a Sensitive Action, which the export never includes.');
    }
  }
  if (plan.readOnly) {
    const flow = {
      id: tc.id,
      name: title,
      role: tc.role,
      description: '',
      startPage: tc.startPage,
      steps,
    };
    if (needsTestCopy(flow, plan.pages ?? [])) {
      return skip(
        `the Plan is read-only (${plan.readOnlyReason || 'the site is not a test copy'}), so a step that sends a form or changes data is not exported.`
      );
    }
  }

  const body: string[] = [];
  let fixme: string | undefined;
  const start = whereIs(plan.targetUrl, tc.startPage || '/');
  if (start.kind === 'request') fixme = 'The start page is on another site, which the export does not open.';
  else body.push(`const response = await page.goto(${q(start.path)});`);
  if (!fixme) {
    try {
      for (const s of steps) body.push(...mapStep(s, tc.role, plan.targetUrl));
    } catch (err) {
      if (!(err instanceof Unmappable)) throw err;
      fixme = err.message;
    }
  }
  if (fixme) {
    return {
      group,
      note: `${title}: ${fixme}`,
      code: [`test(${q(title)}, async () => {`, `  // ${comment(fixme)}`, `  test.fixme(true, ${q(fixme)});`, `});`],
    };
  }
  body.push(...expectationLines(tc.expectations));

  const test = [`test(${q(title)}, async ({ page, request }) => {`, ...indent(body), `});`];
  if (size === '1440px') return { group, code: test };
  const v = VIEWPORTS[size];
  return {
    group,
    code: [
      `test.describe(${q(`${title} at ${size}`)}, () => {`,
      `  test.use({ viewport: { width: ${v.width}, height: ${v.height} } });`,
      ...indent(test),
      `});`,
    ],
  };
}

const HELPERS = [
  `import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';`,
  ``,
  `// Finds an element the way the Plan names it: a bare id is a data-testid, anything else a selector.`,
  `// A visible match is preferred; otherwise the first match.`,
  `export async function sel(page: Page, selector: string): Promise<Locator> {`,
  `  const base = /^[\\w-]+$/.test(selector) ? '[data-testid="' + selector + '"]' : selector;`,
  `  const visible = page.locator(base + ' >> visible=true');`,
  `  if ((await visible.count()) > 0) return visible.first();`,
  `  return page.locator(base).first();`,
  `}`,
  ``,
  `function escapeRegExp(text: string): string {`,
  `  return text.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');`,
  `}`,
  ``,
  `function trimSlash(text: string): string {`,
  `  return text.replace(/\\/+$/, '');`,
  `}`,
  ``,
  `// Plain address or a * wildcard; a trailing slash does not matter.`,
  `export async function expectUrl(page: Page, pattern: string): Promise<void> {`,
  `  const url = new URL(page.url());`,
  `  const seen = [url.pathname, url.pathname + url.search, url.href].map(trimSlash);`,
  `  const re = new RegExp('^' + trimSlash(pattern).split('*').map(escapeRegExp).join('.*') + '$');`,
  `  expect(seen.some((s) => re.test(s)), 'Expected the page address to match ' + pattern + ' but it is ' + url.href).toBe(true);`,
  `}`,
  ``,
  `// A link that leaves the site is only asked for its status, never opened. Broken = 404, 410 or a server error.`,
  `export async function expectLinkOk(request: APIRequestContext, url: string): Promise<void> {`,
  `  const res = await request.get(url, { maxRedirects: 10, failOnStatusCode: false });`,
  `  const status = res.status();`,
  `  expect(status === 404 || status === 410 || status >= 500, url + ' answered ' + status).toBe(false);`,
  `}`,
  ``,
].join('\n');

function supportTest(readOnly: boolean): string {
  return [
    `import { test as base, expect } from '@playwright/test';`,
    ``,
    `// The Plan was read-only: nothing may send data. This blocks changing requests as a second guard.`,
    `const READ_ONLY = ${readOnly ? 'true' : 'false'};`,
    `const CHANGING = ${DESTRUCTIVE_METHODS};`,
    ``,
    `export const test = base.extend({`,
    `  context: async ({ context }, use) => {`,
    `    if (READ_ONLY) {`,
    `      await context.route('**/*', (route) =>`,
    `        CHANGING.includes(route.request().method()) ? route.abort('blockedbyclient') : route.fallback()`,
    `      );`,
    `    }`,
    `    await use(context);`,
    `  },`,
    `});`,
    ``,
    `export { expect };`,
    ``,
  ].join('\n');
}

function globalSetup(roles: Array<{ slug: string; env: string }>, target: string): string {
  return [
    `// Template: signs each role in once and saves the sign-in state to auth/<role>.json (kept out of git).`,
    `// It guesses generic email, password and submit fields. Adjust it to your sign-in page, or create`,
    `// the files yourself with: npx playwright codegen --save-storage=auth/<role>.json <address>`,
    `import fs from 'node:fs';`,
    `import { chromium } from '@playwright/test';`,
    ``,
    `const BASE_URL = ${q(target)};`,
    `const ROLES = ${JSON.stringify(roles, null, 2)};`,
    ``,
    `export default async function globalSetup(): Promise<void> {`,
    `  if (ROLES.length === 0) return;`,
    `  fs.mkdirSync('auth', { recursive: true });`,
    `  const browser = await chromium.launch();`,
    `  try {`,
    `    for (const role of ROLES) {`,
    `      const file = 'auth/' + role.slug + '.json';`,
    `      if (fs.existsSync(file)) continue;`,
    `      const username = process.env['QA_' + role.env + '_USERNAME'];`,
    `      const password = process.env['QA_' + role.env + '_PASSWORD'];`,
    `      if (!username || !password) {`,
    `        console.warn('No sign-in state for ' + role.slug + ': set QA_' + role.env + '_USERNAME and QA_' + role.env + '_PASSWORD, or create ' + file);`,
    `        continue;`,
    `      }`,
    `      const loginPath = process.env['QA_' + role.env + '_LOGIN_PATH'] || '/login';`,
    `      const context = await browser.newContext({ baseURL: BASE_URL });`,
    `      const page = await context.newPage();`,
    `      await page.goto(loginPath);`,
    `      await page.locator('input[type="email"], input[name="email"], input[name="username"], input[type="text"]').first().fill(username);`,
    `      await page.locator('input[type="password"]').first().fill(password);`,
    `      await page.locator('button[type="submit"], input[type="submit"]').first().click();`,
    `      await page.waitForLoadState('load');`,
    `      await context.storageState({ path: file });`,
    `      await context.close();`,
    `    }`,
    `  } finally {`,
    `    await browser.close();`,
    `  }`,
    `}`,
    ``,
  ].join('\n');
}

function readme(plan: ReviewPlan, roles: Array<{ slug: string; env: string }>, leftOut: string[]): string {
  const lines: string[] = [
    `# Playwright export of the Plan for ${comment(plan.targetUrl)}`,
    ``,
    `This project is an export of an approved Plan from QA Flow Tester. It holds the steps and expectations of the Plan Items that were switched on.`,
    ``,
    `## Run it`,
    ``,
    '```',
    `npm install`,
    `npx playwright install chromium`,
    `npx playwright test`,
    '```',
    ``,
    `The address under test is \`baseURL\` in \`playwright.config.ts\`. The pinned \`@playwright/test\` version (${EXPORT_PLAYWRIGHT_RANGE}) is free to update.`,
    ``,
    `## Sign-in state`,
    ``,
    `Each role other than \`visitor\` has its own Playwright project and reads its sign-in state from \`auth/<role>.json\`. No password, cookie or token is written in this project; \`auth/\` is in \`.gitignore\`.`,
  ];
  if (roles.length) {
    lines.push(
      ``,
      `\`global-setup.ts\` is a template that signs each role in with environment variables and saves the state:`,
      ``,
      ...roles.map(
        (r) =>
          `- \`${r.slug}\`: \`QA_${r.env}_USERNAME\`, \`QA_${r.env}_PASSWORD\`, optional \`QA_${r.env}_LOGIN_PATH\` (default \`/login\`)`
      ),
      ``,
      `Or create the files yourself: \`npx playwright codegen --save-storage=auth/<role>.json <address>\`.`
    );
  } else lines.push(``, `This Plan has no signed-in roles, so no sign-in state is needed.`);
  if (plan.readOnly) {
    lines.push(
      ``,
      `## Read-only`,
      ``,
      `The Plan was read-only: ${comment(plan.readOnlyReason || 'the site is not a test copy')}. Steps that send a form, change data or press a Sensitive Action are not exported, and \`support/test.ts\` blocks changing requests (POST, PUT, PATCH, DELETE).`
    );
  }
  if (leftOut.length) {
    lines.push(``, `## Left out or not mapped`, ``, ...leftOut.map((l) => `- ${comment(l)}`));
  }
  lines.push(``, `## Limits`, ``, ...EXPORT_LIMITS.map((l) => `- ${l}`), ``);
  return lines.join('\n');
}

/**
 * The approved Plan as a standalone Playwright project. Built from `plan.testCases`, so it is
 * what a Check-up would run: switched-off Plan Items and Scope Exclusions are already out.
 * Deterministic: no dates, no random ids. Secrets are never written; sign-in state is a path.
 */
export function planToPlaywrightProject(plan: ReviewPlan): ExportFile[] {
  const cases = plan.testCases ?? [];
  if (cases.length === 0) throw new Error('The Plan has no tests to export');

  // Roles in plan order: visitor first, then the Plan's roles, then any a test uses.
  const names: string[] = ['visitor'];
  for (const r of [...(plan.roles ?? []), ...cases.map((c) => c.role || 'visitor')]) {
    if (!names.includes(r)) names.push(r);
  }
  const slugs = new Map<string, string>();
  const used = new Set<string>();
  for (const name of names) {
    let slug = slugOf(name);
    for (let n = 2; used.has(slug); n++) slug = `${slugOf(name)}-${n}`;
    used.add(slug);
    slugs.set(name, slug);
  }
  const signedIn = names.filter((n) => n !== 'visitor').map((n) => ({ slug: slugs.get(n)!, env: envOf(n) }));

  const files: ExportFile[] = [];
  const leftOut: string[] = [];
  const perRole = new Map<string, Map<Emitted['group'], string[][]>>();
  const titles = new Set<string>();
  for (const tc of cases) {
    const role = tc.role || 'visitor';
    let title = tc.name || tc.flowId || tc.id;
    if (titles.has(`${role}\n${title}`)) title = `${title} (${tc.id})`;
    for (let n = 2; titles.has(`${role}\n${title}`); n++) title = `${tc.name || tc.flowId || tc.id} (${tc.id}-${n})`;
    titles.add(`${role}\n${title}`);
    const out = emitTest(plan, tc, title);
    if (out.note) leftOut.push(`${role}: ${out.note}`);
    const groups = perRole.get(role) ?? new Map<Emitted['group'], string[][]>();
    groups.set(out.group, [...(groups.get(out.group) ?? []), out.code]);
    perRole.set(role, groups);
  }

  for (const [role, groups] of perRole) {
    const slug = slugs.get(role)!;
    for (const [group, tests] of groups) {
      const content = [
        `import { test, expect } from '../../support/test';`,
        `import { sel, expectUrl, expectLinkOk } from '../../support/helpers';`,
        ``,
        ...tests.flatMap((t) => [...t, ``]),
      ].join('\n');
      files.push({ path: `tests/${slug}/${group}.spec.ts`, content });
    }
  }

  const projects = names.map((name) => {
    const slug = slugs.get(name)!;
    const use = name === 'visitor' ? `{}` : `{ storageState: 'auth/${slug}.json' }`;
    return `    { name: '${slug}', testDir: './tests/${slug}', use: ${use} },`;
  });
  files.push(
    {
      path: 'package.json',
      content:
        JSON.stringify(
          {
            name: 'qa-flow-playwright-export',
            version: '0.0.0',
            private: true,
            scripts: { test: 'playwright test' },
            devDependencies: { '@playwright/test': EXPORT_PLAYWRIGHT_RANGE },
          },
          null,
          2
        ) + '\n',
    },
    {
      path: 'playwright.config.ts',
      content: [
        `import { defineConfig } from '@playwright/test';`,
        ``,
        `export default defineConfig({`,
        `  globalSetup: './global-setup.ts',`,
        `  use: { baseURL: ${q(plan.targetUrl)} },`,
        `  projects: [`,
        ...projects,
        `  ],`,
        `});`,
        ``,
      ].join('\n'),
    },
    { path: 'global-setup.ts', content: globalSetup(signedIn, plan.targetUrl) },
    { path: 'support/helpers.ts', content: HELPERS },
    { path: 'support/test.ts', content: supportTest(!!plan.readOnly) },
    {
      path: '.gitignore',
      content: ['auth/', 'node_modules/', 'test-results/', 'playwright-report/', '.env', ''].join('\n'),
    },
    { path: 'README.md', content: readme(plan, signedIn, leftOut) }
  );
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
