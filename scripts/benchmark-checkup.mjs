#!/usr/bin/env node
/**
 * Check-up benchmark (T-411). Runs the command-line Check-up (`packages/runner/dist/checkup.js`) on each
 * benchmark site several times and reports the median run time, Test points, Flaky Passed, AI calls and
 * tokens, and peak RSS.
 *
 *   pnpm bench:checkup [--sites techgramam,arocord,mghealthtech] [--runs 3] [--pages N]
 *                      [--compare .benchmark/<file>.json] [--no-docs]
 *
 * The AI settings come from the environment (QA_AI_API_KEY and QA_AI_PROVIDER, see .env.example);
 * `pnpm bench:checkup` loads .env the way `pnpm start` does. Peak RSS is the Check-up process's
 * `resourceUsage().maxRSS`, written by a one-line preload: Chromium's own processes are not included.
 *
 * Output: .benchmark/<date>-<commit>-checkup.json and a table appended to docs/TESTING.md (skip with
 * --no-docs). Accuracy: Jaccard overlap of the `(rule, urlPath)` finding sets, the rule being
 * `checker:title`.
 */
import { spawn, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { median, jaccard, appendToTesting } from './benchmark-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchDir = path.join(root, '.benchmark');

export const CHECKUP_SITES = {
  techgramam: { url: 'https://techgramam.com/', pages: 50 },
  arocord: { url: 'https://arocord.com/', pages: 50 },
  mghealthtech: { url: 'https://mghealthtech.com/', pages: 50 },
};

/** Prints the process's peak RSS (KB) when it exits; `checkup.js` ends with process.exit, which still fires it. */
const RSS_PRELOAD =
  "data:text/javascript,process.on('exit',()=>process.stderr.write('BENCH_RSS_KB '+process.resourceUsage().maxRSS+'\\n'))";

function parseArgs(argv) {
  const out = { sites: Object.keys(CHECKUP_SITES), runs: 3, pages: undefined, compare: undefined, docs: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sites') out.sites = argv[++i].split(',').filter(Boolean);
    else if (a === '--runs') out.runs = Math.max(1, parseInt(argv[++i], 10));
    else if (a === '--pages') out.pages = parseInt(argv[++i], 10);
    else if (a === '--compare') out.compare = argv[++i];
    else if (a === '--no-docs') out.docs = false;
  }
  return out;
}

function runOnce(url, pages, scratch) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      ['--import', RSS_PRELOAD, path.join(root, 'packages/runner/dist/checkup.js'), url, '--fail-on', 'none'],
      {
        cwd: root,
        env: { ...process.env, QA_OUTPUT_DIR: path.join(scratch, 'report'), QA_MAX_PAGES: String(pages) },
        stdio: ['ignore', 'inherit', 'pipe'],
      }
    );
    let rssKb = null;
    child.stderr.on('data', (d) => {
      const text = String(d);
      const m = text.match(/BENCH_RSS_KB (\d+)/);
      if (m) rssKb = Number(m[1]);
      process.stderr.write(text.replace(/BENCH_RSS_KB \d+\n?/, ''));
    });
    child.on('close', async (code) => {
      const wallMs = Date.now() - started;
      let report = null;
      try {
        report = JSON.parse(await fs.readFile(path.join(scratch, 'report', 'findings.json'), 'utf8'));
      } catch {
        // No report: the run failed before writing one.
      }
      const usage = Object.values(report?.aiUsage ?? {});
      resolve({
        outcome: report ? 'done' : `exit-${code}`,
        wallMs,
        runMs: report?.durationMs ?? null,
        testPoints: report?.coverage?.totalTestPoints ?? null,
        flakyPassed: report?.coverage?.flakyFlows ?? 0,
        aiCalls: report ? usage.reduce((n, u) => n + (u.requests ?? 0), 0) : null,
        aiTokens: report ? usage.reduce((n, u) => n + (u.promptTokens ?? 0) + (u.completionTokens ?? 0), 0) : null,
        peakRssMb: rssKb === null ? null : Math.round(rssKb / 1024),
        findings: (report?.findings ?? []).map((f) => `${f.checker}:${f.title} ${f.where?.urlPath ?? ''}`),
      });
    });
  });
}

function summarise(runs) {
  const m = (pick) => median(runs.map(pick));
  const withFindings = runs.filter((r) => r.outcome === 'done');
  const overlaps = withFindings.slice(1).map((r) => jaccard(withFindings[0].findings, r.findings));
  return {
    runs: runs.length,
    outcomes: runs.map((r) => r.outcome),
    wallMs: m((r) => r.wallMs),
    runMs: m((r) => r.runMs),
    testPoints: m((r) => r.testPoints),
    flakyPassed: m((r) => r.flakyPassed),
    aiCalls: m((r) => r.aiCalls),
    aiTokens: m((r) => r.aiTokens),
    peakRssMb: m((r) => r.peakRssMb),
    runToRunJaccard: overlaps.length ? Math.min(...overlaps) : null,
    findings: withFindings[0]?.findings ?? [],
  };
}

const fmt = (v) => (v === null || v === undefined ? 'n/a' : String(v));
const fmtS = (ms) => (ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);

function markdownTable(report) {
  const rows = Object.entries(report.sites).map(
    ([name, s]) =>
      `| ${name} | ${fmtS(s.runMs)} | ${fmt(s.testPoints)} | ${fmt(s.flakyPassed)} | ${fmt(s.aiCalls)} / ${fmt(s.aiTokens)} | ${fmt(s.peakRssMb)} MB | ${s.compareJaccard === undefined ? fmt(s.runToRunJaccard?.toFixed?.(2)) : s.compareJaccard.toFixed(2)} |`
  );
  return [
    `**${report.date}, commit \`${report.commit}\`** (${report.kind}, median of ${report.runs} runs)`,
    '',
    '| Site | Run time | Test points | Flaky Passed | AI calls / tokens | Peak RSS | Jaccard |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
  const date = new Date().toISOString().slice(0, 10);
  const compare = args.compare ? JSON.parse(await fs.readFile(path.resolve(args.compare), 'utf8')) : undefined;
  const report = { kind: 'checkup', date, commit, runs: args.runs, startedAt: new Date().toISOString(), sites: {} };
  for (const name of args.sites) {
    const site = CHECKUP_SITES[name];
    if (!site) throw new Error(`Unknown site "${name}". Known: ${Object.keys(CHECKUP_SITES).join(', ')}`);
    const runs = [];
    for (let i = 1; i <= args.runs; i++) {
      const scratch = path.join(benchDir, 'tmp', `${date}-${commit}-checkup-${name}-${i}`);
      await fs.rm(scratch, { recursive: true, force: true });
      console.log(`[bench] ${name} run ${i}/${args.runs}: ${site.url}`);
      runs.push(await runOnce(site.url, args.pages ?? site.pages, scratch));
    }
    const summary = summarise(runs);
    const before = compare?.sites?.[name]?.findings;
    if (before) summary.compareJaccard = jaccard(before, summary.findings);
    report.sites[name] = summary;
  }
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(benchDir, { recursive: true });
  const out = path.join(benchDir, `${date}-${commit}-checkup.json`);
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  const md = markdownTable(report);
  console.log(`\n${md}\n[bench] Wrote ${path.relative(root, out)}`);
  if (args.docs) await appendToTesting(md);
}

main().catch((err) => {
  console.error(`[bench] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
