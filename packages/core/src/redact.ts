import { promises as fs } from 'fs';
import path from 'path';
import type { RoleCredential } from '@qa/types';
import { SECRET_PARAM_NAMES } from '@qa/checkers';

export const REDACTED = '***';

/** The value of a secret-looking URL parameter, wherever a URL appears in text. */
const SECRET_PARAM_IN_TEXT = new RegExp(`([?&](?:${SECRET_PARAM_NAMES})=)[^&#\\s"'<>)]*`, 'gi');

/** Hides the values of secret-looking URL parameters in any text. */
export function redactUrl(text: string): string {
  return text.replace(SECRET_PARAM_IN_TEXT, `$1${REDACTED}`);
}

const TEXT_EVIDENCE = new Set(['.html', '.htm', '.ts', '.js', '.json', '.md', '.txt', '.log']);

/**
 * Keeps a run's credentials out of everything it writes or streams: passwords and tokens always,
 * usernames when they are email addresses (a plain username like "admin" would blank out ordinary
 * words), and the values of secret-looking URL parameters.
 */
export class Redactor {
  private readonly secrets: string[];

  constructor(credentials: Array<Partial<RoleCredential>> = []) {
    const values = new Set<string>();
    for (const c of credentials) {
      for (const secret of [c.password, c.token]) if (secret && secret.length >= 3) values.add(secret);
      if (c.username && c.username.includes('@')) values.add(c.username);
    }
    // Longest first, so a secret that contains another is hidden whole. Encoded forms too, as
    // they appear in URLs.
    this.secrets = [...values]
      .flatMap((v) => [v, encodeURIComponent(v), encodeURIComponent(v).replace(/%20/g, '+')])
      .filter((v, i, all) => all.indexOf(v) === i)
      .sort((a, b) => b.length - a.length);
  }

  text(input: string): string {
    let out = redactUrl(input);
    for (const secret of this.secrets) out = out.split(secret).join(REDACTED);
    return out;
  }

  /** A redacted copy of any JSON-shaped value: every string in it, at any depth. */
  deep<T>(value: T): T {
    if (typeof value === 'string') return this.text(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.deep(v)) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.deep(v)])) as T;
    }
    return value;
  }

  /** Redacts every text evidence file under a folder, in place (DOM snapshots, repro scripts, logs). */
  async files(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.files(full);
      } else if (TEXT_EVIDENCE.has(path.extname(entry.name).toLowerCase())) {
        const content = await fs.readFile(full, 'utf8');
        const redacted = this.text(content);
        if (redacted !== content) await fs.writeFile(full, redacted, 'utf8');
      }
    }
  }
}
