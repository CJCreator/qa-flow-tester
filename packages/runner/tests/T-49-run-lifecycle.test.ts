import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (file: string) => readFileSync(path.join(here, '..', 'src', file), 'utf8').replace(/\r\n/g, '\n');
// The run code is split across checkup-run*.ts: read them as one text.
const runFiles = () =>
  ['checkup-run.ts', 'checkup-run-execute.ts', 'checkup-run-testing.ts', 'checkup-run-helpers.ts']
    .map((f) => src(path.join('session', f)))
    .join('\n');

describe('shutdown on SIGTERM and SIGINT', () => {
  const cli = src('cli.ts');
  const server = src('server.ts');

  it('cli.ts handles SIGTERM and SIGINT through one shutdown that exits within 10 s', () => {
    expect(cli).toContain("process.on('SIGTERM', shutdown)");
    expect(cli).toContain("process.on('SIGINT', shutdown)");
    expect(cli).toMatch(/setTimeout\(\(\) => process\.exit\(1\), 10000\)/);
    expect(cli).toContain('server.shutdown()');
  });

  it('shutdown stops the run, waits for it, removes the sign-in folders and closes the server', () => {
    const start = server.indexOf('public async shutdown(');
    const end = server.indexOf('public async stop(): Promise<void>', start);
    expect(start).toBeGreaterThan(-1);
    const body = server.slice(start, end);
    expect(body.indexOf('this.checkupRun.stop(')).toBeLessThan(body.indexOf('this.checkupRun.waitFor('));
    expect(body.indexOf('this.checkupRun.waitFor(')).toBeLessThan(body.indexOf('sweepLeftovers()'));
    expect(body).toContain('await this.stop();');
  });
});

describe('unhandled rejections do not crash the runner', () => {
  it('cli.ts logs an unhandledRejection and keeps serving', () => {
    const cli = src('cli.ts');
    const handler = cli.slice(cli.indexOf("process.on('unhandledRejection'"));
    expect(handler).toContain('console.error');
    expect(handler).not.toContain('process.exit');
  });

  it('server.ts answers a failed request with 500 only while its headers are unsent', () => {
    const server = src('server.ts');
    const idx = server.indexOf("const msg = this.redactedMessage(err);\n          res.writeHead(500");
    expect(idx).toBeGreaterThan(-1);
    const before = server.slice(Math.max(0, idx - 300), idx);
    expect(before).toContain('if (res.headersSent)');
  });
});

describe('a stop frees the slot only after the old run has ended', () => {
  const runSrc = runFiles();

  it('start() refuses while the previous executeRun has not returned', () => {
    expect(runSrc).toMatch(/if \(starting \|\| !runEnded \|\|/);
    expect(runSrc).toContain('.finally(() => {\n        runEnded = true;\n      })');
  });
});

describe('the run auth folder is removed on every testing exit', () => {
  const testingSrc = src('session/checkup-run-testing.ts');
  const executeSrc = src('session/checkup-run-execute.ts');
  const runSrc = testingSrc;

  it('executeTesting wraps runTesting in try/finally that cleans unless kept for review', () => {
    const start = testingSrc.indexOf('const executeTesting = async (');
    expect(start).toBeGreaterThan(-1);
    const body = testingSrc.slice(start);
    expect(body).toContain('await runTesting(');
    expect(body).toContain('} finally {');
    expect(body).toContain('await session.secrets.clean(runId);');
    // The kept-for-review exception lives in the finally of executeRun, which calls executeTesting.
    const runStart = executeSrc.indexOf('const executeRun = async (');
    const runBody = executeSrc.slice(runStart);
    expect(runBody).toContain('keptForReview');
    expect(runBody).toContain('await session.secrets.clean(runId);');
  });

  it('the scrub runs before the saved sign-ins are dropped on a successful run', () => {
    const scrubAt = runSrc.indexOf('await scrubRunFiles();');
    const dropAt = runSrc.indexOf('session.secrets.savedSessions.delete(context.runId);');
    expect(scrubAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(scrubAt);
  });
});

describe('approval is serialised with a replacePlan start', () => {
  it('approve claims the testing phase before the plan save is awaited', () => {
    const plan = src('routes/plan.ts');
    const claim = plan.indexOf("session.run.setPhase('testing');\n  try {\n    await session.plan.save(record);");
    expect(claim).toBeGreaterThan(-1);
  });
});
