// CHK-SECRETS: scans the files a commit would include (tracked files, plus new files git does not ignore) with the
// AI-EOS secret scanner. Git-ignored files (.env, generated reports, .claude/) are never read. Paths the .gitleaks.toml
// allowlist covers (fixtures and package tests, which hold fake keys on purpose) are left out, and findings whose value
// is a {{...}} template placeholder are dropped. Prints the rule, file and line only, never a value.
// Exit 0: no finding; 1: a finding; 2: usage error or the scan could not run.
// Usage: node scripts/scan-commit-secrets.mjs --aieos <path to aieos.mjs> [--root <repository>]
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_BUFFER = 64 * 1024 * 1024;

/** Paths (relative, with '/') that `git commit -A` would include. Ignored files are not listed, so never read. */
export function listCommitFiles(root) {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  if (r.status !== 0) throw new Error(`git ls-files failed in ${root}: ${(r.stderr || r.error?.message || '').trim()}`);
  // A nested repository is listed as 'dir/'; its files are not part of this commit.
  return [...new Set(r.stdout.split('\0'))].filter((f) => f && !f.endsWith('/'));
}

// Gitleaks writes regexes as '''literal''', 'literal' or "basic" TOML strings.
const TOML_STRING = /'''([\s\S]*?)'''|'([^'\n]*)'|"((?:[^"\\\n]|\\.)*)"/g;

/** Path regexes from the global allowlist(s) of a gitleaks config ([allowlist] or [[allowlists]]). */
export function parseGitleaksAllowlistPaths(toml) {
  const out = [];
  let section = '';
  const lines = toml.split(/\r?\n/);
  // The array is closed by a ']' outside its strings (a regex such as [^/] holds one too).
  const closed = (body) => body.replace(TOML_STRING, '').split('[').slice(1).join('[').includes(']');
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(lines[i]);
    if (header) {
      section = header[1];
      continue;
    }
    if (section !== 'allowlist' && section !== 'allowlists') continue;
    if (!/^\s*paths\s*=\s*\[/.test(lines[i])) continue;
    let body = lines[i];
    while (!closed(body) && i + 1 < lines.length) body += '\n' + lines[++i];
    for (const m of body.matchAll(TOML_STRING)) {
      const source = m[1] ?? m[2] ?? m[3].replace(/\\(.)/g, '$1');
      out.push(new RegExp(source));
    }
  }
  return out;
}

function allowlistPaths(root) {
  const file = path.join(root, '.gitleaks.toml');
  return existsSync(file) ? parseGitleaksAllowlistPaths(readFileSync(file, 'utf8')) : [];
}

const ENV_FILE = (rel) => {
  const base = rel.split('/').pop();
  return /^\.env(\..+)?$/.test(base) && !/\.(example|sample|template|dist)$/.test(base);
};

/** Copies the commit set, minus allowlisted paths, into dest. Only regular files: symbolic links are not followed. */
export function copyCommitSet(root, files, dest, allowlist) {
  let copied = 0;
  let allowlisted = 0;
  const envFiles = [];
  for (const rel of files) {
    if (allowlist.some((re) => re.test(rel))) {
      allowlisted++;
      continue;
    }
    const src = path.join(root, rel);
    let st;
    try {
      st = lstatSync(src);
    } catch {
      continue; // tracked but deleted in the working tree: nothing to commit
    }
    if (!st.isFile()) continue;
    // The scanner only spots committed env files through git, and the copy is not a repository.
    if (ENV_FILE(rel)) envFiles.push(rel);
    const target = path.join(dest, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(src, target);
    copied++;
  }
  return { copied, allowlisted, envFiles };
}

/**
 * True when the finding's value is a whole {{...}} placeholder. The scanner reports the value only as a preview
 * ("abcd…(N chars)"), so the value is found again on its line by those first characters and its length.
 */
export function isTemplatePlaceholder(finding, dir) {
  const m = /^(.{4})…\((\d+) chars\)$/su.exec(String(finding.preview ?? ''));
  if (!m || !m[1].startsWith('{{') || !finding.line) return false;
  const [, prefix, lengthText] = m;
  const length = Number(lengthText);
  let line;
  try {
    line = readFileSync(path.join(dir, finding.file), 'utf8').split(/\r?\n/)[finding.line - 1];
  } catch {
    return false;
  }
  if (line === undefined) return false;
  for (let i = line.indexOf(prefix); i !== -1; i = line.indexOf(prefix, i + 1)) {
    if (/^\{\{[^{}\r\n]+\}\}$/.test(line.slice(i, i + length))) return true;
  }
  return false;
}

function runScanner(aieos, dir) {
  const r = spawnSync(process.execPath, [aieos, 'scan', 'secrets', '--json', '--root', dir], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    data = null;
  }
  if (r.status !== 0 || !data || !Array.isArray(data.findings)) {
    const why = data?.error || (r.stderr || r.error?.message || '').trim().split('\n').pop() || 'no output';
    throw new Error(`the AI-EOS scanner did not run (exit ${r.status}): ${why}`);
  }
  return data;
}

export function scanCommitSet({ root, aieos }) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'qa-commit-scan-'));
  try {
    const files = listCommitFiles(root);
    const { copied, allowlisted, envFiles } = copyCommitSet(root, files, tmp, allowlistPaths(root));
    const { findings: scanned } = runScanner(aieos, tmp);
    const kept = scanned.filter((f) => !isTemplatePlaceholder(f, tmp));
    const envFindings = envFiles.map((file) => ({ file, rule: 'committed-env-file', severity: 'high', line: null }));
    return { copied, allowlisted, placeholders: scanned.length - kept.length, findings: [...kept, ...envFindings] };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const name = /^--(aieos|root)$/.exec(argv[i])?.[1];
    if (!name || i + 1 >= argv.length) return null;
    opts[name] = argv[++i];
  }
  return opts.aieos ? opts : null;
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts) {
    console.error('Usage: node scripts/scan-commit-secrets.mjs --aieos <path to aieos.mjs> [--root <repository>]');
    return 2;
  }
  const root = path.resolve(opts.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  if (!existsSync(opts.aieos)) {
    console.error(`The AI-EOS scanner was not found at ${opts.aieos}.`);
    return 2;
  }
  let result;
  try {
    result = scanCommitSet({ root, aieos: path.resolve(opts.aieos) });
  } catch (err) {
    console.error(`Secret scan could not run: ${err.message}`);
    return 2;
  }
  const { copied, allowlisted, placeholders, findings } = result;
  const summary =
    `Scanned ${copied} file(s) that would be committed (${allowlisted} left out by the .gitleaks.toml allowlist, ` +
    `${placeholders} {{...}} placeholder(s) ignored): ${findings.length} finding(s). Values are not printed.`;
  if (findings.length === 0) {
    console.log(summary);
    return 0;
  }
  console.error(summary);
  for (const f of findings) {
    console.error(`  [${f.severity}] ${f.rule} ${f.file}${f.line ? `:${f.line}` : ''}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
