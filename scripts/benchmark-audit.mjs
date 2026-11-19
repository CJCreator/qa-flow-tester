#!/usr/bin/env node
/**
 * Website Audit benchmark (T-411). Runs each benchmark site several times on a local runner and reports
 * the median, so speed tickets can say what they changed.
 *
 *   pnpm bench:audit [--sites techgramam,arocord,mghealthtech,large] [--runs 3] [--pages N]
 *                    [--compare .benchmark/<file>.json] [--no-docs]
 *
 * Each run is its own Node process with a runner started in-process on a spare port, a fresh data folder
 * under .benchmark/tmp/ and the AI settings from the environment (`pnpm bench:audit` loads .env the way
 * `pnpm start` does; this script never reads key files itself). Peak RSS is the runner process's
 * `resourceUsage().maxRSS`: Chromium's own processes are not included.
 *
 * Output: .benchmark/<date>-<commit>.json (git-ignored), and a Markdown table appended to the "Benchmarks"
 * section of docs/TESTING.md (skip with --no-docs). Accuracy is the Jaccard overlap of the
 * `(rule, urlPath)` finding sets: between runs of one site, and against --compare when given.
 *
 * Only for sites whose robots.txt allows the crawl. Never point it at a site you have not chosen on purpose.
 */
import { spawn, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchDir = path.join(root, '.benchmark');

/** The benchmark sites (ENHANCEMENT-PLAN-2026-11). `large` is local only and still to be confirmed by the owner. */
export const AUDIT_SITES = {
  techgramam: { url: 'https://techgramam.com/', pages: 50 },
  arocord: { url: 'https://arocord.com/', pages: 50 },
  mghealthtech: { url: 'https://mghealthtech.com/', pages: 50 },
  large: { url: 'https://kubernetes.io/', pages: 1000 },
};

function parseArgs(argv) {
  const out = { sites: Object.keys(AUDIT_SITES), runs: 3, pages: undefined, compare: undefined, docs: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--sites') out.sites = next().split(',').filter(Boolean);
    else if (a === '--runs') out.runs = Math.max(1, parseInt(next(), 10));
    else if (a === '--pages') out.pages = parseInt(next(), 10);
    else if (a === '--compare') out.compare = next();
    else if (a === '--no-docs') out.docs = false;
    else if (a === '--child') out.child = true;
    else if (a === '--url') out.url = next();
    else if (a === '--scratch') out.scratch = next();
  }
  return out;
}

export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** |A ∩ B| / |A ∪ B|; two empty sets overlap fully. */
export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function findFiles(dir, name) {
  const found = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...(await findFiles(p, name)));
    else if (e.name === name || e.name === `${name}.json`) found.push(p);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// One run (child process)
// ---------------------------------------------------------------------------------------------------

async function runOnce({ url, pages, scratch }) {
  const { RunnerServer } = await import(pathToFileURL(path.join(root, 'packages/runner/dist/server.js')).href);
  const port = await freePort();
  const server = new RunnerServer({
    port,
    host: 'localhost',
    outputDir: path.join(scratch, 'report'),
    dataDir: path.join(scratch, 'data'),
  });
  const base = await server.start();
  const started = Date.now();
  const stageMs = {};
  let stage = 'starting';
  let stageAt = started;
  const switchStage = (next) => {
    if (!next || next === stage) return;
    stageMs[stage] = (stageMs[stage] ?? 0) + (Date.now() - stageAt);
    stage = next;
    stageAt = Date.now();
  };
  let terminal = null;
  try {
    const startRes = await fetch(`${base}/api/audits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, maxPages: pages, maxDepth: 5, language: 'en' }),
    });
    if (!startRes.ok) throw new Error(`start answered ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
    const { auditId, version = 1 } = await startRes.json();

    const stream = await fetch(`${base}/api/audits/${auditId}/stream`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!terminal) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let event;
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if ((event.type === 'progress' || event.type === 'snapshot') && event.stage) switchStage(event.stage);
          if (event.type === 'done' || event.type === 'failed') {
            terminal = event.type;
            switchStage(event.type);
          }
        }
      }
    }
    await reader.cancel().catch(() => {});
    const wallMs = Date.now() - started;

    const got = await fetch(`${base}/api/audits/${auditId}?version=${version}`);
    const record = got.ok ? await got.json() : {};
    const result = record.result ?? {};
    const coverage = result.coverage ?? {};
    const skippedByReason = {};
    for (const s of coverage.skipped ?? [])
      skippedByReason[s.why ?? 'other'] = (skippedByReason[s.why ?? 'other'] ?? 0) + 1;
    const http429 = (coverage.routes ?? []).filter((r) => r.status === 429).length;

    // Pipeline steps with their start and end times (T-411), read from the run's own data folder.
    const stepMs = {};
    for (const file of await findFiles(path.join(scratch, 'data'), 'stages')) {
      try {
        const steps = JSON.parse(await fs.readFile(file, 'utf8'));
        for (const s of steps) {
          if (s.startedAt && s.endedAt) stepMs[s.step] = Date.parse(s.endedAt) - Date.parse(s.startedAt);
        }
      } catch {
        // A run that stopped early may have no step list.
      }
    }

    // AI calls and tokens: reported when the result carries them (the AI Request Budget, T-398).
    const ai = result.aiUsage ?? record.version?.aiUsage ?? null;
    const findings = (result.findings ?? []).map((f) => `${f.rule} ${f.urlPath}`);

    return {
      outcome: terminal ?? 'ended-early',
      wallMs,
      stageMs,
      stepMs,
      pagesRecorded: (result.pages ?? []).length,
      pagesSkipped: (coverage.skipped ?? []).length,
      skippedByReason,
      http429,
      aiCalls: ai?.requests ?? null,
      aiTokens: ai ? (ai.promptTokens ?? 0) + (ai.completionTokens ?? 0) : null,
      peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
      findings,
    };
  } finally {
    await server.stop().catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------------
// Parent: runs, medians, files
// ---------------------------------------------------------------------------------------------------

function spawnRun(url, pages, scratch) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), '--child', '--url', url, '--pages', String(pages), '--scratch', scratch],
      { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] }
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => {
      const line = out.split('\n').find((l) => l.startsWith('BENCH_RESULT '));
      resolve(line ? JSON.parse(line.slice('BENCH_RESULT '.length)) : { outcome: 'crashed' });
    });
  });
}

function summarise(runs) {
  const keys = (pick) => [...new Set(runs.flatMap((r) => Object.keys(pick(r) ?? {})))];
  const medianOf = (pick) => median(runs.map(pick));
  const stageMs = Object.fromEntries(keys((r) => r.stageMs).map((k) => [k, medianOf((r) => r.stageMs?.[k])]));
  const stepMs = Object.fromEntries(keys((r) => r.stepMs).map((k) => [k, medianOf((r) => r.stepMs?.[k])]));
  const skippedByReason = Object.fromEntries(
    keys((r) => r.skippedByReason).map((k) => [k, medianOf((r) => r.skippedByReason?.[k] ?? 0)])
  );
  const withFindings = runs.filter((r) => Array.isArray(r.findings));
  const overlaps = withFindings.slice(1).map((r) => jaccard(withFindings[0].findings, r.findings));
  return {
    runs: runs.length,
    outcomes: runs.map((r) => r.outcome),
    wallMs: medianOf((r) => r.wallMs),
    stageMs,
    stepMs,
    pagesRecorded: medianOf((r) => r.pagesRecorded),
    pagesSkipped: medianOf((r) => r.pagesSkipped),
    skippedByReason,
    http429: medianOf((r) => r.http429),
    aiCalls: medianOf((r) => r.aiCalls),
    aiTokens: medianOf((r) => r.aiTokens),
    peakRssMb: medianOf((r) => r.peakRssMb),
    runToRunJaccard: overlaps.length ? Math.min(...overlaps) : null,
    findings: withFindings[0]?.findings ?? [],
  };
}

const fmtS = (ms) => (ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const fmt = (v) => (v === null || v === undefined ? 'n/a' : String(v));

export function markdownTable(report) {
  const rows = Object.entries(report.sites).map(([name, s]) => {
    const skipped = Object.entries(s.skippedByReason)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const crawl = s.stageMs.crawling ?? s.stageMs.crawl ?? null;
    return `| ${name} | ${fmtS(s.wallMs)} | ${fmtS(crawl)} | ${fmt(s.pagesRecorded)} | ${fmt(s.pagesSkipped)}${skipped ? ` (${skipped})` : ''} | ${fmt(s.aiCalls)} / ${fmt(s.aiTokens)} | ${fmt(s.http429)} | ${fmt(s.peakRssMb)} MB | ${s.compareJaccard === undefined ? fmt(s.runToRunJaccard?.toFixed?.(2)) : s.compareJaccard.toFixed(2)} |`;
  });
  return [
    `**${report.date}, commit \`${report.commit}\`** (${report.kind}, median of ${report.runs} runs)`,
    '',
    '| Site | Wall time | Crawl | Recorded | Skipped (by reason) | AI calls / tokens | 429s | Peak RSS | Jaccard |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

export async function appendToTesting(markdown) {
  const file = path.join(root, 'docs/TESTING.md');
  const text = await fs.readFile(file, 'utf8');
  const marker = '<!-- benchmark-results: new tables are appended above this line -->';
  if (!text.includes(marker)) throw new Error('docs/TESTING.md has no benchmark marker');
  await fs.writeFile(file, text.replace(marker, `${markdown}\n${marker}`));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.child) {
    const result = await runOnce({ url: args.url, pages: args.pages, scratch: args.scratch });
    process.stdout.write(`BENCH_RESULT ${JSON.stringify(result)}\n`);
    process.exit(0);
  }
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
  const date = new Date().toISOString().slice(0, 10);
  const compare = args.compare ? JSON.parse(await fs.readFile(path.resolve(args.compare), 'utf8')) : undefined;
  const report = { kind: 'audit', date, commit, runs: args.runs, startedAt: new Date().toISOString(), sites: {} };
  for (const name of args.sites) {
    const site = AUDIT_SITES[name];
    if (!site) throw new Error(`Unknown site "${name}". Known: ${Object.keys(AUDIT_SITES).join(', ')}`);
    const runs = [];
    for (let i = 1; i <= args.runs; i++) {
      const scratch = path.join(benchDir, 'tmp', `${date}-${commit}-${name}-${i}`);
      await fs.rm(scratch, { recursive: true, force: true });
      console.log(`[bench] ${name} run ${i}/${args.runs}: ${site.url}`);
      runs.push(await spawnRun(site.url, args.pages ?? site.pages, scratch));
    }
    const summary = summarise(runs);
    const before = compare?.sites?.[name]?.findings;
    if (before) summary.compareJaccard = jaccard(before, summary.findings);
    report.sites[name] = summary;
  }
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(benchDir, { recursive: true });
  const out = path.join(benchDir, `${date}-${commit}-audit.json`);
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  const md = markdownTable(report);
  console.log(`\n${md}\n[bench] Wrote ${path.relative(root, out)}`);
  if (args.docs) await appendToTesting(md);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[bench] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
