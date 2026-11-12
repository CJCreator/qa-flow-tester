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
 *   QA_FAIL_ON       standard (default), blocker, major or none
 *   QA_CONCURRENCY   spider concurrency 1..5 (default 2)
 *   QA_DELAY_MS      pacing delay in ms 0..2000 (default 100)
 *   QA_CUSTOM_HEADERS custom HTTP headers JSON, e.g. {"X-QA-Bypass-Token":"..."} (or --header "Name: value")
 *   QA_DEBUG         comma list of debug areas (crawl, auth, nav), or "all" (or --debug [areas])
 *   QA_USERNAME, QA_PASSWORD  test sign-in details. Environment only, never a flag. Setting both is the
 *                    consent to sign in and test fully (ADR 0022): use a test account on a test copy.
 *   QA_LOGIN_PATH    optional sign-in page path (for example /login)
 *   QA_ROLES         more test sign-ins, JSON: [{"role","username","password","loginPath"?}]. Environment
 *                    only, never a flag. Same consent and care as QA_USERNAME.
 *   QA_DOCS          spec documents (.md, .txt, .docx) separated by ";" (or --docs a.md b.docx)
 *
 * On GitHub Actions (GITHUB_ACTIONS=true) it also prints one annotation per active Blocker (error) or
 * Major (warning). The exit code does not depend on them.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_RELEASE_GATES,
  isActiveFinding,
  releaseVerdict,
  isSupportedContextName,
  summarizeDocument,
  parseHeaderText,
} from '@qa/types';
import {
  githubAnnotations,
  docxToMarkdown,
  runPostDeploySmoke,
  smokeReport,
  ReportGenerator,
  redactSecretText,
} from '@qa/core';
import type { AIProviderType, Finding, ReleaseReport, SiteAspectGrades, RunStartBody } from '@qa/types';
import { createCheckupSession, createCheckupRun, resolveAuthorization } from './session/checkup-session.js';
import { createShutdown, type ShutdownHandler } from './shutdown.js';

export type FailOn = 'blocker' | 'major' | 'none' | 'standard';

export interface CheckupArgs {
  help?: boolean;
  url?: string;
  staging: boolean;
  failOn: FailOn;
  outputDir: string;
  maxPages: number;
  provider: AIProviderType;
  apiKey?: string;
  /** Test sign-in details from the environment. Present only when both QA_USERNAME and QA_PASSWORD are set. */
  signIn?: SignIn;
  /** Every test sign-in: QA_USERNAME/QA_PASSWORD (role member) first, then QA_ROLES. */
  signIns: RoleSignIn[];
  /** Spec documents to read as Product Context (--docs or QA_DOCS). */
  docs: string[];
  /** Most Tests the Plan runs before Rejects and Limits are trimmed (--test-cap). Absent: the default. */
  testCap?: number;
  /** Spider concurrency: 1 to 5 concurrent page evaluations (--concurrency or QA_CONCURRENCY). */
  crawlConcurrency?: number;
  /** Per-page pacing delay in ms: 0 to 2000 ms (--delay or QA_DELAY_MS). */
  crawlDelayMs?: number;
  /** Custom HTTP headers e.g. X-QA-Bypass-Token (--header "Name: value" or QA_CUSTOM_HEADERS). */
  customHeaders?: Record<string, string>;
  /** Debug areas to trace to stderr (--debug or QA_DEBUG). */
  debug?: string;
  /** `--preset smoke`: Smoke Check-up, GET-only reads of a few known paths. */
  preset?: 'smoke';
  /** Smoke: `--health-path /health`. */
  healthPath?: string;
  /** Smoke: `--expected-version 1.4.2`. */
  expectedVersion?: string;
  /** Smoke: `--confirm-live`, needed for an address that is not a test copy. */
  confirmLive?: boolean;
}

export interface SignIn {
  username: string;
  password: string;
  loginPath?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}
export interface RoleSignIn extends SignIn {
  role: string;
}

export interface CheckupDocument {
  name: string;
  text: string;
}

const MAX_DOCS = 10;
const MAX_DOC_BYTES = 500 * 1024;
const MAX_DOCX_BYTES = 2 * 1024 * 1024;

/** Hides `password: value` style text and secrets in a document before it leaves this machine. */
export function redactIngest(text: string): string {
  const hidden = text.replace(/password\s*[:=]\s*\S+/gi, '[hidden]');
  return redactSecretText(hidden);
}

function parseRoles(env: NodeJS.ProcessEnv): RoleSignIn[] {
  const out: RoleSignIn[] = [];
  if (env.QA_USERNAME && env.QA_PASSWORD) {
    out.push({
      role: 'member',
      username: env.QA_USERNAME,
      password: env.QA_PASSWORD,
      loginPath: env.QA_LOGIN_PATH?.trim() || undefined,
    });
  }
  const raw = env.QA_ROLES?.trim();
  if (raw) {
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Error('QA_ROLES must be JSON like [{"role":"admin","username":"...","password":"..."}].');
    }
    if (!Array.isArray(list)) throw new Error('QA_ROLES must be a JSON list of roles.');
    for (const r of list as Array<Record<string, unknown>>) {
      if (
        !r ||
        typeof r.role !== 'string' ||
        !r.role.trim() ||
        typeof r.username !== 'string' ||
        !r.username ||
        typeof r.password !== 'string' ||
        !r.password
      ) {
        throw new Error('Each QA_ROLES entry needs a role, a username and a password.');
      }
      out.push({
        role: r.role.trim(),
        username: r.username,
        password: r.password,
        loginPath: typeof r.loginPath === 'string' && r.loginPath.trim() ? r.loginPath.trim() : undefined,
        usernameSelector:
          typeof r.usernameSelector === 'string' && r.usernameSelector.trim() ? r.usernameSelector.trim() : undefined,
        passwordSelector:
          typeof r.passwordSelector === 'string' && r.passwordSelector.trim() ? r.passwordSelector.trim() : undefined,
        submitSelector:
          typeof r.submitSelector === 'string' && r.submitSelector.trim() ? r.submitSelector.trim() : undefined,
      });
    }
  }
  return out;
}

const PROVIDERS: AIProviderType[] = ['openrouter', 'gemini', 'openai', 'anthropic'];
const RUN_TIMEOUT_MS = 40 * 60 * 1000;

export const USAGE_TEXT = `Usage: checkup <url> [options]

One check-up from the command line: start the runner, test one address, write the report, print the verdict, and exit.

Options:
  --help, -h             Show this help text
  --staging              Mark target as a test/staging copy (allows full testing)
  --fail-on <level>      Exit code 1 on findings: standard (default), blocker, major, none
  --provider <name>      AI provider: openrouter (default), gemini, openai, anthropic
  --max-pages <n>        Pages to explore (1..1000, default 50)
  --output <dir>         Output directory for report (default qa-report)
  --test-cap <n>         Test cap (1..100000)
  --concurrency <n>      Spider concurrency (1..5, default 2)
  --delay <ms>           Pacing delay in ms (0..2000, default 100)
  --header "Name: val"   Custom HTTP header (repeatable)
  --docs <paths...>      Spec documents to read as Product Context
  --debug [areas]        Debug areas to trace (crawl, auth, nav) or "all"
  --preset smoke         Smoke Check-up (GET-only reads of known paths)
  --health-path <path>   Health check path for smoke preset
  --expected-version <v> Expected version for smoke preset
  --confirm-live         Confirm running smoke check against live address

Environment variables:
  QA_TARGET_URL          Address to check
  QA_AI_API_KEY          AI API key
  QA_AI_PROVIDER         AI provider
  QA_OUTPUT_DIR          Report output directory
  QA_MAX_PAGES           Pages to explore
  QA_FAIL_ON             Exit threshold
  QA_CONCURRENCY         Spider concurrency
  QA_DELAY_MS            Pacing delay in ms
  QA_CUSTOM_HEADERS      JSON custom headers
  QA_DEBUG               Debug areas
  QA_USERNAME, QA_PASSWORD Test sign-in details
  QA_ROLES               Additional roles JSON
  QA_DOCS                Spec documents separated by ";"`;

const VALUE_FLAGS = new Set([
  '--fail-on',
  '--provider',
  '--max-pages',
  '--output',
  '--test-cap',
  '--concurrency',
  '--delay',
  '--header',
  '--preset',
  '--health-path',
  '--expected-version',
]);

function parseWholeNumberInRange(
  raw: string | undefined,
  flagName: string,
  min: number,
  max: number
): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(`${flagName} must be a whole number from ${min} to ${max}, not "${raw}"`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${flagName} must be a whole number from ${min} to ${max}, not "${raw}"`);
  }
  return n;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CheckupArgs {
  const flagMap = new Map<string, string>();
  const headersList: string[] = [];
  const flagDocs: string[] = [];
  let debugValue: string | undefined;
  let positionalUrl: string | undefined;
  let help = false;
  let staging = false;
  let confirmLive: boolean | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--staging') {
      staging = true;
      continue;
    }
    if (arg === '--confirm-live') {
      confirmLive = true;
      continue;
    }
    if (arg === '--docs') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flagDocs.push(argv[++i]);
      }
      continue;
    }
    if (arg === '--debug') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--') && !/^https?:\/\//i.test(next)) {
        debugValue = next;
        i++;
      } else {
        debugValue = 'all';
      }
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      if (arg === '--header') {
        headersList.push(val);
      } else {
        flagMap.set(arg, val);
      }
      i++;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option "${arg}". Run with --help.`);
    }
    if (!positionalUrl) {
      positionalUrl = arg;
    }
  }

  const rawFailOn = flagMap.get('--fail-on') ?? env.QA_FAIL_ON;
  const failOn = (rawFailOn ? rawFailOn.toLowerCase() : 'standard') as FailOn;
  if (!['blocker', 'major', 'none', 'standard'].includes(failOn)) {
    throw new Error(`--fail-on must be blocker, major, none or standard, not "${failOn}"`);
  }
  const provider = (flagMap.get('--provider') ?? env.QA_AI_PROVIDER ?? 'openrouter') as AIProviderType;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`The AI provider must be one of ${PROVIDERS.join(', ')}, not "${provider}"`);
  }

  const maxPages =
    parseWholeNumberInRange(flagMap.get('--max-pages') ?? env.QA_MAX_PAGES, '--max-pages', 1, 1000) ?? 50;
  const crawlConcurrency = parseWholeNumberInRange(
    flagMap.get('--concurrency') ?? env.QA_CONCURRENCY,
    '--concurrency',
    1,
    5
  );
  const testCap = parseWholeNumberInRange(flagMap.get('--test-cap'), '--test-cap', 1, 100000);
  const crawlDelayMs = parseWholeNumberInRange(flagMap.get('--delay') ?? env.QA_DELAY_MS, '--delay', 0, 2000);

  const docs = flagDocs.length
    ? flagDocs
    : (env.QA_DOCS ?? '')
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean);

  if (debugValue) {
    process.env.QA_DEBUG = debugValue;
  } else if (env.QA_DEBUG) {
    debugValue = env.QA_DEBUG;
    process.env.QA_DEBUG = env.QA_DEBUG;
  }

  const customHeaders: Record<string, string> = {};
  if (env.QA_CUSTOM_HEADERS) {
    try {
      const parsed = JSON.parse(env.QA_CUSTOM_HEADERS);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error();
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k !== 'string' || typeof v !== 'string') {
          throw new Error();
        }
        customHeaders[k.trim()] = v;
      }
    } catch {
      throw new Error('QA_CUSTOM_HEADERS is not valid');
    }
  }
  for (const line of headersList) {
    const { headers, errors } = parseHeaderText(line);
    if (errors.length > 0 || Object.keys(headers).length === 0) {
      throw new Error('--header must look like "Name: value"');
    }
    Object.assign(customHeaders, headers);
  }

  const signIns = parseRoles(env);
  const rawPreset = flagMap.get('--preset');
  if (rawPreset !== undefined && rawPreset !== 'smoke') {
    throw new Error(`--preset must be smoke, not "${rawPreset}"`);
  }

  return {
    ...(help ? { help: true } : {}),
    ...(rawPreset === 'smoke'
      ? {
          preset: 'smoke' as const,
          healthPath: flagMap.get('--health-path'),
          expectedVersion: flagMap.get('--expected-version'),
          confirmLive: confirmLive || undefined,
        }
      : {}),
    url: positionalUrl ?? env.QA_TARGET_URL,
    staging: staging || env.QA_STAGING === 'true',
    failOn: failOn as FailOn,
    outputDir: path.resolve(flagMap.get('--output') ?? env.QA_OUTPUT_DIR ?? 'qa-report'),
    maxPages,
    provider,
    apiKey: env.QA_AI_API_KEY?.trim() || undefined,
    signIn: signIns[0]
      ? { username: signIns[0].username, password: signIns[0].password, loginPath: signIns[0].loginPath }
      : undefined,
    signIns,
    docs,
    testCap,
    crawlConcurrency,
    crawlDelayMs,
    customHeaders: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    debug: debugValue,
  };
}

/** The body for POST /api/runner/run. Test sign-in details, when set, are the consent for a full test. */
export function buildRunBody(args: CheckupArgs, documents: CheckupDocument[] = []): RunStartBody {
  const hasKey = !!args.apiKey;
  const signIns: RoleSignIn[] = args.signIns ?? (args.signIn ? [{ role: 'member', ...args.signIn }] : []);
  return {
    targetUrl: args.url ?? '',
    productId: 'ci',
    // A test copy, or a test sign-in, is tested fully. Anything else is read-only: nothing is sent to it.
    owner: args.staging || signIns.length > 0,
    stagingHost: args.staging || undefined,
    useAI: hasKey,
    planWithoutAI: !hasKey,
    // With no key there is no AI to ask for: the fixed-rule plan needs no provider.
    aiProvider: hasKey ? args.provider : 'mock',
    apiKey: args.apiKey,
    maxPages: args.maxPages,
    skipReview: true,
    ...(args.crawlConcurrency ? { crawlConcurrency: args.crawlConcurrency } : {}),
    ...(args.crawlDelayMs !== undefined ? { crawlDelayMs: args.crawlDelayMs } : {}),
    ...(args.customHeaders ? { customHeaders: args.customHeaders } : {}),
    ...(args.testCap ? { testCap: args.testCap } : {}),
    ...(documents.length ? { contextDocuments: documents } : {}),
    ...(signIns.length
      ? {
          roles: signIns.map((r) => ({
            role: r.role,
            username: r.username,
            password: r.password,
            loginPath: r.loginPath,
            usernameSelector: r.usernameSelector,
            passwordSelector: r.passwordSelector,
            submitSelector: r.submitSelector,
          })),
          signInConsent: true,
        }
      : {}),
  };
}

/** Reads the spec documents. Throws a plain sentence when one cannot be used. */
export async function loadCheckupDocuments(paths: string[]): Promise<CheckupDocument[]> {
  if (paths.length > MAX_DOCS) throw new Error(`Use at most ${MAX_DOCS} documents.`);
  const docs: CheckupDocument[] = [];
  for (const p of paths) {
    const name = path.basename(p);
    const kind = isSupportedContextName(name);
    if (!kind.ok) throw new Error(`${name}: ${kind.message}`);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(p);
    } catch {
      throw new Error(`Could not read ${p}.`);
    }
    let text: string;
    if (name.toLowerCase().endsWith('.docx')) {
      if (bytes.length > MAX_DOCX_BYTES) throw new Error(`${name} is larger than 2 MB.`);
      text = (await docxToMarkdown(new Uint8Array(bytes))).text;
    } else {
      text = bytes.toString('utf8');
    }
    text = redactIngest(text);
    if (Buffer.byteLength(text, 'utf8') > MAX_DOC_BYTES) {
      throw new Error(`${name} is larger than 500 KB. Split it into smaller files.`);
    }
    docs.push({ name, text });
  }
  return docs;
}

/** True when the document gave nothing to plan from (no requirements, User Flows or tables). */
export function zeroYield(text: string): boolean {
  const s = summarizeDocument(text);
  return s.requirements === 0 && s.journeys === 0 && s.tables === 0;
}

/** Removes the sign-in details from any text before it is printed. */
export function scrub(text: string, signIn?: SignIn | SignIn[] | CheckupArgs): string {
  let out = text;
  const list: SignIn[] = !signIn
    ? []
    : Array.isArray(signIn)
      ? signIn
      : 'signIns' in signIn
        ? signIn.signIns
        : [signIn];
  const values = list.flatMap((s) => [s.password, s.username]).filter(Boolean);
  // Longest first so a value that contains another is hidden whole.
  for (const v of values.sort((a, b) => b.length - a.length)) out = out.split(v).join('[hidden]');
  return out;
}

/** Findings that count against the release: confirmed, and not marked intended or not a problem. */
function active(findings: Finding[]): Finding[] {
  return findings.filter(isActiveFinding);
}

/** The process exit code: 1 when something at or above the chosen level was found. */
export function exitCodeFor(findings: Finding[], failOn: FailOn, grades?: SiteAspectGrades): number {
  if (failOn === 'none') return 0;
  if (failOn === 'major') {
    return active(findings).some((f) => f.severity === 'Blocker' || f.severity === 'Major') ? 1 : 0;
  }
  if (failOn === 'blocker') {
    return active(findings).some((f) => f.severity === 'Blocker') ? 1 : 0;
  }
  // 'standard': the same rule as the stamp (PRD FR-8.2, FR-10.2), from the one function that defines it.
  return releaseVerdict(findings, DEFAULT_RELEASE_GATES.standard, grades).ready ? 0 : 1;
}

/** Markdown for the Actions job summary page. */
export function summaryMarkdown(report: ReleaseReport, args: Pick<CheckupArgs, 'url' | 'failOn'>): string {
  const verdict = releaseVerdict(report.findings, undefined, report.grades, report.coverage);
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

/** The Smoke Check-up: reads a few known paths (GET only), writes the report, prints the verdict. */
async function runSmokeCheckup(args: CheckupArgs): Promise<number> {
  const result = await runPostDeploySmoke({
    targetUrl: args.url ?? '',
    healthPath: args.healthPath,
    expectedVersion: args.expectedVersion,
    confirmLive: args.confirmLive || args.staging,
    beta: process.env.RUNNER_BETA === '1' || process.env.RUNNER_BETA === 'true',
  });
  if (result.refused) {
    console.error(`[checkup] ${result.refused}`);
    return 2;
  }
  const report = smokeReport(result, args.url ?? '');
  await fs.mkdir(args.outputDir, { recursive: true });
  await new ReportGenerator(args.outputDir).generate(report);
  const verdict = releaseVerdict(report.findings, undefined, report.grades, report.coverage);
  console.log(`\n[checkup] ${verdict.stamp}: ${verdict.reason}`);
  for (const line of result.notChecked) console.log(`[checkup] Did not check: ${line}`);
  console.log(`[checkup] Report written to ${args.outputDir}`);
  return exitCodeFor(report.findings, args.failOn, report.grades);
}

export interface SignalTarget {
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}

/**
 * Registers SIGINT and SIGTERM signal listeners calling shutdown with exit code 2,
 * returning a disposer function that removes them.
 */
export function installCheckupSignalHandlers(
  shutdown: (reason: string, exitCode: number) => Promise<void> | void,
  proc: SignalTarget = process
): () => void {
  const onSigint = () => void shutdown('SIGINT', 2);
  const onSigterm = () => void shutdown('SIGTERM', 2);
  proc.on('SIGINT', onSigint);
  proc.on('SIGTERM', onSigterm);
  return () => {
    proc.removeListener('SIGINT', onSigint);
    proc.removeListener('SIGTERM', onSigterm);
  };
}

export async function runCheckup(args: CheckupArgs): Promise<number> {
  if (args.help) {
    console.log(USAGE_TEXT);
    return 0;
  }
  if (!args.url) throw new Error('Give the address to check, for example: checkup.js https://preview.example.com');

  if (args.preset === 'smoke') return runSmokeCheckup(args);

  const documents = await loadCheckupDocuments(args.docs ?? []);
  if (documents.length > 0) {
    const empty = documents.filter((d) => zeroYield(d.text));
    for (const d of empty) {
      console.log(`[checkup] Warning: nothing was read from ${d.name}. Check it has headings, lists or tables.`);
    }
    if (empty.length === documents.length) {
      console.error('[checkup] None of the documents gave anything to plan from. Stopping.');
      return 2;
    }
  }

  await fs.mkdir(args.outputDir, { recursive: true });
  // Outside the report folder: what the runner keeps while it works must never be uploaded with the report.
  // That includes the sign-in sessions (cookies), so they live here too and are deleted when the run ends.
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-checkup-'));
  const session = createCheckupSession({
    outputDir: args.outputDir,
    dataDir: workDir,
    authDir: path.join(workDir, 'auth'),
  });
  const checkupRun = createCheckupRun(session);
  const shutdown = createShutdown({
    shutdown: async () => {
      await checkupRun.stop();
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
    exit: (c) => process.exit(c),
    log: console.error,
  });
  const disposeSignals = installCheckupSignalHandlers(shutdown);

  try {
    const hasKey = !!args.apiKey;
    if (hasKey && (args.provider === 'openrouter' || args.provider === 'gemini')) {
      console.log(
        '[checkup] Note: free-tier AI keys may be used by the provider for training. Page text from the checked site is sent to the AI.'
      );
    }
    if (!hasKey) {
      console.log(
        documents.length > 0
          ? '[checkup] No QA_AI_API_KEY set: Plan Items from your documents are written by fixed rules.'
          : '[checkup] No QA_AI_API_KEY set: the plan is written by fixed rules, with no AI.'
      );
    }

    const body = buildRunBody(args, documents);
    const signIns: RoleSignIn[] = args.signIns ?? (args.signIn ? [{ role: 'member', ...args.signIn }] : []);
    const authorization = await resolveAuthorization({
      targetUrl: args.url,
      owner: args.staging || signIns.length > 0,
      ownerExplicit: args.staging || signIns.length > 0,
      signInConsent: signIns.length > 0,
      roles: body.roles,
      testCopyMarked: args.staging,
      stagingHost: args.staging,
    });

    try {
      await checkupRun.start({ body, authorization });
    } catch (err: unknown) {
      const e = err as { message?: string; suggestion?: string } | undefined;
      throw new Error(
        scrub(
          `The check-up could not start: ${e?.message ?? String(err)}${e?.suggestion ? ` ${e.suggestion}` : ''}`,
          args
        )
      );
    }

    await checkupRun.waitFor(RUN_TIMEOUT_MS);

    if (session.run.isRunning) throw new Error('The check-up took longer than 40 minutes and was stopped.');
    const errInfo = session.report.error();
    if (errInfo.code === 'ERR_SIGN_IN_FAILED' && errInfo.message) {
      // The fixed reason text only, never built from the typed details.
      throw new Error(`Sign-in failed. ${scrub(errInfo.message, args)}`);
    }
    if (errInfo.message) throw new Error(scrub(errInfo.message, args));

    const report = session.report.last;
    if (!report) {
      throw new Error('No completed run yet');
    }
    const verdict = releaseVerdict(report.findings, undefined, report.grades, report.coverage);
    console.log(`\n[checkup] ${verdict.stamp}: ${verdict.reason}`);
    console.log(`[checkup] Report written to ${args.outputDir}`);

    // Inline annotations on GitHub Actions: one per active Blocker (error) or Major (warning). ADR 0017.
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const line of githubAnnotations(report.findings)) console.log(line);
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(report, args) + '\n').catch(() => {});
    }
    const code = exitCodeFor(report.findings, args.failOn, report.grades);
    if (code !== 0)
      console.log(
        `[checkup] Failing the build: findings at or above "${args.failOn}" were found (--fail-on ${args.failOn}).`
      );
    return code;
  } finally {
    disposeSignals();
    await checkupRun.stop();
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
