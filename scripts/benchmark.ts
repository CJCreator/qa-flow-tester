/**
 * Scores the QA Tool against sites whose problems are known (fixtures/benchmarks/*.json): how
 * many reported issues are real, how many planted defects it finds, and how many pages it reaches.
 * Each site runs through a real runner, exactly as the wizard runs it.
 *
 *   pnpm benchmark                     every site, with AI discovery (needs the saved OpenRouter key)
 *   pnpm benchmark --sites fixture     some sites only (file names without .json)
 *   pnpm benchmark --no-ai             no AI: journeys are skipped, the page sweep still runs
 *   pnpm benchmark --score-only        re-score the last run's reports, e.g. after labelling an answer key
 *
 * Build first (pnpm build): this uses the compiled runner. Results go to .benchmark/.
 */
import { promises as fs } from 'fs';
import path from 'path';
import type http from 'http';
import { fileURLToPath } from 'url';
import { RunnerServer } from '../packages/runner/dist/index.js';
import type { AIMessage, AIProviderType, Finding, ReleaseReport, RoleCredential } from '../packages/types/dist/index.js';

interface Matcher {
  checker?: string;
  titleIncludes?: string;
  actualIncludes?: string;
  urlIncludes?: string;
  breakpoint?: string;
}

interface AnswerKey {
  name: string;
  url: string;
  mode: 'product' | 'safe-public';
  roles?: RoleCredential[];
  issues: Array<{ id: string; what: string; planted?: boolean; expectedBy?: string; match: Matcher[] }>;
  notProblems?: Array<{ why: string; match: Matcher[] }>;
}

interface SiteScore {
  site: string;
  name: string;
  error?: string;
  pagesReached: number;
  reported: number;
  real: number;
  knownFalse: number;
  unlabelled: string[];
  toConfirm: number;
  plantedFound: string[];
  plantedMissed: string[];
  waitingForLaterPhase: string[];
  minutes: number;
}

/** Phase 0 is the current one: planted defects for later phases are listed, not scored. */
const PHASES = ['phase-0', 'phase-1', 'phase-2'];
const CURRENT_PHASE = 'phase-0';
const FIXTURE_PORT = 3598;
const RUNNER_PORT = 3599;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** An AI with nothing to plan, for --no-ai: the page sweep and the checks still run. */
class NoPlanAI {
  readonly providerType: AIProviderType = 'mock';
  async generateText(_messages: AIMessage[]): Promise<string> {
    return JSON.stringify({ flows: [] });
  }
}

function matches(f: Finding, m: Matcher): boolean {
  return (
    (!m.checker || f.checker === m.checker) &&
    (!m.titleIncludes || f.title.includes(m.titleIncludes)) &&
    (!m.actualIncludes || f.expectedVsActual.actual.includes(m.actualIncludes)) &&
    (!m.urlIncludes || f.where.urlPath.includes(m.urlIncludes)) &&
    (!m.breakpoint || f.where.breakpoint === m.breakpoint)
  );
}

function score(site: string, key: AnswerKey, report: ReleaseReport, minutes: number): SiteScore {
  const active = report.findings.filter((f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive');
  const reported = active.filter((f) => !f.needsConfirmation);
  const isReal = (f: Finding) => key.issues.some((i) => i.match.some((m) => matches(f, m)));
  const isKnownFalse = (f: Finding) => (key.notProblems || []).some((n) => n.match.some((m) => matches(f, m)));

  const due = (expectedBy = 'phase-0') => PHASES.indexOf(expectedBy) <= PHASES.indexOf(CURRENT_PHASE);
  const planted = key.issues.filter((i) => i.planted);
  const found = (i: AnswerKey['issues'][number]) => reported.some((f) => i.match.some((m) => matches(f, m)));

  const pages = new Set<string>();
  for (const page of report.pages || []) pages.add(page.urlPath);
  for (const result of report.results) {
    for (const step of result.stepEvidence) {
      try {
        pages.add(new URL(step.urlAfter).pathname);
      } catch {
        // not a full URL
      }
    }
  }

  return {
    site,
    name: key.name,
    pagesReached: pages.size,
    reported: reported.length,
    real: reported.filter(isReal).length,
    knownFalse: reported.filter((f) => !isReal(f) && isKnownFalse(f)).length,
    unlabelled: reported.filter((f) => !isReal(f) && !isKnownFalse(f)).map((f) => `${f.severity} ${f.title} (${f.where.urlPath})`),
    toConfirm: active.length - reported.length,
    plantedFound: planted.filter((i) => due(i.expectedBy) && found(i)).map((i) => i.id),
    plantedMissed: planted.filter((i) => due(i.expectedBy) && !found(i)).map((i) => i.id),
    waitingForLaterPhase: planted.filter((i) => !due(i.expectedBy)).map((i) => `${i.id} (${i.expectedBy})`),
    minutes,
  };
}

async function runSite(site: string, key: AnswerKey, noAi: boolean): Promise<SiteScore> {
  const started = Date.now();
  let fixture: http.Server | undefined;
  let targetUrl = key.url;
  if (key.url === 'fixture') {
    process.env.NODE_ENV = 'test'; // import the fixture without it listening on its usual port
    fixture = (await import('../fixtures/test-app/server.js')).server as http.Server;
    await new Promise<void>((resolve) => fixture!.listen(FIXTURE_PORT, resolve));
    targetUrl = `http://localhost:${FIXTURE_PORT}`;
  }

  const runner = new RunnerServer({
    port: RUNNER_PORT,
    outputDir: path.join(root, '.benchmark', site),
    dataDir: root, // where the wizard's runner keeps the OpenRouter key and chosen models
    ...(noAi ? { createAIProvider: () => new NoPlanAI() } : {}),
  });
  await runner.start();

  try {
    const body =
      key.mode === 'safe-public'
        ? { targetUrl, productId: site, mode: 'safe-public' }
        : { targetUrl, productId: site, useAI: true, aiProvider: noAi ? 'mock' : 'openrouter', roles: key.roles || [] };
    const res = await fetch(`http://localhost:${RUNNER_PORT}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`the runner refused the run (HTTP ${res.status})`);

    const deadline = Date.now() + 30 * 60 * 1000;
    let status: { isRunning: boolean; lastRunError: string | null } = { isRunning: true, lastRunError: null };
    while (status.isRunning && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      status = await (await fetch(`http://localhost:${RUNNER_PORT}/api/runner/status`)).json();
    }
    if (status.isRunning) throw new Error('the run took longer than 30 minutes');
    if (status.lastRunError) throw new Error(status.lastRunError);

    const report = (await (await fetch(`http://localhost:${RUNNER_PORT}/api/report`)).json()) as ReleaseReport;
    return score(site, key, report, (Date.now() - started) / 60000);
  } catch (err) {
    return {
      ...score(site, key, { findings: [], results: [] } as unknown as ReleaseReport, (Date.now() - started) / 60000),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await runner.stop();
    if (fixture) await new Promise<void>((resolve) => fixture!.close(() => resolve()));
  }
}

/** Scores the report a previous run left in .benchmark/<site>/, without visiting the site again. */
async function scoreSavedRun(site: string, key: AnswerKey, previous?: SiteScore): Promise<SiteScore> {
  try {
    const report = JSON.parse(await fs.readFile(path.join(root, '.benchmark', site, 'findings.json'), 'utf8')) as ReleaseReport;
    return score(site, key, report, previous?.minutes ?? 0);
  } catch {
    return { ...score(site, key, { findings: [], results: [] } as unknown as ReleaseReport, 0), error: 'no saved report for this site' };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const noAi = args.includes('--no-ai');
  const scoreOnly = args.includes('--score-only');
  const previousRun = scoreOnly
    ? (JSON.parse(await fs.readFile(path.join(root, '.benchmark', 'results.json'), 'utf8').catch(() => '{}')) as { noAi?: boolean; scores?: SiteScore[] })
    : {};
  const sitesArg = args[args.indexOf('--sites') + 1];
  const keyDir = path.join(root, 'fixtures', 'benchmarks');
  const allSites = (await fs.readdir(keyDir)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const sites = args.includes('--sites') && sitesArg ? sitesArg.split(',') : allSites;

  const scores: SiteScore[] = [];
  for (const site of sites) {
    const key = JSON.parse(await fs.readFile(path.join(keyDir, `${site}.json`), 'utf8')) as AnswerKey;
    console.log(`\n▶ ${key.name} (${key.url === 'fixture' ? 'local fixture' : key.url})…`);
    const previous = previousRun.scores?.find((p) => p.site === site);
    const s = !scoreOnly
      ? await runSite(site, key, noAi)
      : previous?.error
        ? { ...previous, name: key.name } // a site that didn't finish last time has nothing to re-score
        : await scoreSavedRun(site, key, previous);
    scores.push(s);
    if (s.error) console.log(`  ✗ Couldn’t finish: ${s.error}`);
    console.log(
      `  ${s.pagesReached} pages · ${s.reported} issues reported · ${s.real} real · ${s.knownFalse} known false · ${s.unlabelled.length} unlabelled · ${s.toConfirm} to confirm${s.minutes ? ` · ${s.minutes.toFixed(1)} min` : ''}`
    );
    if (s.plantedFound.length + s.plantedMissed.length > 0) {
      console.log(`  Planted defects found: ${s.plantedFound.length} of ${s.plantedFound.length + s.plantedMissed.length}${s.plantedMissed.length ? ` (missed: ${s.plantedMissed.join(', ')})` : ''}`);
    }
    if (s.waitingForLaterPhase.length) console.log(`  Not checked until a later phase: ${s.waitingForLaterPhase.join(', ')}`);
    for (const u of s.unlabelled) console.log(`    ? ${u}`);
  }

  const reported = scores.reduce((n, s) => n + s.reported, 0);
  const real = scores.reduce((n, s) => n + s.real, 0);
  const planted = scores.reduce((n, s) => n + s.plantedFound.length + s.plantedMissed.length, 0);
  const plantedFound = scores.reduce((n, s) => n + s.plantedFound.length, 0);
  console.log(
    `\nOverall: ${real} of ${reported} reported issues real (${reported ? Math.round((real / reported) * 100) : 0}%) · planted defects found ${plantedFound} of ${planted}`
  );
  console.log('Unlabelled issues count as not real until someone checks them and adds them to the answer key.');

  await fs.mkdir(path.join(root, '.benchmark'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.benchmark', 'results.json'),
    JSON.stringify({ when: new Date().toISOString(), noAi: scoreOnly ? !!previousRun.noAi : noAi, scores }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
