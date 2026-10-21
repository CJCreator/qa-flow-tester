import { promises as fs } from 'fs';
import path from 'path';
import type { RoleCredential, StorageStateData } from '@qa/types';
import { SECRET_PARAM_NAMES } from '@qa/checkers';

export const REDACTED = '***';

/** The value of a secret-looking URL parameter, in a query or a fragment, wherever a URL appears in text. */
const SECRET_PARAM_IN_TEXT = new RegExp(`([?&#](?:${SECRET_PARAM_NAMES})=)[^&#\\s"'<>)]*`, 'gi');
/** The token segment of a reset, verify, invite or similar link: /reset/<token>. */
const SECRET_PATH_IN_TEXT = /(\/(?:reset|verify|confirm|activate|invite|magic)\/)[^/?#\s"'<>)]+/gi;

/** Hides the values of secret-looking URL parameters and path tokens in any text. */
export function redactUrl(text: string): string {
  return text.replace(SECRET_PARAM_IN_TEXT, `$1${REDACTED}`).replace(SECRET_PATH_IN_TEXT, `$1${REDACTED}`);
}

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** The forms one secret takes once it is escaped for HTML, JSON or a URL, so each copy in a file is found. */
function secretForms(value: string): string[] {
  const htmlEscape = (quote: string) => value.replace(/[&<>"']/g, (ch) => (ch === "'" ? quote : HTML_ENTITIES[ch]));
  return [
    value,
    htmlEscape('&#39;'),
    htmlEscape('&#x27;'),
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    encodeURIComponent(value).replace(/%20/g, '+'),
    // The form encoding URLSearchParams writes (space as +, and ! ' ( ) encoded too).
    new URLSearchParams([['v', value]]).toString().slice(2),
  ];
}

const TEXT_EVIDENCE = new Set([
  '.html', '.htm', '.ts', '.js', '.json', '.md', '.txt', '.log', '.csv', '.xml', '.yml', '.yaml', '.svg', '.har',
]);

/** Everything a run keeps secret. Short header, tunnel and cookie values are skipped: they match ordinary words. */
export interface RunSecretSource {
  roles?: Array<Partial<RoleCredential>>;
  customHeaders?: Record<string, string>;
  tunnelAuth?: string;
  cookies?: Array<{ name?: string; value?: string }>;
  targetUrl?: string;
}

/**
 * The one list of secrets a run hides: role sign-in details, custom header values, tunnel authorization,
 * session cookies, and the secret-looking parameters of the target URL. Shared by the orchestrator,
 * the runner's run and error paths, so every path hides the same values.
 */
export function runSecrets(source: RunSecretSource): Array<Partial<RoleCredential>> {
  const short = (v: unknown): v is string => typeof v === 'string' && v.length >= 3;
  const secrets: Array<Partial<RoleCredential>> = [...(source.roles || [])];
  for (const val of Object.values(source.customHeaders ?? {})) if (short(val)) secrets.push({ token: val });
  if (short(source.tunnelAuth)) secrets.push({ token: source.tunnelAuth });
  for (const c of source.cookies ?? []) {
    if (short(c.name)) secrets.push({ token: c.name });
    if (short(c.value)) secrets.push({ token: c.value });
  }
  if (source.targetUrl) {
    try {
      for (const val of new URL(source.targetUrl).searchParams.values()) if (short(val)) secrets.push({ token: val });
    } catch {
      // Not a URL: nothing in it to hide.
    }
  }
  return secrets;
}

/**
 * The cookie names and values in saved sign-in sessions. A role's session is either its storage state
 * or the file it was saved to; a missing or unreadable file contributes nothing.
 */
export async function sessionCookies(
  states: Record<string, string | StorageStateData | undefined> | undefined
): Promise<Array<{ name?: string; value?: string }>> {
  const out: Array<{ name?: string; value?: string }> = [];
  for (const state of Object.values(states ?? {})) {
    const data: Partial<StorageStateData> | null =
      typeof state === 'string'
        ? await fs
            .readFile(state, 'utf8')
            .then((text) => JSON.parse(text) as Partial<StorageStateData>)
            .catch(() => null)
        : state ?? null;
    const cookies: unknown = data?.cookies;
    if (!Array.isArray(cookies)) continue;
    for (const c of cookies as Array<{ name?: unknown; value?: unknown }>) {
      if (!c || typeof c !== 'object') continue;
      out.push({
        name: typeof c.name === 'string' ? c.name : undefined,
        value: typeof c.value === 'string' ? c.value : undefined,
      });
    }
  }
  return out;
}

/**
 * Keeps a run's credentials out of everything it writes or streams: passwords and tokens always,
 * usernames when they are email addresses (a plain username like "admin" would blank out ordinary
 * words), and the values of secret-looking URL parameters.
 */
export class Redactor {
  private readonly values = new Set<string>();
  private secrets: string[] = [];

  constructor(credentials: Array<Partial<RoleCredential>> = []) {
    this.add(credentials);
  }

  /** Hides more secrets from here on (e.g. session cookies known only after sign-in). What is hidden stays hidden. */
  add(credentials: Array<Partial<RoleCredential>>): void {
    for (const c of credentials) {
      // Any non-empty role credential, however short: a two-character password is still a password.
      for (const secret of [c.password, c.token]) if (secret) this.values.add(secret);
      if (c.username && c.username.includes('@')) this.values.add(c.username);
    }
    // Longest first, so a secret that contains another is hidden whole. Escaped forms too, as
    // they appear in HTML, JSON and URLs.
    this.secrets = [...this.values]
      .flatMap(secretForms)
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
