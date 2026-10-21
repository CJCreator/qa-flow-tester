import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

// Source checks for T-50 wiring: start-up expiry, beta folder sweep, and save failures shown to the wizard.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(path.join(here, '..', 'src', 'server.ts'), 'utf8');
const planRouteSource = readFileSync(path.join(here, '..', 'src', 'routes', 'plan.ts'), 'utf8');

describe('T-50 start-up wiring in server.ts', () => {
  it('expires waiting plans on start and logs the count and names', () => {
    expect(serverSource).toContain('this.session.plan.expireWaiting(waitingPlanMaxAgeMs())');
    expect(serverSource).toContain('expired waiting plan(s)');
  });

  it('keeps beta session folders under the data folder and sweeps them on start', () => {
    expect(serverSource).toContain('if (this.beta) keepSessionFoldersIn(this.dataDir);');
    expect(serverSource).toContain('if (this.beta) await sweepSessionFolders();');
  });
});

describe('T-50 plan save failures reach the wizard', () => {
  it('uses the shared sentence for a failed save', () => {
    expect(planRouteSource).toContain(`const PLAN_SAVE_FAILED = "Couldn't save the plan. Try again.";`);
  });

  it('returns 500 with the sentence on the request paths that save', () => {
    const responses = planRouteSource.split('sendJson(res, 500, { error: PLAN_SAVE_FAILED });').length - 1;
    expect(responses).toBe(3);
  });

  it('reports a failed save in the background update as PLAN_UPDATE_FAILED', () => {
    expect(planRouteSource).toContain('throw new Error(PLAN_SAVE_FAILED);');
  });
});
