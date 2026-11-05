import { promises as fs } from 'fs';
import path from 'path';
import type { RoleCredential } from '@qa/types';
import { SECRET_PARAM_NAMES } from '@qa/checkers';

export const REDACTED = '***';

/**
 * Parameter names whose values are hidden in any URL text: the checkers' list, plus OAuth and signed-URL
 * names (`code`, `signature`, every `x-amz-*`). Kept here, so the checker's own finding rule is unchanged.
 */
const URL_SECRET_PARAM_NAMES = `${SECRET_PARAM_NAMES}|code|signature|x-amz-[a-z0-9-]+`;

/** The value of a secret-looking URL parameter, query or fragment (`#access_token=`), wherever a URL appears in text. */
const SECRET_PARAM_IN_TEXT = new RegExp(`([?&#](?:${URL_SECRET_PARAM_NAMES})=)[^&#\\s"'<>)]*`, 'gi');

/**
 * A long opaque path segment (a reset or invite token in the path): 32 or more letters, digits, `-` or `_`,
 * with at least one letter and one digit. Ordinary slugs are short or have no digits and are kept.
 */
const TOKEN_PATH_SEGMENT = /(\/)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}/g;

/** Hides the values of secret-looking URL parameters and token-looking path segments in any text. */
export function redactUrl(text: string): string {
  return text.replace(SECRET_PARAM_IN_TEXT, `$1${REDACTED}`).replace(TOKEN_PATH_SEGMENT, `$1${REDACTED}`);
}

const TEXT_EVIDENCE = new Set([
  '.html',
  '.htm',
  '.ts',
  '.js',
  '.json',
  '.md',
  '.txt',
  '.log',
  '.csv',
  '.xml',
  '.yml',
  '.yaml',
  '.svg',
  '.har',
]);

const NAMED_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * The forms a secret takes inside text: as typed, URL-encoded (with `+` for a space too), HTML-escaped
 * (named and numeric entities), and JSON-escaped (`\"` and `\uXXXX`).
 */
function secretForms(v: string): string[] {
  const codePoints = Array.from(v);
  // Non-ASCII characters as \uXXXX, the way a JSON encoder with ASCII output writes them.
  const unicodeEscapes = v.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return [
    v,
    encodeURIComponent(v),
    encodeURIComponent(v).replace(/%20/g, '+'),
    v.replace(/[&<>"']/g, (c) => NAMED_ENTITIES[c] ?? c),
    v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    codePoints.map((c) => `&#${c.codePointAt(0)};`).join(''),
    codePoints.map((c) => `&#x${(c.codePointAt(0) ?? 0).toString(16)};`).join(''),
    JSON.stringify(v).slice(1, -1),
    unicodeEscapes,
  ];
}

/** Secrets shorter than this are not scrubbed (default 3). See the Redactor option for the tradeoff. */
const DEFAULT_MIN_SECRET_LENGTH = 3;

export interface RedactorOptions {
  /**
   * Shortest secret scrubbed from text. Default 3. Lowering it to 1 scrubs every occurrence of a one-character
   * token, which also blanks out ordinary text that contains that character. Use 1 only for a single-character
   * token, on text nobody reads.
   */
  minSecretLength?: number;
}

/**
 * Keeps a run's credentials out of everything it writes or streams: passwords and tokens always,
 * usernames when they are email addresses (a plain username like "admin" would blank out ordinary
 * words), and the values of secret-looking URL parameters.
 */
export class Redactor {
  private readonly secrets: string[];

  constructor(credentials: Array<Partial<RoleCredential>> = [], opts: RedactorOptions = {}) {
    const minLength = opts.minSecretLength ?? DEFAULT_MIN_SECRET_LENGTH;
    const values = new Set<string>();
    for (const c of credentials) {
      for (const secret of [c.password, c.token]) if (secret && secret.length >= minLength) values.add(secret);
      if (c.username && c.username.includes('@')) values.add(c.username);
    }
    // Longest first, so a secret that contains another is hidden whole. Encoded and escaped forms too.
    this.secrets = [...values]
      .flatMap(secretForms)
      .filter((v, i, all) => v.length > 0 && all.indexOf(v) === i)
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
