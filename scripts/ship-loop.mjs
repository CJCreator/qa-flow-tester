// Builds approved backlog items one at a time, each in a FRESH headless Claude Code session (small context = fewer tokens).
// Plan first (interactive):  /ship plan <request>   then approve:  /ship approve <slug>   (or edit .claude/work/backlog.md)
// Then:  node scripts/ship-loop.mjs [--max-iterations 5] [--budget 3] [--total-budget 15] [--dry-run]
//   --budget        USD cap per item (claude --max-budget-usd)
//   --total-budget  USD cap across the whole run; the loop stops before exceeding it
//   --max-iterations  most items to try
//   --verify-budget USD cap for the verification phase (default 8)
//   --verify-at-end   when nothing is left to build, run the one verification phase (.claude/commands/verify-all.md). Without it, run /verify-all yourself.
// While .claude/work/DEFER_TESTS exists, items are built but NOT tested (hook-enforced); only the verification phase runs tests.
// Never commits or pushes. Review with: git diff, /pr-ready.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const num = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const maxIterations = num('--max-iterations', 5);
const perItem = num('--budget', 3);
const totalBudget = num('--total-budget', 15);
const dryRun = argv.includes('--dry-run');
const verifyAtEnd = argv.includes('--verify-at-end');
const verifyBudget = num('--verify-budget', 8);
const isWin = process.platform === 'win32';

const commandFile = path.join(root, '.claude', 'commands', 'build-next.md');
const verifyFile = path.join(root, '.claude', 'commands', 'verify-all.md');
const backlog = path.join(root, '.claude', 'work', 'backlog.md');
if (!existsSync(commandFile)) {
  console.error('Missing .claude/commands/build-next.md');
  process.exit(1);
}
// The procedure goes in on stdin: robust on Windows, and it does not depend on slash commands working in -p mode.
const procedure = readFileSync(commandFile, 'utf8')
  .replace(/^---[\s\S]*?---\s*/, '')
  .replace('$ARGUMENTS', '');

const quote = (s) => (isWin && /\s/.test(s) ? `"${s}"` : s);
const mkArgs = (budget) => [
  '-p',
  'Follow-the-build-procedure-on-stdin-exactly',
  '--permission-mode',
  'acceptEdits',
  '--permission-prompts',
  'none',
  '--max-budget-usd',
  String(budget),
  '--no-session-persistence',
  '--append-subagent-system-prompt-file',
  '.claude/terse-rules.txt',
];

function pending() {
  if (!existsSync(backlog)) return 0;
  return readFileSync(backlog, 'utf8')
    .split('\n')
    .filter((l) => /\|\s*approved\s*\|/.test(l)).length;
}

function runOnce(text = procedure, budget = perItem) {
  return new Promise((resolve) => {
    const child = spawn('claude', mkArgs(budget).map(quote), {
      cwd: root,
      shell: isWin,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(text);
  });
}

let spent = 0;
console.log(`approved items waiting: ${pending()}`);
for (let i = 1; i <= maxIterations; i++) {
  if (pending() === 0) {
    console.log('Nothing approved in .claude/work/backlog.md. Done.');
    break;
  }
  // Worst case an item costs the per-item cap, so refuse to start one that could pass the total.
  if (spent + perItem > totalBudget) {
    console.log(`Stopping: another item could exceed the total budget ($${totalBudget}).`);
    break;
  }
  console.log(`\n=== item ${i}/${maxIterations} (cap $${perItem}, committed so far up to $${spent}) ===`);
  if (dryRun) {
    console.log('dry run: would run `claude ' + mkArgs(perItem).join(' ') + '` with build-next.md on stdin');
    break;
  }
  const { code, out } = await runOnce();
  spent += perItem; // conservative: counts the cap, not the actual spend
  if (/QUEUE_EMPTY/.test(out)) {
    console.log('Queue empty.');
    break;
  }
  if (code !== 0) {
    console.error(`claude exited with code ${code} (budget, turn limit or error). Stopping so you can look.`);
    process.exit(code ?? 1);
  }
}
if (verifyAtEnd && pending() === 0 && !dryRun) {
  console.log('\n=== verification phase (the only test run) ===');
  // Headless runs cannot answer the confirmation question, so the procedure's confirmation step is answered here.
  const verifyText =
    readFileSync(verifyFile, 'utf8')
      .replace(/^---[\s\S]*?---\s*/, '')
      .replace('$ARGUMENTS', '') +
    '\n\nUnattended run: the user pre-approved verification by passing --verify-at-end. Skip the confirmation question and the final re-lock question (leave DEFER_TESTS as phase: verify).';
  const { code } = await runOnce(verifyText, verifyBudget);
  if (code !== 0) {
    console.error(`verification exited with code ${code}`);
    process.exit(code ?? 1);
  }
}
console.log(
  '\nLoop finished. Review: git status, git diff, then /pr-ready. Nothing was pushed.' +
    (verifyAtEnd ? '' : ' Tests have not been run: use /verify-all when every ticket is built.')
);
