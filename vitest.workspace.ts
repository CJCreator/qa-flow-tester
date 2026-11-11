import { defineWorkspace, configDefaults } from 'vitest/config';
import { sharedTest, sharedResolve } from './vitest.config';

// Two tiers. Every test file belongs to exactly one project.
//   unit    : no Chromium, no external network. A loopback server on a port the OS picks is allowed (a
//             RunnerServer, or an http.createServer stub). `pnpm test` and PR CI run only this.
//   browser : launches Chromium (directly, or through the Spider, a discovery agent, the orchestrator or the
//             runner's CLI). `pnpm test:browser`; nightly only, never on PRs.
// `pnpm test:all` runs both. Checked on 2026-11-03 by running `--project unit` with PLAYWRIGHT_BROWSERS_PATH
// set to an empty folder: no unit file tried to launch Chromium.
// A new test file lands in `unit` by default. Add it here when it launches Chromium.
const BROWSER_TESTS: Record<string, string[]> = {
  checkers: ['alt-text-quality', 'design-ux-checkers', 'keyboard-a11y', 'performance', 'refusal-rule', 'security'],
  core: [
    'browser-guard',
    'browser-restart',
    'element-inventory',
    'finding-groups',
    'form-selectors',
    'multi-browser-network',
    'orchestrator-run-paths',
    'role-selector-exact',
    'small-fixes',
    'visual-capture',
    // Website audit (REQ-033, REQ-048...): each launches Chromium through `playwright` or the Spider.
    'audit-crawl-browser',
    'audit-doc-pdf',
    'audit-phone-layout',
  ],
  runner: [
    'access-token',
    'ai-estimate-cap',
    'baseline-accept',
    'beta',
    'beta-privacy',
    'cli-bind-host',
    'context-docx-route',
    'domain-proof',
    'error-redaction',
    'issues-download',
    'reapproval-roles',
    'remembered-signins',
    'route-inventory',
    'scheduler',
    'single-server',
    'spec-override-endpoint',
    // Website audit: each starts a RunnerServer, and some drive Chromium.
    'audit-documents-flow',
    'audit-flow-browser',
    'audit-helpers-routes',
    'audit-persistence-integration',
    'audit-preview-browser',
    'helper-access',
    'route-access-server',
    'server-audit-wiring',
  ],
  wizard: ['landing-audit-browser'],
};

const browserFiles = Object.entries(BROWSER_TESTS).flatMap(([pkg, names]) =>
  names.map((name) => `packages/${pkg}/tests/${name}.test.ts`)
);

export default defineWorkspace([
  {
    resolve: sharedResolve,
    test: {
      ...sharedTest,
      name: 'unit',
      include: ['packages/*/tests/**/*.test.{ts,tsx}'],
      exclude: [...configDefaults.exclude, ...browserFiles],
    },
  },
  {
    resolve: sharedResolve,
    test: {
      ...sharedTest,
      name: 'browser',
      include: browserFiles,
    },
  },
]);
