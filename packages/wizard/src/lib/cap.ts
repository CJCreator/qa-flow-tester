import type { RunCap } from '@qa/types';
import type { AiEstimate } from '../api.js';

/** Turns the cap text boxes into a cap, or undefined when nothing valid was typed. */
export function capFromInputs(requests: string, dollars: string): RunCap | undefined {
  const r = Number(requests.trim());
  const d = Number(dollars.trim());
  const cap: RunCap = {};
  if (requests.trim() && Number.isFinite(r) && r >= 1) cap.requests = Math.floor(r);
  if (dollars.trim() && Number.isFinite(d) && d > 0) cap.dollars = d;
  return cap.requests || cap.dollars ? cap : undefined;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * One plain sentence comparing the estimate with the person's cap. Dollars only show when the
 * estimate carries a price (the provider reported one); otherwise only requests are shown.
 */
export function capLine(estimate: Pick<AiEstimate, 'low' | 'high' | 'estimatedUsd'>, cap?: RunCap): string {
  const about = Math.round((estimate.low + estimate.high) / 2);
  const parts: string[] = [cap?.requests ? `About ${about} requests of your ${cap.requests} cap` : `About ${about} requests`];
  if (estimate.estimatedUsd !== undefined) {
    parts.push(
      cap?.dollars
        ? `about ${money(estimate.estimatedUsd)} of your ${money(cap.dollars)} cap`
        : `about ${money(estimate.estimatedUsd)}`
    );
  }
  let line = parts.join(', ') + '.';
  const over =
    (cap?.requests !== undefined && about > cap.requests) ||
    (cap?.dollars !== undefined && estimate.estimatedUsd !== undefined && estimate.estimatedUsd > cap.dollars);
  if (over) line += ' The cap is lower than the estimate, so the rest is planned with fixed rules.';
  return line;
}
