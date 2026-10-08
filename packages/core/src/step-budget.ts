/** Most time one test step may spend finding and acting on its element. */
export const DEFAULT_STEP_TIMEOUT_MS = 10_000;
export const MAX_STEP_TIMEOUT_MS = 300_000;

/** A usable cap from an option or env value; anything invalid gets the default. */
export function resolveStepTimeoutMs(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return DEFAULT_STEP_TIMEOUT_MS;
  return Math.min(n, MAX_STEP_TIMEOUT_MS);
}

export interface StepBudget {
  remaining(): number;
  spent(): boolean;
  /** A Playwright timeout cut to what is left. Never 0, because Playwright reads 0 as no timeout. */
  clamp(ms: number): number;
}

export function createStepBudget(
  capMs: number,
  startedAt: number = Date.now(),
  now: () => number = Date.now
): StepBudget {
  const remaining = (): number => Math.max(0, capMs - (now() - startedAt));
  return {
    remaining,
    spent: () => remaining() <= 0,
    clamp: (ms: number) => Math.max(1, Math.min(ms, remaining())),
  };
}
