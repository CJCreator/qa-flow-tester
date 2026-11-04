import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ADR 0039: the deploy passes SCHEDULER_SERVICE_ACCOUNT to the runner, and the docs hold the one-time Cloud Scheduler setup.
const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** The runner job's "Deploy to Cloud Run" step, up to the next step. */
function runnerDeployStep(yml: string): string {
  const job = yml.slice(yml.indexOf('\n  cloud-run:'), yml.indexOf('\n  site:'));
  const start = job.indexOf('- name: Deploy to Cloud Run');
  expect(start).toBeGreaterThan(-1);
  const next = job.indexOf('\n      - name:', start + 1);
  return job.slice(start, next === -1 ? undefined : next);
}

/** Splits a gcloud dict flag value the way gcloud does (`gcloud topic escaping`): `^DELIM^` picks the separator. */
function gcloudItems(raw: string): string[] {
  let delim = ',';
  let body = raw;
  if (raw.startsWith('^') && raw.indexOf('^', 1) !== -1) {
    const end = raw.indexOf('^', 1);
    delim = raw.slice(1, end);
    body = raw.slice(end + 1);
  }
  if (!body) return [];
  if (!body.endsWith(delim)) body += delim;
  return body.split(delim).slice(0, -1);
}

describe('deploy.yml passes SCHEDULER_SERVICE_ACCOUNT to the runner', () => {
  const yml = read('.github/workflows/deploy.yml');
  const step = runnerDeployStep(yml);
  const setEnvVars = /--set-env-vars "([^"]*)"/.exec(step)?.[1] ?? '';
  const items = gcloudItems(setEnvVars);

  it('reads it from a repository variable and passes it as one dict item', () => {
    expect(step).toContain('SCHEDULER_SERVICE_ACCOUNT: ${{ vars.SCHEDULER_SERVICE_ACCOUNT }}');
    expect(items).toContain('SCHEDULER_SERVICE_ACCOUNT=$SCHEDULER_SERVICE_ACCOUNT');
  });

  it('uses "#" as the separator, because the service account email contains "@"', () => {
    expect(setEnvVars.startsWith('^#^')).toBe(true);
    expect(setEnvVars.slice(3)).not.toContain('@');
    for (const item of items) expect(item).toMatch(/^[A-Z][A-Z0-9_]*=/);
  });

  it('keeps the origin list as one value and the other flags unchanged', () => {
    const origins = items.find((i) => i.startsWith('RUNNER_ALLOWED_ORIGINS='));
    expect(origins?.split('=')[1]?.split(',').length).toBe(2);
    expect(step).toContain('--timeout 3600');
    expect(step).toContain('--min-instances 1 --max-instances 1');
    expect(step).not.toContain('--no-cpu-throttling');
  });

  it('never takes it from secrets, and the site deploy gets none of it', () => {
    expect(yml).not.toContain('secrets.SCHEDULER_');
    expect(yml.slice(yml.indexOf('\n  site:'))).not.toContain('SCHEDULER_SERVICE_ACCOUNT');
  });
});

describe('docs/DEPLOYMENT.md documents the Cloud Scheduler setup', () => {
  const doc = read('docs/DEPLOYMENT.md');
  const start = doc.indexOf('## Scheduled Check-ups on the hosted copy');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));

  it('has the section', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('lists the exact commands and flags', () => {
    for (const text of [
      'gcloud services enable cloudscheduler.googleapis.com',
      'gcloud scheduler jobs create http',
      '--oidc-service-account-email',
      '--oidc-token-audience',
      '--attempt-deadline 1800s',
      '--max-retry-attempts 0',
      'roles/iam.serviceAccountTokenCreator',
      '`SCHEDULER_SERVICE_ACCOUNT`',
    ]) {
      expect(section).toContain(text);
    }
  });

  it('never gives the job the access key', () => {
    expect(section).not.toContain('--headers');
    expect(section).not.toContain('X-QA-Access');
  });
});

describe('ADR 0039', () => {
  const dir = resolve(root, 'docs/adr');
  const file = readdirSync(dir).find((f) => f.startsWith('0039-'));

  it('exists with the four sections and links the ADRs it builds on', () => {
    expect(file).toBeTruthy();
    expect(existsSync(resolve(dir, file ?? ''))).toBe(true);
    const text = read(`docs/adr/${file}`);
    for (const h of ['## Context', '## Decision', '## Consequences', '## Alternatives considered']) {
      expect(text).toContain(h);
    }
    for (const n of ['0027', '0032', '0036', '0037', '0038']) expect(text).toContain(`(${n}-`);
  });

  it('is cross-linked from ADR 0037', () => {
    expect(read('docs/adr/0037-route-access-levels.md')).toContain('Amended by [0039]');
  });
});
