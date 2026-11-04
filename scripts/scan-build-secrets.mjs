// Fails when build output (the wizard bundle, the runner image's files) contains an AI provider key.
// Prints the file and the pattern name only, never the matched value. Every regular file is read, binary files
// included; symbolic links are not followed.
// Exit 0: no key found; 1: a key was found; 2: usage error, or a folder or file that could not be read.
// Usage: node scripts/scan-build-secrets.mjs <dir> [<dir>...]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The key must not continue a longer token (a letter, digit, '-' or '_' right before it).
const START = '(?<![A-Za-z0-9_-])';

export const AI_KEY_PATTERNS = [
  { name: 'anthropic-api-key', re: new RegExp(`${START}sk-ant-[A-Za-z0-9_-]{20,}`) },
  { name: 'openrouter-api-key', re: new RegExp(`${START}sk-or-[A-Za-z0-9_-]{20,}`) },
  // Every OpenAI key format (legacy, project, service account, admin) contains T3BlbkFJ, base64 for "OpenAI".
  { name: 'openai-api-key', re: new RegExp(`${START}sk-[A-Za-z0-9_-]{16,}T3BlbkFJ[A-Za-z0-9_-]{16,}`) },
  { name: 'google-ai-api-key', re: new RegExp(`${START}AIza[0-9A-Za-z_-]{35}`) },
];

/** Names of the key patterns found in the text. */
export function findKeyPatterns(text) {
  return AI_KEY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

/** Walks a folder. Findings are `{ file, pattern }` with the file relative to the folder, never the value. */
export function scanDir(dir) {
  const findings = [];
  const unreadable = [];
  let scanned = 0;
  const walk = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      unreadable.push(toPosix(path.relative(dir, abs)) || '.');
      return;
    }
    for (const e of entries) {
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = toPosix(path.relative(dir, full));
      let text;
      try {
        // latin1 maps every byte to one character, so ASCII key patterns match in binary files too.
        text = readFileSync(full).toString('latin1');
      } catch {
        unreadable.push(rel);
        continue;
      }
      scanned++;
      for (const pattern of findKeyPatterns(text)) findings.push({ file: rel, pattern });
    }
  };
  walk(dir);
  return { scanned, findings, unreadable };
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function main(argv = process.argv.slice(2)) {
  const dirs = argv.filter((a) => !a.startsWith('--'));
  if (dirs.length === 0 || dirs.length !== argv.length) {
    console.error('Usage: node scripts/scan-build-secrets.mjs <dir> [<dir>...]');
    return 2;
  }
  let code = 0;
  for (const dir of dirs) {
    const { scanned, findings, unreadable } = scanDir(path.resolve(dir));
    for (const f of findings) console.error(`${dir}: ${f.file}: ${f.pattern}`);
    for (const f of unreadable) console.error(`${dir}: ${f}: could not be read`);
    if (findings.length > 0) {
      console.error(
        `${dir}: ${findings.length} AI provider key(s) found in ${scanned} file(s). Values are not printed. Remove the key from the build, rotate it, and rebuild.`
      );
      code = 1;
    } else if (unreadable.length > 0 || scanned === 0) {
      const why = scanned === 0 ? 'no file to scan' : 'some files could not be read';
      console.error(`${dir}: ${why}, so it is not known to be free of keys.`);
      if (code === 0) code = 2;
    } else {
      console.log(`${dir}: no AI provider key in ${scanned} file(s).`);
    }
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
