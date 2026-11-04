import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// BE-607 (REQ-029, REQ-028): the deploy passes the Website Audit bucket and the Firebase settings to the runner,
// and docs/DEPLOYMENT.md documents the one-time bucket and Firebase setup (ADR 0036, Q-30, Q-44).
const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const NAMES = ['AUDIT_STORE_BUCKET', 'FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY', 'FIREBASE_AUTH_DOMAIN'];

/** The runner job's "Deploy to Cloud Run" step, up to the next step. */
function runnerDeployStep(yml: string): string {
  const job = yml.slice(yml.indexOf('\n  cloud-run:'), yml.indexOf('\n  site:'));
  const start = job.indexOf('- name: Deploy to Cloud Run');
  expect(start).toBeGreaterThan(-1);
  const next = job.indexOf('\n      - name:', start + 1);
  return job.slice(start, next === -1 ? undefined : next);
}

/**
 * Splits a gcloud list or dict flag value into its items the way gcloud does (`gcloud topic escaping`):
 * items are separated by commas, unless the value starts with `^DELIM^`, which makes DELIM the separator.
 * A trailing separator is ignored. gcloud then needs every dict item to be KEY=value
 * ("Bad syntax for dict arg" otherwise).
 */
function gcloudItems(raw: string): string[] {
  let delim = ',';
  let body = raw;
  if (raw.startsWith('^') && raw.indexOf('^', 1) !== -1) {
    const end = raw.indexOf('^', 1);
    delim = raw.slice(1, end);
    body = raw.slice(end + 1);
    if (!delim) throw new Error('Invalid delimiter (gcloud topic escaping)');
  }
  if (!body) return [];
  if (!body.endsWith(delim)) body += delim;
  return body.split(delim).slice(0, -1);
}

/** KEY=value items as a map, split on the first `=` like gcloud. Items without `=` are left out. */
function gcloudDict(items: string[]): Map<string, string> {
  const dict = new Map<string, string>();
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq > 0) dict.set(item.slice(0, eq), item.slice(eq + 1));
  }
  return dict;
}

const DICT_ITEM = /^[A-Z][A-Z0-9_]*=/;
const SECOND_ORIGIN = 'https://qa-check-up-cnhl7suwnq-uc.a.run.app';

describe('the gcloud flag parser used below', () => {
  // F-032: the comma-only form gcloud rejected. It must not pass the checks below.
  const old = `RUNNER_BETA=1,RUNNER_ALLOWED_ORIGINS=$RUNNER_URL,${SECOND_ORIGIN},AUDIT_STORE_BUCKET=$AUDIT_STORE_BUCKET`;

  it('splits the old comma-only line so the second origin is a bad item', () => {
    const items = gcloudItems(old);
    expect(items.filter((i) => !DICT_ITEM.test(i))).toEqual([SECOND_ORIGIN]);
    expect(gcloudDict(items).get('RUNNER_ALLOWED_ORIGINS')).toBe('$RUNNER_URL');
  });

  it('keeps commas inside a value with the ^DELIM^ prefix', () => {
    const items = gcloudItems(`^@^A=1@B=x,y@C=`);
    expect(items).toEqual(['A=1', 'B=x,y', 'C=']);
    expect(gcloudDict(items).get('B')).toBe('x,y');
    expect(gcloudItems('^@^A=1@')).toEqual(['A=1']);
    expect(() => gcloudItems('^^A=1')).toThrow(/Invalid delimiter/);
  });
});

describe('deploy.yml passes the Website Audit settings to the runner', () => {
  const yml = read('.github/workflows/deploy.yml');
  const step = runnerDeployStep(yml);
  const setEnvVars = /--set-env-vars "([^"]*)"/.exec(step)?.[1] ?? '';
  const items = gcloudItems(setEnvVars);
  const env = gcloudDict(items);

  it.each(NAMES)('%s comes from a repository variable and reaches Cloud Run', (name) => {
    expect(step).toContain(`${name}: \${{ vars.${name} }}`);
    expect(items).toContain(`${name}=$${name}`);
    expect(env.get(name)).toBe(`$${name}`);
  });

  it('gives gcloud only KEY=value items, each key once (F-032)', () => {
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toMatch(DICT_ITEM);
    expect(env.size).toBe(items.length);
  });

  it('passes both allowed origins as one RUNNER_ALLOWED_ORIGINS value (F-032)', () => {
    expect(env.get('RUNNER_ALLOWED_ORIGINS')).toBe(`$RUNNER_URL,${SECOND_ORIGIN}`);
    expect(env.get('RUNNER_ALLOWED_ORIGINS')?.split(',')).toEqual(['$RUNNER_URL', SECOND_ORIGIN]);
  });

  it('never takes these public values from secrets or writes a value into the file', () => {
    for (const name of NAMES) {
      expect(yml).not.toContain(`secrets.${name}`);
      expect(yml).not.toMatch(new RegExp(`${name}=[^$,"]`));
    }
  });

  it('keeps the existing env vars, the access-token secret and the main-only trigger', () => {
    for (const kept of [
      'RUNNER_BETA=1',
      'RUNNER_HOST=0.0.0.0',
      'RUNNER_DATA_DIR=/tmp/qa-data',
      'RUNNER_OUTPUT_DIR=/tmp/qa-data/reports',
      'RUNNER_ALLOWED_ORIGINS=$RUNNER_URL',
    ]) {
      expect(setEnvVars).toContain(kept);
    }
    expect(env.get('RUNNER_BETA')).toBe('1');
    expect(env.get('RUNNER_HOST')).toBe('0.0.0.0');
    expect(env.get('RUNNER_DATA_DIR')).toBe('/tmp/qa-data');
    expect(env.get('RUNNER_OUTPUT_DIR')).toBe('/tmp/qa-data/reports');
    expect(step).toContain('--set-secrets "RUNNER_ACCESS_TOKEN=qa-access-token:latest"');
    expect(yml).toMatch(/branches: \[main\]/);
    expect(yml).not.toContain('tags:');
  });

  it('the static site deploy gets none of them', () => {
    const site = yml.slice(yml.indexOf('\n  site:'));
    for (const name of NAMES) expect(site).not.toContain(name);
  });
});

describe('docs/DEPLOYMENT.md documents the bucket and Firebase setup', () => {
  const doc = read('docs/DEPLOYMENT.md');
  const start = doc.indexOf('## Website Audit storage and Helper sign-in');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));

  it('has the section', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('creates the bucket in an always-free region with the access settings', () => {
    expect(section).toMatch(/gcloud storage buckets create gs:\/\/\S+/);
    expect(section).toMatch(/--location (us-central1|us-east1|us-west1)\b/);
    expect(section).toContain('--default-storage-class STANDARD');
    expect(section).toContain('--uniform-bucket-level-access');
    expect(section).toContain('--public-access-prevention');
  });

  it('keeps nothing after deletion and expires nothing (Q-30)', () => {
    expect(section).toContain('--soft-delete-duration=0');
    expect(section).toContain('--clear-soft-delete');
    expect(section).toContain('--no-versioning');
    expect(section).toContain('--clear-lifecycle');
    expect(section).toMatch(/no lifecycle rule/i);
    expect(section).not.toMatch(/--lifecycle-file|--retention-period/);
  });

  it('grants the runtime service account objectAdmin on that bucket only', () => {
    expect(section).toMatch(/gcloud storage buckets add-iam-policy-binding gs:\/\/\S+/);
    expect(section).toContain('--role roles/storage.objectAdmin');
    expect(section).not.toContain('gcloud projects add-iam-policy-binding');
  });

  it('lists the Firebase setup for Google sign-in in the same project (Q-44)', () => {
    expect(section).toContain('firebase projects:addfirebase qa-flow-tester-512310');
    expect(section).toContain('identitytoolkit.googleapis.com');
    expect(section).toMatch(/firebase apps:create web/);
    expect(section).toMatch(/enable \*\*Google\*\*/);
    expect(section).toMatch(/Authorized domains/);
  });

  it('names every repository variable the deploy reads', () => {
    for (const name of NAMES) expect(section).toContain(`\`${name}\``);
  });

  it('says local runs keep plain files and need no cloud account (REQ-029 AC-1)', () => {
    expect(section).toContain('Local runs need none of this');
    expect(section).toContain('<RUNNER_DATA_DIR>/audit-store/');
    expect(section).toMatch(/no cloud\s+account/);
  });

  it('says audits and Shared Links live in the bucket on the hosted copy', () => {
    expect(section).toMatch(/hosted copy[\s\S]*Website Audits and Shared Links live in one Cloud Storage bucket/);
  });
});
