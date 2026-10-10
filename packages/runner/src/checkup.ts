/**
 * One check-up from the command line, with nothing to click: start the runner in this process,
 * test one address, write the report, print the verdict, and exit with a code a build can use.
 * It is what the generated GitHub Actions workflow runs, so the check-up happens on the user's own
 * Actions minutes and nothing of ours has to be hosted.
 *
 *   node packages/runner/dist/checkup.js https://preview.example.com [--staging] [--fail-on blocker|major|none]
 *
 * Settings come from the command line, or from the environment so a workflow can set them:
 *   QA_AI_API_KEY    the AI key. Without one the plan is written by fixed rules, with no AI.
 *   QA_AI_PROVIDER   openrouter (default), gemini, openai or anthropic
 *   QA_OUTPUT_DIR    where the report goes (default qa-report)
 *   QA_MAX_PAGES     pages to explore at most (default 50, to keep a run inside free Actions minutes)
 *   QA_FAIL_ON       blocker (default), major or none
 *   QA_USERNAME, QA_PASSWORD  test sign-in details. Environment only, never a flag. Setting both is the
 *                    consent to sign in and test fully (ADR 0022): use a test account on a test copy.
 *   QA_LOGIN_PATH    optional sign-in page path (for example /login)
 *
 * On GitHub Actions (GITHUB_ACTIONS=true) it also prints one annotation per active Blocker (error) or
 * Major (warning). The exit code does not depend on them.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { isActiveFinding, releaseVerdict } from '@qa/types';
import { githubAnnotations } from '@qa/core';
import type { AIProviderType, Finding, ReleaseReport } from '@qa/types';
import { RunnerServer } from './server.js';

export type FailOn = 'blocker' | 'major' | 'none';

export interface CheckupArgs {
  url?: string;
  staging: boolean;
  failOn: FailOn;
  outputDir: string;
  maxPages: number;
  provider: AIProviderType;
  apiKey?: string;
  /** Test sign-in details from the environment. Present only when both QA_USERNAME and QA_PASSWORD are set. */
  signIn?: { username: string; password: string; loginPath?: string };
}

const PROVIDERS: AIProviderType[] = ['openrouter', 'gemini', 'openai', 'anthropic'];
const RUN_TIMEOUT_MS = 40 * 60 * 1000;
const DEFAULT_PORT = 3601;

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CheckupArgs {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const failOn = (flag('--fail-on') ?? env.QA_FAIL_ON ?? 'blocker').toLowerCase();
  if (!['blocker', 'major', 'none'].includes(failOn)) {
    throw new Error(`--fail-on must be blocker, major or none, not "${failOn}"`);
  }
  const provider = (flag('--provider') ?? env.QA_AI_PROVIDER ?? 'openrouter') as AIProviderType;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`The AI provider must be one of ${PROVIDERS.join(', ')}, not "${provider}"`);
  }
  const maxPages = Number(flag('--max-pages') ?? env.QA_MAX_PAGES ?? 50);
  const flagValues = new Set(
    ['--fail-on', '--provider', '--max-pages', '--output'].map((f) => flag(f)).filter(Boolean)
  );
  return {
    url: argv.find((a) => !a.startsWith('--') && !flagValues.has(a)) ?? env.QA_TARGET_URL,
    staging: argv.includes('--staging') || env.QA_STAGING === 'true',
    failOn: failOn as FailOn,
    outputDir: path.resolve(flag('--output') ?? env.QA_OUTPUT_DIR ?? 'qa-report'),
    maxPages: Number.isFinite(maxPages) && maxPages > 0 ? Math.min(Math.floor(maxPages), 1000) : 50,
    provider,
    apiKey: env.QA_AI_API_KEY?.trim() || undefined,
    signIn:
      env.QA_USERNAME && env.QA_PASSWORD
        ? { username: env.QA_USERNAME, password: env.QA_PASSWORD, loginPath: env.QA_LOGIN_PATH?.trim() || undefined }
        : undefined,
  };
}

/** The body for POST /api/runner/run. Test sign-in details, when set, are the consent for a full test. */
export function buildRunBody(args: CheckupArgs): Record<string, unknown> {
  const hasKey = !!args.apiKey;
  return {
    targetUrl: args.url,
    productId: 'ci',
    // A test copy, or a test sign-in, is tested fully. Anything else is read-only: nothing is sent to it.
    owner: args.staging || !!args.signIn,
    stagingHost: args.staging || undefined,
    useAI: hasKey,
    planWithoutAI: !hasKey,
    // With no key there is no AI to ask for: the fixed-rule plan needs no provider.
    aiProvider: hasKey ? args.provider : 'mock',
    apiKey: args.apiKey,
    maxPages: args.maxPages,
    skipReview: true,
    ...(args.signIn
      ? {
          roles: [
            {
              role: 'member',
              username: args.signIn.username,
              password: args.signIn.password,
              loginPath: args.signIn.loginPath,
            },
          ],
          signInConsent: true,
        }
      : {}),
  };
}

/** Removes the sign-in details from any text before it is printed. */
export function scrub(text: string, signIn?: CheckupArgs['signIn']): string {
  let out = text;
  for (const v of [signIn?.password, signIn?.username]) if (v) out = out.split(v).join('[hidden]');
  return out;
}

/** Findings that count against the release: confirmed, and not marked intended or not a problem. */
function active(findings: Finding[]): Finding[] {
  return findings.filter(isActiveFinding);
}

/** The process exit code: 1 when something at or above the chosen level was found. */
export function exitCodeFor(findings: Finding[], failOn: FailOn): number {
  if (failOn === 'none') return 0;
  const levels = failOn === 'major' ? ['Blocker', 'Major'] : ['Blocker'];
  return active(findings).some((f) => levels.includes(f.severity)) ? 1 : 0;
}

/** Markdown for the Actions job summary page. */
export function summaryMarkdown(report: ReleaseReport, args: Pick<CheckupArgs, 'url' | 'failOn'>): string {
  const verdict = releaseVerdict(report.findings);
  const findings = active(report.findings);
  const bySeverity = (s: string) => findings.filter((f) => f.severity === s).length;
  const lines = [
    `## ${verdict.ready ? '✅' : '⛔'} ${verdict.stamp}`,
    '',
    verdict.reason,
    '',
    `Checked ${args.url ?? report.targetUrl}. ${report.coverage.totalTestPoints} tests: ${report.coverage.passed} passed, ${report.coverage.failed} failed.`,
    '',
    `| Blockers | Majors | Minors | Suggestions |`,
    `| :---: | :---: | :---: | :---: |`,
    `| ${bySeverity('Blocker')} | ${bySeverity('Major')} | ${bySeverity('Minor')} | ${bySeverity('Suggestion')} |`,
    '',
  ];
  const worst = findings.filter((f) => f.severity === 'Blocker' || f.severity === 'Major').slice(0, 10);
  if (worst.length) {
    lines.push('### Fix these first', '');
    for (const f of worst) lines.push(`- **${f.severity}:** ${f.title} (\`${f.where.urlPath}\`)`);
    lines.push('');
  }
  lines.push(
    "The full report (`report.html`, `report.md`, `findings.json`) is in this run's **qa-report** artifact.",
    '',
    '_Automatic checks only. This lists what was checked, and does not say the site is compliant or secure._'
  );
  return lines.join('\n');
}

export async function runCheckup(args: CheckupArgs): Promise<number> {
  if (!args.url) throw new Error('Give the address to check, for example: checkup.js https://preview.example.com');

  await fs.mkdir(args.outputDir, { recursive: true });
  // Outside the report folder: what the runner keeps while it works must never be uploaded with the report.
  // That includes the sign-in sessions (cookies), so they live here too and are deleted when the run ends.
  const port = Number(process.env.QA_CHECKUP_PORT) || DEFAULT_PORT;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-checkup-'));
  const server = new RunnerServer({
    port,
    outputDir: args.outputDir,
    dataDir: workDir,
    authDir: path.join(workDir, 'auth'),
  });
  try {
    await server.start();
  } catch (err) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  const base = `http://localhost:${port}`;

  try {
    const hasKey = !!args.apiKey;
    if (hasKey && (args.provider === 'openrouter' || args.provider === 'gemini')) {
      console.log(
        '[checkup] Note: free-tier AI keys may be used by the provider for training. Page text from the checked site is sent to the AI.'
      );
    }
    if (!hasKey) console.log('[checkup] No QA_AI_API_KEY set: the plan is written by fixed rules, with no AI.');
    const res = await fetch(`${base}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRunBody(args)),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; suggestion?: string };
      throw new Error(
        scrub(
          `The check-up could not start: ${body.error ?? `HTTP ${res.status}`}${body.suggestion ? ` ${body.suggestion}` : ''}`,
          args.signIn
        )
      );
    }

    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let status: { isRunning: boolean; lastRunError: string | null; lastErrorCode?: string | null } = {
      isRunning: true,
      lastRunError: null,
    };
    while (status.isRunning && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      status = (await (await fetch(`${base}/api/runner/status`)).json()) as typeof status;
    }
    if (status.isRunning) throw new Error('The check-up took longer than 40 minutes and was stopped.');
    if (status.lastErrorCode === 'ERR_SIGN_IN_FAILED' && status.lastRunError) {
      // The fixed reason text only, never built from the typed details.
      throw new Error(`Sign-in failed. ${scrub(status.lastRunError, args.signIn)}`);
    }
    if (status.lastRunError) throw new Error(scrub(status.lastRunError, args.signIn));

    const report = (await (await fetch(`${base}/api/report`)).json()) as ReleaseReport;
    const verdict = releaseVerdict(report.findings);
    console.log(`\n[checkup] ${verdict.stamp}: ${verdict.reason}`);
    console.log(`[checkup] Report written to ${args.outputDir}`);

    // Inline annotations on GitHub Actions: one per active Blocker (error) or Major (warning). ADR 0017.
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const line of githubAnnotations(report.findings)) console.log(line);
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(report, args) + '\n').catch(() => {});
    }
    const code = exitCodeFor(report.findings, args.failOn);
    if (code !== 0)
      console.log(
        `[checkup] Failing the build: findings at or above "${args.failOn}" were found (--fail-on ${args.failOn}).`
      );
    return code;
  } finally {
    await server.stop();
    // Success, failure or stop: the sessions and the rest of the working folder go.
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Run only when started from the command line, not when imported.
const startedDirectly = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (startedDirectly) {
  runCheckup(parseArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[checkup] ${err instanceof Error ? err.message : err}`);
      process.exit(2);
    });
}
